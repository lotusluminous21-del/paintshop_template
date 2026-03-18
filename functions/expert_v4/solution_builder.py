"""
Expert V4 Solution Builder — Stage 4 (Expert Synthesizer)
=========================================================
Enhanced from V3 to handle multi-sub-project product pools.
Uses the most capable model for deep reasoning about chemical
compatibility, method consistency, and logical sequencing.
"""

import json
from typing import Dict, Any
from core.logger import get_logger
from core.llm_config import LLMConfig
from google.genai import types as genai_types

logger = get_logger("expert_v4.solution_builder")


def generate_expert_solution(
    chat_transcript: str,
    product_pool: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Generate a final structured project plan from the interview transcript
    and the labeled product pool retrieved by the Retriever.

    Args:
        chat_transcript: Full interview history as natural language text.
        product_pool: Output from retriever.retrieve_products() with labeled sub_projects.

    Returns:
        Dict with status and solution.
    """
    model_name = LLMConfig.get_model_name(complex=True)
    vertex_client = LLMConfig.get_client()

    pool_json = json.dumps(product_pool, ensure_ascii=False)

    system_prompt = f"""Είσαι ο Κορυφαίος Ειδικός του καταστήματος χρωμάτων Pavlicevits, με 44 χρόνια εμπειρίας.
Η αποστολή σου είναι να λειτουργήσεις ως **Master Synthesizer (Ειδικός Συνθέτης Λύσεων)**.

Μπροστά σου έχεις:
1. Το ιστορικό συνέντευξης, που αποκαλύπτει ΤΙ ακριβώς χρειάζεται ο πελάτης.
2. Μια δομημένη «πισίνα» προϊόντων, χωρισμένη σε:
   - **sub_projects**: Ομαδοποιημένα ανά υπο-έργο (π.χ. "Προφυλακτήρας - Μαύρο")
   - **shared_products**: Κοινά αναλώσιμα/βοηθητικά

Πισίνα Προϊόντων:
{pool_json}

### ΚΑΝΟΝΕΣ ΕΠΙΛΟΓΗΣ (Ο Νόμος των 44 Ετών)
1. **Απόρριψη Περιττών:** Σε κάθε βήμα, διάλεξε ΤΟ ΕΝΑ καλύτερο προϊόν.
2. **Συμβατότητα Μεθόδου:** ΟΛΑ τα προϊόντα ΠΡΕΠΕΙ να εφαρμόζονται με ΙΔΙΑ μέθοδο.
3. **Χημεία & Σκληρυντές:** 2K → hardener ΥΠΟΧΡΕΩΤΙΚΟΣ. Μην ανακατεύεις 1K/2K χωρίς λόγο.
4. **Αστάρι:** Γυμνό μέταλλο → Wash Primer/Εποξικό. Πλαστικό → Plastic Primer.
5. **Λογική Αλληλουχία:** Καθαρισμός → Αστάρι → Χρώμα → Βερνίκι.
6. **Cross-project Optimization:** Αν πολλά υπο-έργα χρειάζονται ίδιο προϊόν (π.χ. ίδιο βερνίκι), επισήμανέ το μία φορά.

### CUSTOM PAINT
Αν υπάρχει custom paint (is_custom_paint: true), πρόσθεσε:
  "is_custom_paint": true,
  "custom_color_info": {{"color_system": "...", "color_code": "...", "notes": "..."}}

### ΕΞΟΔΟΣ: ΕΝΑ JSON
{{
  "solution": {{
    "title": "Ολοκληρωμένο Πλάνο: [Σύντομος Τίτλος]",
    "project_type": "Αυτοκίνητο | Σκάφος | Ξύλο | Μέταλλο | custom",
    "difficulty": "Εύκολο | Μεσαίο | Απαιτητικό",
    "estimated_time": "[π.χ. 2-4 ώρες]",
    "sub_projects": [
      {{
        "label": "Ετικέτα Υπο-Έργου",
        "steps": [
          {{
            "order": 1,
            "title": "Βήμα 1: [Τίτλος]",
            "description": "Λεπτομερείς οδηγίες...",
            "tips": ["Tips"],
            "warnings": ["Warnings"],
            "selected_products": [
              {{
                "variant_id": "gid://shopify/ProductVariant/...",
                "variant_title": "...",
                "product_title": "...",
                "handle": "...",
                "is_custom_paint": false,
                "custom_color_info": null
              }}
            ],
            "alternatives": [
              {{
                "variant_id": "gid://shopify/ProductVariant/...",
                "variant_title": "...",
                "product_title": "...",
                "handle": "...",
                "reason": "Λόγος προτίμησης (π.χ. ταχύτερο στέγνωμα, πιο οικονομικό)",
                "match_score": 90
              }}
            ]
          }}
        ]
      }}
    ],
    "shared_products": [
      {{
        "product_title": "...",
        "handle": "...",
        "variant_id": "...",
        "reason": "Κοινό για όλα τα υπο-έργα"
      }}
    ],
    "all_product_handles": ["handle1", "handle2"]
  }}
}}
"""

    try:
        response = vertex_client.models.generate_content(
            model=model_name,
            contents=[
                genai_types.Content(
                    role="user",
                    parts=[genai_types.Part.from_text(text=chat_transcript)]
                )
            ],
            config=genai_types.GenerateContentConfig(
                system_instruction=system_prompt,
                response_mime_type="application/json",
            ),
        )

        output_text = response.text
        if not output_text:
            raise ValueError("Empty response from Expert Synthesizer LLM")

        parsed_json = json.loads(output_text)

        return {
            "status": "success",
            "solution": parsed_json.get("solution", {})
        }

    except Exception as e:
        logger.error("Expert Synthesizer failed", exc_info=True)
        return {
            "status": "error",
            "answer": "Παρουσιάστηκε σφάλμα κατά τη δημιουργία της λύσης."
        }
