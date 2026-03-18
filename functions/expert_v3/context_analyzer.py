"""
Context Analyzer — Parallel Sidebar Agent
==========================================
Runs after each assistant message to produce structured sidebar data.
Uses a lightweight (fast) LLM to analyse the conversation and output
a JSON object that populates the frontend sidebar in real-time.

All user-facing strings are emitted in Greek.
"""

import json
from typing import Dict, Any, List
from core.logger import get_logger
from core.llm_config import LLMConfig
from google.genai import types as genai_types

logger = get_logger("expert_v3.context_analyzer")

ANALYSIS_SYSTEM_PROMPT = """Είσαι ένα σύστημα ανάλυσης context για ένα κατάστημα χρωμάτων (Pavlicevits).
Λαμβάνεις το ιστορικό συνομιλίας μεταξύ πελάτη και ειδικού, μαζί με τα προϊόντα που έχουν βρεθεί.

ΠΡΕΠΕΙ να επιστρέψεις ΕΝΑ ΕΓΚΥΡΟ JSON object με την ΑΚΡΙΒΗ παρακάτω δομή.
ΑΠΑΓΟΡΕΥΕΤΑΙ κάθε κείμενο εκτός JSON.

{
  "overallPhase": "<μία από: initialization | gathering_info | product_matching | solution_ready | complete>",
  "overallPhaseLabel": "<ελληνική ετικέτα, π.χ. 'Συλλογή Πληροφοριών'>",
  "domain": "<inferred domain, π.χ. 'automotive', 'structural', 'marine', 'industrial', 'wood', 'general'>",
  "showSolutionButton": true | false,
  "knowledgeDimensions": [
    {
      "id": "<unique_id, π.χ. 'surface_material'>",
      "label": "<ελληνική ετικέτα, π.χ. 'Υλικό Επιφάνειας'>",
      "status": "<identified | pending | unknown>",
      "value": "<εξαχθείσα τιμή ή null>"
    }
  ],
  "recommendedProducts": [
    {
      "handle": "<shopify handle>",
      "variant_id": "<variant GID>",
      "title": "<τίτλος προϊόντος>",
      "sequence_step": "<βήμα στη διαδικασία>",
      "reason": "<σύντομη αιτιολόγηση στα Ελληνικά>"
    }
  ],
  "logs": [
    { "type": "AI", "message": "<σύντομο τεχνικό log στα Ελληνικά>" }
  ]
}

ΚΑΝΟΝΕΣ:
1. overallPhase: Γενική φάση (initialization → gathering_info → product_matching → solution_ready → complete).

2. showSolutionButton: Τίθεται σε TRUE μόνο όταν:
   - ΟΛΑ τα ΚΡΙΣΙΜΑ knowledgeDimensions έχουν status "identified" (τουλάχιστον: υλικό, μέθοδος, φινίρισμα)
   - Στη "δεξαμενή" (accumulatedProducts) υπάρχουν επιλογές προϊόντων που καλύπτουν ΟΛΑ τα απαιτούμενα sequence_steps για το συγκεκριμένο έργο (δηλαδή ο Gatherer έχει μαζέψει αρκετά "υλικά" για να χτιστεί η λύση).
     (π.χ. automotive με σπρέι: υπάρχουν στη δεξαμενή Αστάρια ΚΑΙ Χρώματα Βάσης. Αν χρειάζεται βερνίκι, υπάρχουν ΚΑΙ βερνίκια.)
   - Αν υπάρχει CUSTOM PAINT product στα accumulatedProducts (handle: custom-spray-paint, custom-bucket-paint, custom-touchup-kit), ΠΡΕΠΕΙ η σχετική πληροφορία χρώματος (custom_color_spec) να έχει status "identified".
   - Δεν υπάρχουν ανοιχτές ερωτήσεις κρίσιμες για την επιλογή προϊόντος.
   Σε αμφίβολη περίπτωση, προτίμησε FALSE.

3. knowledgeDimensions: ΔΥΝΑΜΙΚΗ ΛΙΣΤΑ — ΑΝΑΛΟΓΑ ΤΟ DOMAIN:
   Εξάγεις τις σχετικές διαστάσεις γνώσης ΓΙΑ ΤΟ ΣΥΓΚΕΚΡΙΜΕΝΟ ΕΡΓΟ.
   
   **ΠΡΟΣΟΧΗ — ΕΞΑΤΟΜΙΚΕΥΜΕΝΟ ΧΡΩΜΑ:** Αν στη συνομιλία αναφέρθηκε custom paint ή custom mixing,
   ή αν στα accumulatedProducts υπάρχει custom product, ΠΡΕΠΕΙ να προσθέσεις τη διάσταση:
   {
     "id": "custom_color_spec",
     "label": "Εξατομικευμένο Χρώμα",
     "status": "<identified αν δόθηκε κωδικός/περιγραφή, pending αν ζητήθηκε αλλά δεν δόθηκε ακόμα>",
     "value": "<π.χ. 'RAL 7016 (Ανθρακί)' ή 'Περιγραφή: σκούρο μπλε' ή null>"
   }
   
   Παραδείγματα ανά domain (ΣΗΜΑΝΤΙΚΟ: αυτά είναι ενδεικτικά, όχι εξαντλητικά):
   
   Automotive:
   - surface_material (Υλικό Επιφάνειας): μέταλλο, πλαστικό, fiberglass
   - surface_condition (Κατάσταση Επιφάνειας): γρατζουνιά, σκουριά, βαθούλωμα
   - color_preference (Προτίμηση Χρώματος): ματ μαύρο, RAL 9005, μεταλλικό γκρι
   - application_method (Μέθοδος Εφαρμογής): σπρέι, πινέλο, πιστόλι
   - finish_type (Τύπος Φινιρίσματος): γυαλιστερό, ματ, σατινέ
   - damage_depth (Βάθος Ζημιάς): επιφανειακό, μέτριο, βαθύ
   
   Structural/Building:
   - substrate (Υπόστρωμα): τοίχος, σοβάς, τσιμέντο, γυψοσανίδα
   - environment (Περιβάλλον): εσωτερικό, εξωτερικό
   - moisture_level (Υγρασία): ξηρό, υγρό
   - coverage_area (Έκταση): τ.μ.
   - paint_type (Τύπος Βαφής): πλαστικό, ακρυλικό, οικολογικό
   
   Marine:
   - hull_material (Υλικό Γάστρας): fiberglass, ξύλο, ατσάλι
   - area (Περιοχή): γάστρα, κατάστρωμα, εσωτερικό
   - water_type (Τύπος Νερού): θαλασσινό, γλυκό
   - antifouling_needed (Αντιρρυπαντικό): ναι/όχι

3. recommendedProducts: Συμπλήρωσε ΜΟΝΟ από τα accumulatedProducts. Μη φανταστείς νέα.
   **Deduplication:** Αν πολλές εγγραφές έχουν ίδιο `handle` (ίδιο προϊόν, διαφορετικές παραλλαγές), συμπερίλαβε ΜΟΝΟ ΜΙΑ παραλλαγή για αυτό το handle. Επέλεξε την παραλλαγή που ταιριάζει καλύτερα με τις ανάγκες του πελάτη (χρώμα, φινίρισμα, μέγεθος). Ποτέ μην επαναλαμβάνεις αρχείο handle δύο φορές.
4. logs: 2-5 σύντομα "τεχνικά" μηνύματα που αντικατοπρίζουν την πρόοδο.
5. ΟΛΑ τα user-facing κείμενα πρέπει να είναι στα Ελληνικά.
"""


