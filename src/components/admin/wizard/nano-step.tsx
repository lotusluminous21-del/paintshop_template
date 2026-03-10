"use client";

import { useEffect, useState } from "react";
import { Sparkles, Loader2, CheckCircle2, ChevronLeft, ChevronRight, Wand2, ArrowRight, XCircle, RotateCcw, Layers, Image as ImageIcon, RefreshCw, PenTool, Trash2 } from "lucide-react";
import { WizardLayout } from "./wizard-layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import {
    WizardSidebarItem,
    SharedWizardHeader,
    SharedWizardFooter,
    WizardProduct
} from "./shared-wizard-components";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface Variant {
    sku_suffix: string;
    variant_name: string;
}

interface ProductData {
    sku: string;
    status: string;
    enrichment_message?: string;
    name: string;
    pylon_data?: {
        name: string;
    };
    ai_data?: {
        title_el?: string;
        variants?: Variant[];
        selected_images?: Record<string, string>;
        generated_images?: Record<string, string>; // suffix -> new_url
        images?: { url: string; suffix: string }[];
    };
}

interface NanoStepProps {
    products: ProductData[];
    onBack: () => void;
    onRetry: (sku: string) => void;
    onRemoveBg: (sku: string, mode?: "generated" | "source") => void;
    onStartStudio: (environment: string, model: string) => void;
    onRegenerate: (sku: string, environment: string, model: string) => void;
    onRegenerateAll: (environment: string, model: string) => void;
    onAbort: () => void;
    onComplete: () => void;
}

type Environment = "clean" | "realistic" | "styled";

