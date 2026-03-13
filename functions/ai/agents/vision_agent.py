from firebase_admin import firestore
import requests
import base64
import random
import time
from google.auth import default, transport

from core.llm_config import LLMConfig, ModelName
from core.logger import get_logger
from ..models import ProductState
from ..image_utils import normalize_product_image
from .metadata_agent import MetadataAgent, generate_with_retry

logger = get_logger(__name__)

class VisionAgent:
    """
    Responsible for Phase 2: Sourcing images, and Phase 3: Generating Studio Renders.
    """

    @staticmethod
    def source_images(doc_ref, data: dict):
        sku = data.get("sku", "")
        ai_data = data.get("ai_data", {})
        existing_images = ai_data.get("variant_images", {}).get("base", [])

        # --- PROTECTION: Do not overwrite if a user has already manually selected or uploaded an image ---
        selected_images = ai_data.get("selected_images", {})
        current_base = selected_images.get("base")
        if current_base:
            logger.info(f"VisionAgent: Skipping automatic sourcing for {sku}. User has already selected a source image.")
            doc_ref.update({
                "status": ProductState.GENERATING_STUDIO.value if not data.get("search_query") else ProductState.NEEDS_IMAGE_REVIEW.value,
                "enrichment_message": "Preserving user-selected image. Advancing pipeline."
            })
            return

        if existing_images:
            if len(existing_images) == 1:
                # Only one candidate, bypass QA to save time
                logger.info(f"VisionAgent: Only 1 candidate for {sku}. Proceeding directly.")
                best_img_url = existing_images[0]["url"]
                doc_ref.update({
                    "status": ProductState.GENERATING_STUDIO.value,
                    "ai_data.selected_images": {"base": best_img_url},
                    "enrichment_message": "Single image sourced automatically. Beginning Studio Generation."
                })
                return

            doc_ref.update({"enrichment_message": f"QA evaluating {len(existing_images)} image candidates..."})
            logger.info(f"VisionAgent: Running Multimodal QA on {len(existing_images)} candidates for {sku}...")

            from google.genai import types
            import json

            client = LLMConfig.get_client()
            
            # Download candidates (cap at 4 to save context and speed)
            max_candidates = min(len(existing_images), 4)
            image_parts = []
            valid_urls = []
            
            for i in range(max_candidates):
                try:
                    url = existing_images[i]["url"]
                    import html
                    url = html.unescape(url)
                    resp = requests.get(url, timeout=10, verify=False)
                    resp.raise_for_status()
                    # Add to parts array as explicitly numbered image
                    image_parts.extend([
                        types.Part.from_text(text=f"Image Index [{i}]:"),
                        types.Part.from_bytes(data=resp.content, mime_type="image/jpeg")
                    ])
                    valid_urls.append(url)
                except Exception as e:
                    logger.warning(f"Failed to fetch candidate image for QA: {e}")
                    
            if not valid_urls:
                doc_ref.update({
                    "status": ProductState.NEEDS_IMAGE_REVIEW.value,
                    "enrichment_message": "Failed to download candidate images. Please provide a manual source."
                })
                return

            if len(valid_urls) == 1:
                doc_ref.update({
                    "status": ProductState.GENERATING_STUDIO.value,
                    "ai_data.selected_images": {"base": valid_urls[0]},
                    "enrichment_message": "Only 1 valid candidate remained. Beginning Studio Generation."
                })
                return

            prompt = f"""You are a strict Data Quality Assurance AI for a premium e-commerce platform.
You are evaluating {len(valid_urls)} candidate images for a specific product.
Product Title: {ai_data.get('title', 'Unknown')}
Brand: {ai_data.get('brand', 'Unknown')}
Category: {ai_data.get('category', 'Unknown')}

Your job is to select the BEST single image to be used as the source for downstream studio generation.

CRITICAL REJECTION CRITERIA:
- REJECT any image that is just a BRAND LOGO.
- REJECT any image that is a CLP/GHS HAZARD PICTOGRAM (e.g. flame, toxic, corrosive, environment icons).
- REJECT any image that is a technical diagram, chemical symbol, or navigation asset.
- REJECT images with significant text overlays that obscure the product.

STRICT IDENTITY MATCHING:
- The image MUST clearly show the product described: "{ai_data.get('title', 'Unknown')}"
- The BRAND "{ai_data.get('brand', 'Unknown')}" MUST be visible or clearly implied by the packaging.
- Favor "Packshots" (product on pure white background).
Criteria for the BEST image:
1. IDENTITY MATCH: The label on the product MUST accurately match the provided Product Title and Brand. REJECT images of unrelated products.
2. Highest resolution and sharpness.
3. Complete isolation (a clear shot of the single product, preferably on a white/clean background).
4. NO heavy text overlays, promotional banners, or thick watermarks crossing the product.

Analyze the provided images (labeled with their indices).
Output valid JSON complying with the schema provided.
- `best_index`: The integer index of the winning image.
- `confidence`: A float between 0.0 and 1.0. If NO image matches the identity (wrong brand or product), set confidence to 0.0.
- `reasoning`: A brief explanation. If rejecting all, state why.
"""

            try:
                # Use retry helper to defend against 429s during QA
                response = generate_with_retry(
                    client=client,
                    model_name=LLMConfig.get_model_name(complex=True),
                    contents=[
                        types.Content(role="user", parts=[types.Part.from_text(text=prompt)] + image_parts)
                    ],
                    config=types.GenerateContentConfig(
                        temperature=0.0,
                        response_mime_type="application/json",
                        response_schema={
                            "type": "OBJECT",
                            "properties": {
                                "best_index": {"type": "INTEGER"},
                                "confidence": {"type": "NUMBER"},
                                "reasoning": {"type": "STRING"}
                            },
                            "required": ["best_index", "confidence", "reasoning"]
                        }
                    ),
                    sku=sku
                )
                if not response or not response.text:
                    raise Exception("VisionAgent: Empty response from QA model.")
                    
                qa_data = json.loads(response.text)
                best_idx = qa_data.get("best_index", 0)
                confidence = qa_data.get("confidence", 0.0)
                reasoning = qa_data.get("reasoning", "")
                
                logger.info(f"Multimodal QA Result for {sku}: Selected {best_idx} with Confidence {confidence}. Reason: {reasoning}")
                
                # Ensure index is within bounds of successfully downloaded images
                if best_idx < 0 or best_idx >= len(valid_urls):
                    best_idx = 0

                if confidence >= 0.75:
                    doc_ref.update({
                        "status": ProductState.GENERATING_STUDIO.value,
                        "ai_data.selected_images": {"base": valid_urls[best_idx]},
                        "enrichment_message": f"QA Confident ({int(confidence*100)}%): {reasoning}"
                    })
                else:
                    doc_ref.update({
                        "status": ProductState.NEEDS_IMAGE_REVIEW.value,
                        "ai_data.selected_images": {"base": valid_urls[best_idx]} if confidence > 0.3 else firestore.DELETE_FIELD,
                        "enrichment_message": f"QA Validation Failed (Confidence {int(confidence*100)}%): {reasoning} - Manual review required."
                    })
                return

            except Exception as e:
                logger.error(f"Multimodal QA Failed for {sku}: {e}")
                # Fallback to interactive review if QA crashes
                doc_ref.update({
                    "status": ProductState.NEEDS_IMAGE_REVIEW.value,
                    "enrichment_message": "Automatic QA analysis failed. Please select an image manually."
                })
                return
                
        # If no candidates at all
        logger.warning(f"VisionAgent: No images found for {sku}. Re-evaluating text or flagging for manual review.")
        doc_ref.update({
            "status": ProductState.NEEDS_IMAGE_REVIEW.value,
            "enrichment_message": "No web images found. Please provide a manual source image."
        })

    @staticmethod
    def _upload_to_storage(image_bytes: bytes, mime_type: str, sku: str, suffix: str) -> str:
        from firebase_admin import storage
        try:
            bucket = storage.bucket()
            blob_path = f"generated-images/{sku}/studio_{suffix}.jpg"
            blob = bucket.blob(blob_path)
            blob.cache_control = "no-cache, max-age=0"
            blob.upload_from_string(image_bytes, content_type=mime_type)
            blob.make_public()
            return blob.public_url
        except Exception as e:
            logger.error(f"Failed to upload image {suffix} for {sku}: {e}")
            raise e

    @staticmethod
    def generate_studio(doc_ref, data: dict):
        sku = data.get("sku", "")
        ai_data = data.get("ai_data", {})
        
        selected_images = ai_data.get("selected_images", {})
        source_url = selected_images.get("base")
        
        # --- STRICT SELECTION: Only proceed if there is a 'base' image ---
        if not source_url:
            logger.error(f"VisionAgent: Studio generation triggered for {sku} without a defined 'base' source image.")
            # If there's NO base, but we HAVE selected_images, maybe it was a variant?
            # Still, for base STUDIO, we MUST have a base image.
            doc_ref.update({
                "status": ProductState.NEEDS_IMAGE_REVIEW.value,
                "enrichment_message": "Missing 'base' source image. Please select one explicitly to begin studio generation."
            })
            return

        generation_model = ai_data.get("generation_model", "gemini") # "gemini" or "imagen"
        environment = ai_data.get("environment", "styled")
        category = ai_data.get("category", "Άλλο")
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
        
        # Brand palette for ambient lighting — dark blue-green petrol sets the premium studio mood
        color_instruction = "Bathe the entire scene atmosphere with a rich, dark blue-green petrol (#165c52) color cast — it must be the dominant mood color visible in the subtle backdrop haze, surface reflections, and rim lighting. Use deep navy-black (#0d1117) for the darkest shadows to highlight the physical texture of the materials. The dark blue-green petrol must be unmistakably present and recognizable as the brand signature color. Do NOT sample colors from the product label. "
        if finish_instruction:
            color_instruction += finish_instruction
            
        # Category-specific real-world contextual elements — Material and Quality Focused
        decorative_effect = "a slab of raw concrete with exposed aggregate, elegantly lit to reveal its deep physical texture and premium quality; subtle dark blue-green petrol tinted ambient haze in the background"
        
        if category == "Χρώματα Βάσης":
            decorative_effect = "a beautiful display of thick, high-viscosity wet paint subtly pooled around the product's base in its own pigment color — highlighting the rich, creamy texture and premium quality of the paint as a decorative material"
        elif category == "Βερνίκια & Φινιρίσματα":
            decorative_effect = "a smoothly finished wood or acrylic pedestal reflecting the product, lit to emphasize the flawless, high-quality protective finish and depth of the material"
        elif category == "Στόκοι & Πλαστελίνες":
            decorative_effect = "a textured surface with a smooth, perfectly applied spread of fresh filler compound showing elegant trowel marks; lit to emphasize the fine, premium granular texture of the material"
        elif category == "Πινέλα & Εργαλεία":
            decorative_effect = "elegant, controlled paint strokes in dark blue-green petrol and raw umber on a fine slate surface beneath the product — emphasizing the high-quality bristle marks, rich paint texture, and professional grade"
        elif category == "Αξεσουάρ":
            decorative_effect = "a cleanly machined dark steel industrial platform with elegant milled details; soft edge lighting highlighting the solid, professional build quality of the metal"
        elif category == "Διαλυτικά & Αραιωτικά":
            decorative_effect = "the product sits on a pristine, chemical-resistant borosilicate glass surface with subtle light refractions, set against a dark blue-green petrol studio background that emphasizes purity and professional grade fluid clarity"
        elif category == "Προετοιμασία & Καθαρισμός":
            decorative_effect = "a crisp, perfectly clean polished surface subtly dampened with pure water droplets near the product — showcasing the cleansing quality and premium effectiveness in a controlled studio setting"
        elif category == "Σκληρυντές & Ενεργοποιητές":
            decorative_effect = "a dark, premium tempered glass surface with a subtle, controlled warm glow at the base, emphasizing the precision and chemical potency of the activator against a dark blue-green petrol backdrop"
        elif category == "Αστάρια & Υποστρώματα":
            decorative_effect = "an elegant cross-section pedestal displaying flawless coating layers — clean substrate, smooth grey primer, and perfect topcoat — lit softly to highlight the strong adhesion and premium foundational quality of the primer"

        sizing_instruction = "The product must be tightly center-framed, occupying exactly 80% of the vertical canvas height."
        
        NANO_PROMPTS = {
            "clean": f"Using the provided image ONLY as a reference for the product's labels, colors, and shape, generate a BRAND NEW photography with these exact rules:\n1.  **COMMAND**: Ignore the camera angle, perspective, and lighting of the source image. Re-render the product from scratch, resting on an **invisible studio floor** against an **absolutely flat, seamless, solid pure white (#FFFFFF) backdrop**.\n2.  **NEGATIVE INSTRUCTIONS**: DO NOT include a horizon line, floor texture, visible surface transition, or depth. **Completely eliminate all floor reflections and contact shadows.** The white must be a solid, non-gradient color without lighting falloff.\n3.  **Composition & Angle**: Show the product from a straight-on, front-facing eye-level angle. Center it vertically/horizontally. {sizing_instruction} Full visibility (not cut off).\n4.  **Background & Lighting**: The entire canvas background must be a **uniform, flat, and non-reflective #FFFFFF pure white**. Use even studio lighting that does not cast any shadow on the background.\n5.  **Subject Isolation**: EXTRACT A SINGLE ITEM. If the source shows multiple items, generate ONLY ONE single item.\n6.  **Identity Accuracy**: PRESERVE THE IDENTITY (text, labels, logos, colors). Ensure all text on the label is legible and identical to the source.\n7.  **Surface**: The product should appear to float slightly or sit on a perfectly invisible surface that does not interact visually with the white background.",
            "realistic": f"Using the provided image ONLY as a reference for the product's labels, colors, and shape, generate a BRAND NEW photography with these exact rules:\n1.  **COMMAND**: Ignore the camera angle, perspective, and lighting of the source image. Re-render the product from scratch.\n2.  **NEGATIVE INSTRUCTIONS**: DO NOT inherit the lighting direction or camera tilt from the source.\n3.  **Composition & Lighting**: Side-on natural daylight creating realistic soft shadows. Show the product from a straight-on, eye-level angle. {sizing_instruction}\n4.  **Atmosphere**: Clean, light-grey polished concrete surface. Background is a softly blurred, minimalist workshop setting.\n5.  **Identity Accuracy**: Keep the branding and labels EXACTLY as they appear — preserve all text and logos, but render them from the new straight-on perspective.\n6.  **Aesthetic**: Authentic, premium yet practical workshop vibe.",
            "styled": f"Using the provided image ONLY as a reference for the product's labels, colors, and shape, generate a BRAND NEW photography with these exact rules:\n1.  **COMMAND**: Ignore the camera angle, perspective, and lighting of the source image. Re-render the product from scratch in an **elegant, dark premium studio with a dark blue-green petrol (#165c52) atmosphere**.\n2.  **NEGATIVE INSTRUCTIONS**: DO NOT use a white or neutral background. DO NOT create cartoon-like or digitally impossible effects — every element must be physically plausible and photorealistic. DO NOT float the product. All effects must look like they belong in a high-end catalog showcasing building materials.\n3.  **Composition & Camera**: Straight-on or slightly elevated perspective to clearly display the product and surrounding material textures. Center the product. {sizing_instruction} Soft depth of field: sharp product and immediate textures, trailing off smoothly into the studio background.\n4.  **Premium Lighting**: Sophisticated, controlled studio lighting tailored to highlight material textures and finishes — clear key light emphasizing physical qualities, a subtle dark blue-green petrol (#165c52) fill light setting the brand mood, and clean edge lighting. Avoid extreme blown-out contrast; focus on legibility and material richness.\n5.  **Context**: Place the product on or near {decorative_effect}. {color_instruction}\n6.  **Identity Accuracy**: Extract the main product unit. PRESERVE THE BRANDING AND TEXT Identity — all labels, logos, and text must be legible and accurate.\n7.  **Background & Atmosphere**: Dark studio setting with a subtle, rich dark blue-green petrol (#165c52) tint in the shadows and ambient space. The focus remains solidly on the product and the physical qualities of the materials, not the atmosphere.\n8.  **Aesthetic**: Ultra-premium, material-focused catalog imagery. Highlighting the quality, texture, and physical presence of the components. The viewer must feel the premium tangibility of this material."
        }

        IMAGEN_PROMPTS = {
            "clean": f"Professional studio product photography. The product is center-framed. **Background**: Absolutely flat, solid, non-reflective pure white (#FFFFFF) covering the entire frame. **No floor, no shadows, no reflections, and no horizon dots.** The product appears to be perfectly isolated against a uniform white void. {sizing_instruction}",
            "realistic": f"Professional cinematic product photography. The product sits on a high-texture, dark-grey polished concrete surface with realistic micro-reflections. {sizing_instruction} Environment: A minimalist, high-end design workshop with soft, volumetric natural daylight streaming from a side window. Lighting: Warm 4000K sunlight with subtle lens bloom and soft, elongated natural shadows. Camera: 50mm f/1.8 depth of field, sharp focus on the product label with a creamy background blur.",
            "styled": f"Premium material-focused product photography. The product sits on {decorative_effect}. {color_instruction} {sizing_instruction} **Background**: Dark studio environment with a subtle, rich dark blue-green petrol (#165c52) ambient tone emphasizing material quality without overwhelming the scene. **Lighting**: Sophisticated studio lighting designed to highlight physical textures, finishes, and premium quality without extreme contrast. **Camera**: Clean, balanced perspective. Mood: High-end building material and architectural catalog. Tangible, professional, and richly textured."
        }
        
        unique_colors = set()
        for v in variants:
            color = v.get("option1_value") if v.get("option1_name") == "Χρώμα" else None
            if not color:
                color = v.get("option2_value") if v.get("option2_name") == "Χρώμα" else None
            if color:
                unique_colors.add(color)

        try:
            client = LLMConfig.get_image_client()
            generated_images = {}
            
            logger.info(f"VisionAgent: Downloading source for {sku} from {source_url}...")
            import html
            source_url = html.unescape(source_url)
            img_resp = requests.get(source_url, timeout=15, verify=False)
            img_resp.raise_for_status()
            image_data = img_resp.content
            
            doc_ref.update({"enrichment_message": "Optimizing frame & perspective..."})
            image_data = normalize_product_image(image_data)
            mime_type = "image/jpeg"
            
            image_url = None
            base_image_bytes = None

            from google.genai import types

            if generation_model == "imagen":
                logger.info(f"VisionAgent: Calling Imagen for {sku} recontextualization...")
                prompt = IMAGEN_PROMPTS.get(environment, IMAGEN_PROMPTS["clean"])
                doc_ref.update({"enrichment_message": "Re-contextualizing with Imagen..."})
                
                from google.auth import default, transport
                region = LLMConfig.REGION
                project_id = LLMConfig.PROJECT_ID
                model_id = ModelName.IMAGE_RECONTEXT.value
                endpoint = f"https://{region}-aiplatform.googleapis.com/v1/projects/{project_id}/locations/{region}/publishers/google/models/{model_id}:predict"
                
                imagen_retries = 3
                for attempt in range(imagen_retries + 1):
                    try:
                        creds, _ = default()
                        auth_req = transport.requests.Request()
                        creds.refresh(auth_req)
                        
                        payload = {
                            "instances": [{"prompt": prompt, "productImages": [{"image": {"bytesBase64Encoded": base64.b64encode(image_data).decode("utf-8")}}] }],
                            "parameters": {"sampleCount": 1, "addWatermark": False, "seed": random.randint(1, 1000000), "enhancePrompt": False}
                        }
                        headers = {"Authorization": f"Bearer {creds.token}", "Content-Type": "application/json"}
                        
                        resp = requests.post(endpoint, json=payload, headers=headers, timeout=60)
                        resp.raise_for_status()
                        resp_json = resp.json()
                        
                        if "predictions" in resp_json and len(resp_json["predictions"]) > 0:
                            pred = resp_json["predictions"][0]
                            if "bytesBase64Encoded" in pred:
                                img_bytes = base64.b64decode(pred["bytesBase64Encoded"])
                                image_url = VisionAgent._upload_to_storage(img_bytes, "image/jpeg", sku, "base")
                                base_image_bytes = img_bytes
                                break
                        else:
                            raise Exception("Imagen: No predictions returned.")
                            
                    except Exception as ie:
                        if ("429" in str(ie) or "RESOURCE_EXHAUSTED" in str(ie)) and attempt < imagen_retries:
                            wait = (2 ** attempt) + (random.random() * 2)
                            logger.warning(f"VisionAgent: Imagen 429. Retrying in {wait:.1f}s...")
                            time.sleep(wait)
                        else:
                            logger.error(f"Imagen Recontext API call failed: {ie}")
                            raise ie

            else: # Gemini Flash Image
                logger.info(f"VisionAgent: Calling Gemini Studio for {sku} (env={environment})...")
                prompt = NANO_PROMPTS.get(environment, NANO_PROMPTS["clean"])
                doc_ref.update({"enrichment_message": "Synthesizing studio lighting..."})
                
                response = generate_with_retry(
                    client=client,
                    model_name=LLMConfig.get_image_model_name(),
                    contents=[
                        types.Content(
                            role="user",
                            parts=[
                                types.Part.from_bytes(data=image_data, mime_type=mime_type),
                                types.Part.from_text(text=prompt)
                            ]
                        )
                    ],
                    config=types.GenerateContentConfig(temperature=0.3, seed=random.randint(1, 1000000)),
                    sku=sku,
                    max_retries=6
                )
                
                if hasattr(response, 'generated_image') and response.generated_image:
                    image_url = response.generated_image.url
                    base_image_bytes = requests.get(image_url).content
                    generated_images["base"] = image_url
                elif response.candidates and response.candidates[0].content.parts:
                    doc_ref.update({"enrichment_message": "Generating high-fidelity visual..."})
                    img_bytes = None
                    for part in response.candidates[0].content.parts:
                        if part.inline_data:
                            img_bytes = part.inline_data.data
                            break
                    if img_bytes:
                        time.sleep(1)
                        doc_ref.update({"enrichment_message": "Finalizing render..."})
                        time.sleep(0.5)
                        image_url = VisionAgent._upload_to_storage(img_bytes, "image/jpeg", sku, "base")
                        base_image_bytes = img_bytes

            if image_url:
                generated_images["base"] = image_url
            else:
                raise Exception("Failed to generate Base Studio image")
            
            # --- Variant Recoloring ---
            if False and unique_colors and base_image_bytes:
                doc_ref.update({"enrichment_message": f"Rendering {len(unique_colors)} variant colors..."})
                logger.info(f"VisionAgent: Starting semantic recoloring for {len(unique_colors)} variants of {sku}")
                
                for color_name in unique_colors:
                    try:
                        # Safety Check: Did the user abort or delete this product while we were generating?
                        current_snap = doc_ref.get()
                        if not current_snap.exists:
                            raise Exception("Product was deleted during semantic recoloring.")
                        if current_snap.to_dict().get("status") in ["FAILED", "ABORTED"]:
                            raise Exception("Session aborted by user request.")

                        variant_match = next((v for v in variants if v.get("option1_value") == color_name or v.get("option2_value") == color_name), None)
                        if not variant_match: continue
                        suffix_key = variant_match.get("sku_suffix", color_name).replace("-", "").lower()
                        
                        recolor_prompt = f"Accurately recolor ONLY the ambient light accents and contextual surface elements to exactly {color_name}. DO NOT change the background, floor, or the central product itself. Preserve the exact geometry, reflections, shadows, and lighting perfectly."
                        
                        recolor_resp = generate_with_retry(
                            client=client,
                            model_name=ModelName.IMAGE_GEN.value,
                            contents=[
                                types.Content(role="user", parts=[
                                    types.Part.from_bytes(data=base_image_bytes, mime_type="image/jpeg"),
                                    types.Part.from_text(text=recolor_prompt)
                                ])
                            ],
                            config=types.GenerateContentConfig(temperature=0.0),
                            sku=sku
                        )
                        
                        variant_img_bytes = None
                        if hasattr(recolor_resp, 'generated_image') and recolor_resp.generated_image:
                            pass # Not inline
                        elif recolor_resp.candidates and recolor_resp.candidates[0].content.parts:
                            for part in recolor_resp.candidates[0].content.parts:
                                if part.inline_data:
                                    variant_img_bytes = part.inline_data.data
                                    break
                                    
                        if variant_img_bytes:
                            var_url = VisionAgent._upload_to_storage(variant_img_bytes, "image/jpeg", sku, suffix_key)
                            generated_images[suffix_key] = var_url
                            logger.info(f"Successfully recolored {sku} variant: {color_name}")
                    except Exception as ve:
                        logger.error(f"Semantic Recolor failed for {sku} color {color_name}: {ve}")
            
            # Final Formatting for UI array
            array_format = [{"url": url, "suffix": s} for s, url in generated_images.items()]

            # Transition state!
            # NOTE: We intentionally PRESERVE ai_data.selected_images so that
            # the user can re-trigger studio generation (retry/regenerate) without
            # having to re-select the source image from the Image step.
            doc_ref.update({
                "status": ProductState.READY_FOR_PUBLISH.value,
                "ai_data.images": array_format,
                "ai_data.generated_images": firestore.DELETE_FIELD, # Atomic Reset
                "enrichment_message": "Studio generation successful. Pipeline complete."
            })
            logger.info(f"VisionAgent: Studio Generation complete for {sku}")
            
        except Exception as e:
            logger.error(f"VisionAgent Failed for {sku}: {e}", exc_info=True)
            raise e
