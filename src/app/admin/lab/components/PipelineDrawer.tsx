import React, { useState, useEffect, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";
import { LabProduct, ProductState } from "@/types/lab";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AlertCircle, CheckCircle2, Loader2, RotateCcw, X, Image as ImageIcon, Plus, Trash2, Settings2, Upload, Clipboard, ZoomIn } from "lucide-react";
import { doc, updateDoc, deleteField, deleteDoc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "@/lib/firebase";
import ImageLightbox from "./ImageLightbox";
import { getCategoryImage } from "@/lib/categories";
import NextImage from "next/image";

export default function PipelineDrawer({
    product,
    initialStep,
    onClose
}: {
    product: LabProduct;
    initialStep?: string | null;
    onClose: () => void;
}) {
    // Pipeline Steps
    const steps = [
        { id: 'raw', title: 'Row Data Extraction', description: 'Raw Pylon CSV data ingested.' },
        { id: 'metadata', title: 'Metadata Generation', description: 'AI enrichment, Greek translation, and structuring.' },
        { id: 'variants', title: 'Variant Resolution', description: 'Product variant discovery and structuring.' },
        { id: 'sourcing', title: 'Source Image Sourcing', description: 'Scraping target imagery.' },
        { id: 'studio', title: 'Studio Visuals Generation', description: 'Fal.ai context removal & Gemini Studio render.' },
    ];

    // Determine state of each step
    const getStepState = (stepId: string): 'pending' | 'loading' | 'review' | 'complete' => {
        const s = product.status as ProductState;
        const isFailed = s === ProductState.FAILED || s === ProductState.DELAYED_RETRY;
        const msg = product.enrichment_message || "";

        // Establish ground-truth derived from data persistence
        const hasMetadata = !!product.ai_data?.title;
        const hasSourceImage = !!product.ai_data?.selected_images?.base;
        const hasStudioImage = !!(product.ai_data?.images && product.ai_data.images.length > 0);

        // If it's a hard failure, we must figure out WHICH step failed.
        // The *first* step that isn't functionally complete gets the failure flag.
        if (isFailed) {
            if (stepId === 'raw') return 'complete'; // If we have a product, row extract succeeded.
            if (stepId === 'metadata') {
                if (!hasMetadata || msg.includes('Metadata')) return 'review';
                return 'complete';
            }
            if (stepId === 'sourcing') {
                if (hasMetadata && (!hasSourceImage || msg.includes('sourcing') || msg.includes('vision'))) return 'review';
                if (!hasMetadata) return 'pending';
                return 'complete';
            }
            if (stepId === 'studio') {
                if (hasMetadata && hasSourceImage && !hasStudioImage) return 'review';
                if (!hasMetadata || !hasSourceImage) return 'pending';
                return 'complete';
            }
        }

        switch (stepId) {
            case 'raw':
                if (s === ProductState.IMPORTED || s === ProductState.IGNORED) return 'pending';
                if (s === ProductState.RAW_INGESTED || s === ProductState.BATCH_GENERATING) return 'loading';
                if (s === ProductState.NEEDS_MANUAL_DATA) return 'review';
                return 'complete';
            case 'metadata':
                if ([ProductState.IMPORTED, ProductState.RAW_INGESTED, ProductState.BATCH_GENERATING].includes(s)) return 'pending';
                if (s === ProductState.GENERATING_METADATA) return 'loading';
                if (s === ProductState.NEEDS_METADATA_REVIEW) return 'review';
                return 'complete';
            case 'variants':
                if ([ProductState.IMPORTED, ProductState.RAW_INGESTED, ProductState.BATCH_GENERATING, ProductState.GENERATING_METADATA, ProductState.NEEDS_METADATA_REVIEW].includes(s)) return 'pending';
                if (s === ProductState.RESOLVING_VARIANTS) return 'loading';
                return 'complete';
            case 'sourcing':
                if ([ProductState.IMPORTED, ProductState.RAW_INGESTED, ProductState.BATCH_GENERATING, ProductState.GENERATING_METADATA, ProductState.NEEDS_METADATA_REVIEW, ProductState.RESOLVING_VARIANTS].includes(s)) return 'pending';
                if (s === ProductState.SOURCING_IMAGES || s === ProductState.REMOVING_SOURCE_BACKGROUND) return 'loading';
                if (s === ProductState.NEEDS_IMAGE_REVIEW) return 'review';
                return 'complete';
            case 'studio':
                if (![ProductState.GENERATING_STUDIO, ProductState.REMOVING_BACKGROUND, ProductState.READY_FOR_PUBLISH, ProductState.PUBLISHING, ProductState.PUBLISHED].includes(s)) return 'pending';
                if (s === ProductState.GENERATING_STUDIO || s === ProductState.REMOVING_BACKGROUND) return 'loading';
                return 'complete';
            default:
                return 'pending';
        }
    };

    // Auto-expand the active step
    const [expandedStep, setExpandedStep] = useState<string | null>(initialStep || null);
    const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

    // Initial explicit routing via initialStep prop trumps auto-discovery
    useEffect(() => {
        if (initialStep) {
            setExpandedStep(initialStep);
            return;
        }
        for (const step of [...steps].reverse()) {
            const state = getStepState(step.id);
            if (state === 'review' || state === 'loading' || state === 'complete') {
                setExpandedStep(step.id);
                // Stop at the first non-complete one from bottom up, wait actually top down is better
                break;
            }
        }
    }, [product.status, initialStep]);

    useEffect(() => {
        // Find the "current" pipeline step to keep it open
        const active = steps.find(s => {
            const st = getStepState(s.id);
            return st === 'loading' || st === 'review';
        });
        if (active) {
            setExpandedStep(active.id);
        } else if (getStepState('studio') === 'complete') {
            setExpandedStep('studio');
        }
    }, [product.status]);


    // Data States for Editors
    const [aiTitle, setAiTitle] = useState(product.ai_data?.title || "");
    const [aiBrand, setAiBrand] = useState(product.ai_data?.brand || "");
    const [aiDesc, setAiDesc] = useState(product.ai_data?.description || "");
    const [aiType, setAiType] = useState(product.ai_data?.product_type || (product.ai_data?.type === "Σπρέι Βαφής" ? "" : (product.ai_data?.type || "")) || (!["Αυτοκίνητο", "Ναυτιλιακά", "Οικοδομικά", "Ειδικές Εφαρμογές"].includes(product.ai_data?.category || "") ? (product.ai_data?.category || "") : ""));
    const [aiCategory, setAiCategory] = useState(product.ai_data?.project_category || (["Αυτοκίνητο", "Ναυτιλιακά", "Οικοδομικά", "Ειδικές Εφαρμογές"].includes(product.ai_data?.category || "") ? product.ai_data?.category : "") || "");
    const [aiTags, setAiTags] = useState<string[]>(product.ai_data?.tags || []);
    const [variants, setVariants] = useState<any[]>(product.ai_data?.variants || []);
    const [techSpecs, setTechSpecs] = useState<any>(product.ai_data?.technical_specs || {});
    const [manualSearchQuery, setManualSearchQuery] = useState(product.search_query || product.pylon_data?.name || "");

    // Flagged fields from QA cross-validation
    const flaggedFields = product.ai_data?.flagged_fields || [];
    const isFlagged = (field: string) => flaggedFields.includes(field);

    // Flag to track if the current product has changed (to prevent wiping edits on background updates)
    const prevProductIdRef = useRef(product.id);

    // Form sync on product change - ONLY when product ID changes
    useEffect(() => {
        if (prevProductIdRef.current !== product.id) {
            setAiTitle(product.ai_data?.title || "");
            setAiBrand(product.ai_data?.brand || "");
            setAiDesc(product.ai_data?.description || "");
            setAiType(product.ai_data?.product_type || (product.ai_data?.type === "Σπρέι Βαφής" ? "" : (product.ai_data?.type || "")) || (!["Αυτοκίνητο", "Ναυτιλιακά", "Οικοδομικά", "Ειδικές Εφαρμογές"].includes(product.ai_data?.category || "") ? (product.ai_data?.category || "") : ""));
            setAiCategory(product.ai_data?.project_category || (["Αυτοκίνητο", "Ναυτιλιακά", "Οικοδομικά", "Ειδικές Εφαρμογές"].includes(product.ai_data?.category || "") ? product.ai_data?.category : "") || "");
            setAiTags(product.ai_data?.tags || []);
            setVariants(product.ai_data?.variants || []);
            setTechSpecs(product.ai_data?.technical_specs || {});
            setManualSearchQuery(product.search_query || product.pylon_data?.name || "");
            prevProductIdRef.current = product.id;
        }
    }, [product.id]);

    // Derived "dirty" state
    const isMetadataDirty = 
        aiTitle !== (product.ai_data?.title || "") ||
        aiBrand !== (product.ai_data?.brand || "") ||
        aiDesc !== (product.ai_data?.description || "") ||
        aiType !== (product.ai_data?.product_type || (product.ai_data?.type === "Σπρέι Βαφής" ? "" : (product.ai_data?.type || "")) || (!["Αυτοκίνητο", "Ναυτιλιακά", "Οικοδομικά", "Ειδικές Εφαρμογές"].includes(product.ai_data?.category || "") ? (product.ai_data?.category || "") : "")) ||
        aiCategory !== (product.ai_data?.project_category || (["Αυτοκίνητο", "Ναυτιλιακά", "Οικοδομικά", "Ειδικές Εφαρμογές"].includes(product.ai_data?.category || "") ? product.ai_data?.category : "") || "") ||
        JSON.stringify(aiTags) !== JSON.stringify(product.ai_data?.tags || []) ||
        JSON.stringify(techSpecs) !== JSON.stringify(product.ai_data?.technical_specs || {});

    const isVariantsDirty = JSON.stringify(variants) !== JSON.stringify(product.ai_data?.variants || []);

    // Handlers
    const handleSaveMetadata = async () => {
        if (!db) return;

        let targetStatus = product.status;
        let payload: any = {
            "ai_data.title": aiTitle,
            "ai_data.brand": aiBrand,
            "ai_data.description": aiDesc,
            "ai_data.type": aiType,
            "ai_data.product_type": aiType,
            "ai_data.category": aiCategory,
            "ai_data.project_category": aiCategory,
            "ai_data.tags": aiTags,
            "ai_data.variants": variants,
            "ai_data.technical_specs": techSpecs,
            "ai_data.flagged_fields": [], // Clear flags after manual save
            enrichment_message: "Metadata manually approved & saved."
        };

        const studioComplete = getStepState('studio') === 'complete';

        if (product.status === ProductState.NEEDS_METADATA_REVIEW) {
            targetStatus = ProductState.RESOLVING_VARIANTS;
            payload.status = targetStatus;
        } else if (studioComplete && isMetadataDirty) {
            // Warn about reroll only if metadata actually changed
            if (!confirm("Updating core metadata or variants will clear existing generated visuals and reroll them. Proceed?")) return;

            targetStatus = ProductState.GENERATING_STUDIO;
            payload.status = targetStatus;
            payload["ai_data.generated_images"] = deleteField();
            payload["ai_data.images"] = deleteField();
            payload.enrichment_message = "Metadata modified. Re-rendering visuals...";
        }

        try {
            await updateDoc(doc(db!, "staging_products", product.id), payload);
            alert("Metadata saved successfully.");
        } catch (e) {
            console.error(e);
            alert("Failed to save metadata.");
        }
    };

    const handleApplyQASuggestions = async () => {
        if (!db) return;
        const suggestions = product.ai_data?.qa_suggestions;
        if (!suggestions || Object.keys(suggestions).length === 0) return;

        let updatedTechSpecs = { ...techSpecs };
        for (const [key, value] of Object.entries(suggestions)) {
            if (!['title', 'brand', 'type', 'category', 'description', 'tags'].includes(key)) {
                updatedTechSpecs[key] = value;
            }
        }

        let targetStatus = product.status;
        let payload: any = {
            "ai_data.title": suggestions.title !== undefined ? suggestions.title : aiTitle,
            "ai_data.brand": suggestions.brand !== undefined ? suggestions.brand : aiBrand,
            "ai_data.description": suggestions.description !== undefined ? suggestions.description : aiDesc,
            "ai_data.type": suggestions.product_type !== undefined ? suggestions.product_type : (suggestions.type !== undefined ? suggestions.type : aiType),
            "ai_data.product_type": suggestions.product_type !== undefined ? suggestions.product_type : (suggestions.type !== undefined ? suggestions.type : aiType),
            "ai_data.category": suggestions.project_category !== undefined ? suggestions.project_category : (suggestions.category !== undefined ? suggestions.category : aiCategory),
            "ai_data.project_category": suggestions.project_category !== undefined ? suggestions.project_category : (suggestions.category !== undefined ? suggestions.category : aiCategory),
            "ai_data.tags": suggestions.tags !== undefined ? suggestions.tags : aiTags,
            "ai_data.variants": variants,
            "ai_data.technical_specs": updatedTechSpecs,
            "ai_data.flagged_fields": [],
            "ai_data.qa_suggestions": deleteField(),
            enrichment_message: "QA Suggestions applied automatically."
        };

        const studioComplete = getStepState('studio') === 'complete';

        if (product.status === ProductState.NEEDS_METADATA_REVIEW) {
            targetStatus = ProductState.RESOLVING_VARIANTS;
            payload.status = targetStatus;
        } else if (studioComplete) {
            targetStatus = ProductState.GENERATING_STUDIO;
            payload.status = targetStatus;
            payload["ai_data.generated_images"] = deleteField();
            payload["ai_data.images"] = deleteField();
            payload.enrichment_message = "QA Suggestions applied. Re-rendering visuals...";
        }

        try {
            await updateDoc(doc(db!, "staging_products", product.id), payload);
        } catch (e) {
            console.error(e);
            alert("Failed to apply QA suggestions.");
        }
    };

    const handleApproveImage = async (url: string) => {
        if (!db) return;
        try {
            await updateDoc(doc(db!, "staging_products", product.id), {
                "ai_data.selected_images": { "base": url },
                "ai_data.generated_images": deleteField(),
                "ai_data.images": deleteField(),
                status: ProductState.GENERATING_STUDIO,
                enrichment_message: "Source image approved. Beginning Studio Generation..."
            });
            // Actually, if we selected an image, we should probably do background removal first if we wanted to, but the current flow for manual url was straight to GENERATING_STUDIO. We'll keep it as GENERATING_STUDIO to match old behavior, or REMOVING_SOURCE_BACKGROUND if we want it to be cleaned. Let's send to GENERATING_STUDIO. User can reject later.
        } catch (e) {
            console.error(e);
        }
    };

    const handleRegenerate = async (stepId: string) => {
        if (!db) return;
        if (!confirm(`Are you sure you want to rollback and regenerate the ${stepId} step? This will discard downstream data.`)) return;

        let payload: any = { enrichment_message: "Admin triggered manual regeneration." };

        switch (stepId) {
            case 'metadata':
                payload.status = ProductState.GENERATING_METADATA;
                payload["ai_data"] = deleteField();
                break;
            case 'variants':
                payload.status = ProductState.RESOLVING_VARIANTS;
                payload["ai_data.variants"] = deleteField();
                break;
            case 'sourcing':
                payload.status = ProductState.SOURCING_IMAGES;
                payload["ai_data.variant_images"] = deleteField();
                payload["ai_data.selected_images"] = deleteField();
                payload["ai_data.generated_images"] = deleteField();
                payload["ai_data.images"] = deleteField();
                payload["ai_data.grounding_sources"] = deleteField();
                payload["ai_data.grounding_text"] = deleteField();
                break;
            case 'studio':
                payload.status = ProductState.GENERATING_STUDIO;
                payload["ai_data.generated_images"] = deleteField();
                payload["ai_data.images"] = deleteField();
                break;
        }

        try {
            await updateDoc(doc(db!, "staging_products", product.id), payload);
        } catch (e) {
            console.error(e);
        }
    };

    // ── Image Upload / Paste Logic ───────────────────────────────────
    const [uploadState, setUploadState] = useState<'idle' | 'uploading' | 'preview'>('idle');
    const [uploadPreview, setUploadPreview] = useState<string | null>(null);
    const [isDragOver, setIsDragOver] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleImageUpload = useCallback(async (file: File) => {
        if (!storage || !db) return;
        if (!file.type.startsWith('image/')) {
            alert('Please select a valid image file.');
            return;
        }
        if (file.size > 10 * 1024 * 1024) {
            alert('Image must be under 10MB.');
            return;
        }

        // Show preview immediately
        const previewUrl = URL.createObjectURL(file);
        setUploadPreview(previewUrl);
        setUploadState('uploading');

        try {
            const ext = file.name.split('.').pop() || 'jpg';
            const storagePath = `source-images/${product.sku}/manual_${Date.now()}.${ext}`;
            const storageRef = ref(storage, storagePath);

            await uploadBytes(storageRef, file, { contentType: file.type });
            const downloadUrl = await getDownloadURL(storageRef);

            // Add as a CANDIDATE to the image grid — do NOT auto-select
            const existingCandidates = product.ai_data?.variant_images?.base || [];
            const newCandidate = { url: downloadUrl, score: 1.0, source: "manual_upload" };
            await updateDoc(doc(db!, "staging_products", product.id), {
                "ai_data.variant_images.base": [...existingCandidates, newCandidate],
                enrichment_message: "Manual image uploaded. Click to select it."
            });

            setUploadState('idle');
            setUploadPreview(null);
        } catch (e) {
            console.error('Image upload failed:', e);
            alert('Failed to upload image. Please try again.');
            setUploadState('idle');
            setUploadPreview(null);
        }
    }, [product.sku, product.ai_data?.variant_images?.base, storage, db]);

    // Clipboard paste handler
    const handlePaste = useCallback((e: ClipboardEvent) => {
        if (expandedStep !== 'sourcing') return;
        const items = e.clipboardData?.items;
        if (!items) return;
        for (const item of Array.from(items)) {
            if (item.type.startsWith('image/')) {
                e.preventDefault();
                const file = item.getAsFile();
                if (file) handleImageUpload(file);
                break;
            }
        }
    }, [expandedStep, handleImageUpload]);

    useEffect(() => {
        document.addEventListener('paste', handlePaste);
        return () => document.removeEventListener('paste', handlePaste);
    }, [handlePaste]);


    return (
        <>
            <aside className="w-[600px] shrink-0 bg-white border-l border-zinc-200 flex flex-col relative z-20 transition-all duration-300 shadow-sm">
                {/* Header */}
                <div className="h-14 border-b border-zinc-200 px-4 flex items-center justify-between bg-zinc-50 shrink-0">
                    <div className="flex flex-col">
                        <span className="text-[10px] font-mono text-zinc-500">[{product.sku}]</span>
                        <span className="text-sm font-medium text-zinc-900 truncate max-w-[450px]" title={product.pylon_data?.name || "Unknown Product"}>
                            {product.pylon_data?.name || "Unknown Product"}
                        </span>
                    </div>
                    <Button variant="ghost" size="sm" onClick={onClose} className="h-8 text-xs text-zinc-500 hover:text-zinc-900">
                        <X className="w-4 h-4" />
                    </Button>
                </div>

                <div className="flex-1 overflow-auto p-4 space-y-4 bg-zinc-50/50">

                    {/* Global Status Message */}
                    {product.enrichment_message && (
                        <div className="bg-white px-3 py-2 rounded-md border border-zinc-200 text-xs text-zinc-600 shadow-sm flex items-start gap-2 max-w-full overflow-hidden">
                            <Settings2 className="w-4 h-4 text-zinc-400 mt-0.5 shrink-0" />
                            <span className="leading-relaxed break-words whitespace-pre-wrap flex-1 min-w-0">{product.enrichment_message}</span>
                        </div>
                    )}

                    {/* Vertical Stepper */}
                    <div className="space-y-3 relative pl-2">
                        {/* Visual Line */}
                        <div className="absolute left-[20px] top-6 bottom-6 w-px bg-zinc-200 z-0" />

                        {steps.map((step, idx) => {
                            const state = getStepState(step.id);
                            const isExpanded = expandedStep === step.id;
                            const isInteractable = state !== 'pending';

                            return (
                                <div key={step.id} className="relative z-10">
                                    {/* Step Header (Clickable if interactable) */}
                                    <div
                                        className={cn(
                                            "flex items-center gap-3 p-2 rounded-md transition-colors",
                                            isInteractable ? "cursor-pointer hover:bg-zinc-100/50" : "opacity-50 grayscale",
                                            isExpanded && "bg-white shadow-sm border border-zinc-200"
                                        )}
                                        onClick={() => isInteractable && setExpandedStep(isExpanded ? null : step.id)}
                                    >
                                        {/* Icon Indicator */}
                                        <div className={cn(
                                            "w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold border-2 shrink-0 bg-white",
                                            state === 'complete' ? "border-emerald-500 text-emerald-600" :
                                                state === 'review' ? "border-amber-500 text-amber-600" :
                                                    state === 'loading' ? "border-blue-500 text-blue-600" :
                                                        "border-zinc-300 text-zinc-400"
                                        )}>
                                            {state === 'complete' ? <CheckCircle2 className="w-3.5 h-3.5" /> :
                                                state === 'review' ? <AlertCircle className="w-3.5 h-3.5" /> :
                                                    state === 'loading' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> :
                                                        (idx + 1)}
                                        </div>

                                        {/* Title */}
                                        <div className="flex-1 min-w-0">
                                            <h4 className="text-sm font-semibold text-zinc-900">{step.title}</h4>
                                            <p className="text-[10px] text-zinc-500 truncate">{step.description}</p>
                                        </div>
                                    </div>

                                    {/* Step Content Body (Expanded View) */}
                                    {isExpanded && isInteractable && (
                                        <div className="ml-[34px] mt-2 mb-4 p-4 bg-white border border-zinc-200 rounded-lg shadow-sm space-y-4 animate-in fade-in slide-in-from-top-2">

                                            {/* --- RAW STEP --- */}
                                            {step.id === 'raw' && (
                                                <div className="space-y-4">
                                                    {product.status === ProductState.NEEDS_MANUAL_DATA && (
                                                        <div className="flex flex-col gap-3 p-3 bg-amber-50 rounded text-amber-800 text-xs border border-amber-200 max-w-full overflow-hidden">
                                                            <div className="flex flex-col gap-2 mt-2 mb-2">
                                                                <div className="flex items-start gap-2">
                                                                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
                                                                    <div className="flex-1 min-w-0">
                                                                        <p className="font-semibold break-words">Data Unsearchable</p>
                                                                        <p className="mt-0.5 text-amber-700 break-words">
                                                                            This product was blocked by the Gatekeeper because its ERP name is too generic to run automated Google Search enrichment (Score: {Math.round((product.ai_data?.searchability_score || 0) * 100)}%). Select a smart AI suggestion below or provide a more specific search term manually here.
                                                                        </p>
                                                                    </div>
                                                                </div>

                                                                {/* AI Search Suggestions Grid */}
                                                                {product.ai_data?.search_suggestions && product.ai_data.search_suggestions.length > 0 && (
                                                                    <div className="flex flex-col gap-2 mt-3">
                                                                        <p className="text-[10px] font-bold text-amber-800/80 uppercase tracking-widest pl-1">AI Suggestions</p>
                                                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                                                                            {product.ai_data.search_suggestions.map((sug, idx) => (
                                                                                <Button
                                                                                    key={idx}
                                                                                    variant="outline"
                                                                                    className="h-auto min-h-[56px] py-2 px-3 flex flex-col items-start justify-center bg-white/70 border-amber-300 shadow-sm hover:bg-amber-100 hover:border-amber-400 hover:shadow transition-all text-left whitespace-normal leading-tight"
                                                                                    onClick={async () => {
                                                                                        if (!db) return;
                                                                                        try {
                                                                                            await updateDoc(doc(db, "staging_products", product.id), {
                                                                                                "search_query": sug.term.trim(),
                                                                                                "status": ProductState.GENERATING_METADATA,
                                                                                                "enrichment_message": "Suggestion selected. Resuming pipeline..."
                                                                                            });
                                                                                        } catch (e) {
                                                                                            console.error(e);
                                                                                            alert("Failed to update search query and resume pipeline.");
                                                                                        }
                                                                                    }}
                                                                                >
                                                                                    <span className="text-zinc-900 font-semibold text-xs inline-block pb-0.5 truncate w-full" title={sug.term}>{sug.term}</span>
                                                                                    <span className="text-[10px] text-amber-700/80 font-medium">{Math.round(sug.confidence * 100)}% Match</span>
                                                                                </Button>
                                                                            ))}
                                                                        </div>
                                                                    </div>
                                                                )}
                                                            </div>

                                                            <div className="flex items-center gap-2 mt-1 relative pt-3 border-t border-amber-200/50">
                                                                <div className="absolute -top-[9px] left-3 bg-amber-50 px-2 text-[10px] text-amber-600/60 font-medium tracking-wide">OR ENTER MANUALLY</div>
                                                                <Input 
                                                                    value={manualSearchQuery} 
                                                                    onChange={e => setManualSearchQuery(e.target.value)} 
                                                                    placeholder="e.g. HB Body 980 Primer Grey 400ml" 
                                                                    className="flex-1 h-9 bg-white border-amber-300 focus-visible:ring-amber-500 placeholder:text-amber-300 shadow-sm"
                                                                />
                                                                <Button 
                                                                    size="sm" 
                                                                    className="h-9 px-4 bg-amber-600 hover:bg-amber-700 text-white shadow-sm font-medium"
                                                                    disabled={!manualSearchQuery.trim() || manualSearchQuery.trim() === product.pylon_data?.name}
                                                                    onClick={async () => {
                                                                        if (!db) return;
                                                                        try {
                                                                            await updateDoc(doc(db, "staging_products", product.id), {
                                                                                "search_query": manualSearchQuery.trim(),
                                                                                "status": ProductState.GENERATING_METADATA,
                                                                                "enrichment_message": "Manual search term provided. Resuming pipeline..."
                                                                            });
                                                                        } catch (e) {
                                                                            console.error(e);
                                                                            alert("Failed to update search query and resume pipeline.");
                                                                        }
                                                                    }}
                                                                >
                                                                    <CheckCircle2 className="w-4 h-4 mr-2" /> Quickfix
                                                                </Button>
                                                            </div>
                                                        </div>
                                                    )}
                                                    {product.status === ProductState.IGNORED && (
                                                        <div className="flex items-start gap-2 p-2 bg-zinc-50 rounded text-zinc-600 text-xs border border-zinc-200 max-w-full overflow-hidden">
                                                            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-zinc-400" />
                                                            <div className="flex-1 min-w-0 break-words">
                                                                <strong>Ignored Item</strong> - This item was flagged as non-retail (e.g. shipping fees, services) by the Gatekeeper. It will not be processed further.
                                                            </div>
                                                        </div>
                                                    )}
                                                    <div className="space-y-2">
                                                        <h3 className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Pylon Source Data</h3>
                                                        <div className="bg-zinc-50 rounded-md border border-zinc-200 p-2 text-[10px] font-mono text-zinc-500 whitespace-pre-wrap overflow-x-auto max-h-[150px]">
                                                            {JSON.stringify(product.pylon_data, null, 2)}
                                                        </div>
                                                    </div>
                                                </div>
                                            )}

                                            {/* --- METADATA STEP --- */}
                                            {step.id === 'metadata' && (
                                                <div className="space-y-4">
                                                    {/* Alerts */}
                                                    {product.status === ProductState.FAILED && getStepState('metadata') === 'review' && (
                                                        <div className="flex items-start gap-2 p-2 bg-red-50 rounded text-red-800 text-xs border border-red-200 max-w-full overflow-hidden">
                                                            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
                                                            <p className="flex-1 min-w-0 break-words"><strong>Generation Failed</strong> - The pipeline encountered an error while processing metadata.</p>
                                                        </div>
                                                    )}
                                                    {product.status === ProductState.NEEDS_METADATA_REVIEW && (
                                                        <div className="flex items-start gap-2 p-2 bg-amber-50 rounded text-amber-800 text-xs border border-amber-200 max-w-full overflow-hidden">
                                                            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
                                                            <p className="flex-1 min-w-0 break-words"><strong>Low Confidence ({Math.round((product.ai_data?.confidence_score || 0) * 100)}%)</strong> - Please review.</p>
                                                        </div>
                                                    )}

                                                    {/* QA Reasoning Banner */}
                                                    {product.ai_data?.qa_reasoning && flaggedFields.length > 0 && (
                                                        <div className="flex flex-col gap-2 p-2 bg-amber-50 rounded text-amber-800 text-xs border border-amber-200 max-w-full overflow-hidden">
                                                            <div className="flex items-start gap-2">
                                                                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
                                                                <div className="flex-1 min-w-0">
                                                                    <p className="font-semibold break-words">QA Review ({Math.round((product.ai_data?.confidence_score || 0) * 100)}% confidence)</p>
                                                                    <p className="mt-0.5 text-amber-700 break-words">{product.ai_data.qa_reasoning}</p>
                                                                </div>
                                                            </div>
                                                            {product.ai_data.qa_suggestions && Object.keys(product.ai_data.qa_suggestions).length > 0 && (
                                                                <div className="flex justify-end border-t border-amber-200/50 pt-2 mt-1">
                                                                    <Button size="sm" onClick={handleApplyQASuggestions} className="h-7 text-[10px] bg-amber-600 hover:bg-amber-700 text-white shadow-sm font-medium px-3">
                                                                        <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" /> Apply Suggestions ✨
                                                                    </Button>
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}

                                                    <div className="space-y-3">
                                                        <div className={cn("space-y-1", isFlagged('title') && "pl-2 border-l-2 border-amber-400")}>
                                                            <label className="text-[10px] font-bold text-zinc-500 uppercase flex items-center gap-1.5">
                                                                Title
                                                                {isFlagged('title') && <span className="w-1.5 h-1.5 bg-amber-400 rounded-full" />}
                                                            </label>
                                                            <Input value={aiTitle} onChange={e => setAiTitle(e.target.value)} className="h-8 text-xs" />
                                                        </div>
                                                        <div className={cn("space-y-1", isFlagged('brand') && "pl-2 border-l-2 border-amber-400")}>
                                                            <label className="text-[10px] font-bold text-zinc-500 uppercase flex items-center gap-1.5">
                                                                Brand
                                                                {isFlagged('brand') && <span className="w-1.5 h-1.5 bg-amber-400 rounded-full" />}
                                                            </label>
                                                            <Input value={aiBrand} onChange={e => setAiBrand(e.target.value)} className="h-8 text-xs" />
                                                        </div>
                                                        <div className={cn("space-y-1", isFlagged('type') && "pl-2 border-l-2 border-amber-400")}>
                                                            <label className="text-[10px] font-bold text-zinc-500 uppercase flex items-center gap-1.5">
                                                                Type
                                                                {isFlagged('type') && <span className="w-1.5 h-1.5 bg-amber-400 rounded-full" />}
                                                            </label>
                                                            <div className="flex items-center gap-3">
                                                                <div className="relative w-12 h-12 shrink-0">
                                                                    <NextImage
                                                                        src={getCategoryImage(aiType)}
                                                                        alt={aiType}
                                                                        fill
                                                                        className="object-contain drop-shadow-sm"
                                                                    />
                                                                </div>
                                                                <select
                                                                    value={aiType}
                                                                    onChange={e => setAiType(e.target.value)}
                                                                    className="flex h-8 w-full items-center justify-between rounded-md border border-zinc-200 bg-white px-3 py-1 text-xs ring-offset-white focus:outline-none focus:ring-1 focus:ring-zinc-950"
                                                                >
                                                                    <option value="">Επιλέξτε Τύπο</option>
                                                                    {[
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
                                                                    ].map(cat => (
                                                                        <option key={cat} value={cat}>{cat}</option>
                                                                    ))}
                                                                </select>
                                                            </div>
                                                        </div>
                                                        <div className={cn("space-y-1", isFlagged('category') && "pl-2 border-l-2 border-amber-400")}>
                                                            <label className="text-[10px] font-bold text-zinc-500 uppercase flex items-center gap-1.5">
                                                                Project Category
                                                                {isFlagged('category') && <span className="w-1.5 h-1.5 bg-amber-400 rounded-full" />}
                                                            </label>
                                                            <div className="flex items-center gap-3">
                                                                <select
                                                                    value={aiCategory}
                                                                    onChange={e => setAiCategory(e.target.value)}
                                                                    className="flex h-8 w-full items-center justify-between rounded-md border border-zinc-200 bg-white px-3 py-1 text-xs ring-offset-white focus:outline-none focus:ring-1 focus:ring-zinc-950"
                                                                >
                                                                    <option value="">Επιλέξτε Κατηγορία</option>
                                                                    {[
                                                                        "Αυτοκίνητο",
                                                                        "Ναυτιλιακά",
                                                                        "Οικοδομικά",
                                                                        "Ειδικές Εφαρμογές"
                                                                    ].map(cat => (
                                                                        <option key={cat} value={cat}>{cat}</option>
                                                                    ))}
                                                                </select>
                                                            </div>
                                                        </div>
                                                        <div className={cn("space-y-1", isFlagged('description') && "pl-2 border-l-2 border-amber-400")}>
                                                            <label className="text-[10px] font-bold text-zinc-500 uppercase flex items-center gap-1.5">
                                                                Description
                                                                {isFlagged('description') && <span className="w-1.5 h-1.5 bg-amber-400 rounded-full" />}
                                                            </label>
                                                            <Textarea value={aiDesc} onChange={e => setAiDesc(e.target.value)} className="min-h-[160px] text-xs resize-y" />
                                                        </div>
                                                        <div className="space-y-1">
                                                            <label className="text-[10px] font-bold text-zinc-500 uppercase">Tags</label>
                                                            <div className="flex flex-wrap gap-2 mb-2">
                                                                {aiTags.map((tag, i) => (
                                                                    <span key={i} className="inline-flex items-center gap-1 bg-zinc-100 px-2 py-1 rounded text-[10px] font-medium text-zinc-700 border border-zinc-200">
                                                                        {tag}
                                                                        <button onClick={() => setAiTags(aiTags.filter((_, idx) => idx !== i))} className="text-zinc-400 hover:text-red-500"><X className="w-3 h-3" /></button>
                                                                    </span>
                                                                ))}
                                                            </div>
                                                            <Input
                                                                placeholder="Type and press enter to add tag..."
                                                                className="h-8 text-xs focus-visible:ring-1"
                                                                onKeyDown={e => {
                                                                    if (e.key === 'Enter') {
                                                                        e.preventDefault();
                                                                        const val = e.currentTarget.value.trim();
                                                                        if (val && !aiTags.includes(val)) {
                                                                            setAiTags([...aiTags, val]);
                                                                            e.currentTarget.value = '';
                                                                        }
                                                                    }
                                                                }}
                                                            />
                                                        </div>
                                                        <div className="space-y-2 pt-2 border-t border-zinc-100">
                                                            <label className="text-[10px] font-bold text-zinc-500 uppercase">Technical Specs</label>
                                                            <div className="grid grid-cols-2 gap-3 bg-zinc-50/50 p-3 rounded-md border border-zinc-100">
                                                                {[
                                                                    { key: 'chemical_base', label: 'Chemical Base', options: ["Ακρυλικό", "Σμάλτο", "Λάκα", "Ουρεθάνη", "Εποξικό", "Νερού", "Διαλύτου", "Άλλο"] },
                                                                    { key: 'finish', label: 'Finish', options: ["Ματ", "Σατινέ", "Γυαλιστερό", "Υψηλής Γυαλάδας", "Σαγρέ/Ανάγλυφο", "Μεταλλικό", "Πέρλα", "Άλλο"] },
                                                                    { key: 'sequence_step', label: 'Sequence Step', options: ["Προετοιμασία/Καθαριστικό", "Αστάρι", "Ενισχυτικό Πρόσφυσης", "Βασικό Χρώμα", "Βερνίκι", "Γυαλιστικό", "Άλλο"] },
                                                                    { key: 'environment', label: 'Environment', options: ["Εσωτερικός Χώρος", "Εξωτερικός Χώρος", "Και τα δύο"] },
                                                                    { key: 'coverage', label: 'Coverage' },
                                                                    { key: 'drying_time', label: 'Drying Time' },
                                                                    { key: 'drying_time_touch', label: 'Drying Time Touch' },
                                                                    { key: 'recoat_window', label: 'Recoat Window' },
                                                                    { key: 'full_cure', label: 'Full Cure' },
                                                                    { key: 'weight_per_volume', label: 'Weight/Volume' },
                                                                    { key: 'dry_film_thickness', label: 'Dry Film Thickness' },
                                                                    { key: 'mixing_ratio', label: 'Mixing Ratio' },
                                                                    { key: 'pot_life', label: 'Pot Life' },
                                                                    { key: 'voc_level', label: 'VOC Level' },
                                                                    { key: 'spray_nozzle_type', label: 'Spray Nozzle' },
                                                                ].map(field => (
                                                                    <div key={field.key} className="space-y-1">
                                                                        <label className="text-[9px] font-semibold text-zinc-400 uppercase">{field.label}</label>
                                                                        {field.options ? (
                                                                            <select
                                                                                value={techSpecs[field.key] || ''}
                                                                                onChange={e => setTechSpecs({ ...techSpecs, [field.key]: e.target.value })}
                                                                                className="flex h-7 w-full items-center justify-between rounded-md border border-zinc-200 bg-white px-2 py-0 text-[10px] ring-offset-white focus:outline-none focus:ring-1 focus:ring-zinc-950"
                                                                            >
                                                                                <option value="">-- Επιλογή --</option>
                                                                                {field.options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                                                                            </select>
                                                                        ) : (
                                                                            <Input
                                                                                value={techSpecs[field.key] || ''}
                                                                                onChange={e => setTechSpecs({ ...techSpecs, [field.key]: e.target.value })}
                                                                                className="h-7 text-[10px] bg-white"
                                                                            />
                                                                        )}
                                                                    </div>
                                                                ))}

                                                                {/* Array Fields */}
                                                                {[
                                                                    { key: 'surface_suitability', label: 'Surface Suitability', options: ["Γυμνό Μέταλλο", "Πλαστικό", "Ξύλο", "Fiberglass", "Υπάρχον Χρώμα", "Σκουριά", "Αλουμίνιο", "Γαλβανιζέ", "Άλλο"] },
                                                                    { key: 'special_properties', label: 'Special Properties', options: ["Υψηλής Θερμοκρασίας", "Ανθεκτικό σε UV", "Αντισκωριακό", "2 Συστατικών", "1 Συστατικού"] },
                                                                    { key: 'application_method', label: 'Application Method', options: ["Σπρέι", "Πιστόλι Βαφής", "Πινέλο", "Ρολό", "Άλλο"] },
                                                                    { key: 'durability_features', label: 'Durability Features', options: ["Αντισκωριακό", "Πλενόμενο", "Αντοχή σε UV", "Αντοχή σε Χημικά", "Αντοχή σε Γρατζουνιές", "Άλλο"] }
                                                                ].map(field => (
                                                                    <div key={field.key} className="col-span-2 space-y-1 pt-1">
                                                                        <label className="text-[9px] font-semibold text-zinc-400 uppercase">{field.label}</label>
                                                                        <div className="flex flex-wrap gap-1.5 mb-1.5">
                                                                            {(Array.isArray(techSpecs[field.key]) ? techSpecs[field.key] : []).map((val: string, i: number) => (
                                                                                <span key={i} className="inline-flex items-center gap-1 bg-white px-1.5 py-0.5 rounded text-[9px] font-medium text-zinc-600 border border-zinc-200">
                                                                                    {val}
                                                                                    <button onClick={() => {
                                                                                        const arr = [...(techSpecs[field.key] || [])];
                                                                                        arr.splice(i, 1);
                                                                                        setTechSpecs({ ...techSpecs, [field.key]: arr });
                                                                                    }} className="text-zinc-400 hover:text-red-500 cursor-pointer flex items-center justify-center"><X className="w-2.5 h-2.5 pointer-events-none" /></button>
                                                                                </span>
                                                                            ))}
                                                                        </div>
                                                                        <select
                                                                            value=""
                                                                            onChange={e => {
                                                                                const val = e.target.value;
                                                                                if (val) {
                                                                                    const arr = [...(techSpecs[field.key] || [])];
                                                                                    if (!arr.includes(val)) {
                                                                                        arr.push(val);
                                                                                        setTechSpecs({ ...techSpecs, [field.key]: arr });
                                                                                    }
                                                                                }
                                                                            }}
                                                                            className="flex h-7 w-full items-center justify-between rounded-md border border-zinc-200 bg-white px-2 py-0 text-[10px] text-zinc-500 ring-offset-white focus:outline-none focus:ring-1 focus:ring-zinc-950"
                                                                        >
                                                                            <option value="">+ Προσθήκη / Add {field.label}</option>
                                                                            {field.options.filter(opt => !(techSpecs[field.key] || []).includes(opt)).map(opt => (
                                                                                <option key={opt} value={opt}>{opt}</option>
                                                                            ))}
                                                                        </select>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {/* Actions */}
                                                    <div className="flex gap-2 pt-2 border-t border-zinc-100 mt-4">
                                                        <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={() => handleRegenerate('metadata')}>
                                                            <RotateCcw className="w-3 h-3 mr-1.5" /> Reroll
                                                        </Button>
                                                        {(getStepState('metadata') === 'review' || product.status === ProductState.FAILED || isMetadataDirty) && (
                                                            <Button size="sm" className="flex-1 bg-zinc-900 text-white hover:bg-zinc-800 text-xs shadow-sm" onClick={handleSaveMetadata}>
                                                                <CheckCircle2 className="w-3 h-3 mr-1.5" /> 
                                                                {getStepState('metadata') === 'complete' ? "Save Changes" : "Save & Resume"}
                                                            </Button>
                                                        )}
                                                    </div>
                                                </div>
                                            )}

                                            {/* --- VARIANTS STEP --- */}
                                            {step.id === 'variants' && (
                                                <div className="space-y-4">
                                                    {/* Variants Editor - Grouped by Axis */}
                                                    <div className="space-y-2">
                                                        <div className="flex items-center justify-between">
                                                            <label className="text-[10px] font-bold text-zinc-500 uppercase flex items-center gap-1.5">
                                                                Variants ({variants.length})
                                                            </label>
                                                            <div className="flex items-center gap-2">
                                                                <div className="flex items-center gap-1 bg-zinc-100 rounded px-1.5 h-6 border border-zinc-200">
                                                                    <span className="text-[9px] font-semibold text-zinc-500">BULK €:</span>
                                                                    <Input type="number" step="0.01" className="h-4 w-12 text-[10px] p-0 bg-transparent border-none focus-visible:ring-0 shadow-none text-right" placeholder="0.00" onBlur={(e) => {
                                                                        const val = parseFloat(e.target.value);
                                                                        if (!isNaN(val)) {
                                                                            setVariants(variants.map(v => ({ ...v, price: val })));
                                                                            e.target.value = '';
                                                                        }
                                                                    }} />
                                                                </div>
                                                                <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => setVariants([...variants, { sku_suffix: '', variant_name: 'New Option', option1_name: 'Χρώμα', option1_value: '', price: product.pylon_data?.price_retail || 0 }])}>
                                                                    <Plus className="w-3 h-3 mr-1" /> Add Variant
                                                                </Button>
                                                            </div>
                                                        </div>
                                                        <div className="space-y-3 max-h-[350px] overflow-y-auto pr-1">
                                                            {/* Group variants by axis */}
                                                            {(() => {
                                                                const axisGroups: Record<string, { axisName: string, items: { variant: any, originalIndex: number }[] }> = {};
                                                                variants.forEach((v, i) => {
                                                                    const axisParts = [];
                                                                    if (v.option1_name) axisParts.push(v.option1_name);
                                                                    if (v.option2_name) axisParts.push(v.option2_name);
                                                                    if (v.option3_name) axisParts.push(v.option3_name);
                                                                    const axis = axisParts.length > 0 ? axisParts.join(" + ") : 'Ungrouped';
                                                                    
                                                                    if (!axisGroups[axis]) axisGroups[axis] = { axisName: axis, items: [] };
                                                                    axisGroups[axis].items.push({ variant: v, originalIndex: i });
                                                                });

                                                                return Object.values(axisGroups).map(group => (
                                                                    <div key={group.axisName} className="space-y-1.5">
                                                                        <div className="flex items-center gap-2">
                                                                            <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider">{group.axisName}</span>
                                                                            <span className="text-[9px] bg-zinc-100 text-zinc-500 px-1.5 py-0.5 rounded-full">{group.items.length}</span>
                                                                        </div>
                                                                        {group.items.map(({ variant: v, originalIndex: i }) => {
                                                                            const numOptions = (v.option1_name ? 1 : 0) + (v.option2_name ? 1 : 0) + (v.option3_name ? 1 : 0);
                                                                            const cols = numOptions === 3 ? '1fr 1fr 1fr 1fr 65px' : numOptions === 2 ? '1fr 1fr 1fr 65px' : '1fr 1fr 65px';
                                                                            
                                                                            return (
                                                                            <div key={i} className="flex items-center gap-2 p-2 bg-zinc-50 border border-zinc-200 rounded-md">
                                                                                <div className="grid gap-2 flex-1" style={{ gridTemplateColumns: cols }}>
                                                                                    <Input value={v.sku_suffix} onChange={e => { const nv = [...variants]; nv[i].sku_suffix = e.target.value; setVariants(nv); }} placeholder="SKU / Suffix" className="h-7 text-[10px] font-mono" />
                                                                                    
                                                                                    {v.option1_name && (
                                                                                        <Input value={v.option1_value || ''} onChange={e => {
                                                                                            const nv = [...variants]; nv[i].option1_value = e.target.value; setVariants(nv);
                                                                                        }} placeholder={v.option1_name} title={v.option1_name} className="h-7 text-[10px]" />
                                                                                    )}
                                                                                    
                                                                                    {v.option2_name && (
                                                                                        <Input value={v.option2_value || ''} onChange={e => {
                                                                                            const nv = [...variants]; nv[i].option2_value = e.target.value; setVariants(nv);
                                                                                        }} placeholder={v.option2_name} title={v.option2_name} className="h-7 text-[10px]" />
                                                                                    )}
                                                                                    
                                                                                    {v.option3_name && (
                                                                                        <Input value={v.option3_value || ''} onChange={e => {
                                                                                            const nv = [...variants]; nv[i].option3_value = e.target.value; setVariants(nv);
                                                                                        }} placeholder={v.option3_name} title={v.option3_name} className="h-7 text-[10px]" />
                                                                                    )}

                                                                                    {(!v.option1_name && !v.option2_name && !v.option3_name) && (
                                                                                        <Input value={v.option1_value || ''} onChange={e => {
                                                                                            const nv = [...variants]; nv[i].option1_value = e.target.value; setVariants(nv);
                                                                                        }} placeholder="Option Value" className="h-7 text-[10px]" />
                                                                                    )}

                                                                                    <div className="relative">
                                                                                        <span className="absolute left-2 text-[10px] text-zinc-400 top-1/2 -translate-y-1/2">€</span>
                                                                                        <Input type="number" step="0.01" value={v.price ?? ''} onChange={e => {
                                                                                            const nv = [...variants];
                                                                                            nv[i].price = parseFloat(e.target.value) || 0;
                                                                                            setVariants(nv);
                                                                                        }} className="h-7 text-[10px] pl-4 pr-1" placeholder="0.00" />
                                                                                    </div>
                                                                                </div>
                                                                                <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500 hover:text-red-700 hover:bg-red-50" onClick={() => {
                                                                                    const nv = [...variants]; nv.splice(i, 1); setVariants(nv);
                                                                                }}>
                                                                                    <Trash2 className="w-3 h-3" />
                                                                                </Button>
                                                                            </div>
                                                                        )})}
                                                                    </div>
                                                                ));
                                                            })()}
                                                        </div>
                                                    </div>

                                                    {/* Pylon Source Variants (read-only reference) */}
                                                    {product.pylon_data?.source_variants && product.pylon_data.source_variants.length > 0 && (
                                                        <div className="space-y-1 pt-2 border-t border-zinc-100">
                                                            <label className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider">Source Variants (Import)</label>
                                                            <div className="bg-zinc-50 rounded-md border border-zinc-200 p-2 text-[9px] font-mono text-zinc-500 whitespace-pre-wrap overflow-x-auto max-h-[100px]">
                                                                {product.pylon_data.source_variants.map((sv: any, i: number) => (
                                                                    <div key={i} className="flex gap-2">
                                                                        <span className="font-semibold">{sv.sku}</span>
                                                                        <span>{sv.name}</span>
                                                                        <span className="text-emerald-600">€{sv.price_retail}</span>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}

                                                    {/* Actions */}
                                                    <div className="flex gap-2 pt-2 border-t border-zinc-100 mt-4">
                                                        <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={() => handleRegenerate('variants')}>
                                                            <RotateCcw className="w-3 h-3 mr-1.5" /> Reroll Variants
                                                        </Button>
                                                        {(getStepState('variants') === 'complete' ? isVariantsDirty : true) && (
                                                            <Button size="sm" className="flex-1 bg-zinc-900 text-white hover:bg-zinc-800 text-xs shadow-sm" onClick={async () => {
                                                                if (!db) return;
                                                                try {
                                                                    const studioComplete = getStepState('studio') === 'complete';
                                                                    let payload: any = {
                                                                        "ai_data.variants": variants,
                                                                        enrichment_message: "Variants manually saved."
                                                                    };

                                                                    if (getStepState('variants') !== 'complete') {
                                                                        payload.status = ProductState.SOURCING_IMAGES;
                                                                        payload.enrichment_message = "Variants manually approved. Moving to Image Sourcing.";
                                                                    } else if (studioComplete && isVariantsDirty) {
                                                                        if (!confirm("Updating variants will clear existing generated visuals and reroll them. Proceed?")) return;
                                                                        payload.status = ProductState.GENERATING_STUDIO;
                                                                        payload["ai_data.generated_images"] = deleteField();
                                                                        payload["ai_data.images"] = deleteField();
                                                                        payload.enrichment_message = "Variants modified. Re-rendering visuals...";
                                                                    }

                                                                    await updateDoc(doc(db!, "staging_products", product.id), payload);
                                                                    if (getStepState('variants') === 'complete') alert("Variants saved successfully.");
                                                                } catch (e) {
                                                                    console.error(e);
                                                                    alert("Failed to save variants.");
                                                                }
                                                            }}>
                                                                <CheckCircle2 className="w-3 h-3 mr-1.5" /> 
                                                                {getStepState('variants') === 'complete' ? "Save Changes" : "Save & Continue"}
                                                            </Button>
                                                        )}
                                                    </div>
                                                </div>
                                            )}

                                            {/* --- SOURCING STEP --- */}
                                            {step.id === 'sourcing' && (
                                                <div className="space-y-4">
                                                    {/* Alerts */}
                                                    {product.status === ProductState.FAILED && getStepState('sourcing') === 'review' && (
                                                        <div className="flex items-start gap-2 p-2 bg-red-50 rounded text-red-800 text-xs border border-red-200 max-w-full overflow-hidden">
                                                            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
                                                            <p className="flex-1 min-w-0 break-words"><strong>Sourcing Failed</strong> - The pipeline failed while fetching or processing images. Please select a valid image manually.</p>
                                                        </div>
                                                    )}
                                                    {product.status === ProductState.NEEDS_IMAGE_REVIEW && (
                                                        <div className="flex items-start gap-2 p-2 bg-amber-50 rounded text-amber-800 text-xs border border-amber-200 max-w-full overflow-hidden">
                                                            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
                                                            <p className="flex-1 min-w-0 break-words">No valid source images were automatically identified. Please select one or provide a URL.</p>
                                                        </div>
                                                    )}

                                                    <div className="space-y-3">
                                                        {/* Scraped Candidates Grid */}
                                                        {((product.ai_data?.variant_images?.base && product.ai_data.variant_images.base.length > 0) || product.ai_data?.selected_images?.base) && (
                                                            <div className="space-y-1">
                                                                <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Source Image</label>
                                                                <div className="grid grid-cols-3 gap-2">
                                                                    {product.ai_data?.variant_images?.base?.map((img: any, i: number) => {
                                                                        const isSelected = product.ai_data?.selected_images?.base === img.url;
                                                                        return (
                                                                            <div key={i}
                                                                                className={cn(
                                                                                    "aspect-square bg-zinc-100 rounded border overflow-hidden cursor-pointer transition-all relative group",
                                                                                    isSelected ? "border-emerald-500 ring-2 ring-emerald-500 shadow-sm" : "border-zinc-200 hover:ring-2 hover:ring-zinc-300"
                                                                                )}
                                                                                onClick={() => handleApproveImage(img.url)}
                                                                            >
                                                                                 <img 
                                                                                    src={`${img.url}${img.url.includes('?') ? '&' : '?'}v=${typeof product.updated_at === 'object' ? product.updated_at.seconds : Date.now()}`} 
                                                                                    className={cn("w-full h-full object-cover", isSelected ? "" : "opacity-80 group-hover:opacity-100")} 
                                                                                />
                                                                                {/* Zoom icon — opens lightbox without selecting */}
                                                                                <button
                                                                                    className="absolute top-1 left-1 p-1 rounded bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/70 z-10"
                                                                                    onClick={(e) => { e.stopPropagation(); setLightboxSrc(img.url); }}
                                                                                >
                                                                                    <ZoomIn className="w-3 h-3" />
                                                                                </button>
                                                                                {isSelected ? (
                                                                                    <div className="absolute top-1 right-1 bg-emerald-500 rounded-full p-0.5 shadow-sm">
                                                                                        <CheckCircle2 className="w-3 h-3 text-white" />
                                                                                    </div>
                                                                                ) : (
                                                                                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                                                                        <span className="text-white text-[10px] font-medium px-2 py-1 bg-emerald-500/90 rounded border border-emerald-400">Select</span>
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                        );
                                                                    })}

                                                                    {product.ai_data?.selected_images?.base && (!product.ai_data?.variant_images?.base || !product.ai_data?.variant_images?.base?.some((img: any) => img.url === product.ai_data?.selected_images?.base)) && (
                                                                        <div
                                                                            className="aspect-square bg-zinc-100 rounded border border-emerald-500 ring-2 ring-emerald-500 shadow-sm overflow-hidden relative cursor-pointer group"
                                                                            onClick={() => setLightboxSrc(product.ai_data?.selected_images?.base || null)}
                                                                        >
                                                                             <img 
                                                                                src={`${product.ai_data?.selected_images?.base}${product.ai_data?.selected_images?.base?.includes('?') ? '&' : '?'}v=${typeof product.updated_at === 'object' ? product.updated_at.seconds : Date.now()}`} 
                                                                                className="w-full h-full object-cover" 
                                                                            />
                                                                            <div className="absolute top-1 right-1 bg-emerald-500 rounded-full p-0.5 shadow-sm">
                                                                                <CheckCircle2 className="w-3 h-3 text-white" />
                                                                            </div>
                                                                            <div className="absolute bottom-0 inset-x-0 bg-black/50 p-1 flex items-center justify-center">
                                                                                <span className="text-white text-[8px] font-medium">Uploaded</span>
                                                                            </div>
                                                                            <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                                                                <ZoomIn className="w-4 h-4 text-white" />
                                                                            </div>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        )}

                                                        {/* Image Upload Zone — Paste / Drop / Browse */}
                                                        <div className="space-y-1.5">
                                                            <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Upload Source Image</label>
                                                            <div
                                                                className={cn(
                                                                    "relative border-2 border-dashed rounded-lg p-4 text-center transition-all cursor-pointer group",
                                                                    isDragOver
                                                                        ? "border-amber-400 bg-amber-50/50"
                                                                        : "border-zinc-200 bg-zinc-50/50 hover:border-zinc-300 hover:bg-zinc-100/50",
                                                                    uploadState === 'uploading' && "pointer-events-none opacity-60"
                                                                )}
                                                                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(true); }}
                                                                onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(false); }}
                                                                onDrop={(e) => {
                                                                    e.preventDefault(); e.stopPropagation(); setIsDragOver(false);
                                                                    const file = e.dataTransfer.files[0];
                                                                    if (file) handleImageUpload(file);
                                                                }}
                                                                onClick={() => fileInputRef.current?.click()}
                                                            >
                                                                <input
                                                                    ref={fileInputRef}
                                                                    type="file"
                                                                    accept="image/*"
                                                                    className="hidden"
                                                                    onChange={(e) => {
                                                                        const file = e.target.files?.[0];
                                                                        if (file) handleImageUpload(file);
                                                                        e.target.value = ''; // Reset for same-file re-upload
                                                                    }}
                                                                />

                                                                {uploadState === 'uploading' && uploadPreview ? (
                                                                    <div className="flex flex-col items-center gap-2">
                                                                        <div className="relative w-20 h-20 rounded-md overflow-hidden border border-zinc-200">
                                                                            <img src={uploadPreview} className="w-full h-full object-cover" alt="Uploading..." />
                                                                            <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                                                                                <Loader2 className="w-5 h-5 text-white animate-spin" />
                                                                            </div>
                                                                        </div>
                                                                        <p className="text-[10px] text-zinc-500">Uploading...</p>
                                                                    </div>
                                                                ) : (
                                                                    <div className="flex flex-col items-center gap-2 py-2">
                                                                        <div className="w-10 h-10 rounded-full bg-zinc-100 group-hover:bg-zinc-200 flex items-center justify-center transition-colors">
                                                                            <Upload className="w-4 h-4 text-zinc-400 group-hover:text-zinc-600" />
                                                                        </div>
                                                                        <div>
                                                                            <p className="text-xs text-zinc-600 font-medium">
                                                                                Drop an image, <span className="text-zinc-900 underline underline-offset-2">browse</span>, or paste
                                                                            </p>
                                                                            <p className="text-[10px] text-zinc-400 mt-0.5 flex items-center justify-center gap-1">
                                                                                <Clipboard className="w-3 h-3" />
                                                                                <span>Ctrl+V to paste from clipboard</span>
                                                                            </p>
                                                                        </div>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {/* Actions */}
                                                    <div className="flex gap-2 pt-2 border-t border-zinc-100 mt-4">
                                                        <Button variant="outline" size="sm" className="w-full text-xs" onClick={() => handleRegenerate('sourcing')}>
                                                            <RotateCcw className="w-3 h-3 mr-1.5" /> Trigger Rescrape
                                                        </Button>
                                                    </div>
                                                </div>
                                            )}

                                            {/* --- STUDIO STEP --- */}
                                            {step.id === 'studio' && (
                                                <div className="space-y-4">
                                                    <div className="space-y-3">
                                                        {/* Generated Images Display */}
                                                        {/* Generated Images Display */}
                                                        {(() => {
                                                            const renders = product.ai_data?.generated_images
                                                                ? Object.entries(product.ai_data.generated_images).map(([k, v]) => ({ key: k, url: v as string }))
                                                                : product.ai_data?.images
                                                                    ? product.ai_data.images.map(img => ({ key: img.suffix, url: img.url }))
                                                                    : null;

                                                            if (renders && renders.length > 0) {
                                                                return (
                                                                    <div className="space-y-1">
                                                                        <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Final Renders</label>
                                                                        <div className="grid grid-cols-2 gap-3">
                                                                            {renders.map(({ key, url }) => (
                                                                                <div key={key} className="space-y-1 text-center">
                                                                                    <div
                                                                                        className="aspect-square bg-zinc-100 rounded-lg border border-zinc-200 overflow-hidden relative cursor-pointer group"
                                                                                        onClick={() => setLightboxSrc(url)}
                                                                                    >
                                                                                         <img 
                                                                                            src={`${url}${url.includes('?') ? '&' : '?'}v=${typeof product.updated_at === 'object' ? product.updated_at.seconds : Date.now()}`} 
                                                                                            className="w-full h-full object-cover" 
                                                                                        />
                                                                                        <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                                                                            <ZoomIn className="w-5 h-5 text-white" />
                                                                                        </div>
                                                                                    </div>
                                                                                    <span className="text-[10px] font-mono text-zinc-500 uppercase">{key}</span>
                                                                                </div>
                                                                            ))}
                                                                        </div>
                                                                    </div>
                                                                );
                                                            }

                                                            return (
                                                                <div className="h-24 border-2 border-dashed border-zinc-200 rounded-lg flex flex-col items-center justify-center text-zinc-400">
                                                                    <ImageIcon className="w-6 h-6 mb-1 opacity-50" />
                                                                    <span className="text-xs">No visuals generated yet</span>
                                                                </div>
                                                            );
                                                        })()}
                                                    </div>

                                                    {/* Actions */}
                                                    <div className="flex gap-2 pt-2 border-t border-zinc-100 mt-4">
                                                        <Button variant="outline" size="sm" className="w-full text-xs text-red-600 border-red-200 hover:bg-red-50 hover:border-red-300" onClick={() => handleRegenerate('studio')}>
                                                            <RotateCcw className="w-3 h-3 mr-1.5" /> Reject Renders & Reroll
                                                        </Button>
                                                    </div>
                                                </div>
                                            )}

                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Drawer Footer Actions */}
                <div className="p-4 pb-24 border-t border-red-100 bg-white shadow-sm shrink-0 z-10 w-full relative">
                    <Button variant="outline" className="w-full text-red-600 border-red-200 hover:bg-red-50 text-xs font-semibold h-9" onClick={() => {
                        if (confirm(`Irreversibly delete product ${product.sku}?`)) {
                            deleteDoc(doc(db!, "staging_products", product.id));
                            onClose();
                        }
                    }}>
                        Purge Product Record
                    </Button>
                </div>
            </aside>
            <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
        </>
    );
}
