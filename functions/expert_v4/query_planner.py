"""
Expert V4 Query Planner — Stage 2
=================================
Invisible LLM agent that reads the full chat transcript and generates
structured search specifications. The customer never interacts with
this component.

Input:  Natural language chat transcript
Output: JSON with dynamic sub_projects, each containing search specs
"""

import json
from typing import Dict, Any, List
from core.logger import get_logger
from core.llm_config import LLMConfig
from google.genai import types as genai_types

logger = get_logger("expert_v4.query_planner")

PLANNER_SYSTEM_PROMPT = """Είσαι ένα εσωτερικό σύστημα decomposition & query generation για ένα κατάστημα χρωμάτων.

Λαμβάνεις ένα transcript συνομιλίας μεταξύ πελάτη και ειδικού, και πρέπει να:
1. Εξάγεις ΟΛΑ τα υπο-έργα (sub-projects) που αναφέρθηκαν
2. Για ΚΑΘΕ υπο-έργο, δημιουργείς μια λίστα αναζητήσεων (searches) που καλύπτουν ΟΛΑ τα βήματα εφαρμογής

### ΚΑΝΟΝΕΣ ΑΝΑΖΗΤΗΣΕΩΝ (ΣΗΜΑΝΤΙΚΟ)
- Λεπτομέρεια: Κάθε search spec πρέπει να περιλαμβάνει ΟΛΑ τα γνωστά φίλτρα (surface, finish, method κτλ.)
- Εύρος: Κάνε ΕΥΡΕΙΕΣ αναζητήσεις. Καλύτερα 30 αποτελέσματα παρά 2. Ο Expert Synthesizer θα φιλτράρει.
- Πληρότητα: ΜΗΝ ξεχνάς βοηθητικά προϊόντα (adhesion promoter, hardener, thinner, masking tape κτλ.)
- Color: Αν ο πελάτης ζήτησε εξατομικευμένο χρώμα (RAL, NCS, Pantone, OEM), σημείωσε custom_paint=true

### ΣΕΙΡΑ ΒΗΜΑΤΩΝ (sequence_steps)
Τυπική σειρά εφαρμογής (αναλόγως έργο):
1. Καθαρισμός & Προετοιμασία (Cleaner/Degreaser)
2. Ενισχυτικό Πρόσφυσης (Adhesion Promoter) — Αν πλαστικό
3. Αστάρι (Primer) — Ακόμα και αν δεν ρωτήθηκε
4. Στόκος (Filler/Putty) — Αν υπάρχει ζημιά/γρατζουνιά
5. Βασικό Χρώμα (Base Coat / Color)
6. Βερνίκι (Clear Coat) — Αν dual-stage ή metallic/pearl
7. Σκληρυντής (Hardener) — Αν 2K system
8. Γυάλισμα/Αστράφτισμα (Polish/Compound) — Αν χρειάζεται
9. Βοηθητικά (Masking, Sandpaper, Cloth κτλ.)

### ΕΞΟΔΟΣ: ΑΥΣΤΗΡΑ ΕΝΑΣ JSON
Πρέπει να επιστρέψεις ΜΟΝΟ ένα JSON object σε αυτή τη μορφή:

{
  "sub_projects": [
    {
      "label": "Σύντομη Ετικέτα Υπο-Έργου",
      "surface_material": "π.χ. Πλαστικό, Μέταλλο, Ξύλο",
      "surface_condition": "π.χ. Γυμνό, Βαμμένο, Σκουριασμένο",
      "application_method": "π.χ. Σπρέι, Πιστόλι, Πινέλο",
      "environment": "π.χ. Εξωτερικού, Εσωτερικού",
      "desired_finish": "π.χ. Γυαλιστερό, Ματ, Σατινέ",
      "searches": [
        {
          "sequence_step": "Αστάρι",
          "query": "αστάρι πλαστικού σπρέι",
          "product_type": "Αστάρι",
          "variant_title": null,
          "custom_paint": false
        },
        {
          "sequence_step": "Βασικό Χρώμα",
          "query": "σπρέι μαύρο γυαλιστερό",
          "product_type": "Χρώμα",
          "variant_title": "Μαύρο",
          "custom_paint": false
        }
      ]
    }
  ],
  "shared_items": [
    {
      "sequence_step": "Βοηθητικά",
      "query": "ταινία μασκαρίσματος αυτοκινήτου",
      "product_type": "Αναλώσιμα",
      "reason": "Κοινό για όλα τα υπο-έργα"
    }
  ]
}

ΣΗΜΑΝΤΙΚΟ:
- sub_projects: ΔΥΝΑΜΙΚΟ, 1 ή 10, ανάλογα το έργο
- shared_items: Προϊόντα κοινά σε ΠΟΛΛΑ υπο-έργα (π.χ. sandpaper, masking tape, degreaser)
- Αν δεν υπάρχουν shared items, βάλε κενή λίστα []
- ΜΟΝΟ JSON, κανένα άλλο κείμενο!
"""


def generate_search_plan(chat_transcript: str) -> Dict[str, Any]:
    """
    Generate structured search specifications from a chat transcript.

    Args:
        chat_transcript: Full chat history as natural language text.

    Returns:
        Dict with sub_projects and shared_items, each containing search specs.
    """
    model_name = LLMConfig.get_model_name(complex=False)
    vertex_client = LLMConfig.get_client()

    user_prompt = f"""ΙΣΤΟΡΙΚΟ ΣΥΝΟΜΙΛΙΑΣ:
{chat_transcript}

Αναλύσε την παραπάνω συνομιλία και δημιούργησε το search plan JSON."""

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
                system_instruction=PLANNER_SYSTEM_PROMPT,
                response_mime_type="application/json",
            ),
        )

        output_text = response.text
        if not output_text:
            raise ValueError("Empty response from Query Planner LLM")

        parsed = json.loads(output_text)

        sub_projects = parsed.get("sub_projects", [])
        shared_items = parsed.get("shared_items", [])
        total_searches = sum(len(sp.get("searches", [])) for sp in sub_projects) + len(shared_items)

        logger.info(
            "Query plan generated",
            sub_projects=len(sub_projects),
            shared_items=len(shared_items),
            total_searches=total_searches,
        )

        return parsed

    except Exception as e:
        logger.error("Query Planner failed", exc_info=True)
        return {
            "sub_projects": [],
            "shared_items": [],
            "error": str(e),
        }
