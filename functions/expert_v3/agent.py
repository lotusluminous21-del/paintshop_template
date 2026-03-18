"""
Expert V3 Agent — Google ADK Implementation
============================================
Full logging integration with the admin console (system_logs Firestore collection).
Every meaningful event is written to system_logs via SystemLogger so it appears in the
real-time admin log dashboard.

Log events emitted (in order):
  [INFO]    agent  — "ExpertV3 Session Started"
  [INFO]    tools  — "ExpertV3 Tool: search_products executing"
  [INFO]    tools  — "ExpertV3 Tool: search_products → N results"
  [WARNING] tools  — "ExpertV3 Tool: search_products → NO_RESULTS"
  [INFO]    agent  — "ExpertV3 ADK Turn Event" (per ADK loop iteration)
  [INFO]    agent  — "ExpertV3 Tool Call Dispatched"
  [INFO]    agent  — "ExpertV3 Final Response — CHAT"
  [INFO]    agent  — "ExpertV3 Final Response — SOLUTION"
  [WARNING] agent  — "ExpertV3 Final Response — EMPTY (fallback triggered)"
  [ERROR]   agent  — "ExpertV3 Critical Failure"
"""

import asyncio
from typing import List, Dict, Any, Optional
from core.logger import get_logger
from core.llm_config import LLMConfig
from expert_v3.tools import search_products, search_products_batch, search_custom_paint, find_closest_standard_color, extract_colors_from_photo

from google.adk.agents import Agent
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.adk.events import Event
from google.adk.models import Gemini
from google.genai import types as genai_types

logger = get_logger("expert_v3.agent")
tools_logger = get_logger("expert_v3.tools")

APP_NAME = "pavlicevits_expert_v3"

