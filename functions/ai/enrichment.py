import os
import logging
import json
import base64
import requests
import time
import random
import uuid
import urllib3
from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field
from firebase_admin import firestore, storage
from firebase_functions import firestore_fn, options
from google import genai
from google.genai import types

from core.llm_config import LLMConfig, ModelName
from .image_utils import normalize_product_image

# Suppress SSL warnings since we use verify=False for some extractors
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

logger = logging.getLogger(__name__)

def upload_image_to_storage(image_bytes: bytes, mime_type: str, sku: str) -> str:
    """
    Uploads raw image bytes to Firebase Storage and returns the public URL.
    Overwrites previous version for efficient storage.
    """
    try:
        bucket = storage.bucket() # Uses default bucket
        # Use a fixed filename to allow overwriting and efficient storage
        filename = "studio_base.jpg"
        blob_path = f"generated-images/{sku}/{filename}"
        blob = bucket.blob(blob_path)
        blob.cache_control = "no-cache, max-age=0"
        
        # Atomic Reset: If we are uploading a NEW base, ensure any old derived visuals in Firestore are gone
        # Note: This is usually handled by the frontend, but we do it here as a safety bridge.
        
        blob.upload_from_string(image_bytes, content_type=mime_type)
        blob.make_public()
        
        return blob.public_url
    except Exception as e:
        logger.error(f"Failed to upload image for {sku}: {e}")
        raise e

def generate_with_retry(client, model, contents, config, retries=3, initial_delay=1):
    """
    Wraps generate_content with exponential backoff for 429 errors.
    """
    delay = initial_delay
    for attempt in range(retries + 1):
        try:
            return client.models.generate_content(
                model=model,
                contents=contents,
                config=config
            )
        except Exception as e:
            # Check for 429 or Resource Exhausted
            error_str = str(e)
            if "429" in error_str or "RESOURCE_EXHAUSTED" in error_str:
                if attempt < retries:
                    sleep_time = delay + random.uniform(0, 1) # Add jitter
                    logger.warning(f"Rate limited (429). Retrying in {sleep_time:.2f}s... (Attempt {attempt+1}/{retries})")
                    time.sleep(sleep_time)
                    delay = min(delay * 2, 60.0) # Exponential backoff with cap
                    continue
            # Re-raise other errors or if retries exhausted
            raise e

def clean_json(text: str) -> str:
    """Removes potential markdown code blocks from the JSON string."""
    text = text.strip()
    if text.startswith("```"):
        # Find the first { and the last }
        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end != -1:
            return text[start:end+1]
    return text


def generate_metadata(product_name: str, sku: str, search_results: list) -> dict:
    """
    Generates metadata, variants, categories and tags using Gemini based on search results.
    """
    client = LLMConfig.get_client()

    # Construct context from search results
    context_text = "\n".join([f"- {r['title']}: {r['snippet']}" for r in search_results])

    prompt = f"""
    You are an expert e-commerce copywriter for a premium paints and sprays shop.
    Create a compelling, SEO-optimized product description for a Shopify store.
    The description should be PLAIN TEXT ONLY, NO HTML TAGS.
    
    You must also:
    1. Provide a high-quality translation of the description in Greek.
    2. Provide a customer-friendly product title in Greek.
    3. DISCOVER VARIANTS: From the context, identify if this product has variants (colors, sizes, volumes). 
       List them clearly.
    4. SUGGEST CATEGORIES & TAGS: Based on the product type (e.g., Spray Paint, Primer, Wood Varnish).

    Product: {product_name} (SKU: {sku})
    
    Context from Search:
    {context_text}
    
    Output JSON format:
    {{
        "title_el": "Greek Title",
        "description": "English description",
        "description_el": "Greek description",
        "short_description": "...",
        "tags": ["tag1", "tag2"],
        "product_type": "Main Product Type",
        "project_category": "Main Project Category",
        "variants": [
            {{
                "sku_suffix": "suffix (e.g. RED)",
                "variant_name": "Color: Red",
                "option_name": "Color",
                "option_value": "Red",
                "pylon_sku": "{sku}"
            }}
        ],
        "attributes": {{"key": "value"}},
        "confidence_score": 0.0-1.0
    }}
    """

    try:
        model_name = LLMConfig.get_model_name(complex=True)
        logger.info(f"Calling Gemini ({model_name}) for SKU {sku}")
        
        response = client.models.generate_content(
            model=model_name,
            contents=[prompt],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.3
            )
        )
        
        if not response or not response.text:
            logger.error(f"Gemini returned empty text for {sku}")
            return {}

        logger.info(f"Gemini Response for {sku}: {response.text}")
        cleaned_text = clean_json(response.text)
        data = json.loads(cleaned_text)
        return data
    except Exception as e:
        logger.error(f"Gemini metadata generation failed for {sku}: {str(e)}", exc_info=True)
        return {"error": str(e)}

def validate_image(image_url: str, product_name: str) -> float:
    return 0.8 

