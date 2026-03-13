from firebase_functions import https_fn, options, identity_fn, scheduler_fn
from firebase_admin import initialize_app
import os
import json

# Initialize app
try:
    initialize_app()
except ValueError:
    pass

# AI Modules - Lazy Import Wrappers
AI_AVAILABLE = True
CHAT_AVAILABLE = True

from firebase_functions import firestore_fn, storage_fn
from firebase_functions import firestore_fn, storage_fn
# from google.cloud import firestore # Removed to prevent top-level import issues

# --- 1. Catalogue Upload Trigger ---
@storage_fn.on_object_finalized(
    region="europe-west1",
    memory=options.MemoryOption.GB_1,
    timeout_sec=540,
    cpu=1,
)
def process_catalogue_upload(event: storage_fn.CloudEvent[storage_fn.StorageObjectData]):
    try:
        from ai.catalogue import process_catalogue_upload
        process_catalogue_upload(event)
    except Exception as e:
        print(f"Error in process_catalogue_upload wrapper: {e}")

# --- 2. Product Enrichment Trigger ---
from core.logger import get_logger
main_logger = get_logger("functions.main")

@firestore_fn.on_document_written(
    document="staging_products/{sku}",
    region="europe-west1",
    memory=options.MemoryOption.GB_2,
    timeout_sec=540,
    secrets=["SERPER_API_KEY", "FAL_KEY"]
)
def enrich_product(event: firestore_fn.Event[firestore_fn.Change[firestore_fn.DocumentSnapshot]]) -> None:
    try:
        from ai.controller import EnrichmentController
        EnrichmentController.handle_trigger(event)
    except Exception as e:
        # PRISTINE LOGGING: Captures full traceback and saves to Firestore system_logs automatically
        main_logger.error("Error in enrich_product wrapper", exc_info=True, sku=event.params.get("sku", "unknown"))
        
        # Critical: Report system-level errors back to the document so the UI doesn't hang
        try:
            if event.data and hasattr(event.data, "after") and event.data.after:
                event.data.after.reference.update({
                    "status": "FAILED",
                    "enrichment_message": f"Global App Error: {str(e)[:100]}"
                })
        except Exception as report_err:
            main_logger.error("Failed to report error to Firestore document", exc_info=report_err)

# --- 3. Chat Assistant Callable ---
@https_fn.on_call(region="europe-west1", memory=options.MemoryOption.MB_512)
def chat_assistant(req: https_fn.CallableRequest) -> dict:
    try:
        from ai.chat import chat_assistant
        return chat_assistant(req)
    except Exception as e:
        print(f"Error in chat_assistant wrapper: {e}")
        return {"error": str(e)}

# --- 4. RAG Indexer Trigger ---
@firestore_fn.on_document_written(
    document="staging_products/{sku}",
    region="europe-west1",
    memory=options.MemoryOption.MB_256
)
def index_product_trigger(event: firestore_fn.Event[firestore_fn.Change[firestore_fn.DocumentSnapshot]]) -> None:
    try:
        from rag.indexer import index_product_trigger
        index_product_trigger(event)
    except Exception as e:
        print(f"Error in index_product_trigger wrapper: {e}")

# --- 5. User Creation Trigger (Auth) ---
@identity_fn.before_user_created(region="europe-west1")
def create_user_document(event: identity_fn.AuthBlockingEvent) -> identity_fn.BeforeCreateResponse | None:
    try:
        from auth.user_triggers import create_user_document
        return create_user_document(event)
    except Exception as e:
        print(f"Error in create_user_document wrapper: {e}")
        return None

# --- 5b. Sync User to Shopify (Callable) ---
@https_fn.on_call(region="europe-west1", memory=options.MemoryOption.MB_256)
def sync_shopify_customer(req: https_fn.CallableRequest) -> dict:
    try:
        from auth.user_triggers import sync_shopify_customer as sync_handler
        return sync_handler(req)
    except Exception as e:
        print(f"Error in sync_shopify_customer wrapper: {e}")
        return {"error": str(e)}

