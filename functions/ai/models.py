from typing import List, Dict, Any, Optional, Literal
from enum import Enum
from pydantic import BaseModel, Field

# --- Strict State Machine Enums ---
class ProductState(str, Enum):
    """
    The absolute source of truth for a product's state in the Lab pipeline.
    Products flow strictly down this list unless diverted by an error or a review flag.
    """
    IMPORTED = "IMPORTED"
    RAW_INGESTED = "RAW_INGESTED"
    BATCH_GENERATING = "BATCH_GENERATING"
    GENERATING_METADATA = "GENERATING_METADATA"
    NEEDS_METADATA_REVIEW = "NEEDS_METADATA_REVIEW"
    RESOLVING_VARIANTS = "RESOLVING_VARIANTS"
    REMOVING_SOURCE_BACKGROUND = "REMOVING_SOURCE_BACKGROUND"
    SOURCING_IMAGES = "SOURCING_IMAGES"
    NEEDS_IMAGE_REVIEW = "NEEDS_IMAGE_REVIEW"
    GENERATING_STUDIO = "GENERATING_STUDIO"
    REMOVING_BACKGROUND = "REMOVING_BACKGROUND"
    READY_FOR_PUBLISH = "READY_FOR_PUBLISH"
    PUBLISHING = "PUBLISHING"
    PUBLISHED = "PUBLISHED"
    DELAYED_RETRY = "DELAYED_RETRY"
    FAILED = "FAILED"

# --- Shared Data Schemas ---
class ProductVariant(BaseModel):
    sku_suffix: str = Field(description="Unique suffix for this variant (e.g., -RED, -400ML)")
    variant_name: str = Field(description="The full name of the variant")
    option1_name: Optional[str] = Field(description="Name of the first dynamic option (e.g., 'Χρώμα')", default=None)
    option1_value: Optional[str] = Field(description="Value for the first option (e.g., 'Κόκκινο')", default=None)
    option2_name: Optional[str] = Field(description="Name of the second dynamic option", default=None)
    option2_value: Optional[str] = Field(description="Value for the second option", default=None)
    option3_name: Optional[str] = Field(description="Name of the third dynamic option", default=None)
    option3_value: Optional[str] = Field(description="Value for the third option", default=None)
    pylon_sku: Optional[str] = None # Legacy mapping
    price: Optional[float] = Field(description="Λιανική τιμή του variant (Retail price)", default=None)

class ProductImage(BaseModel):
    url: str
    suffix: str = Field(description="Base or variant suffix tracking")
    description: Optional[str] = None

