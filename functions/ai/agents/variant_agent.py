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
        Post-processor that uses deterministic python logic to clean up 
        LLM hallucinations, deduplicate axes, and ensure strictly clean variants.
        Preserves pylon_sku and price fields from source mapping.
        """
        if not variants:
            return []

        logger.info(f"VariantAgent: Curating {len(variants)} raw variants via Python rules...")

        curated = []
        seen_skus = set()

        for raw_v in variants:
            v = dict(raw_v) # fast shallow copy
            sku_s = v.get("sku_suffix", "").strip().upper()
            if not sku_s or sku_s in seen_skus:
                continue

            # Deterministic cleanup of options. We now allow dynamic axes!
            o1n = v.get("option1_name")
            o1v = v.get("option1_value")
            o2n = v.get("option2_name")
            o2v = v.get("option2_value")

            # Clean empty pairs
            if o1n and not o1v:
                o1n = None
            if o2n and not o2v:
                o2n = None

            # Fallback for completely empty variants that need differentiation
            if not o1v and not o2v:
                o1n = "Επιλογή"
                o1v = sku_s

            v["option1_name"] = o1n
            v["option1_value"] = o1v
            v["option2_name"] = o2n
            v["option2_value"] = o2v

            # Build variant_name dynamically from whatever values exist
            name_parts = [str(val) for val in [o1v, o2v] if val]
            v["variant_name"] = " - ".join(name_parts)

            curated.append(v)
            seen_skus.add(sku_s)

        # Safety: ensure all source variants survived curation (specifically price checks)
        source_skus = {v.get("pylon_sku") for v in variants if v.get("pylon_sku")}
        curated_skus = {v.get("pylon_sku") for v in curated if v.get("pylon_sku")}
        missing = source_skus - curated_skus
        if missing:
            logger.warning(f"VariantAgent Curation: {len(missing)} source variants were dropped! Re-adding them.")
            dropped = [v for v in variants if v.get("pylon_sku") in missing]
            curated.extend(dropped)

        # Ensure that ALL prices from source survived!
        # The LLM frequently drops the price field, so we must inject it back.
        price_map = {v.get("pylon_sku"): v.get("price") for v in variants if v.get("pylon_sku") and v.get("price") is not None}
        for v in curated:
            p_sku = v.get("pylon_sku")
            if p_sku in price_map:
                v["price"] = price_map[p_sku]

        logger.info(f"VariantAgent Curation: {len(variants)} raw → {len(curated)} clean variants.")
        return curated

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

            ===== SKU & TEXT PATTERN INSIGHTS =====
            - Suffixes or text like "1KG", "5KG", "1L", "2,5LT", "0.75LT", "400ML" are ALWAYS size/weight dimensions.
            - Text like "RED", "BLUE", "WHITE", "ΛΕΥΚΟ", "ΓΚΡΙ", "ΠΟΡΤΟΚΑΛΙ" are ALWAYS color dimensions.
            ================================================================

            VARIANT RESOLUTION RULES:
            1. DYNAMIC AXIS EXTRACTION & FLEXIBILITY:
               For EVERY source variant, you MUST analyze the full text of its original name and deduce WHAT makes these variants different.
               You are NO LONGER restricted to just Color or Weight. You must dynamically title your axes based on what the product actually is.
               Examples:
               - For Paint: `option1_name`="Χρώμα", `option2_name`="Χωρητικότητα"
               - For Sandpaper: `option1_name`="Νούμερο (Grit)"
               - For Tape/Masking: `option1_name`="Πλάτος (mm)", `option2_name`="Μήκος (m)"
               - For Brushes/Tools: `option1_name`="Μέγεθος" or "Διάσταση"
               
            2. UNIQUENESS GUARANTEE (MANDATORY):
               EVERY variant MUST have a UNIQUE combination of option values. 
               If your variants have different SKUs or prices, they differ in some dimension. YOU MUST extract that dimension from their text strings and put it in Option 1 or Option 2. Never output identical variants.

            3. CROSS-AXIS: If a product has multiple dimensions (e.g., Color AND Size), create the full matrix.
            
            4. DISCOVERY: If web search found ADDITIONAL valid variants not in source, ADD them with price: null.

            CATEGORY GUIDELINES (product type: "{product_type}"):
            - If it's a Tool/Accessory, look for Dimensions, Lengths, Diameters.
            - If it's a Liquid (Solvent/Hardener/Paint), look for Weight/Volume (Liters, ml, kg).
            - If it's Paint, look for Color in addition to Volume.

            VARIANT NAME: Create a clean Greek name combining the option values, e.g. "Λευκό - 1kg", "Νο 80", or "19mm x 50m".

            MANDATORY SCHEMA USAGE (CRITICAL):
            Every variant MUST have at least ONE non-null option. 
            `option1_name` must be the name of the primary changing attribute.
            `option1_value` must be the value.
            Use `option2_name` and `option2_value` if there is a second changing attribute.

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