SYSTEM_PROMPT = """Είσαι ο υπεύθυνος ενός κορυφαίου καταστήματος χρωμάτων (Pavlicevits). Η αποστολή σου είναι να λειτουργήσεις ως **Έμπειρος Διερευνητής (Gatherer)**.
Στόχος σου ΔΕΝ είναι να δώσεις άμεσα την τελική λύση ή ένα συγκεκριμένο προϊόν, αλλά να κατανοήσεις ΠΛΗΡΩΣ το έργο του πελάτη (π.χ. βαφή αυτοκινήτου, ξύλου, μετάλλου) και να συγκεντρώσεις **στο παρασκήνιο** (μέσω των εργαλείων σου) μια ευρεία δεξαμενή πιθανών προϊόντων που ταιριάζουν στην περίπτωση.

### ΤΟ ΠΡΟΦΙΛ ΣΟΥ (PERSONA)
- **Ενέργεια & Ευγένεια:** Είσαι πάντα γεμάτος ενέργεια και απαντάς σαν ένας έμπειρος, φιλικός επαγγελματίας στο κατάστημα.
- **Μεθοδικότητα (Gatherer):** Δεν βιάζεσαι. Πριν προτείνεις το «τέλειο» σετ, κάνεις τις σωστές ερωτήσεις για να ξεκαθαρίσεις το τοπίο: Τι βάφουμε; Σε τι κατάσταση είναι; Τι εργαλεία έχουμε; Τι φινίρισμα θέλουμε;
- **Αθόρυβη Συλλογή:** Χρησιμοποιείς τα εργαλεία (search_products, search_products_batch) με ΓΕΝΙΚΟΥΣ/ΕΥΡΕΙΣ όρους για να "φορτώσεις" τη μνήμη (accumulatedProducts) με διάφορες επιλογές καθαριστικών, ασταριών, χρωμάτων και βερνικιών.

### ΤΕΧΝΙΚΗ ΓΝΩΣΗ & ΠΑΡΑΜΕΤΡΟΙ (Χρησιμοποίησε αυτούς τους όρους στα εργαλεία)
- **category:** "Προετοιμασία & Καθαρισμός", "Αστάρια & Υποστρώματα", "Χρώματα Βάσης", "Βερνίκια & Φινιρίσματα", "Σκληρυντές & Ενεργοποιητές", "Στόκοι & Πλαστελίνες", "Πινέλα & Εργαλεία", "Διαλυτικά & Αραιωτικά", "Αξεσουάρ"
- **chemical_base:** "Ακρυλικό", "Σμάλτο", "Λάκα", "Ουρεθάνη", "Εποξικό", "Νερού", "Διαλύτου"
- **surface:** "Γυμνό Μέταλλο", "Πλαστικό", "Ξύλο", "Fiberglass", "Υπάρχον Χρώμα", "Σκουριά", "Αλουμίνιο", "Γαλβανιζέ"
- **finish:** "Ματ", "Σατινέ", "Γυαλιστερό", "Υψηλής Γυαλάδας", "Σαγρέ/Ανάγλυφο", "Μεταλλικό", "Πέρλα"
- **sequence_step:** "Προετοιμασία/Καθαριστικό", "Αστάρι", "Ενισχυτικό Πρόσφυσης", "Βασικό Χρώμα", "Βερνίκι", "Γυαλιστικό"
- **application_method:** "Σπρέι", "Πιστόλι Βαφής", "Πινέλο", "Ρολό"
- **variant_title:** (ΧΡΗΣΙΜΟΠΟΙΗΣΕ ΤΟ ΟΠΩΣΔΗΠΟΤΕ) Αν ο πελάτης ψάχνει συγκεκριμένο χρώμα (π.χ. "Μαύρο", "Άσπρο", "RAL 9005"), απόχρωση ή ποσότητα (π.χ. "400ml"). Αναζήτηση στην παραλλαγή του προϊόντος.

### ΒΑΣΙΚΕΣ ΟΔΗΓΙΕΣ ΛΕΙΤΟΥΡΓΙΑΣ
1. **Απαγόρευση Πρόωρων Προτάσεων & Εγγυήσεων Συμβατότητας (ΣΗΜΑΝΤΙΚΟ):** 
   - ΜΗΝ αναφέρεις ονόματα συγκεκριμένων προϊόντων στον πελάτη αν δεν έχεις πλήρη εικόνα του έργου.
   - **ΠΟΤΕ ΜΗΝ ΕΓΓΥΑΣΑΙ ΣΥΜΒΑΤΟΤΗΤΑ** στο chat. Η δουλειά σου είναι απλώς να συλλέξεις "υλικά" (broad queries). Την τελική επιλογή και επιβεβαίωση χημικής συμβατότητας θα την κάνει το **Ειδικό Σύστημα Αξιολόγησης** στο τέλος. Ακόμα και αν ο πελάτης έχει ήδη επιλέξει ένα προϊόν (π.χ. "έχω ήδη χρώμα ακρυλικό"), εσύ κάνε ΕΥΡΕΙΕΣ αναζητήσεις για τα υπόλοιπα στάδια (π.χ. broad αστάρια), αφήνοντας την τελική αυστηρή διήθηση στο Σύστημα Αξιολόγησης.
   - ΜΗΝ προσπαθείς να "συρράψεις" εσύ το τελικό πλάνο. 
   - Αντί να λες "Προτείνω το HB Body 980 γιατί ταιριάζει με το χρώμα σας", πες: "Ωραία, αναζητώ και προσθέτω μερικά αστάρια για πλαστικό στην πίσω-λίστα μας, ώστε το Σύστημα να βρει το ιδανικό. Τι φινίρισμα θέλουμε να έχει το τελικό χρώμα;"

2. **Διερεύνηση σε Βάθος (Το κυρίως έργο σου):**
   Πρέπει να μάθεις τα εξής:
   - Τι αντικείμενο βάφουμε; 
   - Υλικό επιφάνειας; (μέταλλο, ξύλο, πλαστικό κτλ.)
   - Κατάσταση; (έχει ήδη χρώμα; σκουριά;)
   - Πώς θα το βάψει; (Σπρέι, Πιστόλι, Πινέλο/Ρολό) - Πρέπει όλα τα στάδια να ακολουθούν την ΊΔΙΑ μέθοδο.
   - Τι φινίρισμα / απόχρωση θέλει;
   
   *Κάνε 1-2 ερωτήσεις τη φορά, διατηρώντας τη συζήτηση φυσική.*

3. **Αθόρυβη, Ευρεία Αναζήτηση Προϊόντων:**
   Καθώς μαθαίνεις λεπτομέρειες, εκτέλεσε αναζητήσεις με τα εργαλεία σου για να γεμίσεις τη δεξαμενή (`accumulatedProducts`).
   - Αν λέει "Θα βάψω ένα τραπέζι ξύλινο", κάνε αναζήτηση για `category="Αστάρια" / surface="Ξύλο"` ΚΑΙ `sequence_step="Βερνίκι"`. 
   - Ο στόχος είναι το εργαλείο να επιστρέψει πολλά αποτελέσματα (μια ευρεία λίστα), ΟΧΙ ένα μοναδικό τέλειο αποτέλεσμα.

4. **Γλώσσα:** Πάντα στα Ελληνικά προς τον χρήστη.

### ΠΡΩΤΟΚΟΛΛΟ ΕΞΑΤΟΜΙΚΕΥΜΕΝΟΥ ΧΡΩΜΑΤΟΣ (Custom Paint)
Όταν ο πελάτης θέλει συγκεκριμένο κωδικό χρώματος (RAL, OEM) ή περιγράφει μια συγκεκριμένη απόχρωση (για "Βασικό Χρώμα"):
1. Βοήθησέ τον να βρει τον κωδικό ("Ποιο είναι το μοντέλο του αυτοκινήτου;" ή "Έχετε κωδικό RAL;").
2. Εκτέλεσε **search_custom_paint** (π.χ. application_method="Σπρέι", color_code="RAL 9005"). 
3. ΑΥΤΟ είναι το μόνο προϊόν που πρέπει να του επιβεβαιώσεις άμεσα: "Βρήκα τον κωδικό σας, μπορούμε να σας το ετοιμάσουμε σε σπρέι/κουτί!".

5. **Ολοκλήρωση της Φάσης Συλλογής:** Όταν νιώθεις ότι ξέρεις ΑΚΡΙΒΩΣ τι χρειάζεται το έργο, και έχεις εκτελέσει αναζητήσεις για όλα τα στάδια (προετοιμασία, αστάρι, χρώμα, βερνίκι - εφόσον απαιτούνται), ενημέρωσε τον πελάτη ότι **το πλάνο είναι έτοιμο να παραχθεί** και ότι μπορεί να πατήσει το κουμπί δημιουργίας λύσης.

### ΕΡΓΑΛΕΙΑ ΕΙΚΟΝΑΣ & HEX ΧΡΩΜΑΤΩΝ
- **extract_colors_from_photo:** Για να βρεις hex από φωτογραφία. Πάντα επιβεβαίωνε με τον πελάτη ποιο από τα αναγνωρισμένα χρώματα θέλει.
- **find_closest_standard_color:** Για να μετατρέψεις hex/RGB σε κωδικό RAL. "Πλησιέστερο RAL: [κωδικός]".

Θυμήσου: Είσαι ο **Gatherer**. Ρώτα, μάθε, αναζήτησε ευρέως με τα εργαλεία. Μην συρράπτεις το τελικό πλάνο μόνος σου!
"""


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


