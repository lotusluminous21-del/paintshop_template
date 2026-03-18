// src/lib/expert/types.ts

// Must match functions/expert/schema.py exactly

export type ProjectDomain = 'automotive' | 'marine' | 'structural' | 'industrial' | 'woodworking' | 'general' | 'home' | 'unknown';

export type ProjectType =
    | 'damage-repair'
    | 'new-parts-painting'
    | 'restoration'
    | 'protective-coatings'
    | 'custom-finishes'
    | 'marine-antifouling'
    | 'marine-gelcoat-repair'
    | 'marine-topside-paint'
    | 'marine-wood-varnish'
    | 'structural-masonry-protection'
    | 'structural-wood-staining'
    | 'structural-metal-gate-fence'
    | 'structural-interior-wall'
    | 'general-painting'
    | 'unknown';

export type ConfidenceLevel = 'none' | 'low' | 'medium' | 'high';

export interface InferredValue<T> {
    value: T;
    confidence: ConfidenceLevel;
    source: string;
}

export interface Taxonomies {
    material: string | null;
    damage_depth: string | null;
    environment: string | null;
    rust: string | null;
    color_type: string | null;
    budget: string | null;
}

export interface KnowledgeGaps {
    critical: string[];
    important: string[];
    optional: string[];
}

export interface KnowledgeState {
    domain: ProjectDomain;
    project_type: ProjectType;
    confirmed_facts: Partial<Taxonomies> & Record<string, any>;
    inferred_facts: Record<string, InferredValue<any>>;
    gaps: KnowledgeGaps;
}

export interface ExpertQuestion {
    id: string;
    field: string;
    text: string;
    type: 'single-select' | 'multi-select' | 'text' | 'color-picker';
    options?: {
        id: string;
        label: string;
        description?: string;
        icon?: string;
        value: any;
    }[];
    help_text?: string;
    required?: boolean;
}

export interface SolutionStep {
    order: number;
    title: string;
    description: string;
    product_handles: string[]; // Shopify product handles (matches Python schema)
    selected_products?: {
        variant_id: string;
        variant_title?: string;
        product_title?: string;
        handle: string;
        is_custom_paint?: boolean;
        custom_color_info?: {
            color_system: string;
            color_code: string;
            notes?: string;
        };
        [key: string]: any;
    }[];
    tips: string[];
    warnings?: string[];
}

export interface Solution {
    id: string;
    title: string;
    projectType: string;
    difficulty: string;
    estimatedTime: string;
    steps?: SolutionStep[];
    sub_projects?: {
        label: string;
        steps: SolutionStep[];
    }[];
    shared_products?: {
        product_title?: string;
        handle: string;
        variant_id?: string;
        reason?: string;
        [key: string]: any;
    }[];
    totalPrice: number;
    totalProducts: number;
    assumptions: string[];
}

export interface SuggestedProduct {
    handle: string;
    title: string;
    image?: string;
    price?: number;
    reason?: string;
}

export interface ExpertChatResponse {
    status: 'chat' | 'success' | 'error';
    answer?: string; // Text response if status === 'chat' or 'error'
    solution?: Solution; // The finalized plan if status === 'success'
}

export interface ExpertChatRequest {
    message: string;
    history: { role: 'user' | 'model'; content: string }[];
}

// ── V4 Pipeline Types ─────────────────────────────────────────────────

export type PipelineStage = '' | 'planning' | 'retrieving' | 'synthesizing' | 'complete' | 'error';

export interface InterviewDimension {
    status: 'identified' | 'pending' | 'unknown';
    value: string | null;
}

export interface InterviewProgress {
    what: InterviewDimension;
    why: InterviewDimension;
    how: InterviewDimension;
    where: InterviewDimension;
    result: InterviewDimension;
}

export interface KnowledgeDimension {
    id: string;
    label: string;
    status: 'identified' | 'pending' | 'unknown';
    value: string | null;
}

export interface SidebarState {
    overallPhase: 'interviewing' | 'ready_for_plan' | 'planning' | 'retrieving' | 'synthesizing' | 'complete';
    overallPhaseLabel: string;
    domain: string;
    showSolutionButton: boolean;
    briefReadiness: number;
    interviewProgress: InterviewProgress;
    knowledgeDimensions: KnowledgeDimension[];
    logs: { type: string; message: string }[];
    // Legacy V3 fields (kept for backward compatibility during transition)
    recommendedProducts?: SuggestedProduct[];
    analysisPhase?: string;
}
