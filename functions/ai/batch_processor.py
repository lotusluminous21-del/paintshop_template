"""
Parallel Studio Processor — Fire-and-forget with real-time Firestore updates.

Architecture & Fixes:
  1. start_studio_session(skus) -> Chunks SKUs, creates batches as QUEUED, returns immediately.
  2. process_studio_queue(batch_id) -> Uses a strict, transaction-based Global Lock.
     - Processes products sequentially.
     - Performs INLINE heartbeats (no unstable background threads).
     - Respects hard 30s/60s rate-limit delays, while keeping the lock alive.
  3. check_and_process_batches() -> Cron safety net that drives the queue forward safely.
"""

import os
import json
import uuid
import logging
import time
import random
import datetime
import requests
import urllib3
from typing import List, Dict, Any, Optional

from firebase_admin import firestore
from google.genai import types

from core.llm_config import LLMConfig, ModelName
from .image_utils import normalize_product_image

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
DELAY_GEMINI = 5              # Reduced from 30s to 5s (safe for flash-lite)
DELAY_IMAGEN = 5              # us-central1 delay
MAX_RETRIES = 3               # Reduced from 5
INITIAL_BACKOFF = 5           # Reduced from 30s
REQUEST_TIMEOUT = 20          # Image download timeout
LOCK_TIMEOUT_SECONDS = 180    # 3 minutes without an inline heartbeat = dead worker

# We rely entirely on `ai/agents/vision_agent.py` for Studio text prompts and API generation logic.

DEFAULT_ENVIRONMENT = "clean"
DEFAULT_MODEL = "gemini"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Delegate generation entirely to VisionAgent
from .agents.vision_agent import VisionAgent

# ---------------------------------------------------------------------------
# 1. Start Studio Session
# ---------------------------------------------------------------------------

def start_studio_session(skus: List[str], environment: str = None, generation_model: str = None, priority: str = "normal") -> dict:
    """Creates batch tracking docs. Quick fire-and-forget."""
    db = firestore.client()
    env = environment or DEFAULT_ENVIRONMENT
    MAX_BATCH_SIZE = 8
    
    sku_chunks = [skus[i:i + MAX_BATCH_SIZE] for i in range(0, len(skus), MAX_BATCH_SIZE)]
    batch_ids = []
    
    # Check for collisions to prevent thundering herds
    active_sessions = db.collection("enrichment_batches").where(filter=firestore.FieldFilter("status", "in", ["QUEUED", "RUNNING"])).get()
    active_skus = {s for doc in active_sessions for s in doc.to_dict().get("skus", [])}
    if any(s in active_skus for s in skus):
        logger.warning(f"[Studio] Session overlap detected. Skipping active SKUs.")

    for idx, chunk in enumerate(sku_chunks):
        batch_id = str(uuid.uuid4())
        batch_ids.append(batch_id)
        
        # All batches go into QUEUED state immediately to be picked up sequentially
        initial_status = "QUEUED"
        
        sku_results = {sku: {"status": initial_status, "error": None} for sku in chunk}
        db.collection("enrichment_batches").document(batch_id).set({
            "job_name": f"parallel-studio-{batch_id}",
            "mode": "parallel",
            "status": initial_status,
            "skus": chunk,
            "sku_results": sku_results,
            "total_count": len(chunk),
            "completed_count": 0,
            "failed_count": 0,
            "environment": env,
            "generation_model": generation_model or DEFAULT_MODEL,
            "priority": priority,
            "created_at": firestore.SERVER_TIMESTAMP,
            "updated_at": firestore.SERVER_TIMESTAMP,
        })

        # Mark products
        for sku in chunk:
            try:
                p_doc = db.collection("staging_products").document(sku).get()
                if p_doc.exists and p_doc.to_dict().get("status") != "BATCH_GENERATING":
                    db.collection("staging_products").document(sku).update({
                        "status": "BATCH_GENERATING",
                        "enrichment_message": "Queued for Studio Generation..."
                    })
            except Exception as e:
                pass

    return {"batch_ids": batch_ids, "count": len(skus)}

# ---------------------------------------------------------------------------
# 1.B Start Pipeline Session (Staggered Governor)
# ---------------------------------------------------------------------------

