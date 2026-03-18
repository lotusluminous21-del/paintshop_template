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

from ..models import ProductState, ProductEnrichmentData, PaintTechnicalSpecs

logger = logging.getLogger(__name__)

def generate_with_retry(client, model_name, contents, config, sku="Unknown", max_retries=3):
    """Global helper for Gemini retries on 429s."""
    last_exc = Exception("Max retries exceeded")
    
    # max_retries=0 means 1 attempt total. max_retries=3 means 4 attempts total.
    for i in range(max_retries + 1):
        try:
            return client.models.generate_content(
                model=model_name,
                contents=contents,
                config=config
            )
        except Exception as e:
            last_exc = e
            
            # If it's a rate limit AND we have retries left, delay and retry
            if ("429" in str(e) or "RESOURCE_EXHAUSTED" in str(e) or "quota" in str(e).lower()) and i < max_retries:
                wait = (i + 1) + (random.random() * 2)
                logger.warning(f"MetadataAgent: 429 for {sku}. Retrying in {wait:.1f}s... ({i+1}/{max_retries})")
                time.sleep(wait)
            else:
                # If it's not a rate limit, or we are on our very last allowed attempt, fail immediately
                raise e
                
    raise last_exc

class MetadataAgent:
    """
    Responsible for Phase 1: Scraping the web for context, and synthesizing
    pylon data + web context into strictly structured Greek metadata.
    """

    @classmethod
    def _validate_metadata(cls, client, original_name: str, structured_data: dict, grounding_text: str) -> dict:
        """
        Cross-validates the generated metadata against the original CSV input name and the Grounding Truth text.
        """
        title = structured_data.get("title", "")
        brand = structured_data.get("brand", "")
        product_type = structured_data.get("product_type", "")
        category = structured_data.get("project_category", "")
        tech_specs = json.dumps(structured_data.get("technical_specs", {}), ensure_ascii=False)

        schema_info = json.dumps(PaintTechnicalSpecs.model_json_schema().get("properties", {}), ensure_ascii=False)

        prompt = f"""You are an expert bilingual Data Quality Assurance auditor for a GREEK-LANGUAGE e-commerce product pipeline.
        Compare generated Greek metadata against the Grounding Truth Text (which may be in English, Greek, or another language).

        GROUNDING TRUTH TEXT (The ONLY source of facts): 
        {grounding_text}

        AVAILABLE SCHEMA CONSTRAINTS:
        The JSON generator was strictly FORCED to pick only from these exact Enum options for its fields. It cannot invent new words.
        {schema_info}

        Generated Greek JSON to evaluate:
        Title: "{title}", Brand: "{brand}", Type: "{product_type}", Category: "{category}"
        Technical Specs: {tech_specs}

        CRITICAL FACT-CHECKING RULES:
        1. BILINGUAL TRANSLATION & ENUM CONSTRAINTS: You MUST evaluate if the selected option is the *closest logical fit* from the "AVAILABLE SCHEMA CONSTRAINTS" given the grounding text, NOT whether it's an exact literal match. You MUST NOT penalize the generator for using broader Enum classifications or the fallback "Άλλο" (Other) if the specific exact word isn't an option. "Άλλο" is a 100% correct and mathematically valid choice if the specific type (e.g. Spatula, Antifouling paint) is not in the schema list.
        2. EXPERT DOMAIN DEDUCTIONS ARE REQUIRED (No Penalty!): Do NOT penalize the agent for making mathematically sound domain deductions. If a product is for "Marine Hulls", inferring "Fiberglass" and "Οικοδομικά/Ναυτιλιακά" is correct. If a product is a "Thinner for 2K Autocoats", inferring "Brush, Spray, Roller" or "Γυμνό Μέταλλο" is correct because that applies to the 2K system. These are NOT hallucinations.
        3. HALLUCINATIONS VS CONTRADICTIONS: Only flag a field if it *contradicts* the text (e.g., text says "1-component" and JSON says "2 Συστατικών", or text says "Matte" and JSON says "High Gloss") OR if the AI invents hyper-specific features (like adding a "Fan spray nozzle" when none is implied, or claiming a wood stain works on bare metal).
        4. BASE TITLE: The Generated Title MUST be a generic "Base" title without variant dimensions (like "400ml" or "Red"). This is correct behavior.
        5. CONFIDENCE SCORING: 
           - 1.0 = All facts match the grounding text via direct translation, valid expert deduction, or correct usage of "Άλλο". No contradictions.
           - 0.8 = Minor deductive overreach (e.g., assuming too many application methods, but none contradict the primary function).
           - 0.5 = Explicit contradictions (e.g., 1K vs 2K, matte vs gloss) or major hallucinations.
           - 0.0 = Complete failure to factually align with the Grounding Truth Text.

        Return JSON with:
        - overall_confidence (0.0-1.0): As per the rules above.
        - flagged_fields (list): Fields that are objectively wrong or factually hallucinated (DO NOT flag accurate translations).
        - reasoning (string): Explain exactly what was hallucinated or incorrect, if anything. MUST BE WRITTEN IN GREEK ONLY (ΠΡΕΠΕΙ ΝΑ ΕΙΝΑΙ ΣΤΑ ΕΛΛΗΝΙΚΑ).
        - suggested_fixes (object): Structured key-value pairs of corrected values ONLY for the flagged fields. If overall_confidence < 1.0, YOU MUST PROVIDE THE SUGGESTED CORRECTIONS HERE. Keys MUST exactly match the JSON schema (e.g. "title", "surface_suitability", "finish"). Wait for my exact JSON structure.
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
                            "reasoning": {"type": "STRING"},
                            "suggested_fixes": {
                                "type": "ARRAY", 
                                "items": {
                                    "type": "OBJECT",
                                    "properties": {
                                        "field_name": {"type": "STRING", "description": "The exact JSON key that needs fixing (e.g. title, finish)"},
                                        "suggested_value": {"type": "STRING", "description": "The new corrected value"}
                                    },
                                    "required": ["field_name", "suggested_value"]
                                }
                            }
                        },
                        "required": ["overall_confidence", "flagged_fields", "reasoning"]
                    }
                )
            )
            return json.loads(response.text)
        except Exception:
            return {"overall_confidence": 0.5, "flagged_fields": [], "reasoning": "QA failed.", "suggested_fixes": {}}

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
                Requirements: Greek Title (Brand - Type [Model]), Brand, Description, Short Description, Product Type (product_type), Project Category (project_category), Tech Specs.

                CRITICAL DESIGN RULES for Title:
                1. The Title MUST ALWAYS start with the Brand name, followed by the product type and model. (e.g., "HB Body 980 Αστάρι Πλαστικών"). Consistency is critical.
                2. The Title MUST be a generic "Base" title.
                3. You MUST EXCLUDE variant-specific details like color (e.g., "Λευκό", "Μαύρο"), volume/weight (e.g., "400ml", "1LT"), or size from the Title, Tags, and core Attributes.
                   These variant details will be handled separately in the variants axis.
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
                
                qa = MetadataAgent._validate_metadata(client, name, structured_data, generated_text)
                structured_data["confidence_score"] = qa.get("overall_confidence", 0.0)
                structured_data["flagged_fields"] = qa.get("flagged_fields", [])
                structured_data["qa_reasoning"] = qa.get("reasoning", "")
                
                # The LLM outputs [{"field_name": "...", "suggested_value": "..."}, ...], we want a dict:
                qa_sugg = {}
                for fix in qa.get("suggested_fixes", []):
                    # Some models might stringify the suggested_value if it's an array. We try to parse it.
                    val = fix.get("suggested_value")
                    try:
                        if isinstance(val, str) and (val.startswith("[") or val.startswith("{")):
                            val = json.loads(val)
                    except:
                        pass
                    qa_sugg[fix.get("field_name")] = val
                structured_data["qa_suggestions"] = qa_sugg

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
