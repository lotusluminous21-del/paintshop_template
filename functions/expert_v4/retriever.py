"""
Expert V4 Retriever — Stage 3
==============================
Pure deterministic code — NO LLM calls. Loops through the Query Planner's
structured search specs and executes Shopify GraphQL queries.

The customer never sees this data; it feeds the Expert Synthesizer.
"""

import json
from typing import Dict, Any, List
from core.logger import get_logger

logger = get_logger("expert_v4.retriever")


def _run_search(search_spec: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Execute a single search spec against the Shopify Admin API.
    Reuses the existing build_search_query + GraphQL infrastructure from tools.py.
    """
    from expert_v4.tools import build_search_query
    from shopify.client import ShopifyClient

    query_text = search_spec.get("query", "")
    product_type = search_spec.get("product_type")
    variant_title = search_spec.get("variant_title")

    if not query_text:
        return []

    # Build the GraphQL query using existing infrastructure
    graphql_query = build_search_query({
        "category": product_type,
        "variant_title": variant_title
    })

    if not graphql_query and query_text:
        graphql_query = f"title:'{query_text}'"

    try:
        client = ShopifyClient()
        raw_results = client.search_products_by_query(graphql_query, limit=10)

        results = []
        for p in raw_results:
            if not p.get("handle"):
                continue

            # Extract the first available variant
            variants = p.get("variants", [])
            first_variant = variants[0] if variants else {}

            product_info = {
                "title": p.get("title", ""),
                "handle": p.get("handle", ""),
                "productType": p.get("productType", ""),
                "vendor": p.get("vendor", ""),
                "description": (p.get("description", "") or "")[:200],
                "variant_id": first_variant.get("id", ""),
                "variant_title": first_variant.get("title", ""),
                "price": first_variant.get("price", ""),
                "available": True,
                "sequence_step": search_spec.get("sequence_step", ""),
            }
            results.append(product_info)

        return results

    except Exception as e:
        logger.error(f"Search failed for spec: {search_spec.get('query')}", exc_info=True)
        return []


def _run_custom_paint_search(search_spec: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Search for custom paint products using the existing tools.py logic.
    """
    from shopify.client import ShopifyClient

    # Custom paints have known handles
    custom_handles = ["custom-spray-paint", "custom-bucket-paint", "custom-touchup-kit"]
    results = []
    client = ShopifyClient()

    for handle in custom_handles:
        try:
            raw_products = client.search_products_by_query(f"handle:{handle}", limit=1)
            
            if not raw_products:
                continue

            product = raw_products[0]

            variants = product.get("variants", [])
            first_variant = variants[0] if variants else {}

            results.append({
                "title": product.get("title", ""),
                "handle": product.get("handle", ""),
                "productType": product.get("productType", ""),
                "vendor": product.get("vendor", ""),
                "variant_id": first_variant.get("id", ""),
                "variant_title": first_variant.get("title", ""),
                "price": first_variant.get("price", ""),
                "available": True,
                "sequence_step": search_spec.get("sequence_step", "Βασικό Χρώμα"),
                "is_custom_paint": True,
            })

        except Exception as e:
            logger.warning(f"Custom paint search failed for {handle}: {e}")
            continue

    return results


def retrieve_products(search_plan: Dict[str, Any]) -> Dict[str, Any]:
    """
    Execute all search specs from the Query Planner and return a labeled product pool.

    Args:
        search_plan: Output from query_planner.generate_search_plan()

    Returns:
        Dict with:
          - sub_projects: {label: [products]}
          - shared_products: [products]
          - total_products: int
    """
    sub_projects = search_plan.get("sub_projects", [])
    shared_items = search_plan.get("shared_items", [])

    result = {
        "sub_projects": {},
        "shared_products": [],
        "total_products": 0,
    }

    seen_handles = set()

    # Execute searches for each sub-project
    for sp in sub_projects:
        label = sp.get("label", "Unnamed")
        searches = sp.get("searches", [])
        sp_products = []

        for search_spec in searches:
            is_custom = search_spec.get("custom_paint", False)

            if is_custom:
                products = _run_custom_paint_search(search_spec)
            else:
                products = _run_search(search_spec)

            # Deduplicate within this retrieval run
            for p in products:
                handle = p.get("handle")
                dedup_key = f"{handle}_{p.get('sequence_step', '')}"
                if dedup_key not in seen_handles:
                    seen_handles.add(dedup_key)
                    sp_products.append(p)

        result["sub_projects"][label] = sp_products
        result["total_products"] += len(sp_products)

        logger.info(
            f"Retriever: Sub-project '{label}'",
            searches=len(searches),
            products_found=len(sp_products),
        )

    # Execute shared items
    for search_spec in shared_items:
        products = _run_search(search_spec)
        for p in products:
            handle = p.get("handle")
            dedup_key = f"shared_{handle}"
            if dedup_key not in seen_handles:
                seen_handles.add(dedup_key)
                p["reason"] = search_spec.get("reason", "Κοινό αναλώσιμο")
                result["shared_products"].append(p)

    result["total_products"] += len(result["shared_products"])

    logger.info(
        "Retriever complete",
        sub_projects=len(result["sub_projects"]),
        shared_products=len(result["shared_products"]),
        total_products=result["total_products"],
    )

    return result