def analyze_context(
    messages: List[Dict[str, Any]],
    accumulated_products: Dict[str, Any],
    has_solution: bool = False,
) -> Dict[str, Any]:
    """
    Analyse the chat context and return structured sidebar data.
    Uses a lightweight/fast model for speed.
    """
    model_name = LLMConfig.get_model_name(complex=False)
    vertex_client = LLMConfig.get_client()

    # Build chat transcript
    transcript_lines = []
    for msg in messages:
        role = "Πελάτης" if msg.get("role") == "user" else "Ειδικός"
        content = msg.get("content", "")
        ready = msg.get("ready_for_solution", False)
        transcript_lines.append(f"{role}: {content}")
        if ready:
            transcript_lines.append("[SYSTEM: ready_for_solution = true]")

    transcript = "\n".join(transcript_lines)

    # Build products context
    products_json = json.dumps(
        list(accumulated_products.values()) if accumulated_products else [],
        ensure_ascii=False
    )

    user_prompt = f"""ΙΣΤΟΡΙΚΟ ΣΥΝΟΜΙΛΙΑΣ:
{transcript}

ΣΥΛΛΕΧΘΕΝΤΑ ΠΡΟΙΟΝΤΑ (accumulatedProducts):
{products_json}

HAS_SOLUTION: {has_solution}

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
            "Context analysis complete",
            phase=parsed.get("analysisPhase"),
            products_count=len(parsed.get("recommendedProducts", [])),
        )

        return parsed

    except Exception as e:
        logger.error("Context analysis failed", exc_info=True)
        # Return a safe fallback so the frontend doesn't break
        return {
            "overallPhase": "initialization",
            "overallPhaseLabel": "Αρχικοποίηση",
            "domain": "general",
            "showSolutionButton": False,
            "knowledgeDimensions": [],
            "recommendedProducts": [],
            "logs": [
                {"type": "AI", "message": "ΣΦΑΛΜΑ_ΑΝΑΛΥΣΗΣ: fallback ενεργοποιήθηκε"}
            ],
        }