# Decorator moved to main.py for lazy loading
def enrich_product(event: firestore_fn.Event[firestore_fn.Change[firestore_fn.DocumentSnapshot]]) -> None:
    """
    Main dispatcher for the Product Enrichment Wizard.
    """
    try:
        logger.info(f"Triggered enrich_product for event: {event.id}")
        new_doc = event.data.after
        if not new_doc:
            return

        data = new_doc.to_dict()
        if not data:
            return

        status = data.get("status")
        sku = data.get("sku")
        pylon_data = data.get("pylon_data", {})
        name = pylon_data.get("name", "")

        # PHASE 1: Metadata & Variant Discovery
        if status == "PENDING_METADATA":
            handle_metadata_phase(new_doc.reference, data, firestore.client(), force_metadata=True)
        
        # PHASE 2: Image Sourcing
        elif status == "PENDING_IMAGE_SOURCING":
            handle_image_sourcing_phase(new_doc.reference, data, firestore.client())

        # PHASE 3: Nano Banana Studio Generation
        elif status == "PENDING_NANO_BANANA":
            # For now, we still allow individual processing if triggered by a doc write (e.g. manual retry)
            # but the UI will favor the bulk trigger.
            handle_nano_banana_phase(new_doc.reference, sku, name, data.get("ai_data", {}))

        # PHASE 3.5: Batch Generation In Progress
        elif status == "BATCH_GENERATING":
            # Just wait for the batch process to complete
            pass

        # PHASE 4: Final BG Removal & Prep
        elif status == "PENDING_BG_REMOVAL":
            handle_bg_removal_phase(new_doc.reference, sku, data.get("ai_data", {}), mode="generated")

        # PHASE 4.5: Source BG Removal (Optional)
        elif status == "PENDING_SOURCE_BG_REMOVAL":
            handle_bg_removal_phase(new_doc.reference, sku, data.get("ai_data", {}), mode="source")

    except Exception as e:
        logger.error(f"Global enrichment trigger error: {e}", exc_info=True)
        # Try to report to doc if possible
        try:
            event.data.after.reference.update({
            "status": "FAILED",
            "enrichment_message": f"Global Trigger Error: {str(e)[:50]}"
        })
        except:
            pass


from core.discovery_service import DiscoveryService
from core.content_extractor import ContentExtractor

from .schema import ProductEnrichmentData


