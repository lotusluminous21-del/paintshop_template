"""
Expert V4 Interviewer — Pure Chat Agent (Stage 1)
==================================================
Zero product-search tools. Relies entirely on the LLM's native domain
knowledge about painting to ask expert-level probing questions.

Only tools provided:
  - find_closest_standard_color  (hex → RAL, no product data)
  - extract_colors_from_photo    (image → hex palette, no product data)

The Interviewer's job is to produce a comprehensive natural-language
"Project Brief" that will be consumed downstream by the Query Planner.
"""

import asyncio
from typing import List, Dict, Any, Optional
from core.logger import get_logger
from core.llm_config import LLMConfig

from google.adk.agents import Agent
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.adk.events import Event
from google.adk.models import Gemini
from google.genai import types as genai_types

logger = get_logger("expert_v4.interviewer")

APP_NAME = "pavlicevits_expert_v4"

# ── Color-only tools (no product leakage) ──────────────────────────────────

def find_closest_standard_color(hex_code: str) -> dict:
    """
    Find the closest RAL Classic color to an arbitrary hex code.

    Uses CIELAB color space and Delta-E CIE2000 for perceptually accurate matching.
    Call this when a customer provides a hex or RGB color code and wants to know
    the nearest standard industrial paint color.

    Args:
        hex_code: Hex color string, e.g. "#3A5F0B" or "3A5F0B"

    Returns:
        Dict with: ral_code, ral_name, hex, delta_e, confidence (high/medium/low), input_hex
    """
    from expert_v4.color_utils import find_closest_ral
    logger.info("find_closest_standard_color called", hex_code=hex_code)
    result = find_closest_ral(hex_code)
    logger.info("find_closest_standard_color result", result=result)
    return result


def extract_colors_from_photo(image_base64: str) -> dict:
    """
    Extract the dominant colors from a customer photo and find the closest RAL match for each.

    Uses Pillow's median-cut quantization for accurate pixel-level color extraction
    (NOT LLM estimation). Returns 5 dominant colors with hex codes, percentages,
    and closest RAL matches with confidence levels.

    IMPORTANT: Never estimate hex codes yourself — always use this tool for photo analysis.

    Args:
        image_base64: Base64-encoded image string (JPEG or PNG). May include data URI prefix.

    Returns:
        Dict with: dominant_colors, ral_matches, disclaimer
    """
    from expert_v4.color_extract import analyze_photo_from_base64
    logger.info("extract_colors_from_photo called")
    try:
        result = analyze_photo_from_base64(image_base64)
        logger.info("extract_colors_from_photo result", n_colors=len(result.get("dominant_colors", [])))
        return result
    except Exception as e:
        logger.error("extract_colors_from_photo failed", error=str(e))
        return {
            "error": str(e),
            "instruction": "Η ανάλυση φωτογραφίας απέτυχε. Ζήτα από τον πελάτη να δοκιμάσει με άλλη φωτογραφία ή να δώσει κωδικό χρώματος."
        }


# ── System Prompt ──────────────────────────────────────────────────────────