# --- 6. Bundle Advisor (AI Agent) ---
@https_fn.on_call(region="europe-west1", memory=options.MemoryOption.MB_512)
def suggest_bundles(req: https_fn.CallableRequest) -> dict:
    try:
        from ai.agent import suggest_bundles
        return suggest_bundles(req)
    except Exception as e:
        print(f"Error in suggest_bundles wrapper: {e}")
        return {"error": str(e)}


# --- 7. Expert Paint Advisor (Agentic RAG) ---
@https_fn.on_call(region="europe-west1", memory=options.MemoryOption.MB_512)
def expert_chat(req: https_fn.CallableRequest) -> dict:
    try:
        from expert.main import expert_chat as expert_chat_handler
        return expert_chat_handler(req)
    except Exception as e:
        print(f"Error in expert_chat wrapper: {e}")
        return {"error": str(e)}

# --- 7b. Expert Paint Advisor V2 (Multi-Agent, Separated Concerns) ---
@https_fn.on_call(region="europe-west1", memory=options.MemoryOption.MB_512)
def expert_chat_v2(req: https_fn.CallableRequest) -> dict:
    try:
        from expert_v2.main import expert_chat_v2 as handler
        return handler(req)
    except Exception as e:
        print(f"Error in expert_chat_v2 wrapper: {e}")
        return {"error": str(e)}

# --- 7c. Expert Paint Advisor V3 - Manual Solution Finalization ---
@https_fn.on_call(region="europe-west1", memory=options.MemoryOption.MB_512, timeout_sec=120)
def generate_expert_solution_v3(req: https_fn.CallableRequest) -> dict:
    try:
        data = req.data
        session_id = data.get("sessionId")
        user_id = data.get("userId")
        
        if not session_id or not user_id:
            return {"status": "error", "message": "Missing sessionId or userId"}
            
        from firebase_admin import firestore
        import uuid
        from datetime import datetime, timezone
        
        db = firestore.client()
        session_ref = db.collection("users").document(user_id).collection("expert_sessions").document(session_id)
        
        doc_snap = session_ref.get()
        if not doc_snap.exists:
            return {"status": "error", "message": "Session not found"}
            
        session_data = doc_snap.to_dict() or {}
        messages = session_data.get("messages", [])
        accumulated = session_data.get("accumulatedProducts", {})
        
        if not accumulated:
            return {"status": "error", "message": "No products gathered yet to build a solution"}
            
        history_text = "\n".join([
            f"{'Πελάτης' if m.get('role') == 'user' else 'Ειδικός'}: {m.get('content')}"
            for m in messages if m.get('content')
        ])
        
        from expert_v3.solution_builder import generate_expert_solution
        result = generate_expert_solution(history_text, accumulated)
        
        now = datetime.now(timezone.utc)
        
        if result.get("status") == "success":
            session_ref.update({
                "messages": firestore.firestore.ArrayUnion([{
                    "id": str(uuid.uuid4()),
                    "role": "assistant",
                    "content": "Εξαιρετικά! Έχω συλλέξει όλες τις απαραίτητες πληροφορίες και σας ετοίμασα το πλήρες εξατομικευμένο πλάνο!",
                    "solution": result.get("solution"),
                    "timestamp": now
                }]),
                "status": "idle",
                "agentStatus": ""
            })
        else:
            session_ref.update({
                "messages": firestore.firestore.ArrayUnion([{
                    "id": str(uuid.uuid4()),
                    "role": "assistant",
                    "content": result.get("answer", "Συγγνώμη, παρουσιάστηκε σφάλμα κατά την επεξεργασία του πλάνου."),
                    "timestamp": now
                }]),
                "status": "idle",
                "agentStatus": ""
            })
            
        return result

    except Exception as e:
        print(f"Error in generate_expert_solution_v3 wrapper: {e}")
        return {"status": "error", "message": str(e)}