def handle_metadata_phase(product_ref, data, db, force_metadata=False):
    """
    Phase 1: Generate Metadata AND Search for Images using Gemini Grounding + Scraper.
    """
    sku = data.get("sku", "")
    name = data.get("name") or data.get("pylon_data", {}).get("name", "")
    
    if not name:
        logger.error(f"Missing name for SKU {sku}")
        product_ref.update({
            "status": "MISSING_DATA",
            "enrichment_message": "Missing product name. Check input data."
        })
        return

    ai_data_existing = data.get("ai_data", {})
    # Detection: If title_el exists, we are likely refining/sourcing images for already approved metadata
    is_refinement = bool(ai_data_existing.get("title_el")) and not force_metadata
    search_query = data.get("search_query")

    logger.info(f"Starting Grounding + Scraper Enrichment for {sku} (is_refinement={is_refinement}, custom_query={bool(search_query)})")
    
    try:
        # Initialize Services
        discovery_service = DiscoveryService()
        content_extractor = ContentExtractor()

        # --- STEP 1: Grounded Search (Text + Source URLs) ---
        search_result = discovery_service.search_and_enrich(name, search_query=search_query)
        
        if search_result.get("error"):
            raise Exception(f"Discovery Service Failed: {search_result['error']}")
            
        generated_text = search_result.get("text", "")
        source_urls = search_result.get("source_urls", [])
        
        logger.info(f"Discovery complete. Found {len(source_urls)} sources.")

        # --- STEP 2: Image Extraction (Scraper) ---
        found_images = []
        if source_urls:
            logger.info(f"Extracting images from {len(source_urls)} sources...")
            images = content_extractor.fetch_images_from_urls(source_urls, limit=5)
            # Format as expected by frontend/firestore
            found_images = [{"url": img, "score": 0.9, "source": "web_scrape"} for img in images]
            logger.info(f"Extracted {len(found_images)} images.")
        
        # --- STEP 3: Structure Data (Gemini) ---
        # Skip metadata structuring if we are only refining images and already have metadata
        if is_refinement:
            logger.info(f"Skipping metadata structuring for {sku} as it already exists.")
            new_ai_data = {
                **ai_data_existing,
                "variant_images": {
                    "base": found_images
                },
                "grounding_sources": source_urls,
                "grounding_text": generated_text,
                "refined_at": firestore.SERVER_TIMESTAMP
            }
            # Also clear the search_query after use to prevent accidental re-runs with it
            product_ref.update({
                "status": "PENDING_IMAGE_SELECTION", # Advance directly to selection
                "ai_data": new_ai_data,
                "search_query": firestore.DELETE_FIELD,
                "enrichment_message": f"Refined search complete. Found {len(found_images)} images."
            })
        else:
            client = LLMConfig.get_client()
            model_name = LLMConfig.get_model_name(complex=True)
            
            structure_prompt = f"""Είσαι ένας Ειδικός Δεδομένων Shopify για ένα Κατάστημα Χρωμάτων, Σπρέι και Εργαλείων.
            Εξήγαγε τις πληροφορίες του προϊόντος σε μια έγκυρη δομή JSON βάσει του παρακάτω κειμένου.

            SOURCE TEXT:
            {generated_text}

            REQUIREMENTS (STRICTLY IN GREEK):
            - Δημιούργησε έναν σημασιολογικό (semantic), καθαρό και συνοπτικό τίτλο (title). ΠΡΕΠΕΙ να περιέχει εμφανώς κωδικούς μοντέλων, νούμερα ταυτοποίησης ή την κύρια μάρκα, ώστε να ξεχωρίζει από παρόμοια προϊόντα.
            - Γράψε μια περιγραφή (description) που είναι διαβαστερή, φιλική προς τον πελάτη και συνοψίζει τα τεχνικά χαρακτηριστικά τονίζοντας την κύρια χρήση και τα οφέλη.
            - Σύντομη περιγραφή (short_description) για συλλογές.
            - PRODUCT TYPE (product_type): Επίλεξε ΑΥΣΤΗΡΑ μία από τις παρακάτω κατηγορίες προϊόντων: "Προετοιμασία & Καθαρισμός", "Αστάρια & Υποστρώματα", "Χρώματα Βάσης", "Βερνίκια & Φινιρίσματα", "Σκληρυντές & Ενεργοποιητές", "Στόκοι & Πλαστελίνες", "Πινέλα & Εργαλεία", "Διαλυτικά & Αραιωτικά", "Αξεσουάρ", "Άλλο".
            - PROJECT CATEGORY (project_category): Επίλεξε ΑΥΣΤΗΡΑ μία από τις παρακάτω κατηγορίες έργου: "Αυτοκίνητο", "Ναυτιλιακά", "Οικοδομικά", "Ειδικές Εφαρμογές".
            - DYNAMIC VARIANTS: Αναζήτησε άξονες παραλλαγών στο κείμενο (π.χ. διαθέσιμα χρώματα στο χρωματολόγιο, συσκευασίες/όγκοι (400ml, 1L), μεγέθη, διαμέτρους μπεκ). Δημιούργησε δυναμικά Options (π.χ. option1_name="Χρώμα", option1_value="Λευκό", option2_name="Όγκος / Συσκευασία", option2_value="400ml") και χτίσε τον πίνακα `variants`.
            - TECHNICAL SPECS: Κατηγοριοποίησε αυστηρά το προϊόν βάσει της χημικής του βάσης (Ακρυλικό, Σμάλτο κλπ), το στάδιο της εφαρμογής (Αστάρι, Βερνίκι κλπ), κατάλληλες επιφάνειες και φινίρισμα. 
            - Βαθύτερα Τεχνικά Χαρακτηριστικά (όπου υπάρχουν): Ειδικό βάρος, πάχος στεγνού φιλμ, αναλογία μίξης (για 2K), voc.

            ΠΡΟΣΟΧΗ: Όλα τα δεδομένα, enum values, tags και categories ΠΡΕΠΕΙ να επιστραφούν ΑΥΣΤΗΡΑ στα Ελληνικά.
            """
            
            structure_response = client.models.generate_content(
                model=model_name,
                contents=[structure_prompt],
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=ProductEnrichmentData,
                    temperature=0.0
                )
            )
            
            structured_data = json.loads(structure_response.text)
            
            ai_data = {
                "title": structured_data.get("title", ""),
                "description": structured_data.get("description", ""),
                "short_description": structured_data.get("short_description", ""),
                "tags": structured_data.get("tags", []),
                "product_type": structured_data.get("product_type", ""),
                "project_category": structured_data.get("project_category", ""),
                "variants": structured_data.get("variants", []),
                "attributes": structured_data.get("attributes", {}),
                "technical_specs": structured_data.get("technical_specs", {}),
                "generated_at": firestore.SERVER_TIMESTAMP,
                "model": model_name,
                "variant_images": {
                    "base": found_images
                },
                "grounding_sources": source_urls,
                "grounding_text": generated_text # Store raw text for debugging
            }
            
            # Update Firestore
            product_ref.update({
                "status": "PENDING_METADATA_REVIEW",
                "ai_data": ai_data,
                "enrichment_message": f"Enrichment Complete. Found {len(found_images)} images."
            })
        logger.info(f"Enrichment successful for {sku}")

    except Exception as e:
        logger.error(f"Enrichment Failed for {sku}: {e}", exc_info=True)
        product_ref.update({
            "status": "FAILED", 
            "enrichment_message": f"AI Error: {str(e)}"
        })

