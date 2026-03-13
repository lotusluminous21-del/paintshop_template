import json
import time
from firebase_admin import firestore
from shopify.client import ShopifyClient
from core.logger import get_logger

logger = get_logger("sync.products")

# Maximum time a product can stay in PUBLISHING before being considered stuck
PUBLISHING_TIMEOUT_SECONDS = 600  # 10 minutes

# Default sales channel to publish all products to
SALES_CHANNEL_NAME = "pavlicevits_eshop"


def _build_body_html(ai: dict) -> str:
    """Builds a clean HTML body from AI enrichment data.
    Technical specs are stored as metafields, not in the description."""
    parts = []

    description = ai.get("description", "")
    if description:
        parts.append(f"<p>{description}</p>")

    short_desc = ai.get("short_description", "")
    if short_desc and short_desc != description:
        parts.append(f"<p><em>{short_desc}</em></p>")

    return "\n".join(parts) if parts else "<p></p>"


def _normalize_suffix(suffix: str) -> str:
    """Normalizes a suffix for matching: lowercase, no hyphens."""
    return suffix.lower().replace("-", "").strip()


def _build_product_images(ai: dict) -> list:
    """
    Build the images array for the Shopify product payload.
    Returns list of dicts with 'src' key, base image only (variants removed).
    """
    images_data = ai.get("images", [])
    if not images_data:
        return []

    base_images = [img for img in images_data if _normalize_suffix(img.get("suffix", "")) == "base"]

    result = []
    for img in base_images:
        url = img.get("url", "")
        if not url:
            continue
        entry = {"src": url}
        if img.get("description"):
            entry["alt"] = img["description"]
        result.append(entry)

    return result


def _build_metafields(ai: dict) -> list:
    """
    Builds the metafields array for inline inclusion in Shopify product creation.
    Maps AI enrichment data to structured metafields under the 'pavlicevits' namespace.
    Only includes non-empty fields.
    """
    NAMESPACE = "pavlicevits"
    metafields = []

    def _add(key: str, value, mf_type: str = "single_line_text_field"):
        """Helper to add a metafield only if value is non-empty."""
        if value is None or value == "" or value == []:
            return
        if isinstance(value, list):
            # Shopify list types expect JSON array of strings
            metafields.append({
                "namespace": NAMESPACE,
                "key": key,
                "value": json.dumps(value),
                "type": mf_type
            })
        else:
            metafields.append({
                "namespace": NAMESPACE,
                "key": key,
                "value": str(value),
                "type": mf_type
            })

    # --- Base product metafields ---
    _add("short_description", ai.get("short_description"), "multi_line_text_field")
    _add("brand", ai.get("brand"))
    _add("category", ai.get("category"))
    _add("ai_confidence", ai.get("confidence_score"), "number_decimal")

    # --- Technical specs metafields (paint products) ---
    specs = ai.get("technical_specs")
    if specs and isinstance(specs, dict):
        # Single-value text fields
        _add("chemical_base", specs.get("chemical_base"))
        _add("finish", specs.get("finish"))
        _add("sequence_step", specs.get("sequence_step"))
        _add("coverage", specs.get("coverage"))
        _add("drying_time_touch", specs.get("drying_time_touch"))
        _add("recoat_window", specs.get("recoat_window"))
        _add("full_cure", specs.get("full_cure"))
        _add("drying_time", specs.get("drying_time"))
        _add("environment", specs.get("environment"))
        _add("weight_per_volume", specs.get("weight_per_volume"))
        _add("dry_film_thickness", specs.get("dry_film_thickness"))
        _add("mixing_ratio", specs.get("mixing_ratio"))
        _add("pot_life", specs.get("pot_life"))
        _add("voc_level", specs.get("voc_level"))
        _add("spray_nozzle_type", specs.get("spray_nozzle_type"))

        # List-value fields
        _add("surfaces", specs.get("surface_suitability"), "json")
        _add("special_properties", specs.get("special_properties"), "json")
        _add("application_method", specs.get("application_method"), "list.single_line_text_field")

    return metafields