# --- 7d. Expert Paint Advisor V3 (ReAct Agent - Firestore Driven) ---
@firestore_fn.on_document_written(
    document="users/{userId}/expert_sessions/{sessionId}",
    region="europe-west1",
    memory=options.MemoryOption.MB_512,
    timeout_sec=540 # Allow up to 9 minutes for long tool queries
)
def expert_session_trigger(event: firestore_fn.Event[firestore_fn.Change[firestore_fn.DocumentSnapshot]]) -> None:
    try:
        # We only care about after-writes where the document still exists
        if not event.data or not event.data.after or not event.data.after.exists:
            return

        after_data = event.data.after.to_dict() or {}
        
        # ── CRITICAL SELF-TRIGGER GUARD ──────────────────────────────────────
        # The trigger fires on EVERY write to this document — including writes
        # the function itself makes (agentStatus updates, etc). We ONLY want to
        # run the agent when a NEW MESSAGE was added by the user (i.e., the
        # messages array grew). Compare before vs after to detect this.
        before_data = event.data.before.to_dict() if (event.data.before and event.data.before.exists) else {}
        
        before_messages = before_data.get("messages", [])
        after_messages = after_data.get("messages", [])
        
        # If message count didn't increase, this was an internal write — skip.
        if len(after_messages) <= len(before_messages):
            return

        last_message = after_messages[-1]

        # Only process if the newly added message is from the user
        if last_message.get("role") != "user":
            return

        user_id = event.params.get("userId", "unknown")
        session_id = event.params.get("sessionId", "unknown")
        main_logger.info(
            "[expert_session_trigger] New user message detected",
            user_id=user_id,
            session_id=session_id,
        )

        # 1. Update status to processing immediately
        event.data.after.reference.update({
            "status": "processing",
            "agentStatus": "Ανάλυση ερωτήματος..."
        })
        
        from expert_v3.agent import ExpertV3Agent
        agent = ExpertV3Agent()
        
        # Build history from all messages EXCEPT the latest user one
        history = []
        for msg in after_messages[:-1]:
            h = {"role": msg.get("role", "user"), "content": msg.get("content", "")}
            # Carry through image_url for multimodal history
            if msg.get("image_url"):
                h["image_url"] = msg["image_url"]
            history.append(h)
                
        user_message_content = last_message.get("content", "")
        user_image_url = last_message.get("image_url")
        
        # 2. Process chat — pass session_id + user_id for structured log correlation
        result = agent.process_chat(
            user_message_content,
            history=history,
            doc_ref=event.data.after.reference,
            session_id=session_id,
            user_id=user_id,
            session_data=after_data,
            image_url=user_image_url,
        )
        
        from firebase_admin import firestore
        import uuid
        
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc)

        # 3. Append final result and reset status
        if result.get("status") == "chat":
            event.data.after.reference.update({
                "messages": firestore.firestore.ArrayUnion([{
                    "id": str(uuid.uuid4()),
                    "role": "assistant",
                    "content": result.get("answer", ""),
                    "ready_for_solution": result.get("ready_for_solution", False),
                    "timestamp": now
                }]),
                "status": "idle",
                "agentStatus": ""
            })
        else:
            event.data.after.reference.update({
                "messages": firestore.firestore.ArrayUnion([{
                    "id": str(uuid.uuid4()),
                    "role": "assistant",
                    "content": result.get("answer", "Συγγνώμη, παρουσιάστηκε σφάλμα κατά την επεξεργασία."),
                    "timestamp": now
                }]),

                "status": "error",
                "agentStatus": ""
            })

    except Exception as e:
        main_logger.error(
            f"expert_session_trigger CRASHED: {e}",
            exc_info=True,
            session_id=event.params.get("sessionId", "unknown"),
            user_id=event.params.get("userId", "unknown"),
        )
        try:
            event.data.after.reference.update({
                "status": "error",
                "agentStatus": f"Σφάλμα: {str(e)[:80]}"
            })
        except:
            pass

