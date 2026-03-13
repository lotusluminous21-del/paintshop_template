import logging
import json
import traceback
import random
import time
from firebase_admin import firestore
from google.genai import types

from core.llm_config import LLMConfig
from core.discovery_service import DiscoveryService
from core.content_extractor import ContentExtractor

from ..models import ProductState, ProductEnrichmentData

logger = logging.getLogger(__name__)

def generate_with_retry(client, model_name, contents, config, sku="Unknown", max_retries=3):
    """Global helper for Gemini retries on 429s."""
    last_exc = Exception("Max retries exceeded")
    for i in range(max_retries):
        try:
            return client.models.generate_content(
                model=model_name,
                contents=contents,
                config=config
            )
        except Exception as e:
            last_exc = e
            if "429" in str(e) or "RESOURCE_EXHAUSTED" in str(e):
                wait = (i + 1) + (random.random() * 2)
                logger.warning(f"MetadataAgent: 429 for {sku}. Retrying in {wait:.1f}s... ({i+1}/{max_retries})")
                time.sleep(wait)
            else:
                raise e
    raise last_exc

class MetadataAgent:
    """
    Responsible for Phase 1: Scraping the web for context, and synthesizing
    pylon data + web context into strictly structured Greek metadata.
    """

    @classmethod
    def _validate_metadata(cls, client, original_name: str, structured_data: dict) -> dict:
        """
        Cross-validates the generated metadata against the original CSV input name.
        """
        title = structured_data.get("title", "")
        brand = structured_data.get("brand", "")
        product_type = structured_data.get("type", "")
        category = structured_data.get("category", "")

        prompt = f"""You are a strict Quality Assurance auditor for a GREEK-LANGUAGE e-commerce product pipeline.
        Compare generated metadata against the original input name: "{original_name}"
        Generated: Title: "{title}", Brand: "{brand}", Type: "{product_type}", Category: "{category}"

        CRITICAL DESIGN RULES:
        1. BASE TITLE: The Generated Title MUST be a generic "Base" title.
        2. VARIANT DATA REMOVAL: It is INTENTIONAL and REQUIRED to remove variant-specific details like color (e.g. "Λευκό", "Μαύρο"), volume (e.g. "750ml", "1LT"), or size from the Title, Tags, and core Attributes.
        3. NO CONFIDENCE PENALTY: Do NOT flag the absence of these variant-specific tokens as an error. If the core identity (Brand/Model) is correct, the confidence score should be 1.0.
        4. PASS CRITERIA: A title like "Spray" for an input "Spray Black 400ml" is a perfect PASS.

        Return JSON with:
        - overall_confidence (0-1): 1.0 if the core identity (Brand/Model) is correct.
        - flagged_fields (list): Fields that are objectively wrong (incorrect brand or type).
        - reasoning (string): Explain your logic.
        """

        try:
            response = generate_with_retry(
                client,
                model_name=LLMConfig.get_model_name(complex=False),
                contents=[prompt],
                config=types.GenerateContentConfig(
                    temperature=0.0,
                    response_mime_type="application/json",
                    response_schema={
                        "type": "OBJECT",
                        "properties": {
                            "overall_confidence": {"type": "NUMBER"},
                            "flagged_fields": {"type": "ARRAY", "items": {"type": "STRING"}},
                            "reasoning": {"type": "STRING"}
                        },
                        "required": ["overall_confidence", "flagged_fields", "reasoning"]
                    }
                )
            )
            return json.loads(response.text)
        except Exception:
            return {"overall_confidence": 0.5, "flagged_fields": [], "reasoning": "QA failed."}

    @staticmethod
    def process(doc_ref, data: dict):
        sku = data.get("sku", "")
        pylon_data = data.get("pylon_data", {})
        name = pylon_data.get("name", "")
        price_retail = pylon_data.get("price_retail", 0.0)
        
        if not name:
            logger.error(f"Missing name for SKU {sku}")
            return

        try:
            ai_data_existing = data.get("ai_data", {})
            force_metadata = data.get("force_metadata", False)
            is_refinement = bool(ai_data_existing.get("title_el")) and not force_metadata
            search_query = data.get("search_query", "").strip()

            if search_query and (len(search_query) < 15 or name.lower() not in search_query.lower()):
                search_query = f"{name} {search_query}"
            
            discovery_service = DiscoveryService()
            # Step 1: Initial Discovery (Grounding for Textual Context)
            search_result = discovery_service.search_and_enrich(name, search_query=search_query)
            generated_text = search_result.get("text", "")
            source_urls = search_result.get("source_urls", [])
            
            # CONSOLIDATED: Only search for images once we have a clean name
            found_images = []

            if is_refinement:
                structured_data = ai_data_existing
            else:
                client = LLMConfig.get_client()
                model_name = LLMConfig.get_model_name(complex=True)
                
                structure_prompt = f"""Extract Greek product metadata into JSON. 
                Original: "{name}". Context: {generated_text}
                Requirements: Greek Title (Brand - Type [Model]), Brand, Description, Short Description, Type, Category, Tech Specs.

                CRITICAL DESIGN RULE for Title:
                - The Title MUST be a generic "Base" title.
                - You MUST EXCLUDE variant-specific details like color (e.g., "Λευκό", "Μαύρο"), volume/weight (e.g., "400ml", "1LT"), or size from the Title, Tags, and core Attributes.
                - These variant details will be handled separately in the variants axis.
                """

                structure_response = generate_with_retry(
                    client,
                    model_name=model_name,
                    contents=[structure_prompt],
                    config=types.GenerateContentConfig(
                        response_mime_type="application/json",
                        response_schema=ProductEnrichmentData,
                        temperature=0.0
                    ),
                    sku=sku
                )
                structured_data = json.loads(structure_response.text)
                
                qa = MetadataAgent._validate_metadata(client, name, structured_data)
                structured_data["confidence_score"] = qa.get("overall_confidence", 0.0)
                structured_data["flagged_fields"] = qa.get("flagged_fields", [])
                structured_data["qa_reasoning"] = qa.get("reasoning", "")

            # Step 3: Consolidated High-Intent Image Search
            refined_name = f"{structured_data.get('brand', '')} {structured_data.get('title', '')}".strip()
            logger.info(f"MetadataAgent: High-intent search for '{refined_name}'")
            
            try:
                img_search = discovery_service.search_for_images(refined_name)
                refined_urls = img_search.get("source_urls", [])
                if refined_urls:
                    extractor = ContentExtractor()
                    images = extractor.fetch_images_from_urls(refined_urls, limit=10, product_context=refined_name)
                    found_images = [{"url": img, "score": 0.95, "source": "consolidated"} for img in images]
            except Exception:
                logger.error(f"MetadataAgent: Image search failed for {sku}")

            structured_data["grounding_sources"] = source_urls
            structured_data["generated_at"] = firestore.SERVER_TIMESTAMP
            structured_data["variant_images"] = {"base": found_images}
            
            next_status = ProductState.RESOLVING_VARIANTS.value
            if structured_data.get("confidence_score", 0.0) < 0.7 or structured_data.get("flagged_fields"):
                next_status = ProductState.NEEDS_METADATA_REVIEW.value
            
            doc_ref.update({
                "status": next_status,
                "ai_data": structured_data,
                "search_query": firestore.DELETE_FIELD,
                "enrichment_message": f"Metadata stabilized. Sourced {len(found_images)} images."
            })

        except Exception as e:
            logger.error(f"MetadataAgent Failed for {sku}: {traceback.format_exc()}")
            raise e
