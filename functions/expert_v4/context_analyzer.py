"""
Expert V4 Context Analyzer — Overwatch Agent
=============================================
Refactored for the V4 4-stage pipeline architecture.

Key changes from V3:
- No longer tracks accumulatedProducts (products don't accumulate during chat)
- Tracks interview completeness via briefReadiness (0.0–1.0)
- Phases: interviewing → ready_for_plan → planning → retrieving → synthesizing → complete
- showSolutionButton appears when interview is sufficiently complete
"""

import json
from typing import Dict, Any, List
from core.logger import get_logger
from core.llm_config import LLMConfig
from google.genai import types as genai_types

logger = get_logger("expert_v4.context_analyzer")

ANALYSIS_SYSTEM_PROMPT = """Είσαι ένα σύστημα ανάλυσης context για ένα κατάστημα χρωμάτων (Pavlicevits).
Λαμβάνεις το ιστορικό συνομιλίας μεταξύ πελάτη και ειδικού (ΣΥΝΕΝΤΕΥΚΤΗ).

ΣΗΜΑΝΤΙΚΟ: Στο V4 σύστημα, ο συνεντευκτής ΔΕΝ ΕΧΕΙ πρόσβαση σε προϊόντα.
Αξιολογείς ΜΟΝΟ την πληρότητα της συνέντευξης, ΟΧΙ τα προϊόντα.

ΠΡΕΠΕΙ να επιστρέψεις ΕΝΑ ΕΓΚΥΡΟ JSON object:

{
  "overallPhase": "<interviewing | ready_for_plan | planning | retrieving | synthesizing | complete>",
  "overallPhaseLabel": "<ελληνική ετικέτα>",
  "domain": "<automotive | structural | marine | industrial | wood | general>",
  "showSolutionButton": true | false,
  "briefReadiness": <0.0 - 1.0>,
  "interviewProgress": {
    "what": {"status": "<identified|pending|unknown>", "value": "<τι βάφουμε>"},
    "why": {"status": "<identified|pending|unknown>", "value": "<γιατί/κατάσταση>"},
    "how": {"status": "<identified|pending|unknown>", "value": "<μέθοδος>"},
    "where": {"status": "<identified|pending|unknown>", "value": "<περιβάλλον: π.χ. εξωτερικός/εσωτερικός χώρος (outdoors/indoors)>"},
    "result": {"status": "<identified|pending|unknown>", "value": "<φινίρισμα/χρώμα>"}
  },
  "knowledgeDimensions": [
    {
      "id": "<unique_id>",
      "label": "<ελληνική ετικέτα>",
      "status": "<identified | pending | unknown>",
      "value": "<εξαχθείσα τιμή ή null>"
    }
  ],
  "logs": [
    { "type": "AI", "message": "<σύντομο τεχνικό log στα Ελληνικά>" }
  ]
}

ΚΑΝΟΝΕΣ:

1. overallPhase:
   - "interviewing": Η συνέντευξη είναι σε εξέλιξη
   - "ready_for_plan": Η συνέντευξη ολοκληρώθηκε, αναμονή χρήστη
   - "planning/retrieving/synthesizing": Το pipeline εκτελείται (σπάνιο — γίνεται server-side)
   - "complete": Η λύση έχει παραδοθεί

2. showSolutionButton: TRUE μόνο όταν:
   - briefReadiness >= 0.75
   - Τουλάχιστον 3/5 interviewProgress dimensions είναι "identified"
   - Ο ειδικός δεν έχει κρίσιμες ανοιχτές ερωτήσεις
   ΠΡΟΣΟΧΗ: Αν ο ειδικός αναφέρει ρητά στη συζήτηση "μπορείτε να πατήσετε Δημιουργία Πλάνου" (ή παρόμοια), τότε το showSolutionButton ΠΡΕΠΕΙ ΝΑ ΕΙΝΑΙ ΟΠΩΣΔΗΠΟΤΕ TRUE.
   Σε αμφίβολη περίπτωση (και αν δεν υπάρχει προτροπή από τον ειδικό), προτίμησε FALSE.

3. briefReadiness (0.0 - 1.0):
   - 0.0: Μόλις ξεκίνησε η συζήτηση
   - 0.3: Βασικό αντικείμενο αναγνωρίστηκε
   - 0.5: Αντικείμενο + μέθοδος + χρώμα
   - 0.75: Επαρκή δεδομένα για search plan
   - 1.0: Πλήρη δεδομένα, χωρίς αμφιβολίες

4. interviewProgress: Αξιολόγησε τις 5 διαστάσεις ποιότητας:
   - what: Τι βάφουμε (αντικείμενο + υλικό)
   - why: Γιατί (κατάσταση/ζημιά)
   - how: Πώς (μέθοδος εφαρμογής)
   - where: Πού (περιβάλλον). Αν το αντικείμενο ('what') είναι π.χ. αυτοκίνητο, τότε συχνά εξυπακούεται ως "Εξωτερικός χώρος" (outdoors) και μπορείς να το ορίσεις ως "identified".
   - result: Τι αποτέλεσμα (φινίρισμα/χρώμα)

5. knowledgeDimensions: ΔΥΝΑΜΙΚΗ, domain-specific λίστα (όπως V3).
   Επιπλέον: αν αναφέρθηκε custom χρώμα, πρόσθεσε custom_color_spec dimension.

6. logs: 2-4 σύντομα τεχνικά μηνύματα.

7. ΟΛΑ τα κείμενα στα Ελληνικά.
"""