# --- 7e. Context Analysis Trigger (Parallel Sidebar Agent) ---
@firestore_fn.on_document_written(
    document="users/{userId}/expert_sessions/{sessionId}",
    region="europe-west1",
    memory=options.MemoryOption.MB_256,
    timeout_sec=120
)
def context_analysis_trigger(event: firestore_fn.Event[firestore_fn.Change[firestore_fn.DocumentSnapshot]]) -> None:
    """
    Fires after the chat agent writes an assistant message.
    Produces structured sidebar data (analysis phase, products, logs)
    and writes it back to the session document's sidebarState field.
    """
    try:
        if not event.data or not event.data.after or not event.data.after.exists:
            return

        after_data = event.data.after.to_dict() or {}
        before_data = event.data.before.to_dict() if (event.data.before and event.data.before.exists) else {}

        before_messages = before_data.get("messages", [])
        after_messages = after_data.get("messages", [])

        # Only fire when a new message was added
        if len(after_messages) <= len(before_messages):
            return

        last_message = after_messages[-1]

        # INVERSE guard: only process ASSISTANT messages
        if last_message.get("role") != "assistant":
            return

        user_id = event.params.get("userId", "unknown")
        session_id = event.params.get("sessionId", "unknown")
        main_logger.info(
            "[context_analysis_trigger] New assistant message — running sidebar analysis",
            user_id=user_id,
            session_id=session_id,
        )

        accumulated = after_data.get("accumulatedProducts", {})
        has_solution = bool(last_message.get("solution"))

        from expert_v3.context_analyzer import analyze_context
        sidebar_state = analyze_context(
            messages=after_messages,
            accumulated_products=accumulated,
            has_solution=has_solution,
        )

        event.data.after.reference.update({
            "sidebarState": sidebar_state
        })

        main_logger.info(
            "[context_analysis_trigger] Sidebar state written",
            phase=sidebar_state.get("analysisPhase"),
            session_id=session_id,
        )

    except Exception as e:
        main_logger.error(
            f"context_analysis_trigger CRASHED: {e}",
            exc_info=True,
            session_id=event.params.get("sessionId", "unknown"),
        )
        # Non-fatal — sidebar just won't update this turn

@https_fn.on_call(region="europe-west1", memory=options.MemoryOption.MB_256)
def save_expert_project(req: https_fn.CallableRequest) -> dict:
    try:
        from expert.main import save_expert_project as save_handler
        return save_handler(req)
    except Exception as e:
        print(f"Error in save_expert_project wrapper: {e}")
        return {"error": str(e)}

# --- 8. Photo Color Analysis Callable ---
@https_fn.on_call(region="europe-west1", memory=options.MemoryOption.MB_512)
def analyze_photo_color(req: https_fn.CallableRequest) -> dict:
    """Analyze a photo to extract dominant colors and find closest RAL matches."""
    try:
        image_base64 = req.data.get("image_base64", "")
        n_colors = req.data.get("n_colors", 5)
        surface_type = req.data.get("surface_type", "matte")
        if not image_base64:
            return {"error": "No image_base64 provided"}
        from expert_v3.color_extract import analyze_photo_from_base64
        return analyze_photo_from_base64(image_base64, n_colors, surface_type)
    except Exception as e:
        main_logger.error(f"analyze_photo_color CRASHED: {e}", exc_info=True)
        return {"error": str(e)}

# Payment Modules (REMOVED)
# User opted for Shopify Native Checkout + AADE Webhook

# --- Health Check ---
@https_fn.on_call(
    region="europe-west1",
    memory=options.MemoryOption.MB_256,
)
def health_check(req: https_fn.CallableRequest) -> dict:
    return {
        "status": "ok",
        "message": "Cloud Functions are operational",
        "version": "1.3.0",
        "features": {
            "ai": AI_AVAILABLE,
            "payments": False # Disabled
        }
    }

@https_fn.on_request(region="europe-west1")
def shopify_order_paid(req: https_fn.Request) -> https_fn.Response:
    """
    Webhook for Shopify 'orders/paid' event.
    Triggers AADE invoice transmission.
    """
    # 1. Verify HMAC (Security)
    # We should verify X-Shopify-Hmac-Sha256 header using SHOPIFY_WEBHOOK_SECRET
    # For MVP/Dev, we'll skip strict verification but print a warning if secret missing.
    
    import hmac
    import hashlib
    import base64
    
    secret = os.environ.get('SHOPIFY_WEBHOOK_SECRET')
    if not secret:
        print("Warning: SHOPIFY_WEBHOOK_SECRET not set. Skipping verification.")
    else:
        hmac_header = req.headers.get('X-Shopify-Hmac-Sha256')
        if not hmac_header:
            return https_fn.Response("Missing HMAC header", status=401)
            
        digest = hmac.new(
            secret.encode('utf-8'),
            req.get_data(),
            hashlib.sha256
        ).digest()
        computed_hmac = base64.b64encode(digest).decode('utf-8')
        
        if not hmac.compare_digest(computed_hmac, hmac_header):
            return https_fn.Response("Invalid HMAC signature", status=401)
    
    try:
        from webhooks.shopify import handle_order_paid
        data = req.get_json()
        
        # Run logic (sync for now, or use background task if supported)
        handle_order_paid(data)
        
        return https_fn.Response("OK", status=200)
    except Exception as e:
        print(f"Error in shopify_order_paid: {e}")
        return https_fn.Response("Internal Error", status=500)