SYSTEM_PROMPT = """Είσαι ένας κορυφαίος ειδικός εφαρμογής χρωμάτων με 40+ χρόνια πρακτικής εμπειρίας σε ΟΛΑ τα πεδία: αυτοκίνητα, σκάφη, βιομηχανία, κτίρια, ξυλουργική, καλλιτεχνική βαφή, και ειδικές επικαλύψεις.

ΡΟΛΟΣ: Συνεντεύκτης / Ερευνητής Έργου
ΔΕΝ ΕΧΕΙΣ πρόσβαση σε προϊόντα ή απόθεμα. Η ΜΟΝΗ σου δουλειά είναι να ΡΩΤΑΣ — τα σωστά ερωτήματα που μόνο ένας αληθινός ειδικός θα σκεφτόταν.

### ΚΑΝΟΝΕΣ
1. Χρησιμοποίησε τη βαθιά τεχνική εμπειρία σου για να εντοπίσεις λεπτομέρειες που ένας ερασιτέχνης θα παρέλειπε.
2. Κάνε 1–2 ερωτήσεις ανά απάντηση. Κράτα τη συζήτηση φυσική, φιλική, σαν σε κατάστημα.
3. ΜΗΝ αναφέρεις ΠΟΤΕ ονόματα συγκεκριμένων προϊόντων ή μάρκες. ΔΕΝ ξέρεις τι υπάρχει στο ράφι.
4. ΜΗΝ εγγυάσαι ποτέ συμβατότητα ή αποτελέσματα — αυτό είναι δουλειά του Ειδικού Συστήματος Αξιολόγησης.
5. Πάντα στη γλώσσα του πελάτη (κατά κύριο λόγο Ελληνικά).

### ΤΙ ΠΡΕΠΕΙ ΝΑ ΜΑΘΕΙΣ (5 Διαστάσεις Ποιότητας)
Πριν θεωρήσεις ολοκληρωμένη τη συνέντευξη, βεβαιώσου ότι σε κάθε υπο-έργο καλύπτεις:
- **ΤΙ** βάφουμε (αντικείμενο + υλικό επιφάνειας)
- **ΓΙΑΤΙ** (κατάσταση/ζημιά που οδήγησε στην ανάγκη)
- **ΠΩΣ** (μέθοδος εφαρμογής + επίπεδο εμπειρίας)
- **ΠΟΥ** (περιβάλλον + συνθήκες έκθεσης)
- **ΤΙ ΑΠΟΤΕΛΕΣΜΑ** (φινίρισμα + χρώμα + προσδοκίες ανθεκτικότητας)

### ΕΡΓΑΛΕΙΑ ΕΙΚΟΝΑΣ
- **extract_colors_from_photo:** Αν ο πελάτης στείλει φωτογραφία, χρησιμοποίησε αυτό για να βρεις τα κυρίαρχα χρώματα. Πάντα ρώτα ποιο ακριβώς χρώμα θέλει από αυτά που αναγνωρίστηκαν.
- **find_closest_standard_color:** Αν δώσει hex/RGB κωδικό, μετέτρεψέ τον σε RAL.

### ΟΛΟΚΛΗΡΩΣΗ ΣΥΝΕΝΤΕΥΞΗΣ
Όταν νιώθεις ότι κατανοείς ΠΛΗΡΩΣ το έργο (σε κάθε υπο-έργο), ενημέρωσε τον πελάτη:
"Εξαιρετικά! Έχω πλήρη εικόνα του έργου σας. Μπορείτε τώρα να πατήσετε «Δημιουργία Πλάνου» για να σας ετοιμάσω τη λύση!"

Θυμήσου: Είσαι ΜΟΝΟ ερευνητής. Ρώτα, μάθε, κατανόησε. Μην προτείνεις, μη συγκρίνεις, μη δεσμεύεσαι για τίποτα σχετικά με προϊόντα!
"""


# ── Helper ─────────────────────────────────────────────────────────────────

def _extract_text_from_event(event: Event) -> str:
    """Safely extract all text from an ADK response event's content parts."""
    try:
        if event.content and event.content.parts:
            return "".join(
                part.text for part in event.content.parts
                if hasattr(part, "text") and part.text
            )
    except Exception:
        pass
    return ""


# ── Agent Class ────────────────────────────────────────────────────────────