def _validate_product_data(sku: str, ai: dict, pylon: dict) -> list:
    """
    Pre-flight validation of product data.
    Returns a list of error strings (empty = valid).
    """
    errors = []

    # Must have a title
    title = ai.get("title") or pylon.get("name")
    if not title:
        errors.append("Missing product title in both ai_data.title and pylon_data.name")

    # Must have at least one image
    images = ai.get("images", [])
    if not images:
        errors.append("Missing ai_data.images — no product images available")

    # Validate images have URLs
    valid_images = [img for img in images if img.get("url")]
    if images and not valid_images:
        errors.append("ai_data.images exists but all entries are missing URLs")

    # Validate variants have option data if present
    variants = ai.get("variants", [])
    for i, v in enumerate(variants):
        if not v.get("sku_suffix"):
            errors.append(f"Variant [{i}] missing sku_suffix")
        # At least one option must be defined
        has_option = any(v.get(f"option{j}_name") and v.get(f"option{j}_value") for j in range(1, 4))
        if not has_option:
            # This should ideally be caught and fixed by _fix_missing_variant_options before validation
            errors.append(f"Variant [{i}] '{v.get('variant_name', '?')}' has no option name/value pairs")

    return errors


def _fix_missing_variant_options(ai: dict):
    """
    Ensures every variant has at least one option name/value pair.
    If missing, it uses the variant_name or sku_suffix as a fallback.
    """
    variants = ai.get("variants", [])
    if not variants:
        return

    for v in variants:
        has_option = any(v.get(f"option{j}_name") and v.get(f"option{j}_value") for j in range(1, 4))
        if not has_option:
            # Fallback: Use variant_name or SKU suffix as Option 1
            fallback_value = v.get("variant_name") or v.get("sku_suffix", "").replace("-", "") or "Default"
            v["option1_name"] = "Επιλογή"
            v["option1_value"] = fallback_value
            logger.info(f"Fixed missing options for variant: {fallback_value}")


def _recover_stuck_publishing(db):
    """
    Safety net: Finds products stuck in PUBLISHING status for too long
    and resets them to READY_FOR_PUBLISH so they can be retried.
    """
    import datetime

    try:
        stuck_docs = db.collection("staging_products").where("status", "==", "PUBLISHING").stream()
        recovered = 0
        for doc in stuck_docs:
            data = doc.to_dict()
            updated_at = data.get("updated_at")

            # Check if it's been stuck for too long
            is_stuck = False
            if updated_at:
                if isinstance(updated_at, dict) and "seconds" in updated_at:
                    # Firestore Timestamp as dict
                    elapsed = time.time() - updated_at["seconds"]
                    is_stuck = elapsed > PUBLISHING_TIMEOUT_SECONDS
                elif hasattr(updated_at, "timestamp"):
                    # Native Firestore Timestamp
                    elapsed = time.time() - updated_at.timestamp()
                    is_stuck = elapsed > PUBLISHING_TIMEOUT_SECONDS
                else:
                    # Unknown format, recover it to be safe
                    is_stuck = True
            else:
                # No timestamp at all — it's stuck
                is_stuck = True

            if is_stuck:
                # Check if it actually exists in Shopify already (maybe it succeeded but Firestore update failed)
                shopify = ShopifyClient()
                existing = shopify.get_inventory_item_id_by_sku(doc.id)
                if existing:
                    doc.reference.update({
                        "status": "PUBLISHED",
                        "enrichment_message": "Recovered: Product found in Shopify after stuck PUBLISHING state."
                    })
                    logger.info(f"Recovered stuck product {doc.id} — found in Shopify, marked PUBLISHED.")
                else:
                    doc.reference.update({
                        "status": "READY_FOR_PUBLISH",
                        "enrichment_message": "Recovered: Reset from stuck PUBLISHING state. Will retry on next sync."
                    })
                    logger.info(f"Recovered stuck product {doc.id} — reset to READY_FOR_PUBLISH.")
                recovered += 1

        if recovered:
            logger.info(f"Recovered {recovered} stuck PUBLISHING products.")
    except Exception as e:
        logger.error(f"Error recovering stuck PUBLISHING products: {e}")