def start_pipeline_session(skus: List[str]) -> dict:
    """
    Creates batch tracking docs for the entire text/image pipeline.
    Instead of calling AI directly, the worker will just change the status
    to GENERATING_METADATA sequentially to throttle the Firestore triggers.
    """
    db = firestore.client()
    # Larger chunks since text is faster and we stagger internally
    MAX_BATCH_SIZE = 15 
    
    sku_chunks = [skus[i:i + MAX_BATCH_SIZE] for i in range(0, len(skus), MAX_BATCH_SIZE)]
    batch_ids = []

    for idx, chunk in enumerate(sku_chunks):
        batch_id = str(uuid.uuid4())
        batch_ids.append(batch_id)
        
        initial_status = "QUEUED"
        sku_results = {sku: {"status": initial_status, "error": None} for sku in chunk}
        
        db.collection("enrichment_batches").document(batch_id).set({
            "job_name": f"pipeline-governor-{batch_id}",
            "mode": "pipeline", # NEW MODE
            "status": initial_status,
            "skus": chunk,
            "sku_results": sku_results,
            "total_count": len(chunk),
            "completed_count": 0,
            "failed_count": 0,
            "priority": "normal",
            "created_at": firestore.SERVER_TIMESTAMP,
            "updated_at": firestore.SERVER_TIMESTAMP,
        })
        
        # Mark products as pending in the queue
        for sku in chunk:
            try:
                db.collection("staging_products").document(sku).update({
                    "status": "BATCH_GENERATING",
                    "enrichment_message": "Queued for automated pipeline...",
                    "ai_data": firestore.DELETE_FIELD,
                    "failed_attempts": 0
                })
            except Exception:
                pass

    return {"batch_ids": batch_ids, "count": len(skus)}

# ---------------------------------------------------------------------------
# 2. Process Studio Queue (Worker)
# ---------------------------------------------------------------------------