class InterviewerAgent:
    """
    V4 Interviewer — pure conversational expert with NO product tools.
    Only color analysis tools are provided (they don't expose product data).
    """

    def __init__(self):
        model_name = LLMConfig.get_model_name(complex=False)
        logger.info("InterviewerAgent (V4) initializing", model=model_name)

        vertex_client = LLMConfig.get_client()
        adk_model = Gemini(model=model_name)
        adk_model.api_client = vertex_client

        self._agent = Agent(
            name="pavlicevits_interviewer",
            model=adk_model,
            description="Expert paint application interviewer for the Pavlicevits shop.",
            instruction=SYSTEM_PROMPT,
            tools=[find_closest_standard_color, extract_colors_from_photo],
            generate_content_config=genai_types.GenerateContentConfig(
                tool_config=genai_types.ToolConfig(
                    function_calling_config=genai_types.FunctionCallingConfig(
                        mode="AUTO"
                    )
                )
            ),
        )
        self._session_service = InMemorySessionService()
        self._runner = Runner(
            agent=self._agent,
            session_service=self._session_service,
            app_name=APP_NAME,
        )
        logger.info("InterviewerAgent (V4) ready", model=model_name)

    def process_chat(
        self,
        user_message: str,
        history: Optional[List[Dict[str, str]]] = None,
        doc_ref: Any = None,
        session_id: Optional[str] = None,
        user_id: Optional[str] = None,
        image_url: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Process one user turn (sync entry point).
        """
        if history is None:
            history = []

        effective_session_id = session_id or "default_session"
        effective_user_id = user_id or "default_user"

        logger.info(
            "InterviewerAgent Session Started",
            session_id=effective_session_id,
            user_id=effective_user_id,
            history_turns=len(history),
            user_message=user_message[:120],
            has_image=bool(image_url),
        )

        try:
            return asyncio.run(self._run_adk_turn(
                user_message=user_message,
                history=history,
                doc_ref=doc_ref,
                effective_session_id=effective_session_id,
                effective_user_id=effective_user_id,
                image_url=image_url,
            ))

        except Exception as e:
            logger.error(
                "InterviewerAgent Critical Failure",
                exc_info=True,
                session_id=effective_session_id,
            )
            return {
                "status": "error",
                "answer": "Παρουσιάστηκε σφάλμα συστήματος κατά την επεξεργασία του αιτήματός σας."
            }

    async def _run_adk_turn(
        self,
        user_message: str,
        history: List[Dict[str, str]],
        doc_ref: Any,
        effective_session_id: str,
        effective_user_id: str,
        image_url: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Async inner method — runs the ADK agent loop."""
        import uuid

        turn_session_id = f"{effective_session_id}_{uuid.uuid4().hex[:8]}"

        session = await self._session_service.create_session(
            app_name=APP_NAME,
            user_id=effective_user_id,
            session_id=turn_session_id,
        )

        # Seed prior conversation turns
        if history:
            for msg in history:
                role = msg.get("role", "user")
                content_text = msg.get("content", "")
                if not content_text and not msg.get("image_url"):
                    continue
                adk_role = "user" if role == "user" else "model"

                parts = []
                if msg.get("image_url") and adk_role == "user":
                    try:
                        import requests
                        resp = requests.get(msg["image_url"], timeout=5)
                        if resp.status_code == 200:
                            parts.append(genai_types.Part.from_bytes(
                                data=resp.content,
                                mime_type="image/jpeg"
                            ))
                    except Exception:
                        pass
                if content_text:
                    parts.append(genai_types.Part.from_text(text=content_text))

                if not parts:
                    continue

                content = genai_types.Content(role=adk_role, parts=parts)
                evt = Event(
                    invocation_id=f"history_{uuid.uuid4().hex[:8]}",
                    author=adk_role,
                    content=content,
                )
                await self._session_service.append_event(session, evt)

        logger.info(
            "InterviewerAgent Session Seeded",
            session_id=effective_session_id,
            turns_loaded=len(history),
        )

        # Build user message — no product context injection, just language enforcement
        new_text = user_message
        new_text += (
            "\n\n[SYSTEM: ΠΡΕΠΕΙ ΝΑ ΑΠΑΝΤΗΣΕΙΣ ΣΤΑ ΕΛΛΗΝΙΚΑ. "
            "ΜΗΝ αναφέρεις ονόματα προϊόντων ή μάρκες. Είσαι ΜΟΝΟ ερευνητής.]"
        )

        new_parts = []
        if image_url:
            try:
                import requests
                resp = requests.get(image_url, timeout=10)
                if resp.status_code == 200:
                    new_parts.append(genai_types.Part.from_bytes(
                        data=resp.content,
                        mime_type="image/jpeg"
                    ))
                    logger.info("InterviewerAgent: Attached image to user message")
            except Exception as img_err:
                logger.warning(f"InterviewerAgent: Failed to fetch image: {img_err}")
        new_parts.append(genai_types.Part.from_text(text=new_text))

        new_content = genai_types.Content(role="user", parts=new_parts)

        if doc_ref:
            try:
                doc_ref.update({"agentStatus": "Ανάλυση ερωτήματος..."})
            except Exception:
                pass

        # ── ADK RUNNER LOOP ───────────────────────────────────────────────
        result = {"status": "chat", "answer": ""}
        tool_calls_made: List[str] = []
        turn_count = 0

        async for event in self._runner.run_async(
            user_id=effective_user_id,
            session_id=turn_session_id,
            new_message=new_content,
        ):
            turn_count += 1

            fn_calls = event.get_function_calls() or []
            for fn_call in fn_calls:
                tool_calls_made.append(fn_call.name)
                logger.info(
                    f"InterviewerAgent Tool Call: {fn_call.name}",
                    session_id=effective_session_id,
                )

                if doc_ref and fn_call.name == "extract_colors_from_photo":
                    try:
                        doc_ref.update({"agentStatus": "Ανάλυση χρωμάτων φωτογραφίας..."})
                    except Exception:
                        pass

            if event.is_final_response():
                text = _extract_text_from_event(event)
                if text:
                    result = {"status": "chat", "answer": text}
                    logger.info(
                        "InterviewerAgent Final Response",
                        session_id=effective_session_id,
                        adk_turns=turn_count,
                        tool_calls=tool_calls_made,
                        answer_preview=text[:120],
                    )
                else:
                    logger.warning(
                        "InterviewerAgent: Empty response (fallback triggered)",
                        session_id=effective_session_id,
                    )

        if not result.get("answer"):
            result["answer"] = (
                "Συγγνώμη, δεν μπόρεσα να επεξεργαστώ το αίτημά σας αυτή τη στιγμή. "
                "Παρακαλώ δοκιμάστε ξανά."
            )

        return result
