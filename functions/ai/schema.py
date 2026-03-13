from typing import List, Dict, Any, Optional, Literal
from pydantic import BaseModel, Field


# --- Pydantic Models for Structured Output ---
class ProductVariant(BaseModel):
    sku_suffix: str = Field(description="A unique suffix for this variant (e.g., -RED, -400ML)")
    variant_name: str = Field(description="The full name of the variant")
    option1_name: Optional[str] = Field(description="Name of the first dynamic option (e.g., 'Χρώμα', 'Όγκος / Συσκευασία')", default=None)
    option1_value: Optional[str] = Field(description="Value for the first option (e.g., 'Κόκκινο', '400ml')", default=None)
    option2_name: Optional[str] = Field(description="Name of the second dynamic option, if applicable", default=None)
    option2_value: Optional[str] = Field(description="Value for the second option, if applicable", default=None)
    option3_name: Optional[str] = Field(description="Name of the third dynamic option, if applicable", default=None)
    option3_value: Optional[str] = Field(description="Value for the third option, if applicable", default=None)
    pylon_sku: Optional[str] = None
    price: Optional[float] = Field(description="Retail price for this variant", default=None)

class ProductImage(BaseModel):
    url: str
    description: Optional[str] = None

class PaintTechnicalSpecs(BaseModel):
    chemical_base: Literal["Ακρυλικό", "Σμάλτο", "Λάκα", "Ουρεθάνη", "Εποξικό", "Νερού", "Διαλύτου", "Άλλο"] = Field(description="Ο χημικός τύπος/βάση του προϊόντος (Chemical base)")
    sequence_step: Literal["Προετοιμασία/Καθαριστικό", "Αστάρι", "Ενισχυτικό Πρόσφυσης", "Βασικό Χρώμα", "Βερνίκι", "Γυαλιστικό", "Άλλο"] = Field(description="Σε ποιο στάδιο της βαφής χρησιμοποιείται (Sequence step)")
    surface_suitability: List[Literal["Γυμνό Μέταλλο", "Πλαστικό", "Ξύλο", "Fiberglass", "Υπάρχον Χρώμα", "Σκουριά", "Αλουμίνιο", "Γαλβανιζέ", "Άλλο"]] = Field(description="Λίστα με κατάλληλες επιφάνειες (Surface suitability)")
    finish: Literal["Ματ", "Σατινέ", "Γυαλιστερό", "Υψηλής Γυαλάδας", "Σαγρέ/Ανάγλυφο", "Μεταλλικό", "Πέρλα", "Άλλο"] = Field(description="Το τελικό φινίρισμα (Finish)")
    special_properties: List[Literal["Υψηλής Θερμοκρασίας", "Ανθεκτικό σε UV", "Αντισκωριακό", "2 Συστατικών", "1 Συστατικού"]] = Field(description="Ειδικές ιδιότητες (Special properties)", default=[])
    
    # Application & Timeline
    drying_time_touch: Optional[str] = Field(description="Χρόνος στεγνώματος στην αφή", default=None)
    recoat_window: Optional[str] = Field(description="Χρόνος επαναβαφής", default=None)
    full_cure: Optional[str] = Field(description="Πλήρης σκλήρυνση", default=None)
    application_method: List[Literal["Σπρέι", "Πιστόλι Βαφής", "Πινέλο", "Ρολό", "Άλλο"]] = Field(description="Μέθοδοι εφαρμογής", default=[])
    
    # Deep Technical Attributes
    weight_per_volume: Optional[str] = Field(description="Ειδικό Βάρος (π.χ. kg/L)", default=None)
    dry_film_thickness: Optional[str] = Field(description="Συνιστώμενο πάχος στεγνού φιλμ (μm)", default=None)
    mixing_ratio: Optional[str] = Field(description="Αναλογία μίξης (κυρίως για 2K)", default=None)
    pot_life: Optional[str] = Field(description="Χρόνος ζωής μίγματος (pot life)", default=None)
    voc_level: Optional[str] = Field(description="Επίπεδο ΠΟΕ (VOC)", default=None)
    spray_nozzle_type: Optional[str] = Field(description="Τύπος μπεκ (π.χ. Βεντάλια, Κυκλικό)", default=None)

ProductCategory = Literal[
    "Προετοιμασία & Καθαρισμός",
    "Αστάρια & Υποστρώματα",
    "Χρώματα Βάσης",
    "Βερνίκια & Φινιρίσματα",
    "Σκληρυντές & Ενεργοποιητές",
    "Στόκοι & Πλαστελίνες",
    "Πινέλα & Εργαλεία",
    "Διαλυτικά & Αραιωτικά",
    "Αξεσουάρ",
    "Άλλο"
]


class ProductEnrichmentData(BaseModel):
    title: str = Field(description="Semantic, neat, and brief title in Greek. MUST clearly display any identification/model numbers or primary brand identifiers.")
    description: str = Field(description="Comprehensive and customer-friendly summary in Greek.")
    short_description: str = Field(description="Brief summary for collections (in Greek).", default="")
    tags: List[str] = Field(description="List of relevant tags (in Greek)")
    category: ProductCategory = Field(description="Main product category (in Greek)")
    variants: List[ProductVariant] = Field(description="Discovered dynamic variants based on the available options (e.g. Colors, Sizes, Types)", default=[])
    attributes: Dict[str, Any] = Field(description="Key-value product attributes", default={})
    technical_specs: Optional[PaintTechnicalSpecs] = Field(description="Technical specifications for paint/spray products, structured strictly in Greek", default=None)
    confidence_score: float = Field(description="Confidence score 0.0-1.0")

class ExpertChatRequest(BaseModel):
    message: str = Field(description="The user's message or question about a painting project.")
    history: List[Dict[str, str]] = Field(description="Previous chat history", default=[])
    context: Optional[Dict[str, Any]] = Field(description="Optional context like captured surface type, etc.", default=None)

class ExpertChatResponse(BaseModel):
    answer: str = Field(description="The expert's advice or final recommendation.")
    suggested_products: List[Dict[str, Any]] = Field(description="List of specific Shopify products included in the advice.", default=[])
    step_by_step_recipe: List[str] = Field(description="The multi-step process proposed by the expert.", default=[])
    safety_warnings: List[str] = Field(description="Critical safety warnings for the identified products.", default=[])