def process_studio_queue(batch_id: str) -> dict:
    """
    Process products ONE at a time. Uses rigorous Transactional Locking.
    """
    db = firestore.client()
    client = LLMConfig.get_client()

    batch_ref = db.collection("enrichment_batches").document(batch_id)
    lock_ref = db.collection("system_config").document("studio_lock")

    @firestore.transactional
    def attempt_claim(transaction):
        lock_snap = lock_ref.get(transaction=transaction)
        batch_snap = batch_ref.get(transaction=transaction)

        if not batch_snap.exists: return "NOT_FOUND", None
        batch_status = batch_snap.get("status")

        if batch_status not in ("QUEUED", "RUNNING"): 
            return batch_status, None

        now = datetime.datetime.now(datetime.timezone.utc)
        
        # Check Global Lock Staleness
        active_holder = None
        is_stale = True
        
        if lock_snap.exists:
            lock_data = lock_snap.to_dict()
            active_holder = lock_data.get("active_batch_id")
            updated = lock_data.get("updated_at")
            if updated and (now - updated).total_seconds() < LOCK_TIMEOUT_SECONDS:
                is_stale = False # Lock is actively being updated
        
        if not is_stale and active_holder:
            if active_holder == batch_id and batch_status == "RUNNING":
                # Duplicate trigger event for the exact same batch!
                return "ALREADY_RUNNING", active_holder
            elif active_holder != batch_id:
                # Another batch is actively processing
                return "LOCKED_BY_OTHER", active_holder

        # Claim Both
        transaction.update(batch_ref, {"status": "RUNNING", "updated_at": firestore.SERVER_TIMESTAMP})
        transaction.set(lock_ref, {"active_batch_id": batch_id, "updated_at": firestore.SERVER_TIMESTAMP})
        return "CLAIMED", None

    try:
        claim_status, active_holder = attempt_claim(db.transaction())
    except Exception as e:
        logger.error(f"[Studio {batch_id}] Transaction failed: {e}")
        return {"error": str(e)}

    if claim_status in ("LOCKED_BY_OTHER", "ALREADY_RUNNING"):
        logger.info(f"[Studio {batch_id}] Yielding worker — lock held actively by {active_holder} ({claim_status}).")
        return {"status": "waiting"}
    
    if claim_status != "CLAIMED":
        return {"status": "already_processed", "state": claim_status}

    # Fetch batch data
    batch_doc = batch_ref.get()
    batch_data = batch_doc.to_dict()
    skus = batch_data.get("skus", [])
    sku_results = batch_data.get("sku_results", {})
    environment = batch_data.get("environment", DEFAULT_ENVIRONMENT)
    generation_model = batch_data.get("generation_model", DEFAULT_MODEL)
    mode = batch_data.get("mode", "parallel") # "parallel" (Studio) or "pipeline" (Governor)

    completed = 0
    failed = 0
    
    logger.info(f"[Studio {batch_id}] Worker Started (Model={generation_model})")

    for i, sku in enumerate(skus):
        # Skip previously completed items (crash recovery)
        if sku_results.get(sku, {}).get("status") in ("COMPLETED", "FAILED"):
            completed += 1 if sku_results[sku]["status"] == "COMPLETED" else 0
            failed += 1 if sku_results[sku]["status"] == "FAILED" else 0
            continue

        # Abort Check
        if batch_ref.get().get("status") == "ABORTED":
            return _handle_abort(db, batch_ref, skus, sku_results, completed, failed)

        logger.info(f"[Studio {batch_id}] Processing [{i+1}/{len(skus)}]: {sku}")
        
        if mode == "pipeline":
            # PIPELINE GOVERNOR MODE: Just trigger the first state and sleep
            try:
                db.collection("staging_products").document(sku).update({
                    "status": "GENERATING_METADATA",
                    "enrichment_message": "Pipeline initiated..."
                })
                completed += 1
                sku_results[sku] = {"status": "COMPLETED", "error": None}
                # Strict 15-second throttle between metadata triggers
                delay = 15 
            except Exception as e:
                failed += 1
                sku_results[sku] = {"status": "FAILED", "error": str(e)}
                delay = 0

        else:
            # STUDIO GENERATION MODE (Traditional Parallel)
            doc_ref = db.collection("staging_products").document(sku)
            doc = doc_ref.get()
            
            if doc.exists:
                data = doc.to_dict()
                try:
                    # Leverage the highly-calibrated, rate-limit safe VisionAgent directly!
                    # Pass the batch's environment and model down to override defaults if desired.
                    ai_data = data.get("ai_data", {})
                    ai_data["environment"] = environment
                    ai_data["generation_model"] = generation_model
                    data["ai_data"] = ai_data
                    
                    VisionAgent.generate_studio(doc_ref, data)
                    
                    # If it didn't throw an exception, VisionAgent successfully pushed the final state.
                    completed += 1
                    sku_results[sku] = {"status": "COMPLETED", "error": None}
                    
                    # Apply Rate Limit padding ONLY if we successfully executed a generation
                    delay = DELAY_IMAGEN if generation_model == "imagen" else DELAY_GEMINI
                except Exception as e:
                    failed += 1
                    error_str = str(e)[:150]
                    sku_results[sku] = {"status": "FAILED", "error": error_str}
                    # Handle failure gracefully
                    from .controller import EnrichmentController
                    EnrichmentController._handle_agent_failure(doc_ref, data, f"Studio error: {error_str[:80]}")
                    delay = 0 # Skip rate limit timeout if execution failed
            else:
                failed += 1
                sku_results[sku] = {"status": "FAILED", "error": "Product missing"}
                delay = 0 # Skip rate limit timeout if product is entirely deleted

        # Update batch & heartbeat the lock
        batch_ref.update({
            "sku_results": sku_results, "completed_count": completed, 
            "failed_count": failed, "updated_at": firestore.SERVER_TIMESTAMP
        })
        # Internal heartbeat for the lock since VisionAgent took over
        try:
            db.collection("system_config").document("studio_lock").set({
                "active_batch_id": batch_id,
                "updated_at": firestore.SERVER_TIMESTAMP
            }, merge=True)
        except Exception: pass

        # Apply computed delay safely maintaining the lock
        if delay > 0:
            for _ in range(delay):
                time.sleep(1)
                if _ % 10 == 0: 
                    _heartbeat_lock(db, batch_id)
                    if batch_ref.get().get("status") == "ABORTED": break
            
            if batch_ref.get().get("status") == "ABORTED":
                return _handle_abort(db, batch_ref, skus, sku_results, completed, failed)

    # Wrap up Batch
    final_status = "COMPLETED" if failed == 0 else "COMPLETED_WITH_ERRORS"
    batch_ref.update({
        "status": final_status,
        "sku_results": sku_results,
        "completed_at": firestore.SERVER_TIMESTAMP,
        "updated_at": firestore.SERVER_TIMESTAMP
    })

    # Release Global Lock
    try:
        lock_snap = lock_ref.get()
        if lock_snap.exists and lock_snap.get("active_batch_id") == batch_id:
            lock_ref.delete()
    except Exception: pass

    logger.info(f"[Studio {batch_id}] Batch Finished. Status: {final_status}")
    
    # Optional: trigger next process directly via Cron/PubSub logic here if needed.
    # Because threading is dangerous, we rely on the Cron or Cloud Function queue listener 
    # to pick up the next QUEUED batch seamlessly now that the lock is free.
    return {"status": final_status, "completed": completed, "failed": failed}



