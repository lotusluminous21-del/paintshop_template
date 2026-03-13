/**
 * Strict State Machine Enums for the Monolithic Admin Lab.
 * These perfectly mirror the backend Enums defined in `functions/ai/models.py`.
 */
export enum ProductState {
    IMPORTED = "IMPORTED",
    BATCH_GENERATING = "BATCH_GENERATING",
    RAW_INGESTED = "RAW_INGESTED",
    GENERATING_METADATA = "GENERATING_METADATA",
    NEEDS_METADATA_REVIEW = "NEEDS_METADATA_REVIEW",
    RESOLVING_VARIANTS = "RESOLVING_VARIANTS",
    SOURCING_IMAGES = "SOURCING_IMAGES",
    NEEDS_IMAGE_REVIEW = "NEEDS_IMAGE_REVIEW",
    REMOVING_SOURCE_BACKGROUND = "REMOVING_SOURCE_BACKGROUND",
    GENERATING_STUDIO = "GENERATING_STUDIO",
    REMOVING_BACKGROUND = "REMOVING_BACKGROUND",
    READY_FOR_PUBLISH = "READY_FOR_PUBLISH",
    PUBLISHING = "PUBLISHING",
    PUBLISHED = "PUBLISHED",
    DELAYED_RETRY = "DELAYED_RETRY",
    FAILED = "FAILED"
}

export type ProductType =
    | "Προετοιμασία & Καθαρισμός"
    | "Αστάρια & Υποστρώματα"
    | "Χρώματα Βάσης"
    | "Βερνίκια & Φινιρίσματα"
    | "Σκληρυντές & Ενεργοποιητές"
    | "Στόκοι & Πλαστελίνες"
    | "Πινέλα & Εργαλεία"
    | "Διαλυτικά & Αραιωτικά"
    | "Αξεσουάρ"
    | "Άλλο";

export type ProjectCategory =
    | "Αυτοκίνητο"
    | "Ναυτιλιακά"
    | "Οικοδομικά"
    | "Ειδικές Εφαρμογές";

export interface ProductVariant {
    sku_suffix: string;
    variant_name: string;
    option1_name?: string;
    option1_value?: string;
    option2_name?: string;
    option2_value?: string;
    option3_name?: string;
    option3_value?: string;
    pylon_sku?: string;
    price?: number;
}

export type ChemicalBase = "Ακρυλικό" | "Σμάλτο" | "Λάκα" | "Ουρεθάνη" | "Εποξικό" | "Νερού" | "Διαλύτου" | "Άλλο";
export type SequenceStep = "Προετοιμασία/Καθαριστικό" | "Αστάρι" | "Ενισχυτικό Πρόσφυσης" | "Βασικό Χρώμα" | "Βερνίκι" | "Γυαλιστικό" | "Άλλο";
export type SurfaceSuitability = "Γυμνό Μέταλλο" | "Πλαστικό" | "Ξύλο" | "Fiberglass" | "Υπάρχον Χρώμα" | "Σκουριά" | "Αλουμίνιο" | "Γαλβανιζέ" | "Άλλο";
export type Finish = "Ματ" | "Σατινέ" | "Γυαλιστερό" | "Υψηλής Γυαλάδας" | "Σαγρέ/Ανάγλυφο" | "Μεταλλικό" | "Πέρλα" | "Άλλο";
export type SpecialProperty = "Υψηλής Θερμοκρασίας" | "Ανθεκτικό σε UV" | "Αντισκωριακό" | "2 Συστατικών" | "1 Συστατικού";
export type ApplicationMethod = "Σπρέι" | "Πιστόλι Βαφής" | "Πινέλο" | "Ρολό" | "Άλλο";

export interface PaintTechnicalSpecs {
    chemical_base?: ChemicalBase;
    sequence_step?: SequenceStep;
    surface_suitability?: SurfaceSuitability[];
    finish?: Finish;
    special_properties?: SpecialProperty[];
    drying_time_touch?: string;
    recoat_window?: string;
    full_cure?: string;
    application_method?: ApplicationMethod[];
    weight_per_volume?: string;
    dry_film_thickness?: string;
    mixing_ratio?: string;
    pot_life?: string;
    voc_level?: string;
    spray_nozzle_type?: string;
}

export interface ProductImage {
    url: string;
    suffix: string;
    description?: string;
}

export interface ProductEnrichmentData {
    title: string;
    brand?: string;
    description: string;
    short_description: string;
    tags: string[];
    type: ProductType | string;
    category: ProjectCategory | string;
    variants: ProductVariant[];
    attributes: Record<string, any>;
    technical_specs?: PaintTechnicalSpecs;
    confidence_score: number;
    flagged_fields?: string[];
    qa_reasoning?: string;

    // UI Trackers / Additional fields
    images?: ProductImage[]; // Finalized Output
    generated_images?: Record<string, string>; // In-flight studio generations
    selected_images?: Record<string, string>; // Source images
    variant_images?: Record<string, any[]>; // Raw scraped candidate images
}

/**
 * The core Staging Product object that represents a row in the Firestore DB
 * and a row in the Lab Data Grid.
 */
export interface LabProduct {
    id: string;
    sku: string;
    status: ProductState;
    enrichment_message?: string;

    // The sparse data from Pylon
    pylon_data: {
        name: string;
        price?: number;
        stock?: number;
        [key: string]: any;
    };

    // The rich AI generated data
    ai_data?: ProductEnrichmentData;

    updated_at?: string | { seconds: number; nanoseconds: number };
    created_at?: string | { seconds: number; nanoseconds: number };
}