async def sync_products_job():
    """
    Syncs 'READY_FOR_PUBLISH' products from Firestore Staging to Shopify.
    
    Pipeline per product:
    1. Pre-flight validation (title, images, variants)
    2. READY_FOR_PUBLISH → PUBLISHING
    3. Create Shopify product (with all variants, images, brand, category)
    4. Link variant-specific images (from create_product response — zero extra API calls)
    5. Assign to category collection
    6. PUBLISHING → PUBLISHED (with sync report)
    
    Error handling:
    - Pre-flight failures → FAILED immediately, no Shopify call made
    - Shopify create_product fails → FAILED, nothing created
    - Variant image linking fails → Product still PUBLISHED (images exist, just not linked to variants)
    - Collection assignment fails → Product still PUBLISHED (just not in a collection)
    - All non-critical failures are tracked in enrichment_message as warnings
    - Stuck PUBLISHING products are auto-recovered on next sync run
    """
    db = firestore.client()
    shopify = ShopifyClient()

    logger.info("Starting Staged Product Sync Job...")

    # --- Phase 0: Recover stuck PUBLISHING products ---
    _recover_stuck_publishing(db)

    # --- Phase 0.5: Ensure metafield definitions exist in Shopify ---
    try:
        shopify.ensure_metafield_definitions()
    except Exception as mf_err:
        logger.warning(f"Non-critical: Failed to bootstrap metafield definitions: {mf_err}")

    # --- Phase 1: Fetch READY_FOR_PUBLISH products ---
    docs = db.collection("staging_products").where("status", "==", "READY_FOR_PUBLISH").stream()

    products_to_sync = []
    for doc in docs:
        product_data = doc.to_dict()
        product_data["sku"] = doc.id
        products_to_sync.append(product_data)

    if not products_to_sync:
        logger.info("No products ready for publish.")
        return {"created": 0, "updated": 0, "failed": 0}

    logger.info(f"Found {len(products_to_sync)} products ready for publish. Syncing to Shopify...")

    synced_count = 0
    updated_count = 0
    failed_count = 0

    for p in products_to_sync:
        sku = p.get("sku")
        pylon = p.get("pylon_data", {})
        ai = p.get("ai_data", {})
        doc_ref = db.collection("staging_products").document(sku)

        # --- Detect existing Shopify product (upsert detection) ---
        existing_shopify_id = p.get("shopify_product_id")
        if not existing_shopify_id:
            # Check Shopify directly by SKU (covers partial runs / manual imports)
            existing_shopify_id = shopify.find_product_id_by_sku(sku)
            if existing_shopify_id:
                logger.info(f"Product {sku} found in Shopify (ID: {existing_shopify_id}). Will UPDATE.")

        is_update = bool(existing_shopify_id)

        # --- Fix missing variant options (Robustness) ---
        _fix_missing_variant_options(ai)

        # --- Pre-flight Validation ---
        validation_errors = _validate_product_data(sku, ai, pylon)
        if validation_errors:
            error_summary = "; ".join(validation_errors[:3])
            logger.error(f"Pre-flight validation failed for {sku}: {error_summary}")
            doc_ref.update({
                "status": "FAILED",
                "enrichment_message": f"Sync blocked — data validation failed: {error_summary}"
            })
            failed_count += 1
            continue

        # --- Mark as PUBLISHING ---
        doc_ref.update({
            "status": "PUBLISHING",
            "enrichment_message": f"{'Updating' if is_update else 'Creating'} in Shopify...",
            "updated_at": firestore.SERVER_TIMESTAMP
        })

        try:
            # ============================================
            # PHASE 2: Build Product Payload
            # ============================================

            # Images (base first)
            images = _build_product_images(ai)

            # Tags (include category as a tag)
            tags_list = ai.get("tags", [])
            if isinstance(tags_list, str):
                tags_str = tags_list
            else:
                tags_str = ", ".join(tags_list)
            category = ai.get("category", "")
            if category and category not in tags_list:
                tags_str = f"{tags_str}, {category}" if tags_str else category

            # Rich HTML body
            body_html = _build_body_html(ai)

            # Vendor & Product Type
            vendor = ai.get("brand") or pylon.get("brand", "Pavlicevits")
            product_type = category or "General"

            # --- Build Options & Variants ---
            options = []
            variants_data = []
            ai_variants = ai.get("variants", [])
            fallback_price = pylon.get("price_retail") or pylon.get("price") or 0

            if ai_variants:
                # Collect unique option names in first-appearance order
                option_names = []
                for v in ai_variants:
                    for i in range(1, 4):
                        opt_name = v.get(f"option{i}_name")
                        if opt_name and opt_name not in option_names:
                            option_names.append(opt_name)

                # Build Shopify options with values
                for name in option_names:
                    values = []
                    for v in ai_variants:
                        for i in range(1, 4):
                            if v.get(f"option{i}_name") == name:
                                val = v.get(f"option{i}_value")
                                if val and val not in values:
                                    values.append(val)
                    options.append({"name": name, "values": values})

                # Build variant payloads
                for v in ai_variants:
                    variant_price = v.get("price")
                    if variant_price is None or variant_price == 0:
                        variant_price = fallback_price

                    var_payload = {
                        "sku": f"{sku}{v.get('sku_suffix', '')}",
                        "price": str(variant_price),
                        "inventory_management": None,
                        "title": v.get("variant_name", ""),
                    }

                    for i in range(1, 4):
                        opt_name = v.get(f"option{i}_name")
                        opt_value = v.get(f"option{i}_value")
                        if opt_name and opt_value:
                            try:
                                opt_index = option_names.index(opt_name) + 1
                                var_payload[f"option{opt_index}"] = opt_value
                            except ValueError:
                                pass

                    variants_data.append(var_payload)
            else:
                variants_data = [{
                    "price": str(fallback_price),
                    "sku": sku,
                    "inventory_management": None,
                }]

            product_payload = {
                "title": ai.get("title") or pylon.get("name"),
                "body_html": body_html,
                "vendor": vendor,
                "product_type": product_type,
                "status": "draft",
                "tags": tags_str,
                "images": images,
                "variants": variants_data,
            }
            if options:
                product_payload["options"] = options

            # Metafields (inline — no extra API calls)
            metafields = _build_metafields(ai)
            if metafields:
                product_payload["metafields"] = metafields

            # ============================================
            # PHASE 3: Create or Update Product in Shopify
            # ============================================
            if is_update:
                # --- UPDATE existing product ---
                logger.info(f"Updating product {sku} (Shopify ID: {existing_shopify_id})...")

                # Clean old variants before update (Shopify won't replace them automatically)
                try:
                    shopify.delete_product_variants(existing_shopify_id)
                except Exception as var_err:
                    logger.warning(f"Could not clean old variants for {sku}: {var_err}")

                result_product = shopify.update_product(existing_shopify_id, product_payload)

                if not result_product:
                    # Product was likely deleted from Shopify (404). Fall back to CREATE.
                    logger.warning(f"Update failed for {sku} (ID {existing_shopify_id} not found). Falling back to CREATE.")
                    is_update = False  # Switch to create path for status tracking
                    result_product = shopify.create_product(product_payload)
                    if not result_product:
                        raise Exception(f"Both update and create failed for {sku}")

                product_id = str(result_product["id"])
                logger.info(f"Successfully {'created (fallback)' if not is_update else 'updated'} product {sku} in Shopify (ID: {product_id})")
            else:
                # --- CREATE new product ---
                result_product = shopify.create_product(product_payload)
                if not result_product:
                    raise Exception("Shopify create_product returned no product data")

                product_id = str(result_product["id"])
                logger.info(f"Successfully created product {sku} in Shopify (ID: {product_id})")

            # Track non-critical warnings for the sync report
            warnings = []

            # ============================================
            # PHASE 4: Link Variant Images (SKIPPED)
            # ============================================
            # Variant image rendering is disabled, everyone gets the base image
            pass

            # ============================================
            # PHASE 5: Assign to Collection
            # ============================================
            if category:
                try:
                    collection_id = shopify.get_or_create_collection(category)
                    if collection_id:
                        shopify.add_product_to_collection(product_id, collection_id)
                    else:
                        warnings.append(f"collection '{category}' could not be found/created")
                except Exception as coll_err:
                    logger.warning(f"Non-critical: Failed to assign {sku} to collection: {coll_err}")
                    warnings.append(f"collection assignment failed: {str(coll_err)[:80]}")

            # ============================================
            # PHASE 5.5: Publish to Sales Channel
            # ============================================
            try:
                pub_id = shopify.get_publication_id(SALES_CHANNEL_NAME)
                if pub_id:
                    success = shopify.publish_product_to_channel(product_id, pub_id)
                    if not success:
                        warnings.append(f"failed to publish to {SALES_CHANNEL_NAME}")
                else:
                    warnings.append(f"sales channel '{SALES_CHANNEL_NAME}' not found")
            except Exception as pub_err:
                logger.warning(f"Non-critical: Failed to publish {sku} to channel: {pub_err}")
                warnings.append(f"channel publishing failed: {str(pub_err)[:80]}")

            # ============================================
            # PHASE 6: Mark PUBLISHED
            # ============================================
            sync_message = f"Successfully {'updated' if is_update else 'created'} in Shopify."
            if warnings:
                sync_message += f" Warnings: {'; '.join(warnings)}"

            doc_ref.update({
                "status": "PUBLISHED",
                "shopify_product_id": product_id,
                "synced_at": firestore.SERVER_TIMESTAMP,
                "enrichment_message": sync_message
            })
            if is_update:
                updated_count += 1
            else:
                synced_count += 1

        except Exception as e:
            logger.error(f"Exception syncing {sku}: {e}", exc_info=True)
            doc_ref.update({
                "status": "FAILED",
                "enrichment_message": f"Shopify sync failed: {str(e)[:200]}"
            })
            failed_count += 1

    summary = f"Sync Completed. Created: {synced_count}, Updated: {updated_count}, Failed: {failed_count}"
    logger.info(summary)
    return {"created": synced_count, "updated": updated_count, "failed": failed_count}


