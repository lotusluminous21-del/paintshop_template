import csv
import io
import json
from typing import List, Dict, Any
from firebase_admin import firestore
from datetime import datetime
from core.logger import get_logger
logger = get_logger("pylon.ingest")

STAGING_COLLECTION = "staging_products"

def parse_float_greek(value: str) -> float:
    """Parses a float string with Greek locale (comma as decimal)."""
    if not value:
        return 0.0
    try:
        # Remove thousands separator (.) and replace decimal comma (,) with dot (.)
        clean_value = value.replace(".", "").replace(",", ".")
        return float(clean_value)
    except ValueError:
        logger.warning(f"Could not parse float value: {value}")
        return 0.0

def group_variants_with_llm(products: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Uses an LLM to identify duplicate products (variants like colors/sizes) 
    from the raw parsed list and groups them under a single parent product.
    """
    if not products:
        return []

    from core.llm_config import LLMConfig
    from google.genai import types

    client = LLMConfig.get_client()
    model_name = LLMConfig.get_model_name(complex=True)
    
    grouped_products_map = {}
    
    # Process in chunks to avoid blowing up the LLM context window
    chunk_size = 50 
    for i in range(0, len(products), chunk_size):
        chunk = products[i:i + chunk_size]
        
        # Prepare a lightweight JSON representation for the LLM
        items_for_llm = []
        for p in chunk:
            items_for_llm.append({
                "sku": p["sku"],
                "name": p["pylon_data"]["name"],
                "comments": p["pylon_data"].get("comments", "")
            })
            
        prompt = f"""You are a strict Data Deduplication AI for a Greek e-commerce paint and marine store.
        Your job is to identify products that are simply VARIANTS of the exact same underlying base product.
        Often these differ only by color (e.g., BLACK, WHITE, RED) or size/volume (e.g., 400ML, 1LT, 750ML).
        
        RAW INPUT PRODUCTS:
        {json.dumps(items_for_llm, ensure_ascii=False)}
        
        RULES:
        1. Group products together ONLY if they represent the same underlying item with different attributes (color/size).
        2. Choose ONE SKU from the group to be the "parent_sku" (ideally the shortest or most generic one, or just the first one).
        3. All SKUs in that group (including the parent itself) should be listed in the "member_skus" array.
        4. If a product has no variants, it should still be returned as its own group with just its own SKU in "member_skus" and itself as the "parent_sku".
        
        Return a strict JSON array of objects with ALWAYS two fields: "parent_sku" and "member_skus".
        """
        
        try:
            response = client.models.generate_content(
                model=model_name,
                contents=[prompt],
                config=types.GenerateContentConfig(
                    temperature=0.0,
                    response_mime_type="application/json",
                    response_schema={
                        "type": "ARRAY",
                        "items": {
                            "type": "OBJECT",
                            "properties": {
                                "parent_sku": {"type": "STRING"},
                                "member_skus": {
                                    "type": "ARRAY",
                                    "items": {"type": "STRING"}
                                }
                            },
                            "required": ["parent_sku", "member_skus"]
                        }
                    }
                )
            )
            
            result_text = response.text
            if result_text.startswith("```json"):
                result_text = result_text.replace("```json\\n", "").replace("\\n```", "")
            
            group_mappings = json.loads(result_text)
            
            # Reconstruct the aggregated products from this chunk
            chunk_products_by_sku = {p["sku"]: p for p in chunk}
            
            for mapping in group_mappings:
                parent_sku = mapping.get("parent_sku")
                member_skus = mapping.get("member_skus", [])
                
                if not parent_sku or parent_sku not in chunk_products_by_sku:
                    # Fallback if hallucinated
                    if member_skus and member_skus[0] in chunk_products_by_sku:
                        parent_sku = member_skus[0]
                    else:
                        continue
                        
                # Make a distinct copy of the parent to become the master record
                parent_doc = dict(chunk_products_by_sku[parent_sku])
                
                # Ensure the 'source_variants' array exists on the parent
                if "source_variants" not in parent_doc["pylon_data"]:
                    parent_doc["pylon_data"]["source_variants"] = []
                
                # Append all members to the parent's source_variants
                variant_prices = []
                for m_sku in member_skus:
                    if m_sku in chunk_products_by_sku:
                        member_doc = chunk_products_by_sku[m_sku]
                        price = member_doc["pylon_data"].get("price_retail", 0)
                        if price:
                            variant_prices.append(price)
                        parent_doc["pylon_data"]["source_variants"].append({
                            "sku": member_doc["sku"],
                            "price_retail": member_doc["pylon_data"]["price_retail"],
                            "price_bulk": member_doc["pylon_data"]["price_bulk"],
                            "stock_quantity": member_doc["pylon_data"]["stock_quantity"],
                            "active": member_doc["pylon_data"]["active"],
                            "name": member_doc["pylon_data"]["name"],
                            "comments": member_doc["pylon_data"].get("comments", "")
                        })
                
                # Update parent price to the minimum of all variants for floor pricing
                if variant_prices:
                    parent_doc["pylon_data"]["price_retail"] = min(variant_prices)
                
                grouped_products_map[parent_sku] = parent_doc
                
        except Exception as e:
            logger.error(f"LLM Grouping failed for chunk: {str(e)}. Passing items through directly.", exc_info=True)
            for p in chunk:
                 if "source_variants" not in p["pylon_data"]:
                     p["pylon_data"]["source_variants"] = [{
                        "sku": p["sku"],
                        "price_retail": p["pylon_data"]["price_retail"],
                        "price_bulk": p["pylon_data"]["price_bulk"],
                        "stock_quantity": p["pylon_data"]["stock_quantity"],
                        "active": p["pylon_data"]["active"],
                        "name": p["pylon_data"]["name"],
                        "comments": p["pylon_data"].get("comments", "")
                     }]
                 grouped_products_map[p["sku"]] = p
                 
    return list(grouped_products_map.values())

def parse_pylon_csv(csv_content: str) -> List[Dict[str, Any]]:
    """
    Parses the Pylon export CSV content into a list of dictionaries.
    Resilient to BOM, encoding issues, and slight header variations.
    """
    if not csv_content:
        return []

    # 1. Strip BOM if present
    csv_content = csv_content.lstrip('\ufeff')

    first_line = csv_content.splitlines()[0] if csv_content else ""
    delimiter = ";" if ";" in first_line else ","
    logger.info(f"Using CSV delimiter: '{delimiter}'")

    f = io.StringIO(csv_content)
    reader = csv.DictReader(f, delimiter=delimiter)
    
    products = []
    
    # Helper to find value by partial key match (resilient to Greek characters/BOM)
    def find_val(row_dict, possible_keywords):
        for k, v in row_dict.items():
            if not k: continue
            k_clean = k.strip().lower()
            for pk in possible_keywords:
                if pk.lower() in k_clean:
                    return v
        return None

    # Common Greek headers for Pylon
    SKU_KEYS = ["Κωδικός", "Kwdivko", "SKU", "Code"]
    NAME_KEYS = ["Όνομα", "Onoma", "Name", "Περιγραφή"]
    STOCK_KEYS = ["Υπόλοιπο", "Stock", "Quantity", "Ποσότητα"]
    PRICE_RETAIL_KEYS = ["Λιανική", "Retail", "Price", "Τιμή"]
    PRICE_BULK_KEYS = ["Χονδρική", "Hondriki", "Bulk", "Wholesale"]
    ACTIVE_KEYS = ["Ενεργό", "Active", "Status"]
    COMMENT_KEYS = ["Σχόλια", "Comments", "Παρατηρήσεις", "Σχόλιο"]

    for row in reader:
        # Map CSV columns to our schema using fuzzy matching
        sku = find_val(row, SKU_KEYS)
        if not sku:
            continue

        name = find_val(row, NAME_KEYS)
        stock_val = find_val(row, STOCK_KEYS) or "0"
        stock = parse_float_greek(str(stock_val))
        
        price_retail_val = find_val(row, PRICE_RETAIL_KEYS) or "0"
        price_retail = parse_float_greek(str(price_retail_val))

        price_bulk_val = find_val(row, PRICE_BULK_KEYS) or "0"
        price_bulk = parse_float_greek(str(price_bulk_val))
        
        active_raw = find_val(row, ACTIVE_KEYS) or "Ναι"
        active = str(active_raw).lower() in ["ναι", "yes", "true", "1"]
        
        comments = find_val(row, COMMENT_KEYS) or ""

        # SANITIZE SKU: Replace slashes with dashes to avoid Firestore path errors (empty components)
        raw_sku = str(sku).strip()
        safe_sku = raw_sku.replace("/", "-").replace("\\", "-")

        # FILTER EMPTY KEYS: raw_csv_row must not have empty string keys, 
        # as Firestore merge=True fails with "One or more components is not a string or is empty."
        clean_row = {str(k).strip(): v for k, v in row.items() if k and str(k).strip()}

        product_data = {
            "sku": safe_sku,
            "source": "manual_csv",
            "pylon_data": {
                "name": str(name).strip() if name else "",
                "price_retail": price_retail,
                "price_bulk": price_bulk,
                "stock_quantity": stock,
                "active": active,
                "comments": str(comments).strip(),
                "raw_csv_row": clean_row
            },
            "updated_at": datetime.utcnow().isoformat()
        }
        # Initial status for new products. 
        # We don't overwrite status if it's already being processed or reviewed.
        product_data["status"] = "IMPORTED" 
        
        products.append(product_data)
        
    return group_variants_with_llm(products)

def parse_pylon_xlsx(file_content: bytes) -> List[Dict[str, Any]]:
    """
    Parses the Pylon export XLSX binary content into a list of dictionaries.
    Extracts the newly requested 'comments' column.
    """
    import openpyxl
    
    wb = openpyxl.load_workbook(io.BytesIO(file_content), data_only=True)
    ws = wb.active
    
    products = []
    rows = list(ws.iter_rows(values_only=True))
    
    if not rows:
        return []
        
    headers = [str(cell).strip() if cell is not None else "" for cell in rows[0]]
    
    # Common Greek headers for Pylon
    SKU_KEYS = ["Κωδικός", "Kwdivko", "SKU", "Code"]
    NAME_KEYS = ["Όνομα", "Onoma", "Name", "Περιγραφή"]
    STOCK_KEYS = ["Υπόλοιπο", "Stock", "Quantity", "Ποσότητα"]
    PRICE_RETAIL_KEYS = ["Λιανική", "Retail", "Price", "Τιμή"]
    PRICE_BULK_KEYS = ["Χονδρική", "Hondriki", "Bulk", "Wholesale"]
    ACTIVE_KEYS = ["Ενεργό", "Active", "Status"]
    COMMENT_KEYS = ["Σχόλια", "Comments", "Παρατηρήσεις", "Σχόλιο"]
    
    def find_val(row_dict, possible_keywords):
        for k, v in row_dict.items():
            if not k: continue
            k_clean = k.strip().lower()
            for pk in possible_keywords:
                if pk.lower() in k_clean:
                    return v
        return None

    for row_cells in rows[1:]:
        row_vals = [str(cell) if cell is not None else "" for cell in row_cells]
        row_dict = dict(zip(headers, row_vals))
        
        sku = find_val(row_dict, SKU_KEYS)
        if not sku or str(sku).strip() == "" or str(sku).strip() == "None":
            continue

        name = find_val(row_dict, NAME_KEYS)
        stock_val = find_val(row_dict, STOCK_KEYS) or "0"
        stock = parse_float_greek(str(stock_val))
        
        price_retail_val = find_val(row_dict, PRICE_RETAIL_KEYS) or "0"
        price_retail = parse_float_greek(str(price_retail_val))

        price_bulk_val = find_val(row_dict, PRICE_BULK_KEYS) or "0"
        price_bulk = parse_float_greek(str(price_bulk_val))
        
        active_raw = find_val(row_dict, ACTIVE_KEYS) or "Ναι"
        active = str(active_raw).lower() in ["ναι", "yes", "true", "1"]
        
        comments = find_val(row_dict, COMMENT_KEYS) or ""

        # SANITIZE SKU: Replace slashes with dashes
        raw_sku = str(sku).strip()
        safe_sku = raw_sku.replace("/", "-").replace("\\", "-")
        
        # FILTER EMPTY KEYS: Trailing empty columns in Excel produce empty string keys which crash Firestore.
        clean_row_dict = {str(k).strip(): v for k, v in row_dict.items() if k and str(k).strip()}

        product_data = {
            "sku": safe_sku,
            "source": "manual_xlsx",
            "pylon_data": {
                "name": str(name).strip() if name else "",
                "price_retail": price_retail,
                "price_bulk": price_bulk,
                "stock_quantity": stock,
                "active": active,
                "comments": str(comments).strip(),
                "raw_xlsx_row": clean_row_dict
            },
            "updated_at": datetime.utcnow().isoformat()
        }
        product_data["status"] = "IMPORTED" 
        
        products.append(product_data)
        
    return group_variants_with_llm(products)

def ingest_products_to_firestore(products: List[Dict[str, Any]], db: firestore.client) -> Dict[str, int]:
    """
    Upserts parsed products into the staging_products collection.
    Preserves status if the product has already been processed.
    """
    count = 0
    total_processed = 0
    results = {"created": 0, "updated": 0, "errors": 0, "ingested_skus": []}

    # For status preservation, we need to know what's already there.
    # We'll process in chunks to avoid hitting Firestore limits and to keep it efficient.
    chunk_size = 30 # Limit for Firestore 'IN' queries
    for i in range(0, len(products), chunk_size):
        chunk = products[i:i + chunk_size]
        skus = [p["sku"] for p in chunk]
        
        # Track SKUs for the pipeline governor
        results["ingested_skus"].extend(skus)
        
        # 1. Fetch existing docs to check statuses
        existing_docs = {doc.id: doc.to_dict() for doc in db.collection(STAGING_COLLECTION).where("sku", "in", skus).get()}
        
        batch = db.batch()
        for p in chunk:
            sku = p["sku"]
            doc_ref = db.collection(STAGING_COLLECTION).document(sku)
            
            existing = existing_docs.get(sku)
            if existing:
                # PRESERVATION LOGIC:
                # If the product is already ENRICHED, APPROVED, or in a specific wizard step, 
                # we don't want to reset it to "IMPORTED".
                current_status = existing.get("status")
                if current_status and current_status != "IMPORTED":
                    # Keep existing status
                    p["status"] = current_status
                results["updated"] += 1
            else:
                results["created"] += 1

            batch.set(doc_ref, p, merge=True)
            count += 1
            total_processed += 1

        batch.commit()
        logger.info(f"Committed batch of {len(chunk)} products.")

    results["total"] = total_processed
    return results
