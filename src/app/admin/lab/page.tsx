"use client";

import React, { useState, useEffect, useRef, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
    Activity,
    AlertCircle,
    CheckCircle2,
    OctagonPause,
    UploadCloud,
    LayoutGrid,
    Search,
    Filter,
    Loader2,
    Play,
    ZoomIn,
    RefreshCw
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { collection, onSnapshot, query, orderBy, doc, updateDoc, writeBatch, deleteDoc, deleteField } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import { LabProduct, ProductState } from "@/types/lab";
import { getLogger } from "@/lib/logger";
import PipelineDrawer from "./components/PipelineDrawer";
import ImageLightbox from "./components/ImageLightbox";

const systemLogger = getLogger("LabDashboard");

function LabDashboardContent() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const urlSkusParam = searchParams.get('skus');
    const [selectedSku, setSelectedSku] = useState<string | null>(null);
    const [targetStep, setTargetStep] = useState<string | null>(null);
    const [products, setProducts] = useState<LabProduct[]>([]);
    const [loading, setLoading] = useState(true);
    const [isUploading, setIsUploading] = useState(false);
    const [isAborting, setIsAborting] = useState(false);
    const [isCommitting, setIsCommitting] = useState(false);
    const [isStartingPipeline, setIsStartingPipeline] = useState(false);
    const [selectedSkus, setSelectedSkus] = useState<Set<string>>(new Set());
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

    // Filter states
    const [activeFilter, setActiveFilter] = useState<string>("All Products");

    // Real-time Firestore Listener
    useEffect(() => {
        if (!db) return;

        const q = query(
            collection(db, "staging_products"),
            orderBy("updated_at", "desc")
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const items: LabProduct[] = [];
            snapshot.forEach((doc) => items.push({ id: doc.id, ...doc.data() } as LabProduct));
            setProducts(items);
            setLoading(false);
        }, (err) => {
            console.error("Firestore Listen Error:", err);
            setLoading(false);
        });

        return () => unsubscribe();
    }, []);

    // Derived stats
    const totalCount = products.length;
    const reviewCount = products.filter(p => p.status.includes('REVIEW') || p.status === 'FAILED' || p.status === 'DELAYED_RETRY').length;

    // Telemetry Calculations
    const processingProducts = products.filter(p => p.status.includes('GENERATING') || p.status.includes('SOURCING') || p.status.includes('REMOVING'));
    const readyProducts = products.filter(p => p.status === 'READY_FOR_PUBLISH' || p.status === 'PUBLISHED');
    const estimatedEtaMinutes = Math.ceil((processingProducts.length * 20) / 60); // Roughly 20s per product in pipeline
    const estimatedCost = (readyProducts.length * 0.05).toFixed(2); // ~$0.05 blended pipeline cost per ready product

    // Intervention Handlers
    const handleMetadataApproval = async (productId: string, newTitle: string, newDescription: string) => {
        if (!db) return;
        try {
            await updateDoc(doc(db, "staging_products", productId), {
                "ai_data.title": newTitle,
                "ai_data.description": newDescription,
                "ai_data.generated_images": deleteField(),
                "ai_data.images": deleteField(),
                status: ProductState.SOURCING_IMAGES,
                enrichment_message: "Metadata manually approved. Resuming pipeline..."
            });
            setSelectedSku(null);
        } catch (e) {
            console.error(e);
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsUploading(true);
        try {
            const isXLSX = file.name.toLowerCase().endsWith('.xlsx');
            let finalBody: any;
            let finalHeaders: any = {};

            if (isXLSX) {
                finalBody = await file.arrayBuffer();
                finalHeaders = { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
            } else {
                finalBody = await file.text();
                finalHeaders = { "Content-Type": "text/csv" };
            }

            // Determine the Cloud Function URL
            const endpoint = `${getBaseEndpoint()}/pylon_ingest_csv`;

            const res = await fetch(endpoint, {
                method: "POST",
                body: finalBody,
                headers: finalHeaders
            });

            if (!res.ok) throw new Error(await res.text());

            systemLogger.info("File payload parsed and ingested successfully.", await res.json());
        } catch (error) {
            systemLogger.error("File Upload preflight or ingest failed.", error);
            alert(`Upload failed: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            setIsUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleImageApproval = async (productId: string, imageUrl: string) => {
        if (!db) return;
        try {
            await updateDoc(doc(db, "staging_products", productId), {
                "ai_data.selected_images": { "base": imageUrl },
                "ai_data.generated_images": deleteField(),
                "ai_data.images": deleteField(),
                status: ProductState.GENERATING_STUDIO,
                enrichment_message: "Source image provided. Beginning Studio Generation..."
            });
            setSelectedSku(null);
        } catch (e) {
            console.error(e);
        }
    };

    const getBaseEndpoint = () => {
        const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "pavlicevits-9a889";
        // To use the local Firebase Emulator, create a .env.local with NEXT_PUBLIC_USE_FUNCTIONS_EMULATOR=true
        const useEmulator = process.env.NEXT_PUBLIC_USE_FUNCTIONS_EMULATOR === 'true';
        return useEmulator
            ? `http://127.0.0.1:5001/${projectId}/europe-west1`
            : `https://europe-west1-${projectId}.cloudfunctions.net`;
    };

    const handleGlobalAbort = async () => {
        setIsAborting(true);
        try {
            const res = await fetch(`${getBaseEndpoint()}/abort_studio_session`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ data: { batch_ids: ["GLOBAL"] } }) // Passes the required expected Callable format
            });
            if (!res.ok) throw new Error(await res.text());

            systemLogger.info("Global Abort signal dispatched successfully.");
        } catch (error) {
            systemLogger.error("Failed to execute Global Abort via HTTP trigger.", error);
            alert("Failed to send Global Abort signal.");
        } finally {
            setIsAborting(false);
        }
    };

    const handleCommitToShopify = async () => {
        setIsCommitting(true);
        try {
            const res = await fetch(`${getBaseEndpoint()}/pylon_sync_products`, {
                method: "POST"
            });
            if (!res.ok) {
                const errData = await res.json().catch(() => ({ error: "Unknown error" }));
                throw new Error(errData.error || `HTTP ${res.status}`);
            }

            const data = await res.json();
            const r = data.result || {};
            systemLogger.info("Shopify sync completed.", { created: r.created, updated: r.updated, failed: r.failed });
            alert(`Sync Complete: ${r.created || 0} created, ${r.updated || 0} updated, ${r.failed || 0} failed`);
        } catch (error) {
            systemLogger.error("Failed to commit via pylon_sync_products", error);
            alert(`Shopify Sync Failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        } finally {
            setIsCommitting(false);
        }
    };

    const handleStartPipeline = async () => {
        if (!functions || selectedSkus.size === 0) return;
        setIsStartingPipeline(true);
        try {
            const startPipelineAction = httpsCallable(functions, 'trigger_pipeline_session');
            const result = await startPipelineAction({ skus: Array.from(selectedSkus) });
            systemLogger.info("Pipeline started successfully.", result.data as Record<string, any>);
            alert("AI Pipeline started for selected products.");
            setSelectedSkus(new Set()); // Deselect after starting
        } catch (error) {
            systemLogger.error("Failed to start AI pipeline.", error);
            alert("Failed to start AI pipeline.");
        } finally {
            setIsStartingPipeline(false);
        }
    };

    const handleBulkDelete = async () => {
        if (!db || selectedSkus.size === 0) return;
        if (!confirm(`Are you sure you want to delete ${selectedSkus.size} products?`)) return;

        try {
            const batch = writeBatch(db!);
            selectedSkus.forEach(sku => {
                batch.delete(doc(db!, "staging_products", sku));
            });
            await batch.commit();
            setSelectedSkus(new Set());
            setSelectedSku(null);
        } catch (e) {
            console.error(e);
            alert("Bulk delete failed");
        }
    };

    const handleRePublish = async () => {
        if (!db || selectedSkus.size === 0) return;
        const eligibleSkus = Array.from(selectedSkus).filter(sku => {
            const p = products.find(prod => prod.sku === sku);
            return p && (p.status === 'PUBLISHED' || p.status === 'FAILED' || p.status === 'READY_FOR_PUBLISH');
        });
        if (eligibleSkus.length === 0) {
            alert('No eligible products selected. Only PUBLISHED, FAILED, or READY_FOR_PUBLISH products can be re-synced.');
            return;
        }
        if (!confirm(`Reset ${eligibleSkus.length} product(s) to READY_FOR_PUBLISH for re-sync to Shopify?`)) return;

        try {
            const batch = writeBatch(db!);
            eligibleSkus.forEach(sku => {
                const ref = doc(db!, "staging_products", sku);
                batch.update(ref, {
                    status: 'READY_FOR_PUBLISH',
                    enrichment_message: 'Queued for re-sync to Shopify.',
                });
            });
            await batch.commit();
            setSelectedSkus(new Set());
            alert(`${eligibleSkus.length} product(s) queued for re-sync. Click "Commit to Shopify" to sync now.`);
        } catch (e) {
            console.error(e);
            alert('Failed to queue products for re-sync.');
        }
    };

    const toggleSelection = (sku: string, e: React.MouseEvent) => {
        e.stopPropagation();
        const next = new Set(selectedSkus);
        if (next.has(sku)) next.delete(sku);
        else next.add(sku);
        setSelectedSkus(next);
    };

    const toggleAll = () => {
        if (selectedSkus.size === filteredProducts.length) {
            setSelectedSkus(new Set());
        } else {
            setSelectedSkus(new Set(filteredProducts.map(p => p.sku)));
        }
    };

    const handleSaveOverride = async (productId: string, partialAiData: any) => {
        if (!db) return;
        try {
            await updateDoc(doc(db, "staging_products", productId), {
                "ai_data.title": partialAiData.title,
                "ai_data.description": partialAiData.description,
                "ai_data.category": partialAiData.category,
                enrichment_message: "Manual override applied by Admin."
            });
            alert("Overrides saved.");
        } catch (e) {
            console.error(e);
        }
    };

    const handleRetry = async (productId: string, targetState: string) => {
        if (!db) return;
        try {
            const payload: any = {
                status: targetState,
                enrichment_message: `Manual injection to ${targetState}...`,
                failed_attempts: 0
            };
            // Cascading cleanup: wipe stale downstream data
            if (targetState === ProductState.GENERATING_METADATA) {
                payload["ai_data"] = deleteField();
            } else if (targetState === ProductState.SOURCING_IMAGES) {
                payload["ai_data.variant_images"] = deleteField();
                payload["ai_data.selected_images"] = deleteField();
                payload["ai_data.generated_images"] = deleteField();
                payload["ai_data.images"] = deleteField();
                payload["ai_data.grounding_sources"] = deleteField();
                payload["ai_data.grounding_text"] = deleteField();
            } else if (targetState === ProductState.GENERATING_STUDIO) {
                payload["ai_data.generated_images"] = deleteField();
                payload["ai_data.images"] = deleteField();
            }
            await updateDoc(doc(db, "staging_products", productId), payload);
            setSelectedSku(null);
        } catch (e) {
            console.error(e);
        }
    };

    const selectedProduct = products.find(p => p.sku === selectedSku);

    // Filtered products
    const filteredProducts = products.filter(p => {
        if (urlSkusParam) {
            const allowedSkus = urlSkusParam.split(',').map(s => s.trim());
            if (!allowedSkus.includes(p.sku)) return false;
        }

        if (activeFilter === "All Products") return true;
        if (activeFilter === "Imported") return p.status === 'IMPORTED';
        if (activeFilter === "Needs Review") return p.status === ProductState.NEEDS_METADATA_REVIEW || p.status === ProductState.NEEDS_IMAGE_REVIEW;
        if (activeFilter === "Failed") return p.status === 'FAILED' || p.status === 'DELAYED_RETRY';
        if (activeFilter === "Processing") return (
            p.status.includes('GENERATING') ||
            p.status.includes('SOURCING') ||
            p.status.includes('REMOVING') ||
            p.status === 'BATCH_GENERATING' ||
            p.status === 'RAW_INGESTED'
        ) && p.status !== 'FAILED' && !p.status.includes('REVIEW');
        if (activeFilter === "Ready") return p.status === 'READY_FOR_PUBLISH';
        return true;
    });

    return (
        <div className="flex flex-col h-full bg-zinc-50 overflow-hidden relative">

            {/* 1. Global Command Bar (ATC Telemetry) */}
            <header className="h-14 shrink-0 bg-white border-b border-zinc-200 px-4 flex justify-between items-center z-20">
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                        <Activity className="w-4 h-4 text-emerald-600 animate-pulse" />
                        <span className="text-sm font-medium text-zinc-900 tracking-tight">Lab Telemetry</span>
                    </div>

                    <div className="h-4 w-px bg-zinc-200" />

                    <div className="flex items-center gap-6 text-xs text-zinc-500 font-mono">
                        <div className="flex items-center gap-1.5 cursor-help" title="Based on active queue processing times">
                            <span className="text-zinc-400">ETA:</span>
                            <span className="font-medium text-zinc-800">~{estimatedEtaMinutes}m</span>
                        </div>
                        <div className="flex items-center gap-1.5 cursor-help" title="Approximate incurred API costs">
                            <span className="text-zinc-400">COST:</span>
                            <span className="font-medium text-zinc-800">${estimatedCost}</span>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    {selectedSkus.size > 0 && (
                        <>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={handleRePublish}
                                className="h-8 text-xs font-medium border-blue-200 text-blue-600 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-300 transition-colors"
                            >
                                <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                                Re-Sync {selectedSkus.size} Items
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={handleBulkDelete}
                                className="h-8 text-xs font-medium border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 hover:border-red-300 transition-colors"
                            >
                                Delete {selectedSkus.size} Items
                            </Button>
                        </>
                    )}
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleGlobalAbort}
                        disabled={isAborting}
                        className="h-8 text-xs font-medium border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 hover:border-red-300 transition-colors disabled:opacity-50"
                    >
                        {isAborting ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <OctagonPause className="w-3.5 h-3.5 mr-1.5" />}
                        {isAborting ? "Aborting..." : "Global Abort"}
                    </Button>
                    <Button
                        size="sm"
                        onClick={handleStartPipeline}
                        disabled={isStartingPipeline || selectedSkus.size === 0}
                        className={cn("h-8 text-xs font-medium transition-colors disabled:opacity-50",
                            selectedSkus.size > 0
                                ? "bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"
                                : "bg-zinc-100 text-zinc-400 border border-zinc-200"
                        )}
                    >
                        {isStartingPipeline ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Play className="w-3.5 h-3.5 mr-1.5 shadow-sm" />}
                        {isStartingPipeline ? "Starting..." : "Start AI Pipeline"}
                    </Button>
                    <Button
                        size="sm"
                        onClick={handleCommitToShopify}
                        className="h-8 text-xs font-medium bg-zinc-900 text-white hover:bg-zinc-800 transition-colors disabled:opacity-50"
                        disabled={isCommitting || products.filter(p => p.status === ProductState.READY_FOR_PUBLISH).length === 0}
                    >
                        {isCommitting ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />}
                        {isCommitting ? "Syncing..." : "Commit to Shopify"}
                    </Button>
                </div>
            </header>

            {/* Main Workspace */}
            <div className="flex flex-1 min-h-0 overflow-hidden">
                {/* 2. Left Pane: Dropzone & Filters */}
                <aside className="w-64 shrink-0 bg-white border-r border-zinc-200 flex flex-col z-10">
                    <div className="p-4 border-b border-zinc-200">
                        <input
                            type="file"
                            accept=".csv,.xlsx"
                            className="hidden"
                            ref={fileInputRef}
                            onChange={handleFileUpload}
                        />
                        <div
                            onClick={() => !isUploading && fileInputRef.current?.click()}
                            className={cn(
                                "border-2 border-dashed border-zinc-200 rounded-lg p-6 flex flex-col items-center justify-center text-center transition-all group",
                                isUploading ? "opacity-50 cursor-not-allowed" : "hover:bg-zinc-50 hover:border-zinc-300 cursor-pointer"
                            )}
                        >
                            {isUploading ? (
                                <Loader2 className="w-8 h-8 text-emerald-500 animate-spin mb-2" />
                            ) : (
                                <UploadCloud className="w-8 h-8 text-zinc-400 group-hover:text-zinc-600 transition-colors mb-2" />
                            )}
                            <h3 className="text-sm font-medium text-zinc-900">
                                {isUploading ? "Ingesting..." : "Drop Pylon CSV/XLSX"}
                            </h3>
                            <p className="text-[10px] text-zinc-500 mt-1">
                                {isUploading ? "Parsing format..." : "Autonomous ingest"}
                            </p>
                        </div>
                    </div>

                    <div className="flex-1 overflow-auto p-4">
                        <h4 className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mb-3">Filters</h4>
                        <div className="space-y-1">
                            {["All Products", "Imported", "Needs Review", "Failed", "Processing", "Ready"].map(f => {
                                const count = f === "All Products" ? totalCount :
                                    f === "Imported" ? products.filter(p => p.status === 'IMPORTED').length :
                                        f === "Needs Review" ? products.filter(p => p.status === ProductState.NEEDS_METADATA_REVIEW || p.status === ProductState.NEEDS_IMAGE_REVIEW).length :
                                            f === "Failed" ? products.filter(p => p.status === 'FAILED' || p.status === 'DELAYED_RETRY').length :
                                                f === "Processing" ? products.filter(p => (
                                                    p.status.includes('GENERATING') ||
                                                    p.status.includes('SOURCING') ||
                                                    p.status.includes('REMOVING') ||
                                                    p.status === 'BATCH_GENERATING'
                                                ) && p.status !== 'FAILED' && !p.status.includes('REVIEW')).length :
                                                    products.filter(p => p.status === 'READY_FOR_PUBLISH').length;
                                return (
                                    <button
                                        key={f}
                                        onClick={() => setActiveFilter(f)}
                                        className={cn(
                                            "w-full text-left px-2 py-1.5 text-xs rounded-md transition-colors flex justify-between items-center",
                                            activeFilter === f ? "bg-zinc-100 font-medium text-zinc-900" : "text-zinc-600 hover:bg-zinc-50"
                                        )}
                                    >
                                        {f}
                                        <span className="text-[10px] bg-zinc-100 text-zinc-500 px-1.5 py-0.5 rounded-full">{count}</span>
                                    </button>
                                );
                            })}
                        </div>
                        {urlSkusParam && (
                            <div className="mt-4 bg-emerald-50 border border-emerald-200 rounded-md p-3 space-y-2">
                                <h4 className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider flex items-center gap-1.5"><Filter className="w-3 h-3" /> Custom Selection</h4>
                                <p className="text-xs text-emerald-600 font-medium">Viewing {urlSkusParam.split(',').length} specific products.</p>
                                <Button size="sm" variant="outline" className="w-full text-xs h-7 border-emerald-200 text-emerald-700 hover:bg-emerald-100" onClick={() => router.push('/admin/lab')}>
                                    Clear Filter
                                </Button>
                            </div>
                        )}
                    </div>
                </aside>

                {/* 3. Central Pane: Live Data Grid */}
                <main className="flex-1 min-w-0 min-h-0 relative bg-white flex flex-col">
                    {loading ? (
                        <div className="p-8 flex items-center justify-center h-full">
                            <span className="text-sm text-zinc-400 animate-pulse">Loading Workspace...</span>
                        </div>
                    ) : products.length === 0 ? (
                        <div className="p-8 flex flex-col items-center justify-center h-full text-center bg-zinc-50/50">
                            <div className="w-12 h-12 bg-white rounded-xl border border-zinc-200 flex flex-col items-center justify-center shadow-sm mb-4">
                                <LayoutGrid className="w-5 h-5 text-zinc-400" />
                            </div>
                            <h2 className="text-lg font-medium text-zinc-900 mb-2">Awaiting Data</h2>
                            <p className="text-sm text-zinc-500 max-w-sm">
                                Upload a Pylon CSV or XLSX file to instantly populate the grid and trigger the autonomous enrichment pipeline.
                            </p>
                        </div>
                    ) : (
                        <ScrollArea className="flex-1">
                            <div className="min-w-[800px] w-full">
                                {/* Table Header */}
                                <div className="sticky top-0 z-10 bg-white border-y border-zinc-200 grid grid-cols-[30px_100px_minmax(150px,_1fr)_minmax(150px,_2fr)_140px] gap-4 px-4 py-2 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider shadow-sm items-center">
                                    <div className="flex justify-center">
                                        <input
                                            type="checkbox"
                                            checked={selectedSkus.size === filteredProducts.length && filteredProducts.length > 0}
                                            onChange={toggleAll}
                                            className="rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900"
                                        />
                                    </div>
                                    <div>Status</div>
                                    <div>Product Info</div>
                                    <div>AI Metadata</div>
                                    <div className="text-right">Visuals</div>
                                </div>

                                {/* Table Body */}
                                <div className="divide-y divide-zinc-100">
                                    {filteredProducts.map(product => (
                                        <div
                                            key={product.id}
                                            onClick={() => {
                                                setSelectedSku(product.sku);
                                                // Determine which step pipeline drawer should jump to
                                                if (product.status === ProductState.NEEDS_METADATA_REVIEW) setTargetStep('metadata');
                                                else if (product.status === ProductState.NEEDS_IMAGE_REVIEW) setTargetStep('sourcing');
                                                else if (product.status === ProductState.FAILED || product.status === ProductState.DELAYED_RETRY) {
                                                    if (!product.ai_data?.title || product.enrichment_message?.includes('Metadata')) setTargetStep('metadata');
                                                    else if (!product.ai_data?.selected_images?.base) setTargetStep('sourcing');
                                                    else setTargetStep('studio');
                                                } else {
                                                    setTargetStep(null);
                                                }
                                            }}
                                            className={cn(
                                                "grid grid-cols-[30px_100px_minmax(150px,_1fr)_minmax(150px,_2fr)_140px] gap-4 px-4 py-3 text-sm items-center hover:bg-zinc-50 cursor-pointer transition-colors group",
                                                selectedSku === product.sku && "bg-zinc-50 ring-1 ring-inset ring-zinc-300"
                                            )}
                                        >
                                            <div className="flex justify-center">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedSkus.has(product.sku)}
                                                    onChange={(e) => toggleSelection(product.sku, e as any)}
                                                    onClick={(e) => e.stopPropagation()}
                                                    className="rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900"
                                                />
                                            </div>
                                            <div>
                                                {/* Status Badge */}
                                                <span className={cn(
                                                    "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border",
                                                    product.status === ProductState.FAILED ? "bg-red-50 text-red-700 border-red-200" :
                                                        product.status.includes('REVIEW') ? "bg-amber-50 text-amber-700 border-amber-200" :
                                                            product.status === ProductState.READY_FOR_PUBLISH ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                                                                "bg-blue-50 text-blue-700 border-blue-200"
                                                )}>
                                                    {product.status.replace(/_/g, ' ')}
                                                </span>
                                            </div>

                                            <div className="pr-4 min-w-0">
                                                <div className="text-[10px] font-mono text-zinc-400 mb-0.5">{product.sku}</div>
                                                <div className="text-xs font-medium text-zinc-900 truncate" title={product.pylon_data?.name}>
                                                    {product.pylon_data?.name || "Unknown"}
                                                </div>
                                            </div>

                                            <div className="pr-4 min-w-0">
                                                {product.ai_data?.title ? (
                                                    <>
                                                        <div className="text-xs font-medium text-zinc-800 truncate" title={product.ai_data.title}>
                                                            {product.ai_data.title}
                                                        </div>
                                                        <div className="text-[10px] text-zinc-500 mt-0.5 flex gap-1 items-center">
                                                            <span className="bg-zinc-100 px-1 rounded truncate max-w-[100px]">{product.ai_data.category}</span>
                                                            <span>•</span>
                                                            <span>{product.ai_data.variants?.length || 0} Vars</span>
                                                        </div>
                                                    </>
                                                ) : (
                                                    <span className="text-xs text-zinc-400 italic">Pending...</span>
                                                )}
                                            </div>

                                            <div className="flex justify-end gap-1.5 shrink-0">
                                                {/* Thumbnails Placeholder */}
                                                {(() => {
                                                    const baseFinalImg = product.ai_data?.images?.find(img => img.suffix === "base")?.url;
                                                    const baseStudioImg = product.ai_data?.generated_images?.base;
                                                    const anyFinalImg = product.ai_data?.images?.[0]?.url;
                                                    const sourceImg = product.ai_data?.selected_images?.base;

                                                    // Priority: Finalized Base -> In-flight Base -> Any Finalized -> Source
                                                    const latestImage = baseFinalImg || baseStudioImg || anyFinalImg || sourceImg;

                                                    if (latestImage) {
                                                        return (
                                                            <div className={cn(
                                                                "w-14 h-14 rounded overflow-hidden shrink-0 cursor-pointer relative group",
                                                                (baseFinalImg || anyFinalImg) ? "ring-1 ring-emerald-500 shadow-sm" : "border border-zinc-200"
                                                            )}
                                                                onClick={(e) => { e.stopPropagation(); setLightboxSrc(latestImage); }}
                                                            >
                                                                 <img 
                                                                    src={`${latestImage}${latestImage.includes('?') ? '&' : '?'}v=${typeof product.updated_at === 'object' ? product.updated_at?.seconds : Date.now()}`} 
                                                                    className="w-full h-full object-cover" 
                                                                />
                                                                <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                                                    <ZoomIn className="w-4 h-4 text-white" />
                                                                </div>
                                                            </div>
                                                        );
                                                    }

                                                    return (
                                                        <div className="w-14 h-14 bg-zinc-50 border border-zinc-100 border-dashed rounded flex flex-col items-center justify-center shrink-0">
                                                            <div className="w-1.5 h-1.5 bg-zinc-300 rounded-full" />
                                                        </div>
                                                    );
                                                })()}
                                            </div>
                                        </div>
                                    ))}
                                    {filteredProducts.length === 0 && (
                                        <div className="p-8 text-center text-zinc-500 text-sm">
                                            No products match the selected filter.
                                        </div>
                                    )}
                                </div>
                            </div>
                        </ScrollArea>
                    )}
                </main>

                {/* 4. Right Drawer: Unified Pipeline Control */}
                {selectedProduct && (
                    <PipelineDrawer
                        product={selectedProduct}
                        initialStep={targetStep}
                        onClose={() => {
                            setSelectedSku(null);
                            setTargetStep(null);
                        }}
                    />
                )}
            </div>
            <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
        </div>
    );
}

export default function LabDashboard() {
    return (
        <div className="h-full">
            <Suspense fallback={
                <div className="h-full flex items-center justify-center p-8 bg-zinc-50">
                    <div className="flex flex-col items-center gap-4 text-zinc-400">
                        <Loader2 className="w-8 h-8 animate-spin" />
                        <span className="text-sm">Loading Workspace...</span>
                    </div>
                </div>
            }>
                <LabDashboardContent />
            </Suspense>
        </div>
    );
}