def analyze_context(
    messages: List[Dict[str, Any]],
    has_solution: bool = False,
    pipeline_stage: str = "",
) -> Dict[str, Any]:
    """
    Analyse the chat context and return structured sidebar data.
    V4: No accumulated products — focuses on interview completeness.
    """
    model_name = LLMConfig.get_model_name(complex=False)
    vertex_client = LLMConfig.get_client()

    # Build chat transcript
    transcript_lines = []
    for msg in messages:
        role = "Πελάτης" if msg.get("role") == "user" else "Ειδικός"
        content = msg.get("content", "")
        transcript_lines.append(f"{role}: {content}")

    transcript = "\n".join(transcript_lines)

    user_prompt = f"""ΙΣΤΟΡΙΚΟ ΣΥΝΟΜΙΛΙΑΣ:
{transcript}

HAS_SOLUTION: {has_solution}
PIPELINE_STAGE: {pipeline_stage or 'none'}

Παρακαλώ αναλύσε το context και επέστρεψε το JSON."""

    try:
        response = vertex_client.models.generate_content(
            model=model_name,
            contents=[
                genai_types.Content(
                    role="user",
                    parts=[genai_types.Part.from_text(text=user_prompt)]
                )
            ],
            config=genai_types.GenerateContentConfig(
                system_instruction=ANALYSIS_SYSTEM_PROMPT,
                response_mime_type="application/json",
            ),
        )

        output_text = response.text
        if not output_text:
            raise ValueError("Empty response from LLM")

        parsed = json.loads(output_text)

        logger.info(
            "V4 Context analysis complete",
            phase=parsed.get("overallPhase"),
            readiness=parsed.get("briefReadiness"),
            show_button=parsed.get("showSolutionButton"),
        )

        return parsed

    except Exception as e:
        logger.error("V4 Context analysis failed", exc_info=True)
        return {
            "overallPhase": "interviewing",
            "overallPhaseLabel": "Συνέντευξη",
            "domain": "general",
            "showSolutionButton": False,
            "briefReadiness": 0.0,
            "interviewProgress": {
                "what": {"status": "unknown", "value": None},
                "why": {"status": "unknown", "value": None},
                "how": {"status": "unknown", "value": None},
                "where": {"status": "unknown", "value": None},
                "result": {"status": "unknown", "value": None},
            },
            "knowledgeDimensions": [],
            "logs": [
                {"type": "AI", "message": "ΣΦΑΛΜΑ_ΑΝΑΛΥΣΗΣ: fallback ενεργοποιήθηκε"}
            ],
        }