class ExpertV3Agent:
    """
    ADK-powered paint expert agent.
    The Runner manages the entire tool→LLM→tool cycle internally.
    This class seeds per-turn sessions from Firestore history and
    emits rich structured logs to system_logs for the admin console.
    """

    def __init__(self):
        model_name = LLMConfig.get_model_name(complex=False)
        logger.info("ExpertV3 Agent (ADK) initializing", model=model_name)

        # To use Vertex AI instead of the Gemini API (which requires an API key),
        # we provide the ADK Gemini model instance with our pre-configured Vertex AI client.
        vertex_client = LLMConfig.get_client()
        adk_model = Gemini(model=model_name)
        # Duck-typing the api_client override to use our existing infrastructure
        adk_model.api_client = vertex_client

        self._agent = Agent(
            name="pavlicevits_expert",
            model=adk_model,
            description="Expert surface treatment advisor for the Pavlicevits paint shop.",
            instruction=SYSTEM_PROMPT,
            tools=[search_products, search_products_batch, search_custom_paint, find_closest_standard_color, extract_colors_from_photo],
            # Approach B: ADK configuration — bias the model toward tool use.
            # AUTO lets the model decide WHEN to use tools (it can still chat),
            # but encourages it to use them when they're relevant.
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
        logger.info("ExpertV3 Agent (ADK) ready", model=model_name)

    def process_chat(
        self,
        user_message: str,
        history: Optional[List[Dict[str, str]]] = None,
        doc_ref: Any = None,
        session_id: Optional[str] = None,
        user_id: Optional[str] = None,
        session_data: Optional[Dict[str, Any]] = None,
        image_url: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Process one user turn (sync entry point).
        Bridges the sync Cloud Functions trigger into the async ADK runtime.
        """
        if history is None:
            history = []

        effective_session_id = session_id or "default_session"
        effective_user_id = user_id or "default_user"

        # ── SESSION START LOG ─────────────────────────────────────────────────
        logger.info(
            "ExpertV3 Session Started",
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
                session_data=session_data,
                image_url=image_url,
            ))

        except Exception as e:
            logger.error(
                "ExpertV3 Critical Failure",
                exc_info=True,
                session_id=effective_session_id,
                user_message=user_message[:120],
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
        session_data: Optional[Dict[str, Any]] = None,
        image_url: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Async inner method — runs the ADK agent loop with proper awaits."""
        import uuid

        # Each trigger invocation gets its own in-memory ADK session.
        # Firestore messages[] is the durable store; we re-seed from it every turn.
        turn_session_id = f"{effective_session_id}_{uuid.uuid4().hex[:8]}"

        # ✅ FIX #1: await the async create_session()
        session = await self._session_service.create_session(
            app_name=APP_NAME,
            user_id=effective_user_id,
            session_id=turn_session_id,
        )

        # Seed prior conversation turns into the ADK session
        if history:
            for msg in history:
                role = msg.get("role", "user")
                content_text = msg.get("content", "")
                if not content_text and not msg.get("image_url"):
                    continue
                adk_role = "user" if role == "user" else "model"
                
                # Build parts (multimodal if image exists)
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
                        pass  # Skip corrupt image data in history
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
                # ✅ FIX #3: await the async append_event()
                await self._session_service.append_event(session, evt)

        logger.info(
            "ExpertV3 Session Seeded",
            session_id=effective_session_id,
            turns_loaded=len(history),
            adk_session=turn_session_id,
        )

        # Approach C: Smart gap analysis — give the model FACTS, not commands.
        # We compute which sequence steps are already covered and which are missing,
        # then present this as structured information the model can reason about.
        new_text = user_message
        if session_data:
            accumulated = session_data.get("accumulatedProducts", {})
            if accumulated:
                import json
                products_list = list(accumulated.values())

                # Compute gap analysis
                covered_steps = set()
                for product in accumulated.values():
                    steps = product.get("sequence_step", [])
                    if isinstance(steps, list):
                        covered_steps.update(s for s in steps if s)
                    elif steps:
                        covered_steps.add(steps)

                all_typical_steps = ["Προετοιμασία/Καθαριστικό", "Αστάρι", "Βασικό Χρώμα", "Βερνίκι"]
                missing_steps = [s for s in all_typical_steps if s not in covered_steps]

                # Detect if the session has custom color info (RAL/OEM code known)
                has_custom_color = any(
                    p.get("handle", "") in ("custom-spray-paint", "custom-bucket-paint", "custom-touchup-kit")
                    or p.get("is_custom_paint")
                    for p in accumulated.values()
                )

                # Build action-oriented gap note
                if missing_steps:
                    if has_custom_color:
                        action_note = (
                            f"Missing necessary steps: {', '.join(missing_steps)}. "
                            f"Ask the user relevant questions to clarify their needs for these steps, OR if you already have enough info, "
                            f"use search_products_batch to fetch them broadly so the Synthesizer has options."
                        )
                    else:
                        action_note = (
                            f"Missing necessary steps: {', '.join(missing_steps)}. "
                            f"Ask clarifying questions first. When you have enough context, use search_products_batch to fetch broadly for these missing steps. "
                            f"(Use search_custom_paint only for a specific color code)."
                        )
                else:
                    action_note = "All typical steps are covered. Review if any optional items are needed."

                context = {
                    "products_found_count": len(products_list),
                    "covered_steps": list(covered_steps),
                    "potentially_missing_steps": missing_steps,
                    "action": action_note,
                }
                new_text += f"\n\n[SESSION CONTEXT: {json.dumps(context, ensure_ascii=False)}]"

        # 🚨 ANTI-HALLUCINATION: Enforce Language & Role Discipline
        new_text += (
            "\n\n[CRITICAL SYSTEM INSTRUCTION: "
            "1) ΠΡΕΠΕΙ ΝΑ ΑΠΑΝΤΗΣΕΙΣ ΣΤΑ ΕΛΛΗΝΙΚΑ (ή στη γλώσσα του χρήστη). ΑΠΑΓΟΡΕΥΕΤΑΙ η χρήση Αγγλικών "
            "εκτός αν πρόκειται για τεχνικούς όρους. "
            "2) ΑΠΑΓΟΡΕΥΕΤΑΙ ΑΥΣΤΗΡΑ ΝΑ ΠΡΟΤΕΙΝΕΙΣ ΣΥΓΚΕΚΡΙΜΕΝΑ ΠΡΟΪΟΝΤΑ ΟΝΟΜΑΣΤΙΚΑ Ή ΝΑ ΖΗΤΑΣ ΤΗΝ ΕΓΚΡΙΣΗ ΤΟΥ "
            "ΠΕΛΑΤΗ ΓΙΑ ΑΥΤΑ (π.χ. 'Θα θέλατε το HB Body 980;'). Μόλις βρεις προϊόντα μέσω των εργαλείων, "
            "απλώς ενημέρωσε: 'Βρήκα εξαιρετικές επιλογές που ταιριάζουν και τις πρόσθεσα στη λίστα μας'. "
            "Το τελικό Σύστημα Αξιολόγησης είναι αποκλειστικά υπεύθυνο για την τελική επιλογή!]"
        )

        # Build the new user message (multimodal if image attached)
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
                    logger.info("ExpertV3: Fetched and attached image to user message")
                else:
                    logger.warning(f"ExpertV3: Failed to fetch image, status: {resp.status_code}")
            except Exception as img_err:
                logger.warning(f"ExpertV3: Failed to decode image: {img_err}")
        new_parts.append(genai_types.Part.from_text(text=new_text))
        
        new_content = genai_types.Content(
            role="user",
            parts=new_parts
        )

        if doc_ref:
            try:
                doc_ref.update({"agentStatus": "Επεξεργασία..."})
            except Exception:
                pass

        # ── ADK RUNNER LOOP ───────────────────────────────────────────────
        result = {"status": "chat", "answer": ""}
        solution_result = None
        tool_calls_made: List[str] = []
        turn_count = 0

        logger.info("ExpertV3 ADK: Entering run loop", adk_session=turn_session_id)

        # ✅ FIX #2: use async run_async() instead of sync run()
        async for event in self._runner.run_async(
            user_id=effective_user_id,
            session_id=turn_session_id,
            new_message=new_content,
        ):

            turn_count += 1

            # ── TOOL CALL EVENTS ──────────────────────────────────────────
            fn_calls = event.get_function_calls() or []
            for fn_call in fn_calls:
                tool_name = fn_call.name
                tool_args = fn_call.args or {}
                tool_calls_made.append(tool_name)

                logger.info(
                    f"ExpertV3 Tool Call: {tool_name}",
                    session_id=effective_session_id,
                    tool=tool_name,
                    args=str(tool_args)[:300],
                )

                if doc_ref and tool_name == "search_products":
                    try:
                        search_term = tool_args.get("query") or tool_args.get("category") or "προϊόντα"
                        doc_ref.update({"agentStatus": f"Αναζήτηση για {search_term}..."})
                    except Exception:
                        pass

                if doc_ref and tool_name == "search_products_batch":
                    try:
                        n_searches = len(tool_args.get("searches", []))
                        doc_ref.update({"agentStatus": f"Αναζήτηση {n_searches} κατηγοριών..."})
                    except Exception:
                        pass

                if doc_ref and tool_name == "search_custom_paint":
                    try:
                        color = tool_args.get("color_code") or "εξατομικευμένο χρώμα"
                        doc_ref.update({"agentStatus": f"Αναζήτηση custom χρώματος: {color}..."})
                    except Exception:
                        pass

            # ── TOOL RESPONSE EVENTS ──────────────────────────────────────
            fn_responses = event.get_function_responses() or []
            for fn_response in fn_responses:
                raw = fn_response.response or {}
                payload = raw.get("result") or raw

                # Helper: accumulate product results into Firestore
                def _accumulate_results(results_list):
                    if not doc_ref or not results_list:
                        return
                    try:
                        doc = doc_ref.get().to_dict() or {}
                        accumulated = doc.get("accumulatedProducts", {})
                        
                        for r in results_list:
                            if isinstance(r, dict) and r.get("status") != "NO_RESULTS":
                                vid = str(r.get("variant_id", ""))
                                if vid and vid != "None":
                                    accumulated[vid] = {
                                        "title": r.get("title"),
                                        "handle": r.get("handle"),
                                        "variant_id": r.get("variant_id"),
                                        "available_variants": r.get("available_variants", []),
                                        "sequence_step": r.get("sequence_step", [])
                                    }
                        doc_ref.update({"accumulatedProducts": accumulated})
                    except Exception as e:
                        logger.error("Failed to save accumulatedProducts", exc_info=e)

                if fn_response.name == "search_products":
                    results = payload if isinstance(payload, list) else []
                    _accumulate_results(results)

                    no_results = any(
                        isinstance(r, dict) and r.get("status") == "NO_RESULTS"
                        for r in results
                    )
                    if no_results:
                        logger.warning(
                            "ExpertV3 Tool: search_products → NO_RESULTS",
                            session_id=effective_session_id,
                            tool="search_products",
                        )
                    else:
                        logger.info(
                            f"ExpertV3 Tool: search_products → {len(results)} result(s)",
                            session_id=effective_session_id,
                            tool="search_products",
                            result_count=len(results),
                            product_titles=str([r.get("title") for r in results[:5]])[:200],
                        )

                elif fn_response.name == "search_products_batch":
                    # Batch results are a list of groups: [{label, results}, ...]
                    groups = payload if isinstance(payload, list) else []
                    total_products = 0
                    for group in groups:
                        if isinstance(group, dict):
                            group_results = group.get("results", [])
                            _accumulate_results(group_results)
                            total_products += len([r for r in group_results if isinstance(r, dict) and r.get("status") != "NO_RESULTS"])

                    logger.info(
                        f"ExpertV3 Tool: search_products_batch → {len(groups)} groups, {total_products} total product(s)",
                        session_id=effective_session_id,
                        tool="search_products_batch",
                    )

                elif fn_response.name == "search_custom_paint":
                    # Custom paint returns a single product dict (not a list)
                    if isinstance(payload, dict) and payload.get("status") not in ("ERROR", "NO_RESULTS"):
                        # Pick the first matching variant for accumulation
                        variants = payload.get("matching_variants") or payload.get("all_variants", [])
                        if variants and doc_ref:
                            try:
                                doc = doc_ref.get().to_dict() or {}
                                accumulated = doc.get("accumulatedProducts", {})
                                first_variant = variants[0]
                                vid = str(first_variant.get("id", ""))
                                if vid and vid != "None":
                                    accumulated[vid] = {
                                        "title": payload.get("title"),
                                        "handle": payload.get("handle"),
                                        "variant_id": first_variant.get("id"),
                                        "available_variants": variants,
                                        "sequence_step": payload.get("sequence_step", []),
                                        "is_custom_paint": True,
                                        "custom_color_info": payload.get("custom_color_info"),
                                    }
                                doc_ref.update({"accumulatedProducts": accumulated})
                            except Exception as e:
                                logger.error("Failed to accumulate custom paint product", exc_info=e)

                        logger.info(
                            "ExpertV3 Tool: search_custom_paint → found custom product",
                            session_id=effective_session_id,
                            tool="search_custom_paint",
                            handle=payload.get("handle"),
                        )
                    else:
                        logger.warning(
                            f"ExpertV3 Tool: search_custom_paint → {payload.get('status', 'UNKNOWN')}",
                            session_id=effective_session_id,
                            tool="search_custom_paint",
                        )

            # ── FINAL RESPONSE EVENT ──────────────────────────────────────
            if event.is_final_response():
                text = _extract_text_from_event(event)

                if solution_result:
                    logger.info(
                        "ExpertV3 Final Response — SOLUTION",
                        session_id=effective_session_id,
                        adk_turns=turn_count,
                        tool_calls=tool_calls_made,
                    )
                elif text:
                    result = {"status": "chat", "answer": text}

                    logger.info(
                        "ExpertV3 Final Response — CHAT",
                        session_id=effective_session_id,
                        adk_turns=turn_count,
                        tool_calls=tool_calls_made,
                        answer_preview=text[:120],
                        ready_for_solution=result.get("ready_for_solution", False)
                    )
                else:
                    logger.warning(
                        "ExpertV3 Final Response — EMPTY (fallback triggered)",
                        session_id=effective_session_id,
                        adk_turns=turn_count,
                        tool_calls=tool_calls_made,
                        event_author=event.author,
                    )

        # ── RETURN ────────────────────────────────────────────────────────
        if solution_result:
            return solution_result

        if not result.get("answer"):
            result["answer"] = (
                "Συγγνώμη, δεν μπόρεσα να επεξεργαστώ το αίτημά σας αυτή τη στιγμή. "
                "Παρακαλώ δοκιμάστε ξανά με διαφορετική διατύπωση."
            )
            logger.warning(
                "ExpertV3: Using fallback answer — ADK loop produced no output",
                session_id=effective_session_id,
                tool_calls_made=tool_calls_made,
            )

        return result