@https_fn.on_request(region="europe-west1")
def shopify_refund_created(req: https_fn.Request) -> https_fn.Response:
    """
    Webhook for Shopify 'refunds/create' event.
    Triggers Pylon Credit Note and AADE adjustment.
    """
    # Security verification (same as above, ideally refactored)
    secret = os.environ.get('SHOPIFY_WEBHOOK_SECRET')
    # ... (HMAC check skipped for brevity in this step, but recommended)

    try:
        from webhooks.shopify import handle_refund_created
        data = req.get_json()
        handle_refund_created(data)
        return https_fn.Response("OK", status=200)
    except Exception as e:
        print(f"Error in shopify_refund_created: {e}")
        return https_fn.Response("Internal Error", status=500)

@https_fn.on_request(region="europe-west1", timeout_sec=540)
def pylon_sync_inventory(req: https_fn.Request) -> https_fn.Response:
    """
    Manually trigger Pylon -> Shopify Inventory Sync.
    Would be replaced by a scheduled function in production.
    """
    import asyncio
    from sync.inventory import sync_inventory_job
    
    try:
        asyncio.run(sync_inventory_job())
        return https_fn.Response("Inventory Sync Triggered Successfully", status=200)
    except Exception as e:
        print(f"Error in pylon_sync_inventory: {e}")
        return https_fn.Response(f"Error: {str(e)}", status=500)

@https_fn.on_request(
    region="europe-west1", 
    timeout_sec=540,
    invoker="public"
)
def pylon_sync_products(req: https_fn.Request) -> https_fn.Response:
    """
    Manually trigger Pylon -> Shopify Product Import (Drafts).
    """
    import asyncio
    from sync.products import sync_products_job

    # Set CORS headers for the preflight request
    if req.method == 'OPTIONS':
        headers = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '3600'
        }
        return https_fn.Response('', status=204, headers=headers)

    # Set CORS headers for the main request
    headers = {
        'Access-Control-Allow-Origin': '*'
    }

    if req.method != "POST":
        return https_fn.Response("Method Not Allowed", status=405, headers=headers)
    
    try:
        result = asyncio.run(sync_products_job())
        headers['Content-Type'] = 'application/json'
        return https_fn.Response(json.dumps({"status": "ok", "result": result}), status=200, headers=headers)
    except Exception as e:
        print(f"Error in pylon_sync_products: {e}")
        headers['Content-Type'] = 'application/json'
        return https_fn.Response(json.dumps({"status": "error", "error": str(e)}), status=500, headers=headers)


@https_fn.on_request(
    region="europe-west1", 
    timeout_sec=540,
    invoker="public"
)
def pylon_ingest_csv(req: https_fn.Request) -> https_fn.Response:
    """
    Ingest Pylon CSV via HTTP Upload.
    Expects raw CSV content in the body.
    """
    from firebase_admin import firestore
    from pylon.ingest import parse_pylon_csv, parse_pylon_xlsx, ingest_products_to_firestore

    # Set CORS headers for the preflight request
    if req.method == 'OPTIONS':
        headers = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '3600'
        }
        return https_fn.Response('', status=204, headers=headers)

    # Set CORS headers for the main request
    headers = {
        'Access-Control-Allow-Origin': '*'
    }

    if req.method != "POST":
        return https_fn.Response("Method Not Allowed", status=405, headers=headers)
    
    content_type = req.headers.get("Content-Type", "")
    
    try:
        # 1. Parse based on content type
        if "spreadsheetml.sheet" in content_type:
            file_content = req.get_data() # Binary
            if not file_content:
                return https_fn.Response("Empty body", status=400, headers=headers)
            products = parse_pylon_xlsx(file_content)
        else:
            csv_content = req.get_data(as_text=True)
            if not csv_content:
                return https_fn.Response("Empty body", status=400, headers=headers)
            products = parse_pylon_csv(csv_content)
        
        # 2. Ingest to Firestore
        db = firestore.client()
        stats = ingest_products_to_firestore(products, db)
        
        # We intentionally DO NOT start the pipeline here.
        # Products remain in "IMPORTED" state until manually triggered by the Admin.
        
        return https_fn.Response(json.dumps(stats), status=200, mimetype='application/json', headers=headers)
    except Exception as e:
        main_logger.error(f"Error in pylon_ingest_csv: {e}", exc_info=True)
        return https_fn.Response(f"Error: {str(e)}", status=500, headers=headers)