def handle_image_sourcing_phase(product_ref, data, db):
    """
    Phase 2: Legacy/Retry Image Search. 
    Now primarily a verify/supplement step if Phase 1 missed images.
    """
    # For now, if we are triggered here, it means we need to TRY AGAIN using the same logic
    # or just advance if we have images.
    sku = data.get("sku", "")
    ai_data = data.get("ai_data", {})
    existing_images = ai_data.get("variant_images", {}).get("base", [])
    has_custom_query = "search_query" in data

    # If it's a batch "Start Sourcing" and we already have images, we can skip.
    # But if there's a custom query or it's a manual "Refine", we should proceed.
    if existing_images and not has_custom_query:
        # Check if we were just triggered by a mass update. 
        # If it's a manual Refine, we likely won't have changed anything but the status.
        logger.info(f"Images already present for {sku} and no custom query. Advancing to selection.")
        product_ref.update({
            "status": "PENDING_IMAGE_SELECTION",
            "enrichment_message": "Images ready for selection."
        })
        return

    # If no images, trigger the enrichment logic again (reuse handle_metadata_phase or similar logic)
    # For simplicity, we redirect to metadata phase effectively
    logger.info(f"Retrying enrichment for {sku} in Phase 2...")
    handle_metadata_phase(product_ref, data, db)