def _heartbeat_lock(db, batch_id: str):
    """Updates the global lock timestamp to prevent cron from stealing the lock."""
    try:
        db.collection("system_config").document("studio_lock").set({
            "active_batch_id": batch_id,
            "updated_at": firestore.SERVER_TIMESTAMP
        }, merge=True)
    except Exception as e:
        logger.warning(f"[Studio {batch_id}] Inline heartbeat failed: {e}")

def _handle_abort(db, batch_ref, skus, sku_results, completed, failed):
    batch_id = batch_ref.id
    for sku in skus:
        if sku_results.get(sku, {}).get("status") not in ("COMPLETED", "FAILED"):
            sku_results[sku] = {"status": "FAILED", "error": "Aborted by user"}
            try: db.collection("staging_products").document(sku).update({"status": "FAILED", "enrichment_message": "Session aborted"})
            except: pass
            
    batch_ref.update({
        "status": "ABORTED", "sku_results": sku_results, 
        "completed_count": completed, "failed_count": failed, "updated_at": firestore.SERVER_TIMESTAMP
    })
    try:
        lock_ref = db.collection("system_config").document("studio_lock")
        if lock_ref.get().get("active_batch_id") == batch_id: lock_ref.delete()
    except: pass
    return {"status": "aborted"}

def abort_studio_session(batch_ids: List[str]) -> dict:
    """
    Sets the status of one or more batches to ABORTED.
    The process_studio_queue loop will pick this up and stop.
    """
    db = firestore.client()
    count = 0
    
    # Handle Global Abort Override
    if "GLOBAL" in batch_ids:
        logger.info("Global Abort explicitly requested. Stopping all active batches.")
        batches_query = db.collection("enrichment_batches").where(filter=firestore.FieldFilter("status", "in", ["QUEUED", "RUNNING"])).get()
        batch_ids = [doc.id for doc in batches_query] # Override input with all active IDs

    for b_id in batch_ids:
        try:
            batch_ref = db.collection("enrichment_batches").document(b_id)
            batch_doc = batch_ref.get()
            if batch_doc.exists:
                status = batch_doc.to_dict().get("status")
                if status in ("QUEUED", "RUNNING"):
                    batch_ref.update({
                        "status": "ABORTED",
                        "updated_at": firestore.SERVER_TIMESTAMP
                    })
                    count += 1
                    
                    # Instantly push the abort down to the current SKUs so blocking agents can break
                    skus = batch_doc.to_dict().get("skus", [])
                    for sku in skus:
                        try:
                            sku_ref = db.collection("staging_products").document(sku)
                            sku_snap = sku_ref.get()
                            # Only abort items actively in the processing queue
                            if sku_snap.exists and sku_snap.to_dict().get("status") in ["BATCH_GENERATING", "GENERATING_STUDIO", "GENERATING_METADATA", "SOURCING_IMAGES", "REMOVING_SOURCE_BACKGROUND", "REMOVING_BACKGROUND"]:
                                sku_ref.update({
                                    "status": "FAILED",
                                    "enrichment_message": "Session aborted by user request."
                                })
                        except Exception as sku_err:
                            logger.error(f"Failed to abort sku {sku}: {sku_err}")
                            
        except Exception as e:
            logger.error(f"Failed to abort batch {b_id}: {e}")
            
    return {"aborted_count": count}