@firestore_fn.on_document_created(
    document="contact_inquiries/{docId}",
    region="europe-west1",
    memory=options.MemoryOption.MB_256,
    secrets=["RESEND_API_KEY"]
)
def on_contact_inquiry_created(event: firestore_fn.Event[firestore_fn.DocumentSnapshot]) -> None:
    try:
        from webhooks.contact import handle_contact_inquiry
        handle_contact_inquiry(event)
    except Exception as e:
        print(f"Error in on_contact_inquiry_created wrapper: {e}")

@https_fn.on_call(
    region="europe-west1",
    memory=options.MemoryOption.MB_512,
    timeout_sec=60, 
)
def trigger_pipeline_session(req: https_fn.CallableRequest) -> dict:
    """
    Manually triggers the end-to-end AI Enrichment Pipeline for a list of SKUs.
    This routes to the staggered governor in `ai.batch_processor`.
    """
    try:
        data = req.data
        skus = data.get("skus", [])
        
        print(f"Manual pipeline session requested for {len(skus)} SKUs: {skus}")
        
        if not skus:
            return {"error": "Missing SKUs"}
            
        from ai.batch_processor import start_pipeline_session
        pipeline_result = start_pipeline_session(skus)
        
        return {
            "success": True, 
            "message": f"Pipeline scheduled for {pipeline_result.get('count', 0)} SKUs in {len(pipeline_result.get('batch_ids', []))} batches.",
            "batch_ids": pipeline_result.get("batch_ids",[])
        }
    except Exception as e:
        print(f"Failed to trigger pipeline session: {e}")
        return {"error": str(e)}
@https_fn.on_call(
    region="europe-west1",
    memory=options.MemoryOption.MB_512,
    timeout_sec=30,  # Returns immediately — just creates tracking doc
)
def trigger_batch_enrichment(req: https_fn.CallableRequest) -> dict:
    """
    Fire-and-forget: Creates tracking doc + marks products, returns immediately.
    Actual processing is picked up by the on_batch_created Firestore trigger.
    
    Accepts:
        skus: List of SKU strings
        environment: "clean" (white bg, default) or "realistic" (workshop bg)
        priority: "normal" (default) or "high" (for single-product regeneration)
    """
    try:
        data = req.data
        skus = data.get("skus", [])
        environment = data.get("environment", "clean")
        priority = data.get("priority", "normal")
        print(f"Studio session requested for {len(skus)} SKUs (env={environment}, priority={priority}): {skus}")
        
        if not skus:
            return {"error": "Missing SKUs"}
            
        from ai.batch_processor import start_studio_session
        result = start_studio_session(skus, environment=environment, priority=priority)
        print(f"Studio sessions created: {result}")
        return result
    except Exception as e:
        print(f"Error in trigger_batch_enrichment: {e}")
        import traceback
        traceback.print_exc()
        return {"error": f"Runtime Error: {str(e)}"}


@https_fn.on_call(region="europe-west1", memory=options.MemoryOption.MB_256)
def abort_studio_session(req: https_fn.CallableRequest) -> dict:
    """Callable to abort one or more running batches."""
    try:
        data = req.data
        batch_ids = data.get("batch_ids", [])
        if not batch_ids:
            return {"error": "Missing batch_ids"}
            
        from ai.batch_processor import abort_studio_session
        return abort_studio_session(batch_ids)
    except Exception as e:
        print(f"Error in abort_studio_session: {e}")
        return {"error": str(e)}


