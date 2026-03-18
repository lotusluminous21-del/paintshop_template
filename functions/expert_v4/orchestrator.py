"""
Expert V4 Orchestrator — Pipeline Coordinator
==============================================
Sequences Stages 2→3→4 as a single pipeline:
  Query Planner → Retriever → Expert Synthesizer

Called when the user manually triggers "Generate Solution".
Updates Firestore status through each stage for real-time UI feedback.
"""

import json
from typing import Dict, Any
from core.logger import get_logger

logger = get_logger("expert_v4.orchestrator")


def run_pipeline(
    messages: list,
    doc_ref: Any = None,
) -> Dict[str, Any]:
    """
    Execute the full V4 pipeline:
    Stage 2: Query Planner (chat → search specs)
    Stage 3: Retriever    (search specs → product pool)
    Stage 4: Synthesizer  (product pool → solution)

    Args:
        messages: Full message history from Firestore.
        doc_ref: Firestore document reference for status updates.

    Returns:
        Dict with status ('success'|'error') and solution data.
    """
    # Build chat transcript
    chat_transcript = "\n".join([
        f"{'Πελάτης' if m.get('role') == 'user' else 'Ειδικός'}: {m.get('content', '')}"
        for m in messages if m.get('content')
    ])

    if not chat_transcript.strip():
        return {"status": "error", "answer": "Δεν βρέθηκε ιστορικό συνομιλίας."}

    # ── Stage 2: Query Planner ─────────────────────────────────────────
    _update_status(doc_ref, "planning", "Δημιουργία πλάνου αναζήτησης...")

    from expert_v4.query_planner import generate_search_plan
    search_plan = generate_search_plan(chat_transcript)

    if search_plan.get("error"):
        logger.error("Pipeline failed at Query Planner stage", error=search_plan.get("error"))
        return {"status": "error", "answer": "Αποτυχία δημιουργίας πλάνου αναζήτησης."}

    sub_projects_count = len(search_plan.get("sub_projects", []))
    total_searches = sum(
        len(sp.get("searches", []))
        for sp in search_plan.get("sub_projects", [])
    ) + len(search_plan.get("shared_items", []))

    logger.info(
        "Pipeline Stage 2 complete",
        sub_projects=sub_projects_count,
        total_searches=total_searches,
    )

    # ── Stage 3: Retriever ─────────────────────────────────────────────
    _update_status(
        doc_ref, "retrieving",
        f"Αναζήτηση {total_searches} κατηγοριών προϊόντων..."
    )

    from expert_v4.retriever import retrieve_products
    product_pool = retrieve_products(search_plan)

    total_products = product_pool.get("total_products", 0)
    if total_products == 0:
        logger.warning("Pipeline: Retriever returned 0 products")
        return {
            "status": "error",
            "answer": "Δεν βρέθηκαν προϊόντα στη βάση δεδομένων. Παρακαλώ δοκιμάστε ξανά."
        }

    logger.info("Pipeline Stage 3 complete", total_products=total_products)

    # ── Stage 4: Expert Synthesizer ────────────────────────────────────
    _update_status(
        doc_ref, "synthesizing",
        f"Ο Ειδικός αξιολογεί {total_products} προϊόντα..."
    )

    from expert_v4.solution_builder import generate_expert_solution
    result = generate_expert_solution(chat_transcript, product_pool)

    if result.get("status") == "success":
        logger.info("Pipeline Stage 4 complete — solution generated")
    else:
        logger.error("Pipeline failed at Synthesizer stage")

    return result


def _update_status(doc_ref: Any, pipeline_stage: str, agent_status: str):
    """Update Firestore document with current pipeline stage."""
    if not doc_ref:
        return
    try:
        doc_ref.update({
            "status": "processing",
            "pipelineStage": pipeline_stage,
            "agentStatus": agent_status,
        })
    except Exception as e:
        logger.warning(f"Failed to update pipeline status: {e}")