export function NanoStep({ products, onBack, onRetry, onRemoveBg, onStartStudio, onRegenerate, onRegenerateAll, onAbort, onComplete }: NanoStepProps) {
    const [activeIndex, setActiveIndex] = useState(0);
    const [timestamp] = useState(() => Date.now());
    const [activeVariantSuffix, setActiveVariantSuffix] = useState<string>("base");
    const [lightboxImage, setLightboxImage] = useState<string | null>(null);

    useEffect(() => {
        setActiveVariantSuffix("base");
    }, [activeIndex]);
    const [environment, setEnvironment] = useState<Environment>(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('nano_banana_env');
            if (saved === 'clean' || saved === 'realistic' || saved === 'styled') return saved as Environment;
        }
        return 'styled';
    });

    const [generationModel, setGenerationModel] = useState<"gemini" | "imagen">(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('nano_banana_model');
            if (saved === 'gemini' || saved === 'imagen') return saved;
        }
        return 'gemini';
    });

    useEffect(() => {
        localStorage.setItem('nano_banana_env', environment);
    }, [environment]);

    useEffect(() => {
        localStorage.setItem('nano_banana_model', generationModel);
    }, [generationModel]);

    const activeProduct = products[activeIndex];

    const getProductOutputImages = (product: ProductData) => {
        if (!product?.ai_data) return [];

        let imageList: { suffix: string, url: string }[] = [];

        if (product.ai_data.images && product.ai_data.images.length > 0) {
            imageList = product.ai_data.images.map(img => ({ suffix: img.suffix, url: img.url }));
        } else if (product.ai_data.generated_images) {
            imageList = Object.entries(product.ai_data.generated_images).map(([k, v]) => ({ suffix: k, url: v as string }));
        }

        return imageList.map(img => {
            const buster = `?t=${timestamp}`;
            return {
                suffix: img.suffix,
                url: img.url.includes('studio_') ? `${img.url}${buster}` : img.url
            };
        }).sort((a, b) => a.suffix === 'base' ? -1 : b.suffix === 'base' ? 1 : a.suffix.localeCompare(b.suffix));
    };

    const outputImages = activeProduct ? getProductOutputImages(activeProduct) : [];

    let displayImage = null;
    if (outputImages.length > 0) {
        const found = outputImages.find(img => img.suffix === activeVariantSuffix);
        if (found) {
            displayImage = found.url;
        } else {
            displayImage = outputImages[0].url;
            if (activeVariantSuffix !== outputImages[0].suffix) {
                setActiveVariantSuffix(outputImages[0].suffix);
            }
        }
    }

    // Calculate overall progress
    const totalItems = products.length; // 1 image per product
    const completedItems = products.reduce((acc, p) => {
        return acc + (p.ai_data?.generated_images?.base ? 1 : 0);
    }, 0);
    const progressPercent = Math.round((completedItems / totalItems) * 100);

    const isAllProcessed = products.every(p =>
        p.status === 'PENDING_STUDIO_REVIEW' ||
        p.status === 'PENDING_BG_REMOVAL' ||
        p.status === 'APPROVED' ||
        p.status === 'ENRICHMENT_FAILED'
    );

    // Any items have generated images?
    const hasAnyGenerated = products.some(p => p.ai_data?.generated_images?.base);

    // Check if we are in the "Start" state
    const hasVisuals = products.some(p => p.ai_data?.generated_images?.base);
    const isReady = products.every(p => p.status === 'READY_FOR_STUDIO') && !hasVisuals;
    const isBatchGenerating = products.some(p => p.status === 'BATCH_GENERATING');

    const sidebarTitle = (
        <div className="space-y-4">
            <h3 className="font-bold text-zinc-900 flex items-center gap-2 text-[11px] uppercase tracking-wider px-1">
                <Wand2 className="w-3.5 h-3.5 text-zinc-600" />
                Studio Config
            </h3>

            {/* Compact Selectors Container */}
            <div className="space-y-3 px-1">
                {/* Model Selector - Horizontal */}
                <div className="space-y-1.5">
                    <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest pl-1">Engine</span>
                    <div className="grid grid-cols-2 gap-1 bg-zinc-100/50 p-1 rounded-sm border border-zinc-100">
                        <button
                            onClick={() => setGenerationModel("gemini")}
                            className={cn(
                                "py-1.5 px-2 rounded-md text-[10px] font-bold transition-all text-center flex items-center justify-center gap-1.5",
                                generationModel === "gemini"
                                    ? "bg-white text-zinc-700 shadow-sm"
                                    : "text-zinc-500 hover:text-zinc-700 hover:bg-white/50"
                            )}
                        >
                            <div className={cn("w-1.5 h-1.5 rounded-none", generationModel === "gemini" ? "bg-zinc-500" : "bg-zinc-400")} />
                            Gemini
                        </button>
                        <button
                            onClick={() => setGenerationModel("imagen")}
                            className={cn(
                                "py-1.5 px-2 rounded-md text-[10px] font-bold transition-all text-center flex items-center justify-center gap-1.5",
                                generationModel === "imagen"
                                    ? "bg-white text-zinc-700 shadow-sm"
                                    : "text-zinc-500 hover:text-zinc-700 hover:bg-white/50"
                            )}
                        >
                            <div className={cn("w-1.5 h-1.5 rounded-none", generationModel === "imagen" ? "bg-purple-500" : "bg-zinc-400")} />
                            Imagen
                        </button>
                    </div>
                </div>

                {/* Environment Selector - 3-column grid */}
                <div className="space-y-1.5">
                    <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest pl-1">Style</span>
                    <div className="grid grid-cols-3 gap-1 bg-zinc-100/50 p-1 rounded-sm border border-zinc-100">
                        <button
                            onClick={() => setEnvironment("clean")}
                            className={cn(
                                "py-2 rounded-md text-[9px] font-bold transition-all flex flex-col items-center gap-1",
                                environment === "clean"
                                    ? "bg-white text-zinc-700 shadow-sm"
                                    : "text-zinc-400 hover:text-zinc-600 hover:bg-white/50"
                            )}
                        >
                            <div className={cn("w-1 h-1 rounded-none", environment === "clean" ? "bg-zinc-500" : "bg-zinc-300")} />
                            Clean
                        </button>
                        <button
                            onClick={() => setEnvironment("realistic")}
                            className={cn(
                                "py-2 rounded-md text-[9px] font-bold transition-all flex flex-col items-center gap-1",
                                environment === "realistic"
                                    ? "bg-white text-zinc-700 shadow-sm"
                                    : "text-zinc-400 hover:text-zinc-600 hover:bg-white/50"
                            )}
                        >
                            <div className={cn("w-1 h-1 rounded-none", environment === "realistic" ? "bg-amber-500" : "bg-zinc-300")} />
                            Real
                        </button>
                        <button
                            onClick={() => setEnvironment("styled")}
                            className={cn(
                                "py-2 rounded-md text-[9px] font-bold transition-all flex flex-col items-center gap-1",
                                environment === "styled"
                                    ? "bg-white text-zinc-700 shadow-sm"
                                    : "text-zinc-400 hover:text-zinc-600 hover:bg-white/50"
                            )}
                        >
                            <div className={cn("w-1 h-1 rounded-none", environment === "styled" ? "bg-teal-500" : "bg-zinc-300")} />
                            Styled
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );

    const sidebarList = (
        <TooltipProvider>
            <div className="flex flex-col gap-1 px-2">
                {products.map((p, idx) => {
                    const status = p.status;
                    const isEnriching = status === 'PENDING_NANO_BANANA' || status.includes('GENERATING') || status === 'BATCH_GENERATING';
                    const isFailed = status === 'ENRICHMENT_FAILED';
                    const isBgRemoving = status === 'PENDING_BG_REMOVAL' || status === 'PENDING_SOURCE_BG_REMOVAL';

                    return (
                        <WizardSidebarItem
                            key={p.sku}
                            product={p as unknown as WizardProduct}
                            isActive={activeIndex === idx}
                            onClick={() => setActiveIndex(idx)}
                            statusIndicator={
                                status === 'BATCH_GENERATING' ? (
                                    <><Loader2 className="w-2.5 h-2.5 animate-spin text-zinc-400" /> Batch Processing...</>
                                ) : isEnriching ? (
                                    <><Loader2 className="w-2.5 h-2.5 animate-spin text-zinc-400" /> {p.enrichment_message?.replace("...", "") || "Rendering"}</>
                                ) : isBgRemoving ? (
                                    <><Loader2 className="w-2.5 h-2.5 animate-spin text-cyan-500" /> Removing BG...</>
                                ) : isFailed ? (
                                    <><XCircle className="w-2.5 h-2.5 text-red-500" /> Failed</>
                                ) : status === 'APPROVED' ? (
                                    <><CheckCircle2 className="w-2.5 h-2.5 text-green-500" /> Done</>
                                ) : status === 'PENDING_STUDIO_REVIEW' ? (
                                    <><Sparkles className="w-2.5 h-2.5 text-amber-500" /> Ready for Review</>
                                ) : status === 'READY_FOR_STUDIO' ? (
                                    <span className="text-zinc-300">Ready</span>
                                ) : "Queued"
                            }
                        />
                    );
                })}
            </div>
        </TooltipProvider>
    );

    const failedCount = products.filter(p => p.status === 'ENRICHMENT_FAILED').length;

    const mainContent = isReady ? (
        <div className="flex-1 flex flex-col items-center justify-center p-12 text-center h-full animate-in fade-in zoom-in duration-300">
            <div className="w-24 h-24 bg-gradient-to-br from-zinc-50 to-purple-50 rounded-none flex items-center justify-center mb-8 shadow-inner   ring-white/50">
                <Wand2 className="w-12 h-12 text-zinc-600" />
            </div>
            <h2 className="text-3xl font-bold text-zinc-900 mb-4 tracking-tight">Nano Banana Studio</h2>
            <p className="text-zinc-500 max-w-md mb-8 text-lg font-medium leading-relaxed">
                Generate professional product photography automatically.
            </p>

            <Button
                onClick={() => onStartStudio(environment, generationModel)}
                size="lg"
                className="bg-zinc-600 hover:bg-zinc-700 text-white h-12 px-8 rounded-none font-bold text-sm shadow-xl shadow-sm transition-all transform hover:scale-105"
            >
                <Wand2 className="w-4 h-4 mr-2" />
                Start Generation
            </Button>
        </div>
    ) : activeProduct ? (
        <div className="flex-1 flex flex-col h-full bg-zinc-50/30">
            {/* Live progress banner moved to footer */}

            {/* Product comparison view — always visible */}
            <div className="p-8 space-y-12 max-w-7xl mx-auto flex-1 w-full flex flex-col justify-center">
                <div className="space-y-6">
                    <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-2 justify-center">
                        <PenTool className="w-3 h-3" />
                        Studio Transformation
                    </h4>

                    <div className="grid grid-cols-2 gap-8 items-center max-w-5xl mx-auto w-full">
                        {/* Source */}
                        <div className="space-y-3 group relative">
                            <div className="relative aspect-square rounded-none overflow-hidden border-4 border-white bg-white shadow-xl shadow-sm transition-all group-hover:shadow-2xl group-hover:scale-[1.02]">
                                {activeProduct.ai_data?.selected_images?.base ? (
                                    <img
                                        src={`${activeProduct.ai_data.selected_images.base}${activeProduct.ai_data.selected_images.base.includes('studio_base.jpg') ? `?t=${timestamp}` : ''}`}
                                        alt="Source"
                                        className="w-full h-full object-cover cursor-pointer grayscale opacity-80 group-hover:grayscale-0 group-hover:opacity-100 transition-all duration-500"
                                        onClick={() => setLightboxImage(activeProduct.ai_data?.selected_images?.base ? `${activeProduct.ai_data.selected_images.base}?t=${timestamp}` : null)}
                                    />
                                ) : (
                                    <div className="w-full h-full bg-zinc-100 flex items-center justify-center">
                                        <ImageIcon className="w-12 h-12 text-zinc-300" />
                                    </div>
                                )}
                                <div className="absolute top-4 left-4 bg-white/90 text-zinc-900 text-[10px] font-bold px-3 py-1.5 rounded-none uppercase backdrop-blur-md shadow-sm flex items-center gap-2">
                                    Original Input
                                    {activeProduct.status === 'PENDING_SOURCE_BG_REMOVAL' && <Loader2 className="w-2.5 h-2.5 animate-spin text-zinc-600" />}
                                </div>

                                {activeProduct.status === 'PENDING_SOURCE_BG_REMOVAL' && (
                                    <div className="absolute inset-0 z-40 bg-white/60 backdrop-blur-[2px] flex flex-col items-center justify-center">
                                        <Loader2 className="w-10 h-10 text-zinc-600 animate-spin mb-3" />
                                        <Badge variant="secondary" className="bg-white/80 backdrop-blur-md text-zinc-900 shadow-sm animate-pulse">
                                            Removing Background...
                                        </Badge>
                                    </div>
                                )}

                                {/* Manual BG Removal for Source */}
                                {activeProduct.ai_data?.selected_images?.base && !['BATCH_GENERATING', 'PENDING_NANO_BANANA', 'PENDING_SOURCE_BG_REMOVAL'].includes(activeProduct.status) && (
                                    <div className="absolute inset-x-0 bottom-0 p-6 bg-gradient-to-t from-black/80 via-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-all translate-y-2 group-hover:translate-y-0 z-30">
                                        <Button
                                            size="sm"
                                            variant="secondary"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onRemoveBg(activeProduct.sku, "source");
                                            }}
                                            className="w-full bg-white/90 hover:bg-white text-zinc-900 border-0 text-[10px] font-bold uppercase"
                                        >
                                            <Layers className="w-3 h-3 mr-2" />
                                            Remove Background
                                        </Button>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Result */}
                        <div className="space-y-4 relative group">
                            <h5 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest text-center flex items-center justify-center gap-2">
                                Final Output <Badge className="rounded-none bg-zinc-100 text-zinc-600 px-1 border-0">{outputImages.length}</Badge>
                            </h5>

                            <div className="absolute -left-6 top-[calc(50%+1rem)] -translate-y-1/2 z-10 bg-white shadow-sm rounded-none p-1.5 border border-zinc-200 text-zinc-400">
                                <ArrowRight className="w-4 h-4" />
                            </div>

                            <div className={cn(
                                "relative aspect-square rounded-sm overflow-hidden border-2 bg-white transition-all shadow-md",
                                displayImage
                                    ? "border-white shadow-sm  ring-green-50/30"
                                    : activeProduct.status === 'ENRICHMENT_FAILED'
                                        ? "border-red-100 shadow-sm"
                                        : "border-white shadow-sm   animate-pulse"
                            )}>
                                {displayImage ? (
                                    <>
                                        <img
                                            src={displayImage}
                                            alt="Generated"
                                            className="w-full h-full object-contain cursor-pointer transition-transform duration-700 hover:scale-105"
                                            onClick={() => setLightboxImage(displayImage)}
                                        />

                                        {activeVariantSuffix !== "base" && (
                                            <div className="absolute top-3 left-3 bg-zinc-900/90 text-white shadow-sm border border-zinc-700 backdrop-blur-sm px-2 py-0.5 z-20 flex items-center gap-1.5">
                                                <span className="text-[10px] font-bold uppercase tracking-widest">#{activeVariantSuffix}</span>
                                            </div>
                                        )}

                                        {/* BG Removal Loading Overlay */}
                                        {activeProduct.status === 'PENDING_BG_REMOVAL' && (
                                            <div className="absolute inset-0 z-40 bg-white/60 backdrop-blur-[2px] flex flex-col items-center justify-center">
                                                <Loader2 className="w-10 h-10 text-zinc-600 animate-spin mb-3" />
                                                <Badge variant="secondary" className="bg-white/80 backdrop-blur-md text-zinc-900 shadow-sm animate-pulse">
                                                    Removing Background...
                                                </Badge>
                                            </div>
                                        )}

                                        <Button
                                            size="icon"
                                            variant="secondary"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setLightboxImage(displayImage);
                                            }}
                                            className="absolute top-4 right-4 rounded-none opacity-0 group-hover:opacity-100 transition-opacity bg-black/50 hover:bg-black/70 text-white border-0 z-20"
                                        >
                                            <ImageIcon className="w-4 h-4" />
                                        </Button>

                                        {!['BATCH_GENERATING', 'PENDING_NANO_BANANA', 'PENDING_STUDIO_GENERATION'].some(s => activeProduct.status.includes(s)) && (
                                            <div className="absolute inset-x-0 bottom-0 p-6 bg-gradient-to-t from-black/80 via-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-all translate-y-2 group-hover:translate-y-0 grid grid-cols-1 gap-3 z-30">
                                                <Button
                                                    size="sm"
                                                    onClick={() => onRegenerate(activeProduct.sku, environment, generationModel)}
                                                    className="w-full bg-zinc-600 hover:bg-zinc-700 text-white border-0 text-[10px] font-bold uppercase"
                                                >
                                                    <RotateCcw className="w-3 h-3 mr-2" />
                                                    Retry
                                                </Button>
                                            </div>
                                        )}
                                    </>
                                ) : activeProduct.status === 'ENRICHMENT_FAILED' ? (
                                    <div className="w-full h-full flex flex-col items-center justify-center text-red-500 p-8 text-center bg-red-50/20">
                                        <XCircle className="w-10 h-10 mb-4" />
                                        <span className="text-[10px] font-bold uppercase tracking-widest mb-2 text-red-500">Generation Failed</span>
                                        <XCircle className="w-12 h-12 mb-4 drop-shadow-sm" />
                                        <span className="text-xs font-bold uppercase tracking-widest mb-2">Generation Failed</span>
                                        <p className="text-xs text-red-400 mb-6 max-w-[200px] leading-relaxed">{activeProduct.enrichment_message}</p>
                                        <Button
                                            size="sm"
                                            variant="destructive"
                                            onClick={() => onRetry(activeProduct.sku)}
                                            className="rounded-none font-bold"
                                        >
                                            <RotateCcw className="w-3.5 h-3.5 mr-2" /> Retry Generation
                                        </Button>
                                    </div>
                                ) : (
                                    <div className="flex flex-col items-center justify-center h-full text-center space-y-6">
                                        <div className="relative">
                                            {isBatchGenerating || activeProduct.status === 'PENDING_NANO_BANANA' || activeProduct.status.includes('GENERATING') ? (
                                                <>
                                                    <div className="absolute inset-0 bg-zinc-500/20 blur-2xl rounded-none animate-pulse" />
                                                    <Loader2 className="w-12 h-12 text-zinc-500 animate-[spin_3s_linear_infinite] relative z-10" />
                                                </>
                                            ) : (
                                                <div className="w-16 h-16 bg-zinc-50 rounded-none flex items-center justify-center border border-zinc-100 shadow-inner">
                                                    <Wand2 className="w-8 h-8 text-zinc-300" />
                                                </div>
                                            )}
                                        </div>

                                        <div className="space-y-4">
                                            <div className="space-y-1">
                                                <h4 className="font-bold text-zinc-900 uppercase tracking-tight text-sm">Studio Transformation</h4>
                                                <p className="text-[10px] text-zinc-400 font-medium">
                                                    {isBatchGenerating || activeProduct.status === 'PENDING_NANO_BANANA' || activeProduct.status.includes('GENERATING')
                                                        ? "AI is synthesizing your studio shot..."
                                                        : "Product ready for studio synthesis."}
                                                </p>
                                            </div>

                                            {(isBatchGenerating || activeProduct.status === 'PENDING_NANO_BANANA' || activeProduct.status.includes('GENERATING')) ? (
                                                <div className="flex flex-col gap-2 w-full max-w-[200px] mx-auto text-left">
                                                    {[
                                                        { label: "Normalization", key: "Optimizing frame" },
                                                        { label: "Studio Synthesis", key: "Synthesizing studio" },
                                                        { label: "Final Render", key: "Generating high-fidelity" }
                                                    ].map((phase, i) => {
                                                        const isActive = activeProduct.enrichment_message?.includes(phase.key);
                                                        const isDone = !isActive && activeProduct.enrichment_message && i < [
                                                            "Optimizing frame",
                                                            "Synthesizing studio",
                                                            "Generating high-fidelity"
                                                        ].findIndex(k => activeProduct.enrichment_message?.includes(k));

                                                        return (
                                                            <div key={phase.label} className="flex items-center gap-3">
                                                                <div className={cn(
                                                                    "w-1.5 h-1.5 rounded-none transition-all duration-500",
                                                                    isActive ? "bg-zinc-500   animate-pulse" :
                                                                        isDone ? "bg-green-500" : "bg-zinc-200"
                                                                )} />
                                                                <span className={cn(
                                                                    "text-[10px] font-bold uppercase tracking-wider transition-colors",
                                                                    isActive ? "text-zinc-600" :
                                                                        isDone ? "text-green-600/60" : "text-zinc-300"
                                                                )}>
                                                                    {phase.label}
                                                                </span>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            ) : (
                                                <Button
                                                    onClick={() => onRegenerate(activeProduct.sku, environment, generationModel)}
                                                    size="sm"
                                                    disabled={isBatchGenerating}
                                                    className="bg-zinc-600 hover:bg-zinc-700 text-white rounded-none font-bold text-[10px]"
                                                >
                                                    <Sparkles className="w-3 h-3 mr-2" /> Start Generation
                                                </Button>
                                            )}
                                        </div>

                                        {(activeProduct.status === 'ENRICHMENT_FAILED' || isBatchGenerating || activeProduct.status === 'PENDING_NANO_BANANA' || activeProduct.status.includes('GENERATING')) && activeProduct.enrichment_message && (
                                            <span className="text-[9px] text-zinc-400/60 font-medium mt-6 italic bg-white/50 px-3 py-1 rounded-none border border-zinc-50">
                                                {activeProduct.enrichment_message}
                                            </span>
                                        )}
                                    </div>
                                )}

                                <Badge
                                    className={cn(
                                        "absolute top-4 left-4 text-[10px] font-bold px-3 py-1 uppercase backdrop-blur-md shadow-sm border-0",
                                        displayImage ? "bg-green-500/90 hover:bg-green-600/90" :
                                            activeProduct.status === 'ENRICHMENT_FAILED' ? "bg-red-500/90" :
                                                (isBatchGenerating || activeProduct.status === 'PENDING_NANO_BANANA' || activeProduct.status.includes('GENERATING')) ? "bg-zinc-500/90" : "bg-zinc-400/90"
                                    )}
                                >
                                    {displayImage
                                        ? (activeProduct.status === 'APPROVED' ? "Ready" : "Studio Visual")
                                        : activeProduct.status === 'ENRICHMENT_FAILED'
                                            ? "Failed"
                                            : (isBatchGenerating || activeProduct.status === 'PENDING_NANO_BANANA' || activeProduct.status.includes('GENERATING'))
                                                ? "Generating..."
                                                : "Pending"}
                                </Badge>
                            </div>
                        </div>

                        {/* Multi-Variant Strip Selection */}
                        {outputImages.length > 1 && (
                            <div className="flex gap-2 overflow-x-auto pb-2 pt-1 w-full shrink-0">
                                {outputImages.map(img => (
                                    <button
                                        key={img.suffix}
                                        onClick={() => setActiveVariantSuffix(img.suffix)}
                                        className={cn(
                                            "relative flex-shrink-0 aspect-square w-16 h-16 border bg-white overflow-hidden transition-all group rounded-none",
                                            activeVariantSuffix === img.suffix
                                                ? "border-zinc-900 opacity-100 ring-2 ring-zinc-900 ring-offset-2"
                                                : "border-zinc-200 opacity-60 hover:opacity-100 cursor-pointer"
                                        )}
                                    >
                                        <img src={img.url} alt={img.suffix} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
                                        <div className="absolute inset-x-0 bottom-0 bg-zinc-900/80 p-0.5">
                                            <p className="text-[8px] font-bold text-white text-center uppercase truncate">{img.suffix}</p>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    ) : null;

    const footerActions = (
        <SharedWizardFooter
            onBack={onBack}
            centerContent={
                <div className="flex flex-col flex-1 max-w-sm">
                    {isBatchGenerating ? (
                        <div className="animate-in fade-in slide-in-from-bottom-2">
                            <div className="flex justify-between items-center mb-1.5">
                                <div className="flex items-center gap-2">
                                    <Loader2 className="w-3 h-3 text-zinc-600 animate-spin" />
                                    <span className="text-[10px] font-bold text-zinc-900 uppercase tracking-tight">Studio Working...</span>
                                </div>
                                <span className="text-[10px] font-bold text-zinc-600 bg-zinc-50 px-1.5 py-0.5 rounded-md">
                                    {completedItems + failedCount}/{totalItems}
                                </span>
                            </div>
                            <Progress value={((completedItems + failedCount) / totalItems) * 100} className="h-1 bg-zinc-50" />
                            <div className="mt-1.5 flex justify-between">
                                <span className="text-[9px] text-zinc-400 font-medium">Estimated time:</span>
                                <span className="text-[9px] text-zinc-500 font-bold uppercase">
                                    {(() => {
                                        const totalSeconds = Math.max(1, (totalItems - completedItems) * 5);
                                        const mins = Math.ceil(totalSeconds / 60);
                                        return `${mins} minutes`;
                                    })()}
                                </span>
                            </div>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-0.5 opacity-60">
                            <span className="text-[10px] text-zinc-400 font-medium flex items-center gap-1.5">
                                <Sparkles className="w-3 h-3 text-amber-500" />
                                Visuals generated at 4K resolution.
                            </span>
                            <p className="text-[9px] text-zinc-400 uppercase tracking-widest font-bold">Studio Idle</p>
                        </div>
                    )}
                </div>
            }
            rightContent={
                <div className="flex items-center gap-3">
                    {/* Abort Action (Visible only when generating) */}
                    {isBatchGenerating && (
                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button
                                    variant="destructive"
                                    className="h-10 px-5 rounded-none font-bold text-xs transition-all transform hover:scale-105 duration-200 shadow-lg shadow-sm"
                                >
                                    <XCircle className="w-3.5 h-3.5 mr-2" />
                                    Abort
                                </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>Abort Studio Process?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                        This will stop any running and queued studio generation processes.
                                        Products currently being processed may finish, but subsequent ones will be skipped.
                                    </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={onAbort} className="bg-red-600 hover:bg-red-700">
                                        Abort Process
                                    </AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    )}

                    {/* Regenerate All Action */}
                    <AlertDialog>
                        <AlertDialogTrigger asChild>
                            <Button
                                variant="outline"
                                disabled={isBatchGenerating}
                                className="h-10 px-5 rounded-none border-zinc-100 text-zinc-700 hover:bg-zinc-100 hover:text-zinc-800 font-bold text-xs transition-all transform hover:scale-105 duration-200"
                            >
                                <RotateCcw className="w-3.5 h-3.5 mr-2" />
                                Regenerate All
                            </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>Regenerate All Visuals?</AlertDialogTitle>
                                <AlertDialogDescription>
                                    This will cancel any existing processes and restart studio generation for all products in this list.
                                    Existing studio images will be overwritten.
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => onRegenerateAll(environment, generationModel)} className="bg-zinc-600 hover:bg-zinc-700">
                                    Regenerate All
                                </AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>

                    {/* Bulk Remove BG Action */}

                    <AlertDialog>
                        <AlertDialogTrigger asChild>
                            <Button
                                disabled={isBatchGenerating}
                                className="bg-green-600 hover:bg-green-700 h-10 px-6 text-white rounded-none font-bold shadow-lg shadow-sm transition-all transform hover:scale-105 disabled:opacity-30 disabled:scale-100 disabled:shadow-none text-xs"
                            >
                                Send to Staging Area <CheckCircle2 className="w-4 h-4 ml-2" />
                            </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>Send All Products to Staging Area?</AlertDialogTitle>
                                <AlertDialogDescription>
                                    This will move all products to the Visual Staging Area for final review. You can still reach them in the Staging Area before they go live on Shopify.
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={onComplete} className="bg-green-600 hover:bg-green-700">
                                    Send to Staging Area
                                </AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                </div>
            }
        />
    );

    const headerContent = activeProduct && (
        <SharedWizardHeader
            title={activeProduct.ai_data?.title_el || activeProduct.pylon_data?.name || activeProduct.name || activeProduct.sku}
            phaseLabel="Phase 3 / Studio Monitor"
            icon={Wand2}
            onPrev={() => setActiveIndex(prev => Math.max(0, prev - 1))}
            onNext={() => setActiveIndex(prev => Math.min(products.length - 1, prev + 1))}
            prevDisabled={activeIndex === 0}
            nextDisabled={activeIndex === products.length - 1}
        />
    );

    return (
        <>
            <WizardLayout
                sidebarList={sidebarList}
                mainContent={mainContent}
                footerActions={footerActions}
                sidebarTitle={sidebarTitle}
                headerContent={headerContent}
            />

            {/* Lightbox Overlay */}
            {lightboxImage && (
                <div
                    className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center p-8 backdrop-blur-md animate-in fade-in duration-200"
                    onClick={() => setLightboxImage(null)}
                >
                    <div className="relative max-w-7xl max-h-[90vh] w-full h-full flex items-center justify-center">
                        <img
                            src={lightboxImage}
                            alt="Lightbox"
                            className="max-w-full max-h-full object-contain rounded-sm shadow-2xl"
                        />
                        <Button
                            variant="secondary"
                            size="icon"
                            onClick={() => setLightboxImage(null)}
                            className="absolute top-4 right-4 rounded-none bg-white/10 hover:bg-white/20 text-white border-0 backdrop-blur-md"
                        >
                            <span className="sr-only">Close</span>
                            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </Button>
                    </div>
                </div>
            )}
        </>
    );
}