def handle_nano_banana_phase(doc_ref, sku, name, ai_data):
    logger.info(f"Phase 3: Studio Generation for {sku}")
    
    import requests
    import base64
    import random
    
    generation_model = ai_data.get("generation_model", "gemini") # "gemini" or "imagen"
    environment = ai_data.get("environment", "clean")
    
    product_type = ai_data.get("product_type", "Άλλο")
    variants = ai_data.get("variants", [])
    technical_specs = ai_data.get("technical_specs", {})
    finish_raw = technical_specs.get("finish", "")
    
    # Translate finish into aesthetic directions for contextual surfaces
    finish_instruction = ""
    if finish_raw in ["Ματ", "Σατινέ", "Σαγρέ/Ανάγλυφο"]:
        finish_instruction = "The contextual surfaces and ambient accents MUST have a smooth, matte, light-absorbing finish with completely diffused, non-reflective highlights."
    elif finish_raw in ["Γυαλιστερό", "Υψηλής Γυαλάδας"]:
        finish_instruction = "The contextual surfaces and ambient accents MUST possess a highly glossy, wet, and deeply reflective finish with sharp specular highlights."
    elif finish_raw in ["Μεταλλικό", "Πέρλα"]:
        finish_instruction = "The contextual surfaces and ambient accents MUST feature a sparkling, metallic finish infused with micro-reflective pearlescent flakes that catch the light dynamically."
    
    # Brand palette for ambient lighting — petrol green DOMINATES the scene
    color_instruction = "FLOOD the entire scene atmosphere with a strong, saturated dark petrol green (#165c52) color cast — it must be the dominant mood color visible in the backdrop haze, surface reflections, and rim lighting. Use deep navy-black (#0d1117) for the darkest shadows to create extreme contrast. The petrol green must be unmistakably present and recognizable as the brand signature color. Do NOT sample colors from the product label. "
    if finish_instruction:
        color_instruction += finish_instruction
    
    # Category-specific real-world contextual elements — BOLD and dramatic
    decorative_effect = "a massive slab of fractured raw concrete with exposed steel rebar and rough aggregate, dramatically side-lit to reveal deep texture; thick volumetric petrol-green-tinted fog rolling through the background"
    
    if product_type == "Χρώματα Βάσης":
        decorative_effect = "a dramatic cascade of thick, high-viscosity wet paint pouring and pooling around the product's base in the product's own pigment color — visible glossy drip trails, heavy paint rivulets, and a wide spreading puddle catching sharp studio reflections"
    elif product_type == "Βερνίκια & Φινιρίσματα":
        decorative_effect = "a jet-black mirror-finish acrylic pedestal reflecting the product with crystalline clarity; intense caustic light patterns from a hidden light source dancing across the reflective surface, creating dramatic bright-to-dark contrast"
    elif product_type == "Στόκοι & Πλαστελίνες":
        decorative_effect = "a cracked, heavily textured concrete block with deep fissures revealing raw substrate layers; a thick spread of fresh filler compound applied with visible trowel marks on one face; clouds of fine powder dust suspended and dramatically backlit"
    elif product_type == "Πινέλα & Εργαλεία":
        decorative_effect = "thick, aggressive paint strokes in vivid petrol green and raw umber slashed across a dark slate surface beneath and around the product — heavy impasto texture with visible bristle marks, paint-loaded drips, and bold gestural energy"
    elif product_type == "Αξεσουάρ":
        decorative_effect = "a precision-machined dark steel industrial platform with CNC-milled grooves and chamfered edges; intense specular highlights from edge lighting creating sharp bright lines against the dark metal"
    elif product_type == "Διαλυτικά & Αραιωτικά":
        decorative_effect = "dramatic plumes of dense vapor rising from the product base, backlit by a sharp petrol-green-gelled light source creating visible light rays through the vapor; the product sits on a dark chemical-resistant borosilicate glass surface with visible caustic refractions"
    elif product_type == "Προετοιμασία & Καθαρισμός":
        decorative_effect = "a high-impact frozen splash of crystal-clear water exploding upward from a dark polished surface near the product — individual droplets suspended mid-air catching pin-sharp highlights, with a spreading ripple pattern on the wet surface"
    elif product_type == "Σκληρυντές & Ενεργοποιητές":
        decorative_effect = "intense, razor-sharp beams of white light slicing through dense petrol-green atmospheric haze around the product; the product sits on dark tempered glass with a vivid hot-orange glow at its base suggesting an exothermic chemical reaction"
    elif product_type == "Αστάρια & Υποστρώματα":
        decorative_effect = "a dramatically split cross-section pedestal showing thick, clearly distinct coating layers — raw rusted steel substrate, grey primer coat, and glossy topcoat — each layer sharply delineated and side-lit to emphasize depth and material contrast"

    sizing_instruction = "The product must be tightly center-framed, occupying exactly 80% of the vertical canvas height."
    
    NANO_PROMPTS = {
        "clean": f"""Using the provided image ONLY as a reference for the product's labels, colors, and shape, generate a BRAND NEW photography with these exact rules:
1.  **COMMAND**: Ignore the camera angle, perspective, and lighting of the source image. Re-render the product from scratch, resting on an **invisible studio floor** against an **absolutely flat, seamless, solid pure white (#FFFFFF) backdrop**.
2.  **NEGATIVE INSTRUCTIONS**: DO NOT include a horizon line, floor texture, visible surface transition, or depth. **Completely eliminate all floor reflections and contact shadows.** The white must be a solid, non-gradient color without lighting falloff.
3.  **Composition & Angle**: Show the product from a straight-on, front-facing eye-level angle. Center it vertically/horizontally. {sizing_instruction} Full visibility (not cut off).
4.  **Background & Lighting**: The entire canvas background must be a **uniform, flat, and non-reflective #FFFFFF pure white**. Use even studio lighting that does not cast any shadow on the background.
5.  **Subject Isolation**: EXTRACT A SINGLE ITEM. If the source shows multiple items, generate ONLY ONE single item.
6.  **Identity Accuracy**: PRESERVE THE IDENTITY (text, labels, logos, colors). Ensure all text on the label is legible and identical to the source.
7.  **Surface**: The product should appear to float slightly or sit on a perfectly invisible surface that does not interact visually with the white background.""",

        "realistic": f"""Using the provided image ONLY as a reference for the product's labels, colors, and shape, generate a BRAND NEW photography with these exact rules:
1.  **COMMAND**: Ignore the camera angle, perspective, and lighting of the source image. Re-render the product from scratch.
2.  **NEGATIVE INSTRUCTIONS**: DO NOT inherit the lighting direction or camera tilt from the source.
3.  **Composition & Lighting**: Side-on natural daylight creating realistic soft shadows. Show the product from a straight-on, eye-level angle. {sizing_instruction}
4.  **Atmosphere**: Clean, light-grey polished concrete surface. Background is a softly blurred, minimalist workshop setting.
5.  **Identity Accuracy**: Keep the branding and labels EXACTLY as they appear — preserve all text and logos, but render them from the new straight-on perspective.
6.  **Aesthetic**: Authentic, premium yet practical workshop vibe.""",

        "modern": f"""Using the provided image ONLY as a reference for the product's labels, colors, and shape, generate a BRAND NEW photography with these exact rules:
1.  **COMMAND**: Ignore the camera angle, perspective, and lighting of the source image. Re-render the product from scratch in a **dramatic, dark industrial studio drenched in petrol green (#165c52) atmosphere**.
2.  **NEGATIVE INSTRUCTIONS**: DO NOT use a white or neutral background. DO NOT create cartoon-like or digitally impossible effects — every element must be physically plausible and photorealistic. DO NOT float the product. All effects must look like they could exist in a real high-budget studio photoshoot.
3.  **Composition & Camera**: Heroic low-angle perspective (15-20° upward looking), making the product tower over the viewer. Center the product. {sizing_instruction} Ultra-shallow depth of field (f/1.4 equivalent): razor-sharp product label and body, with gently blurred background atmosphere.
4.  **EXTREME Cinematic Lighting**: Aggressive high-contrast 3-point lighting — punishing hard key light from upper-left creating razor-sharp highlights and deep black shadows on the product, a STRONG saturated petrol green (#165c52) fill light from the right flooding the product's right side and background with unmistakable green, a hot 3200K tungsten kicker from directly behind creating a bright edge-separation halo. Contrast ratio must be extreme: blown-out specular highlights next to pitch-black shadows.
5.  **Industrial Context**: Place the product on or near {decorative_effect}. {color_instruction}
6.  **Identity Accuracy**: Extract the main product unit. PRESERVE THE BRANDING AND TEXT Identity — all labels, logos, and text must be legible and accurate.
7.  **Background & Atmosphere**: Deep black studio void with thick, visible volumetric haze/fog strongly tinted petrol green (#165c52) — the green atmosphere must be clearly visible and dominant, creating visible light rays where the studio lights cut through the fog. The overall color palette of the image should read as dark + petrol green + sharp white highlights.
8.  **Aesthetic**: Ultra-premium automotive advertising meets industrial material catalog. Think Porsche or Audi product photography — maximum drama, maximum contrast, maximum presence. The viewer must feel the weight and importance of this product."""
    }

    IMAGEN_PROMPTS = {
        "clean": f"Professional studio product photography. The product is center-framed. **Background**: Absolutely flat, solid, non-reflective pure white (#FFFFFF) covering the entire frame. **No floor, no shadows, no reflections, and no horizon lines.** The product appears to be perfectly isolated against a uniform white void. {sizing_instruction}",
        "realistic": f"Professional cinematic product photography. The product sits on a high-texture, dark-grey polished concrete surface with realistic micro-reflections. {sizing_instruction} Environment: A minimalist, high-end design workshop with soft, volumetric natural daylight streaming from a side window. Lighting: Warm 4000K sunlight with subtle lens bloom and soft, elongated natural shadows. Camera: 50mm f/1.8 depth of field, sharp focus on the product label with a creamy background blur.",
        "modern": f"Ultra-dramatic industrial editorial product photography. The product sits on {decorative_effect}. {color_instruction} {sizing_instruction} **Background**: Deep black studio void with thick volumetric fog heavily tinted petrol green (#165c52), creating visible god-rays where lights cut through. **Lighting**: Aggressive high-contrast 3-point — hard key upper-left, STRONG saturated petrol green (#165c52) fill flooding right side, hot tungsten kicker behind for bright edge halo. Heroic low-angle camera (15-20° upward). Ultra-shallow depth of field. Extreme contrast: blown-out highlights against pitch-black shadows. Mood: Porsche-level automotive advertising. Maximum drama and presence."
    }
    
    # Identify unique variant colors that need dedicated images
    unique_colors = set()
    for v in variants:
        color = v.get("option1_value") if v.get("option1_name") == "Χρώμα" else None
        if not color:
            color = v.get("option2_value") if v.get("option2_name") == "Χρώμα" else None
        if color:
            unique_colors.add(color)
            
    try:
        # Use US Central specifically for image/Imagen models
        client = LLMConfig.get_image_client()
        selected_images = ai_data.get("selected_images", {})
        generated_images = {}
        
        # Select a single source image (prioritize 'base', else take the first one)
        source_url = selected_images.get("base")
        active_suffix = "base"
        
        if not source_url and selected_images:
            first_key = next(iter(selected_images))
            source_url = selected_images[first_key]
        
        if source_url:
            try:
                # Download image to bypass robots.txt restriction on Vertex AI
                logger.info(f"Downloading source image for {sku} from {source_url}...")
                import html
                source_url = html.unescape(source_url)
                img_resp = requests.get(source_url, timeout=15, verify=False)
                img_resp.raise_for_status()
                image_data = img_resp.content
                logger.info(f"Downloaded {len(image_data)} bytes of image data for {sku}")
                mime_type = img_resp.headers.get('Content-Type', 'image/jpeg')
                
                # Normalize product sizing and centering
                doc_ref.update({"enrichment_message": "Optimizing frame & perspective..."})
                image_data = normalize_product_image(image_data)
                mime_type = "image/jpeg" # Explicitly JPEG after normalization
                
                image_url = None

                if generation_model == "imagen":
                    logger.info(f"Calling Imagen Recontext for {sku} (env={environment})...")
                    prompt = IMAGEN_PROMPTS.get(environment, IMAGEN_PROMPTS["clean"])
                    doc_ref.update({"enrichment_message": "Re-contextualizing with Imagen..."})
                    
                    # For Imagen Recontext, we use predict call as it's a specific API
                    # Using the raw prediction endpoint if genai doesn't support it directly
                    try:
                        # Removed forced 60s sleep since we're in us-central1 and have higher capacity
                        
                        from google.auth import default, transport
                        creds, project = default()
                        auth_req = transport.requests.Request()
                        creds.refresh(auth_req)
                        
                        region = LLMConfig.REGION
                        project_id = LLMConfig.PROJECT_ID
                        model_id = ModelName.IMAGE_RECONTEXT.value
                        
                        endpoint = f"https://{region}-aiplatform.googleapis.com/v1/projects/{project_id}/locations/{region}/publishers/google/models/{model_id}:predict"
                        
                        payload = {
                            "instances": [
                                {
                                    "prompt": prompt,
                                    "productImages": [
                                        {
                                            "image": {
                                                "bytesBase64Encoded": base64.b64encode(image_data).decode("utf-8")
                                            }
                                        }
                                    ]
                                }
                            ],
                            "parameters": {
                                "sampleCount": 1,
                                "addWatermark": False,
                                "seed": random.randint(1, 1000000),
                                "enhancePrompt": False
                            }
                        }
                        
                        headers = {
                            "Authorization": f"Bearer {creds.token}",
                            "Content-Type": "application/json"
                        }
                        
                        response = requests.post(endpoint, json=payload, headers=headers, timeout=60)
                        response.raise_for_status()
                        resp_json = response.json()
                        
                        if "predictions" in resp_json and len(resp_json["predictions"]) > 0:
                            pred = resp_json["predictions"][0]
                            if "bytesBase64Encoded" in pred:
                                img_bytes = base64.b64decode(pred["bytesBase64Encoded"])
                                image_url = upload_image_to_storage(img_bytes, "image/jpeg", sku)
                            elif "gcsUri" in pred:
                                # Handle GCS URI if provided
                                logger.info(f"Imagen returned GCS URI: {pred['gcsUri']}")
                                # For now we assume base64 is returned as per typical predict output
                        
                    except Exception as ie:
                        logger.error(f"Imagen Recontext API call failed: {ie}")
                        raise ie

                else: # Default to Gemini
                    logger.info(f"Calling Gemini to generate studio image for {sku} (env={environment})...")
                    prompt = NANO_PROMPTS.get(environment, NANO_PROMPTS["clean"])
                    doc_ref.update({"enrichment_message": "Synthesizing studio lighting..."})
                    response = generate_with_retry(
                        client=client,
                        model=LLMConfig.get_image_model_name(),
                        contents=[
                            types.Content(
                                role="user",
                                parts=[
                                    types.Part.from_bytes(data=image_data, mime_type=mime_type),
                                    types.Part.from_text(text=prompt)
                                ]
                            )
                        ],
                        config=types.GenerateContentConfig(
                            temperature=0.3,
                            seed=random.randint(1, 1000000),
                        ),
                        retries=4,
                        initial_delay=2
                    )
                    
                    # Case 1: Standard generated_image (Imagen models)
                    if hasattr(response, 'generated_image') and response.generated_image:
                        image_url = response.generated_image.url
                    
                    # Case 2: Raw data in candidates (Gemini Flash Image)
                    elif response.candidates and response.candidates[0].content.parts:
                        # Extract image
                        doc_ref.update({"enrichment_message": "Generating high-fidelity visual..."})
                        
                        img_bytes = None
                        for part in response.candidates[0].content.parts:
                            if part.inline_data:
                                img_bytes = part.inline_data.data
                                break
                        
                        if img_bytes:
                            # UI Visibility: Brief pause
                            import time
                            time.sleep(1)
                            doc_ref.update({"enrichment_message": "Finalizing render..."})
                            time.sleep(0.5)
                            # Upload BASE to Firebase Storage
                            image_url = upload_image_to_storage(img_bytes, "image/jpeg", f"{sku}_base")

                if image_url:
                    generated_images["base"] = image_url
                    base_image_bytes = img_bytes if img_bytes else requests.get(image_url).content
                else:
                    raise Exception("Failed to generate Base Studio image")
                
                # --- PHASE 3.B: Variant Recoloring using Gemini 2.5 Flash Image ---
                if False and unique_colors and base_image_bytes:
                    doc_ref.update({"enrichment_message": f"Rendering {len(unique_colors)} variant colors..."})
                    logger.info(f"Starting semantic recoloring for {len(unique_colors)} variants of {sku}")
                    
                    for color_name in unique_colors:
                        try:
                            # Map the color directly to the relevant variant object for tracking/suffix
                            variant_match = next((v for v in variants if v.get("option1_value") == color_name or v.get("option2_value") == color_name), None)
                            if not variant_match: continue
                            suffix_key = variant_match.get("sku_suffix", color_name).replace("-", "").lower()
                            
                            recolor_prompt = f"Accurately recolor ONLY the ambient light accents and contextual surface elements to exactly {color_name}. DO NOT change the background, floor, or the central product itself. Preserve the exact geometry, reflections, shadows, and lighting perfectly."
                            
                            recolor_resp = generate_with_retry(
                                client=client,
                                model=ModelName.IMAGE_GEN.value,
                                contents=[
                                    types.Content(
                                        role="user",
                                        parts=[
                                            types.Part.from_bytes(data=base_image_bytes, mime_type="image/jpeg"),
                                            types.Part.from_text(text=recolor_prompt)
                                        ]
                                    )
                                ],
                                config=types.GenerateContentConfig(temperature=0.0),
                                retries=2,
                                initial_delay=1
                            )
                            
                            variant_img_bytes = None
                            if hasattr(recolor_resp, 'generated_image') and recolor_resp.generated_image:
                                # Standard payload
                                pass
                            elif recolor_resp.candidates and recolor_resp.candidates[0].content.parts:
                                for part in recolor_resp.candidates[0].content.parts:
                                    if part.inline_data:
                                        variant_img_bytes = part.inline_data.data
                                        break
                                        
                            if variant_img_bytes:
                                var_url = upload_image_to_storage(variant_img_bytes, "image/jpeg", f"{sku}_{suffix_key}")
                                generated_images[suffix_key] = var_url
                                logger.info(f"Successfully recolored {sku} variant: {color_name}")
                        except Exception as ve:
                            logger.error(f"Semantic Recolor failed for {sku} color {color_name}: {ve}")
                            # Keep going even if one variant fails
                            
            except Exception as e:
                logger.warning(f"Failed to generate image for {sku}: {e}")
                raise e
        
        doc_ref.update({
            "ai_data.generated_images": generated_images,
            "ai_data.images": firestore.DELETE_FIELD, # Atomic Reset: purge derived assets on re-render
            "status": "PENDING_STUDIO_REVIEW",
            "enrichment_message": "Ready for Studio Review"
        })
        
    except Exception as e:
        logger.error(f"Generation phase failed for {sku}: {e}")
        doc_ref.update({"status": "FAILED", "enrichment_message": f"Generation error: {str(e)}"})