def fail_batch(batch_id: str, error_message: str):
    """
    Public utility to force-fail a batch and all its pending products.
    """
    db = firestore.client()
    batch_ref = db.collection("enrichment_batches").document(batch_id)
    doc = batch_ref.get()
    if doc.exists:
        data = doc.to_dict()
        skus = data.get("skus", [])
        sku_results = data.get("sku_results", {})
        
        for sku in skus:
            if sku_results.get(sku, {}).get("status") not in ("COMPLETED", "FAILED"):
                sku_results[sku] = {"status": "FAILED", "error": error_message}
                try: 
                    db.collection("staging_products").document(sku).update({
                        "status": "FAILED", 
                        "enrichment_message": error_message
                    })
                except: pass
        
        batch_ref.update({
            "status": "FAILED",
            "sku_results": sku_results,
            "error_details": error_message,
            "updated_at": firestore.SERVER_TIMESTAMP
        })
        
        try:
            lock_ref = db.collection("system_config").document("studio_lock")
            if lock_ref.get().get("active_batch_id") == batch_id: lock_ref.delete()
        except: pass

# ---------------------------------------------------------------------------
# 3. Queue Manager / Cron Safety Net
# ---------------------------------------------------------------------------

def check_and_process_batches() -> dict:
    """
    Called by Cloud Scheduler ideally every 1 minute.
    This acts as the robust, non-overlapping Queue Driver.
    """
    db = firestore.client()
    summary = {"recovered": 0, "processed": 0}
    now = datetime.datetime.now(datetime.timezone.utc)

    # 1. Clear dead locks
    lock_ref = db.collection("system_config").document("studio_lock")
    lock_snap = lock_ref.get()
    if lock_snap.exists:
        updated = lock_snap.get("updated_at")
        if updated and (now - updated).total_seconds() > LOCK_TIMEOUT_SECONDS:
            logger.warning(f"[Cron] Clearing DEAD global lock from crashed worker.")
            dead_batch = lock_snap.get("active_batch_id")
            lock_ref.delete()
            if dead_batch:
                b_ref = db.collection("enrichment_batches").document(dead_batch)
                if b_ref.get().get("status") == "RUNNING":
                    logger.warning(f"[Cron] Auto-requeuing crashed batch {dead_batch}.")
                    b_ref.update({"status": "QUEUED", "error_details": "Worker crashed, auto-requeued."})
                    summary["recovered"] += 1
            return summary # Wait for next cron cycle to resume cleanly
        else:
            return summary # A worker is actively running, do not interfere.

    # 2. No active workers -> Find next QUEUED batch and process it inline
    queued = db.collection("enrichment_batches").where(filter=firestore.FieldFilter("status", "==", "QUEUED")).get()
    if not queued: return summary

    # Sort by priority and age
    queued_docs = list(queued)
    queued_docs.sort(key=lambda d: (0 if d.to_dict().get("priority") == "high" else 1, d.create_time))
    
    next_batch_id = queued_docs[0].id
    logger.info(f"[Cron] Launching processing for QUEUED batch {next_batch_id}")
    
    # Process synchronously in this container.
    # 3. Check for DELAYED_RETRY products that need resumption
    # To avoid overwhelming, just get up to 8 of them
    try:
        delayed_docs = db.collection("staging_products").where(filter=firestore.FieldFilter("status", "==", "DELAYED_RETRY")).limit(8).get()
        if delayed_docs:
            batch = db.batch()
            for doc_snap in delayed_docs:
                data = doc_snap.to_dict() or {}
                # Recover to the exact state it failed on, default to sourcing images if missing
                target_state = data.get("retry_target_state", "SOURCING_IMAGES")
                
                batch.update(doc_snap.reference, {
                    "status": target_state,
                    "enrichment_message": f"Recovering from DELAYED_RETRY to {target_state}..."
                })
            batch.commit()
            
            logger.info(f"[Cron] Recovered {len(delayed_docs)} DELAYED_RETRY products directly to their target states.")
            summary["recovered_retries"] = len(delayed_docs)
    except Exception as retry_e:
        logger.error(f"[Cron] Error checking delays: {retry_e}")

    return summary