class PaintTechnicalSpecs(BaseModel):
    chemical_base: Literal["Ακρυλικό", "Σμάλτο", "Λάκα", "Ουρεθάνη", "Εποξικό", "Νερού", "Διαλύτου", "Άλλο"] = Field(description="Ο χημικός τύπος/βάση του προϊόντος (Chemical base)")
    sequence_step: Literal["Προετοιμασία/Καθαριστικό", "Αστάρι", "Ενισχυτικό Πρόσφυσης", "Βασικό Χρώμα", "Βερνίκι", "Γυαλιστικό", "Άλλο"] = Field(description="Σε ποιο στάδιο της βαφής χρησιμοποιείται (Sequence step)")
    surface_suitability: List[Literal["Γυμνό Μέταλλο", "Πλαστικό", "Ξύλο", "Fiberglass", "Υπάρχον Χρώμα", "Σκουριά", "Αλουμίνιο", "Γαλβανιζέ", "Άλλο"]] = Field(description="Λίστα με κατάλληλες επιφάνειες (Surface suitability)")
    finish: Literal["Ματ", "Σατινέ", "Γυαλιστερό", "Υψηλής Γυαλάδας", "Σαγρέ/Ανάγλυφο", "Μεταλλικό", "Πέρλα", "Άλλο"] = Field(description="Το τελικό φινίρισμα (Finish)")
    special_properties: List[Literal["Υψηλής Θερμοκρασίας", "Ανθεκτικό σε UV", "Αντισκωριακό", "2 Συστατικών", "1 Συστατικού"]] = Field(description="Ειδικές ιδιότητες (Special properties)", default=[])
    
    drying_time_touch: Optional[str] = Field(description="Χρόνος στεγνώματος στην αφή", default=None)
    recoat_window: Optional[str] = Field(description="Χρόνος επαναβαφής", default=None)
    full_cure: Optional[str] = Field(description="Πλήρης σκλήρυνση", default=None)
    application_method: List[Literal["Σπρέι", "Πιστόλι Βαφής", "Πινέλο", "Ρολό", "Άλλο"]] = Field(description="Μέθοδοι εφαρμογής", default=[])
    
    # Legacy specific fields restored
    coverage: Optional[str] = Field(description="Coverage area per liter or unit (e.g., 10-12m²/L) (Απόδοση)", default=None)
    drying_time: Optional[str] = Field(description="Drying time (e.g., 1-2 hours) (Χρόνος στεγνώματος)", default=None)
    durability_features: List[str] = Field(description="Durability features (e.g., Rust-proof, Washable, UV-resistant) (Χαρακτηριστικά αντοχής)", default=[])
    environment: Optional[Literal["Εσωτερικός Χώρος", "Εξωτερικός Χώρος", "Και τα δύο"]] = Field(description="Recommended environment / Indoor, Outdoor, Both", default=None)
    application: List[str] = Field(description="Legacy application methods", default=[]) # Fallback for legacy "application" list

    weight_per_volume: Optional[str] = Field(description="Ειδικό Βάρος (π.χ. kg/L)", default=None)
    dry_film_thickness: Optional[str] = Field(description="Συνιστώμενο πάχος στεγνού φιλμ (μm)", default=None)
    mixing_ratio: Optional[str] = Field(description="Αναλογία μίξης (κυρίως για 2K)", default=None)
    pot_life: Optional[str] = Field(description="Χρόνος ζωής μίγματος (pot life)", default=None)
    voc_level: Optional[str] = Field(description="Επίπεδο ΠΟΕ (VOC)", default=None)
    spray_nozzle_type: Optional[str] = Field(description="Τύπος μπεκ (π.χ. Βεντάλια, Κυκλικό)", default=None)

ProductType = Literal[
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

ProjectCategory = Literal[
    "Αυτοκίνητο",
    "Ναυτιλιακά",
    "Οικοδομικά",
    "Ειδικές Εφαρμογές"
]


class ProductEnrichmentData(BaseModel):
    """
    The strictly validated output from the Metadata AI Agent.
    """
    title: str = Field(description="Semantic, neat, and brief title in Greek. MUST clearly display any identification/model numbers or primary brand identifiers.")
    brand: str = Field(description="The manufacturer/brand of the product. Extract from the original product name or source text. Examples: 'HB Body', 'Motip', 'Nexa Autocolor'.")
    description: str = Field(description="Comprehensive and customer-friendly summary in Greek.")
    short_description: str = Field(description="Brief summary for collections (in Greek).", default="")
    tags: List[str] = Field(description="List of relevant tags (in Greek)")
    product_type: ProductType = Field(description="The primary classification of the product (e.g. Αστάρια, Βερνίκια) (in Greek)")
    project_category: ProjectCategory = Field(description="The project category or industry the product is meant for (e.g. Αυτοκίνητο, Ναυτιλιακά) (in Greek)")
    variants: List[ProductVariant] = Field(description="Discovered dynamic variants based on the available options", default=[])
    attributes: Dict[str, Any] = Field(description="Key-value product attributes", default={})
    technical_specs: Optional[PaintTechnicalSpecs] = Field(description="Technical specifications for paint/spray products, structured strictly in Greek", default=None)
    confidence_score: float = Field(description="Confidence score 0.0-1.0 generated by the parser.")
    
    # Trackers for the Enrichment Pipeline (Not mapped out to LLM output usually, but part of the DB schema)
    # Pydantic allows excluding these from prompt schemas when used as tools.