def _link_variant_images_from_response(
    shopify: ShopifyClient,
    created_product: dict,
    ai_variants: list,
    ai_images: list
) -> int:
    """
    Links variant images using the data already in the create_product response.
    No extra API calls needed — the response contains both variant IDs and image IDs.
    
    Returns the count of successfully linked variants.
    """
    # Build suffix → source URL map from our AI data
    suffix_to_url = {}
    for img in ai_images:
        suffix = _normalize_suffix(img.get("suffix", ""))
        if suffix and suffix != "base":
            suffix_to_url[suffix] = img["url"]

    if not suffix_to_url:
        return 0

    # Build source_url → Shopify image ID map from the create response
    shopify_images = created_product.get("images", [])
    url_to_image_id = {}
    for si in shopify_images:
        src = si.get("src", "")
        img_id = si.get("id")
        if src and img_id:
            url_to_image_id[src] = img_id

    if not url_to_image_id:
        return 0

    # Get Shopify variants from the create response
    shopify_variants = created_product.get("variants", [])
    if not shopify_variants:
        return 0

    linked = 0
    for sv in shopify_variants:
        sv_sku = sv.get("sku", "")
        sv_id = str(sv.get("id", ""))

        # Find the matching AI variant by SKU suffix
        for av in ai_variants:
            expected_suffix = av.get("sku_suffix", "")
            if sv_sku.endswith(expected_suffix):
                normalized_suffix = _normalize_suffix(expected_suffix)
                if normalized_suffix in suffix_to_url:
                    target_url = suffix_to_url[normalized_suffix]

                    # Find the Shopify image ID by matching source URL
                    matched_image_id = _match_image_url(target_url, url_to_image_id)
                    if matched_image_id:
                        success = shopify.update_variant_image(sv_id, matched_image_id)
                        if success:
                            logger.info(f"Linked variant {sv_id} (SKU: {sv_sku}) → image {matched_image_id}")
                            linked += 1
                break  # Found the matching AI variant, move to next Shopify variant

    return linked


def _match_image_url(source_url: str, url_to_id_map: dict):
    """
    Matches a source image URL to a Shopify image ID.
    Shopify CDN may transform URLs, so we use flexible matching:
    - First try exact match
    - Then try substring containment
    - Then try matching the filename portion
    """
    # Exact match
    if source_url in url_to_id_map:
        return url_to_id_map[source_url]

    # Substring containment
    for shopify_url, img_id in url_to_id_map.items():
        if source_url in shopify_url or shopify_url in source_url:
            return img_id

    # Filename match (last path segment, stripping query params)
    source_filename = source_url.split("/")[-1].split("?")[0]
    for shopify_url, img_id in url_to_id_map.items():
        shopify_filename = shopify_url.split("/")[-1].split("?")[0]
        if source_filename and source_filename == shopify_filename:
            return img_id

    return None
