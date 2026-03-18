from firebase_functions import firestore_fn
from core.logger import get_logger
from .models import ProductState

logger = get_logger(__name__)

class EnrichmentController:
    """
    The central routing engine and State Machine for the AI Admin Lab Monolith.
    It receives generic Firestore trigger events, validates the state, and directs them
    to the appropriate isolated AI Agents.
    """

    @staticmethod
    def handle_trigger(event: firestore_fn.Event[firestore_fn.Change[firestore_fn.DocumentSnapshot]]) -> None:
        """Main dispatcher attached to the Firestore `on_document_written` trigger."""
        try:
            new_doc = event.data.after
            if not new_doc or not new_doc.exists:
                return # Document deleted, do nothing
                
            data = new_doc.to_dict()
            if not data:
                return
                
            status_str = data.get("status")
            sku = data.get("sku")
            
            old_doc = event.data.before
            old_data = old_doc.to_dict() if old_doc and old_doc.exists else {}
            old_status_str = old_data.get("status")
            
            if status_str and status_str == old_status_str:
                # State has not changed. Ignore this update to prevent trigger loops from agent logging.
                return
            
            
            # Map raw string to strict Enum
            try:
                state = ProductState(status_str)
            except ValueError:
                logger.warning(f"Unknown or legacy status '{status_str}' for SKU {sku}. Ignoring.")
                return

            logger.info(f"Controller routing {sku} at State: {state.value}")

            # STATE MACHINE ROUTER
            if state == ProductState.GENERATING_METADATA:
                EnrichmentController._route_to_metadata_agent(new_doc.reference, data)
            
            elif state == ProductState.RESOLVING_VARIANTS:
                EnrichmentController._route_to_variant_agent(new_doc.reference, data)
                
            elif state == ProductState.SOURCING_IMAGES:
                EnrichmentController._route_to_vision_agent_sourcing(new_doc.reference, data)
                
            elif state == ProductState.REMOVING_SOURCE_BACKGROUND:
                EnrichmentController._route_to_utility_agent(new_doc.reference, data, mode="source")
                
            elif state == ProductState.GENERATING_STUDIO:
                EnrichmentController._route_to_vision_agent_studio(new_doc.reference, data)
                
            elif state == ProductState.REMOVING_BACKGROUND:
                EnrichmentController._route_to_utility_agent(new_doc.reference, data, mode="generated")
                
            # Idle / Error / Checkpoint States (No autonomous backend action)
            elif state in [
                ProductState.IMPORTED,
                ProductState.BATCH_GENERATING,
                ProductState.RAW_INGESTED,
                ProductState.NEEDS_METADATA_REVIEW,
                ProductState.NEEDS_IMAGE_REVIEW,
                ProductState.READY_FOR_PUBLISH,
                ProductState.PUBLISHED,
                ProductState.FAILED,
                ProductState.PUBLISHING,
                ProductState.DELAYED_RETRY
            ]:
                # The system is waiting on the Human-in-the-Loop (Frontend)
                # or an external publisher cron to move the state forward.
                pass
                
        except Exception as e:
            logger.error(f"Global Controller Error: {e}", exc_info=True)
            # Try a failsafe update to prevent hanging
            try:
                event.data.after.reference.update({
                    "status": "FAILED",
                    "enrichment_message": f"Global Engine Error: {str(e)[:100]}"
                })
            except Exception:
                pass

    @staticmethod
    def _handle_agent_failure(doc_ref, data: dict, error_message: str, max_retries=2):
        failed_attempts = data.get("failed_attempts", 0) + 1
        last_error = data.get("last_error_message", "")
        current_state = data.get("status", "")
        
        # Detect if this is a known rate limit we should tolerate natively
        is_rate_limit = "429" in str(error_message) or "RESOURCE_EXHAUSTED" in str(error_message) or "quota" in str(error_message).lower()
        
        # If the exact same error happens consecutively, fail immediately to prevent pointless loops
        # UNLESS it's a rate limit error, which we expect to repeat until quota resets
        if error_message == last_error and not is_rate_limit:
            status = ProductState.FAILED.value
            enrich_msg = f"{error_message} (Identical consecutive error. Aborting.)"
        elif failed_attempts <= max_retries:
            status = ProductState.DELAYED_RETRY.value
            enrich_msg = f"{error_message} (Attempt {failed_attempts}/{max_retries}. Auto-retry pending.)"
        else:
            status = ProductState.FAILED.value
            enrich_msg = f"{error_message} (Max retries reached.)"
            
        update_payload = {
            "status": status,
            "enrichment_message": enrich_msg,
            "failed_attempts": failed_attempts,
            "last_error_message": error_message
        }
        
        # Always remember where we failed so we can cleanly resume later
        update_payload["failed_at_state"] = current_state
        if status == ProductState.DELAYED_RETRY.value:
            update_payload["retry_target_state"] = current_state
            
        try:
            if doc_ref.get().exists:
                doc_ref.update(update_payload)
            else:
                logger.warning(f"Failed to record {current_state} state: Product {doc_ref.id} no longer exists.")
        except Exception as update_err:
            logger.error(f"Failed to record failure state: {update_err}")

    @staticmethod
    def _route_to_metadata_agent(doc_ref, data: dict):
        from .agents.metadata_agent import MetadataAgent
        try:
            MetadataAgent.process(doc_ref, data)
        except Exception as e:
            logger.error(f"MetadataAgent Failed: {e}")
            EnrichmentController._handle_agent_failure(doc_ref, data, f"Metadata Error: {str(e)[:100]}")

    @staticmethod
    def _route_to_variant_agent(doc_ref, data: dict):
        from .agents.variant_agent import VariantAgent
        try:
            VariantAgent.process(doc_ref, data)
        except Exception as e:
            logger.error(f"VariantAgent Failed: {e}")
            EnrichmentController._handle_agent_failure(doc_ref, data, f"Variant Error: {str(e)[:100]}")

    @staticmethod
    def _route_to_vision_agent_sourcing(doc_ref, data: dict):
        from .agents.vision_agent import VisionAgent
        try:
            VisionAgent.source_images(doc_ref, data)
        except Exception as e:
            logger.error(f"VisionAgent(Sourcing) Failed: {e}")
            EnrichmentController._handle_agent_failure(doc_ref, data, f"Sourcing Error: {str(e)[:100]}")

    @staticmethod
    def _route_to_vision_agent_studio(doc_ref, data: dict):
        from .agents.vision_agent import VisionAgent
        try:
            VisionAgent.generate_studio(doc_ref, data)
        except Exception as e:
            logger.error(f"VisionAgent(Studio) Failed: {e}")
            EnrichmentController._handle_agent_failure(doc_ref, data, f"Studio Error: {str(e)[:100]}")

    @staticmethod
    def _route_to_utility_agent(doc_ref, data: dict, mode="generated"):
        from .agents.utility_agent import UtilityAgent
        try:
            UtilityAgent.remove_backgrounds(doc_ref, data, mode=mode)
        except Exception as e:
            logger.error(f"UtilityAgent Failed: {e}")
            EnrichmentController._handle_agent_failure(doc_ref, data, f"Utility Error: {str(e)[:100]}")