def handle_bg_removal_phase(doc_ref, sku, ai_data, mode="generated"):
    logger.info(f"Phase 4: BG Removal for {sku} (mode={mode})")
    
    import requests
    import os
    from concurrent.futures import ThreadPoolExecutor, as_completed
    
    fal_key = os.environ.get("FAL_KEY", "").strip()
    if not fal_key:
        logger.error(f"Missing FAL_KEY for {sku}")
        doc_ref.update({"status": "FAILED", "enrichment_message": "Missing FAL_KEY for Background Removal"})
        return
        
    service_url = "https://fal.run/fal-ai/bria/background/remove"
    
    # Select target images based on mode
    if mode == "source":
        # Target the manual/downloaded source image
        source_img = ai_data.get("selected_images", {}).get("base")
        if not source_img:
            logger.error(f"No source image to remove background for {sku}")
            doc_ref.update({"status": "READY_FOR_STUDIO", "enrichment_message": "BG removal skipped: No source image"})
            return
        targets = {"base": source_img}
    else:
        # Target the AI generated images
        targets = ai_data.get("generated_images", {})

    if not targets:
        logger.warning(f"No images to process for BG removal for {sku}")
        doc_ref.update({"status": "READY_FOR_STUDIO" if mode == "source" else "APPROVED"})
        return

    final_images = {}
    
    def process_image(suffix, img_url):
        for attempt in range(3):
            try:
                resp = requests.post(
                    service_url,
                    headers={
                        "Authorization": f"Key {fal_key}",
                        "Content-Type": "application/json"
                    },
                    json={"image_url": img_url},
                    timeout=30
                )
                if resp.ok:
                    result = resp.json()
                    result_url = result.get("image", {}).get("url")
                    if result_url:
                        return suffix, result_url
                    else:
                        logger.warning(f"BG removal unexpected response for {sku} suffix {suffix}: {result}")
                else:
                    logger.warning(f"BG removal attempt {attempt+1} failed for {sku} suffix {suffix}: {resp.status_code} {resp.text}")
            except Exception as e:
                logger.warning(f"BG removal attempt {attempt+1} error for {sku} suffix {suffix}: {e}")
        return suffix, None

    try:
        # We can safely run up to 5 concurrent requests to Fal.ai
        with ThreadPoolExecutor(max_workers=5) as executor:
            future_to_suffix = {executor.submit(process_image, s, url): s for s, url in targets.items()}
            
            for future in as_completed(future_to_suffix):
                suffix = future_to_suffix[future]
                result_url = future.result()
                if result_url:
                    final_images[suffix] = result_url
                else:
                    logger.error(f"Failed to remove background for {sku} suffix {suffix} after 3 attempts")

        # Update Firestore based on mode
        if mode == "source" and "base" in final_images:
            doc_ref.update({
                "ai_data.selected_images.base": final_images["base"],
                "status": "READY_FOR_STUDIO",
                "enrichment_message": "Source background removed successfully"
            })
        elif mode == "generated" and final_images:
            doc_ref.update({
                "ai_data.images": [ {"url": url, "suffix": s} for s, url in final_images.items()],
                "status": "APPROVED",
                "enrichment_message": "Ready to sync to Shopify"
            })
        else:
            # Fallback
            doc_ref.update({
                "enrichment_message": f"BG removal completed with mixed results ({len(final_images)}/{len(targets)})",
                "status": "READY_FOR_STUDIO" if mode == "source" else "APPROVED", 
            })
            
    except Exception as e:
        logger.error(f"BG removal phase failed for {sku}: {e}")
        doc_ref.update({"status": "FAILED", "enrichment_message": f"BG removal error: {str(e)}"})


