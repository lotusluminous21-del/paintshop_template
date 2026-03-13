import logging
import json
from firebase_admin import firestore
from google.genai import types

from core.llm_config import LLMConfig
from core.discovery_service import DiscoveryService

from ..models import ProductState, ProductVariant

logger = logging.getLogger(__name__)


class VariantAgent:
    """
    Responsible for Phase 2: Variant Resolution.
    Takes source_variants (the bare minimum from Pylon import) + AI metadata (category/type),
    performs grounded product entity search, discovers additional variants,
    and structures them all with correct option axes, SKUs, and prices.
    """

    CATEGORY_AXIS_RULES = {
        "Πινέλα & Εργαλεία": {"allowed": ["Μέγεθος/Διάσταση"], "forbidden": ["Χρώμα"]},
        "Αξεσουάρ": {"allowed": ["Μέγεθος/Διάσταση"], "forbidden": ["Χρώμα"]},
        "Διαλυτικά & Αραιωτικά": {"allowed": ["Χωρητικότητα/Βάρος"], "forbidden": ["Χρώμα"]},
        "Προετοιμασία & Καθαρισμός": {"allowed": ["Χωρητικότητα/Βάρος"], "forbidden": ["Χρώμα"]},
        "Σκληρυντές & Ενεργοποιητές": {"allowed": ["Χωρητικότητα/Βάρος"], "forbidden": ["Χρώμα"]},
    }

    @classmethod
    def _curate_variants(cls, client, product_type: str, variants: list) -> list:
        """
        Post-processor that uses flash-lite to clean up generic LLM hallucinations,
        deduplicate axes, and force strict alignment between Color and Size.
        Preserves pylon_sku and price fields from source mapping.
        """
        if not variants:
            return []

        logger.info(f"VariantAgent: Curating {len(variants)} raw variants for type '{product_type}' using flash-lite...")

        prompt = f"""You are a strict Data Quality Assurance AI for Shopify.
        You have received a raw list of product variants. Your job is to format, deduplicate, and curate them according to strict Category Rules.
        
        Product Type: {product_type}
        Raw Variants: {json.dumps(variants, ensure_ascii=False)}
        
        CRITICAL CATEGORY RULES:
        1. "Αστάρια & Υποστρώματα", "Χρώματα Βάσης", "Βερνίκια & Φινιρίσματα": Can have BOTH "Χρώμα" and "Χωρητικότητα/Βάρος" (Volume/Weight).
        2. "Πινέλα & Εργαλεία", "Αξεσουάρ": NO variants allowed, OR only "Μέγεθος/Διάσταση" (Size). NEVER Color.
        3. "Διαλυτικά & Αραιωτικά", "Προετοιμασία & Καθαρισμός": ONLY "Χωρητικότητα/Βάρος" allowed. NEVER Color.
        4. "Σκληρυντές & Ενεργοποιητές": Usually ONLY "Χωρητικότητα/Βάρος".
        
        AXIS CONSTRAINTS:
        - Option 1 MUST ONLY be used for "Χρώμα" (Translation: Color). If the product has no color variants, leave Option 1 empty/null and use Option 2.
        - Option 2 MUST ONLY be used for "Χωρητικότητα/Βάρος" (Volume/Weight) or "Μέγεθος/Διάσταση" (Size/Dimension).
        - NEVER invent custom axis names. Only use: "Χρώμα", "Χωρητικότητα/Βάρος", "Μέγεθος/Διάσταση".
        
        CONSISTENCY RULE (CRITICAL):
        Every variant in the output MUST have at least one non-null Option Value.
        - If the variant has a size/weight (e.g., "1LT", "5KG") but no color, assign it to Option 2 and leave Option 1 null.
        - If the variant has a color but no size, assign it to Option 1 and leave Option 2 null.
        - If you cannot find ANY distinguishing feature but there are multiple variants, use the `sku_suffix` or `variant_name` as the Option 1 value, and set the Option 1 name to "Επιλογή" (Choice).
        - If any variant in the list has a value for Option 2 (e.g., "1LT"), then ALL variants in the final list must have a value for Option 2 to maintain Shopify axis alignment. Assign a logical default if missing.
        
        AXIS CONSTRAINTS & CLEANING:
        - `variant_name` should be a clean combination: "Color - Size" e.g., "Μπλε - 1L".
        - Deduplicate any identical variants.
        - Ensure `option1_value` and `option2_value` are clean (e.g., "Μαύρο", not "Μαύρο Ματ").
        
        CROSS-AXIS DETECTION:
        Look at the SKU suffixes carefully. If they contain BOTH a color AND a size/volume component (e.g. "-RED-1KG", "-GREY-5KG"), 
        you MUST decompose them into TWO separate axes on each variant.
        
        PRESERVATION RULES (CRITICAL):
        - You MUST preserve the `pylon_sku` field exactly as-is on every variant that has one.
        - You MUST preserve the `price` field exactly as-is on every variant that has one.
        - Variants that have a `pylon_sku` are SOURCE variants and MUST appear in the output.
        - Ensure NO variant has BOTH `option1_value` and `option2_value` equal to null.
        
        Return the exact curated JSON array of variants.
        """

        try:
            response = client.models.generate_content(
                model=LLMConfig.get_model_name(complex=False),  # Fast flash-lite
                contents=[prompt],
                config=types.GenerateContentConfig(
                    temperature=0.0,
                    response_mime_type="application/json",
                    response_schema={
                        "type": "ARRAY",
                        "items": {
                            "type": "OBJECT",
                            "properties": {
                                "sku_suffix": {"type": "STRING"},
                                "variant_name": {"type": "STRING"},
                                "option1_name": {"type": "STRING", "nullable": True},
                                "option1_value": {"type": "STRING", "nullable": True},
                                "option2_name": {"type": "STRING", "nullable": True},
                                "option2_value": {"type": "STRING", "nullable": True},
                                "price": {"type": "NUMBER", "nullable": True},
                                "pylon_sku": {"type": "STRING", "nullable": True}
                            },
                            "required": ["sku_suffix", "variant_name"]
                        }
                    }
                )
            )

            result_text = response.text
            if result_text.startswith("```json"):
                result_text = result_text.replace("```json\n", "").replace("\n```", "")

            curated = json.loads(result_text)

            # Safety: ensure all source variants survived curation
            source_skus = {v.get("pylon_sku") for v in variants if v.get("pylon_sku")}
            curated_skus = {v.get("pylon_sku") for v in curated if v.get("pylon_sku")}
            missing = source_skus - curated_skus
            if missing:
                logger.warning(f"VariantAgent Curation: {len(missing)} source variants were dropped! Re-adding them.")
                dropped = [v for v in variants if v.get("pylon_sku") in missing]
                curated.extend(dropped)

            logger.info(f"VariantAgent Curation: {len(variants)} raw → {len(curated)} clean variants.")
            return curated
        except Exception as e:
            logger.error(f"Variant Curation Failed: {e}. Falling back to raw list.")
            return variants

    @staticmethod
    def process(doc_ref, data: dict):
        sku = data.get("sku", "")
        pylon_data = data.get("pylon_data", {})
        name = pylon_data.get("name", "")
        source_variants = pylon_data.get("source_variants", [])
        ai_data = data.get("ai_data", {})
        product_type = ai_data.get("type", "Άλλο")
        product_title = ai_data.get("title", name)

        logger.info(f"VariantAgent: Processing {sku} with {len(source_variants)} source variants, type='{product_type}'")

        try:
            # Step 1: Grounded Product Entity Search
            discovery_service = DiscoveryService()
            entity_result = discovery_service.search_product_entities(product_title or name)

            entity_text = entity_result.get("text", "")
            entity_found = entity_result.get("found", False)

            logger.info(f"VariantAgent: Entity search {'found results' if entity_found else 'no results'} ({len(entity_text)} chars)")
            variant_search_context = entity_text if entity_found else "No additional product entity data found."

            # Step 2: Build the variant structuring prompt
            client = LLMConfig.get_client()
            model_name = LLMConfig.get_model_name(complex=True)

            # Format source variants for the prompt
            source_variants_json = json.dumps(source_variants, ensure_ascii=False) if source_variants else "None — Single product with no variants."

            structure_prompt = f"""You are a variant resolution specialist for a Greek e-commerce shop selling paints, sprays, and automotive products.

            Your job is to produce a COMPLETE list of product variants with correct Shopify option axes.

            ===== PRODUCT IDENTITY =====
            Title: "{product_title}"
            Original Name: "{name}"
            SKU: "{sku}"
            Product Type: "{product_type}"
            ================================

            ===== SOURCE VARIANTS (BARE MINIMUM — from import system) =====
            {source_variants_json}

            These source variants are the AUTHORITATIVE FLOOR. Rules:
            - Every source variant MUST appear in your output.
            - Use the source variant's `sku` field exactly as the `sku_suffix`.
            - Use the source variant's `price_retail` as the `price`.
            - Set `pylon_sku` to the source variant's `sku` value (for traceability).
            ================================================================

            ===== PRODUCT ENTITY DATA (from web search context) =====
            {variant_search_context}
            ================================================================

            ===== SKU PATTERN INSIGHTS =====
            - Suffixes like "-1KG", "-5KG", "-1L", "-400ML" are ALWAYS size/weight dimensions.
            - Suffixes like "-RED", "-BLUE", "-WHITE" are ALWAYS color dimensions.
            - In codes like "PE240101" vs "PE240105", different numeric endings often map to different packaging sizes (e.g. 01=1kg, 05=5kg).
            ================================================================

            VARIANT RESOLUTION RULES:
            1. START with all source variants. For each one, analyze its `name` field AND its `sku` field to determine:
               - option1 (Χρώμα/Color): Extract color info if present.
               - option2 (Χωρητικότητα/Βάρος or Μέγεθος/Διάσταση): Extract size/volume.
               
            2. DUAL AXIS DETECTION (MANDATORY):
               If you see multiple variants with the same color but different SKUs or prices, you MUST find a second dimension to distinguish them. 
               Check SKU suffixes or Numeric differences.
               Example: 
               PE240101 (Μπλε) + PE240105 (Μπλε) 
               Result: 
               Var 1: Option 1: "Μπλε", Option 2: "1kg"
               Var 2: Option 1: "Μπλε", Option 2: "5kg"

            3. CROSS-AXIS: If a product has BOTH color AND size dimensions, create the full matrix.
            
            4. DISCOVERY: If web search found ADDITIONAL variants not in source, ADD them with price: null.

            CATEGORY AXIS CONSTRAINTS (product type: "{product_type}"):
            - "Πινέλα & Εργαλεία", "Αξεσουάρ": NO Color. Only "Μέγεθος/Διάσταση" if applicable.
            - "Διαλυτικά & Αραιωτικά", "Προετοιμασία & Καθαρισμός": ONLY "Χωρητικότητα/Βάρος". NO Color.
            - "Σκληρυντές & Ενεργοποιητές": Usually ONLY "Χωρητικότητα/Βάρος".
            - All other types: Can have BOTH "Χρώμα" and "Χωρητικότητα/Βάρος".

            AXIS NOMENCLATURE:
            - `option1_name` MUST ALWAYS be "Χρώμα" (or null if no color).
            - `option2_name` MUST ALWAYS be "Χωρητικότητα/Βάρος" or "Μέγεθος/Διάσταση" (or null).

            VARIANT NAME: Create a clean Greek name combining the option values, e.g. "Μαύρο - 400ml" or just "2.5L".

            MANDATORY OPTIONS (CRITICAL):
            Every variant MUST have at least ONE non-null option value. 
            If a SKU is "-1KG", then `option2_name` must be "Χωρητικότητα/Βάρος" and `option2_value` must be "1kg".
            NEVER return a variant where all option values are null if the SKU suffix implies a dimension.

            Output a JSON array of variant objects.
            """

            response = client.models.generate_content(
                model=model_name,
                contents=[structure_prompt],
                config=types.GenerateContentConfig(
                    temperature=0.0,
                    response_mime_type="application/json",
                    response_schema={
                        "type": "ARRAY",
                        "items": {
                            "type": "OBJECT",
                            "properties": {
                                "sku_suffix": {"type": "STRING"},
                                "variant_name": {"type": "STRING"},
                                "option1_name": {"type": "STRING", "nullable": True},
                                "option1_value": {"type": "STRING", "nullable": True},
                                "option2_name": {"type": "STRING", "nullable": True},
                                "option2_value": {"type": "STRING", "nullable": True},
                                "price": {"type": "NUMBER", "nullable": True},
                                "pylon_sku": {"type": "STRING", "nullable": True}
                            },
                            "required": ["sku_suffix", "variant_name"]
                        }
                    }
                )
            )

            structured_variants = json.loads(response.text)
            logger.info(f"VariantAgent: LLM produced {len(structured_variants)} variants for {sku}")

            # Step 3: Curate with flash-lite
            if structured_variants:
                curated_variants = VariantAgent._curate_variants(client, product_type, structured_variants)
            else:
                curated_variants = []

            # Step 4: Count source vs discovered
            source_count = sum(1 for v in curated_variants if v.get("pylon_sku"))
            discovered_count = len(curated_variants) - source_count

            logger.info(f"VariantAgent: Final result for {sku}: {source_count} source + {discovered_count} discovered = {len(curated_variants)} total variants")

            # Step 5: Write to Firestore and advance
            enrichment_message = f"Variant resolution complete. {source_count} source + {discovered_count} web-discovered variants."

            doc_ref.update({
                "status": ProductState.SOURCING_IMAGES.value,
                "ai_data.variants": curated_variants,
                "enrichment_message": enrichment_message
            })

        except Exception as e:
            logger.error(f"VariantAgent Failed for {sku}: {e}", exc_info=True)
            raise e