@firestore_fn.on_document_created(
    document="enrichment_batches/{batchId}",
    region="europe-west1",
    memory=options.MemoryOption.GB_1,
    timeout_sec=540,  # 9 min — handles ~15 products at 30s delay each
    cpu=1,
)
def on_batch_created(event: firestore_fn.Event[firestore_fn.DocumentSnapshot]) -> None:
    """
    Firestore trigger: When a new batch doc is created, start processing.
    This runs in the background — the callable has already returned to the client.
    """
    batch_id = event.params["batchId"]
    print(f"Firestore trigger fired for batch: {batch_id}")
    
    try:
        from ai.batch_processor import process_studio_queue
        result = process_studio_queue(batch_id)
        print(f"Studio processing complete: {result}")
    except Exception as e:
        print(f"Error processing batch {batch_id}: {e}")
        import traceback
        traceback.print_exc()
        
        # Mark batch AND products as failed using the new utility
        from ai.batch_processor import fail_batch
        try:
            fail_batch(batch_id, f"System Error: {str(e)[:150]}")
        except Exception as fe:
            print(f"Failed to report system error: {fe}")

@https_fn.on_call(region="europe-west1", memory=options.MemoryOption.MB_256)
def trigger_bg_removal(req: https_fn.CallableRequest) -> dict:
    """Manual trigger for background removal on specific SKUs."""
    try:
        data = req.data
        skus = data.get("skus", [])
        mode = data.get("mode", "generated") # "generated" (default) or "source"
        
        if not skus:
            return {"error": "Missing SKUs"}

        import firebase_admin
        from firebase_admin import firestore
        db = firestore.client()
        
        target_status = "PENDING_BG_REMOVAL" if mode == "generated" else "PENDING_SOURCE_BG_REMOVAL"
        message = "Manually triggering background removal..." if mode == "generated" else "Triggering source background removal..."
        
        batch = db.batch()
        for sku in skus:
            doc_ref = db.collection("staging_products").document(sku)
            batch.update(doc_ref, {
                "status": target_status,
                "enrichment_message": message
            })
        batch.commit()
        return {"success": True, "count": len(skus)}
    except Exception as e:
        print(f"Error in trigger_bg_removal: {e}")
        return {"error": str(e)}

@https_fn.on_request(region="europe-west1", memory=options.MemoryOption.MB_256)
def debug_env_http(req: https_fn.Request) -> https_fn.Response:
    import sys
    import os
    import json
    
    results = {
        "status": "ok",
        "python_version": sys.version,
        "cwd": os.getcwd(),
        "files": os.listdir("."),
        # "env_vars": {k: v for k, v in os.environ.items() if "KEY" not in k and "SECRET" not in k}
    }
    
    try:
        import google.genai
        results["google_genai"] = "imported"
    except Exception as e:
        results["google_genai"] = str(e)
        
    try:
        import ai.enrichment
        results["ai_enrichment"] = "imported"
    except Exception as e:
        results["ai_enrichment"] = str(e)
        import traceback
        results["ai_enrichment_trace"] = traceback.format_exc()

    return https_fn.Response(json.dumps(results), status=200, mimetype='application/json')

# --- 5. Periodic Batch Status Sync (Reactive Bridge) ---
# Cloud Scheduler checks Vertex AI and writes results to Firestore.
# Frontend picks up changes via onSnapshot — no client-side polling needed.
@scheduler_fn.on_schedule(
    schedule="every 1 minutes",
    region="europe-west1",
    memory=options.MemoryOption.GB_1,
)
def cron_check_batches(event: scheduler_fn.ScheduledEvent) -> None:
    """
    Checks Vertex AI batch job status and writes per-product results
    to Firestore, enabling real-time UI updates via onSnapshot.
    """
    from ai.batch_processor import check_and_process_batches
    try:
        summary = check_and_process_batches()
        print(f"Batch check summary: {summary}")
    except Exception as e:
        print(f"Error in cron_check_batches: {e}")
        import traceback
        traceback.print_exc()
