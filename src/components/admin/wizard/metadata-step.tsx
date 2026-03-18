"use client";

import { useState, useEffect } from "react";
import { Sparkles, CheckCircle2, ChevronRight, Plus, Trash2, Tag, Layers, Loader2, Wand2, RefreshCw, Database } from "lucide-react";
import { WizardLayout } from "./wizard-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
    WizardSidebarItem,
    SharedWizardHeader,
    SharedWizardFooter,
    SharedWizardSidebarTitle,
    WizardProduct
} from "./shared-wizard-components";

interface Variant {
    sku_suffix: string;
    variant_name: string;
    option_name: string;
    option_value: string;
    pylon_sku: string;
}

interface ProductData {
    sku: string;
    status: string;
    enrichment_message?: string;
    name: string;
    pylon_data?: {
        name: string;
        price_retail: number;
        stock_quantity: number;
        active: boolean;
        description?: string;
    };
    ai_data?: {
        title?: string;
        description?: string;
        category?: string;
        type?: string;
        product_type?: string;
        project_category?: string;
        tags?: string[];
        variants?: Variant[];
        technical_specs?: Record<string, any>;
    };
}

interface MetadataStepProps {
    products: ProductData[];
    onStartScan: () => void;
    onRetry?: (sku: string) => void;
    onComplete: (updatedProducts: ProductData[]) => void;
}

export function MetadataStep({ products, onStartScan, onRetry, onComplete }: MetadataStepProps) {
    const [localProducts, setLocalProducts] = useState(products);
    const [activeIndex, setActiveIndex] = useState(0);

    const storageKey = `wizard_metadata_draft_${products.map(p => p.sku).sort().join(",")}`;

    useEffect(() => {
        const saved = localStorage.getItem(storageKey);
        if (saved) {
            try {
                const draft = JSON.parse(saved);
                const draftSkus = draft.map((p: any) => p.sku).sort().join(",");
                const propSkus = products.map(p => p.sku).sort().join(",");

                if (draftSkus === propSkus) {
                    const merged = draft.map((dp: any) => {
                        const pp = products.find(p => p.sku === dp.sku);
                        if (!pp) return dp;

                        const newAiData = { ...(dp.ai_data || {}) };
                        let hasChanges = false;

                        if (pp.ai_data) {
                            Object.entries(pp.ai_data).forEach(([key, value]) => {
                                if (value && (!newAiData[key] || newAiData[key] === "Σπρέι Βαφής" || (Array.isArray(value) && value.length > 0 && (!newAiData[key] || newAiData[key].length === 0)))) {
                                    newAiData[key] = value;
                                    hasChanges = true;
                                }
                            });
                        }

                        if (hasChanges || pp.status !== dp.status || pp.enrichment_message !== dp.enrichment_message) {
                            return { ...dp, ai_data: newAiData, status: pp.status, enrichment_message: pp.enrichment_message };
                        }
                        return dp;
                    });
                    setLocalProducts(merged);
                    return;
                }
            } catch (e) {
                console.error("Failed to parse metadata draft", e);
            }
        }
        setLocalProducts(products);
    }, [products, storageKey]);

    useEffect(() => {
        if (localProducts.length > 0) {
            localStorage.setItem(storageKey, JSON.stringify(localProducts));
        }
    }, [localProducts, storageKey]);

    const handleComplete = () => {
        localStorage.removeItem(storageKey);
        onComplete(localProducts);
    };

    const activeProduct = localProducts[activeIndex];
    const isScanning = products.some(p => p.status === 'PENDING_METADATA');
    const hasFailures = products.some(p => p.status === 'ENRICHMENT_FAILED');
    const hasResults = products.some(p => p.ai_data?.title || p.status === 'PENDING_METADATA_REVIEW');

    const updateProduct = (sku: string, updates: any) => {
        setLocalProducts(prev => prev.map(p =>
            p.sku === sku ? { ...p, ai_data: { ...p.ai_data, ...updates } } : p
        ));
    };

    const addVariant = () => {
        const newVariant: Variant = { sku_suffix: "", variant_name: "", option_name: "Color", option_value: "", pylon_sku: activeProduct.sku };
        updateProduct(activeProduct.sku, { variants: [...(activeProduct.ai_data?.variants || []), newVariant] });
    };

    const removeVariant = (index: number) => {
        const variants = [...(activeProduct.ai_data?.variants || [])];
        variants.splice(index, 1);
        updateProduct(activeProduct.sku, { variants });
    };

    const sidebarList = (
        <div className="flex flex-col gap-1 px-2">
            {localProducts.map((p, idx) => (
                <WizardSidebarItem
                    key={p.sku}
                    product={p as unknown as WizardProduct}
                    isActive={activeIndex === idx}
                    onClick={() => setActiveIndex(idx)}
                    statusIndicator={
                        p.status === 'PENDING_METADATA' ? (
                            <><Loader2 className="w-2.5 h-2.5 animate-spin text-zinc-500" /> SCAN</>
                        ) : p.status === 'ENRICHMENT_FAILED' ? (
                            <><div className="w-1.5 h-1.5 rounded-full bg-red-500" /> ERR</>
                        ) : p.ai_data?.title ? (
                            <><CheckCircle2 className="w-2.5 h-2.5 text-emerald-500" /> OK</>
                        ) : p.enrichment_message ? (
                            <span className="text-zinc-400 truncate max-w-[80px]">{p.enrichment_message}</span>
                        ) : "WAIT"
                    }
                />
            ))}
        </div>
    );

    const mainContent = !hasResults && !isScanning ? (
        <div className="flex-1 flex flex-col items-center justify-center p-12 text-center h-full">
            <div className="w-16 h-16 bg-zinc-50 border border-zinc-200 rounded-lg flex items-center justify-center mb-6">
                <Database className="w-8 h-8 text-zinc-400" />
            </div>
            <h2 className="text-xl font-semibold text-zinc-900 mb-2 tracking-tight">AI Metadata Extraction</h2>
            <p className="text-zinc-500 max-w-sm mb-8 text-sm leading-relaxed">
                Scan official catalogs to extract Greek translations, technical specifications, and discover hidden structural variants.
            </p>
            <Button
                onClick={onStartScan}
                className="bg-zinc-900 hover:bg-zinc-800 text-white rounded-none h-10 px-8 font-medium"
            >
                <Wand2 className="w-4 h-4 mr-2" />
                Run AI Scan
            </Button>
        </div>
    ) : isScanning ? (
        <div className="flex-1 flex flex-col items-center justify-center p-12 text-center h-full">
            <Loader2 className="w-8 h-8 text-zinc-800 animate-spin mb-6" />
            <h2 className="text-lg font-semibold text-zinc-900 mb-2">Analyzing Catalogs...</h2>
            <p className="text-zinc-500 max-w-sm text-sm">
                Mining product families and cross-referencing web sources.
            </p>
        </div>
    ) : activeProduct ? (
        <div className="p-8 lg:p-12 w-full max-w-5xl mx-auto">
            {(activeProduct.status === 'ENRICHMENT_FAILED' || activeProduct.enrichment_message) && !activeProduct.ai_data?.title && (
                <div className={cn(
                    "p-3 mb-8 flex items-center justify-between gap-3 text-xs font-medium border-l-2 bg-zinc-50",
                    activeProduct.status === 'ENRICHMENT_FAILED' ? "border-red-500 text-red-700" : "border-amber-500 text-amber-700"
                )}>
                    <div className="flex items-center gap-2">
                        {activeProduct.status === 'ENRICHMENT_FAILED' ? <Layers className="w-3.5 h-3.5" /> : <Sparkles className="w-3.5 h-3.5" />}
                        {activeProduct.enrichment_message || "Enrichment parsing failed."}
                    </div>
                    {activeProduct.status === 'ENRICHMENT_FAILED' && onRetry && (
                        <Button variant="outline" size="sm" onClick={() => onRetry(activeProduct.sku)} className="h-7 text-[10px] rounded-none border-zinc-200 bg-white">
                            <RefreshCw className="w-3 h-3 mr-1.5" /> Retry
                        </Button>
                    )}
                </div>
            )}

            <div className="flex flex-col gap-12">

                {/* Comparison View: Title & Description */}
                <section className="space-y-6">
                    <div className="grid grid-cols-2 gap-8">
                        {/* Left: Raw Pylon Data */}
                        <div className="space-y-6 opacity-60 pointer-events-none grayscale">
                            <div className="space-y-2">
                                <Label className="text-[10px] font-bold text-zinc-500 uppercase flex items-center gap-1.5">
                                    <Database className="w-3 h-3" /> Raw ERP Name
                                </Label>
                                <Input disabled className="font-mono text-sm bg-zinc-50 border-transparent rounded-none h-auto py-2" value={activeProduct.pylon_data?.name || 'N/A'} />
                            </div>
                            <div className="space-y-2">
                                <Label className="text-[10px] font-bold text-zinc-500 uppercase">Raw Description</Label>
                                <Textarea disabled className="resize-none bg-zinc-50 border-transparent rounded-none h-[120px] text-xs font-mono" value={activeProduct.pylon_data?.description || 'N/A'} />
                            </div>
                        </div>

                        {/* Right: AI Enriched Data */}
                        <div className="space-y-6 border-l pl-8 border-zinc-200">
                            <div className="space-y-2">
                                <Label className="text-[10px] font-bold text-zinc-900 uppercase flex items-center justify-between">
                                    <span>Greek Semantic Title</span>
                                    <Badge variant="outline" className="text-[9px] py-0 h-4 border-zinc-200">AI</Badge>
                                </Label>
                                <Input
                                    className="font-medium text-lg bg-white border-0 border-b-2 border-zinc-200 rounded-none px-0 h-auto py-1.5 focus-visible:ring-0 focus-visible:border-zinc-900"
                                    value={activeProduct.ai_data?.title || ""}
                                    onChange={(e) => updateProduct(activeProduct.sku, { title: e.target.value })}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label className="text-[10px] font-bold text-zinc-900 uppercase">Greek Enriched Narrative</Label>
                                <Textarea
                                    rows={5}
                                    className="resize-none bg-zinc-50/50 border-zinc-200 rounded-md text-sm leading-relaxed p-3 focus-visible:ring-1 focus-visible:ring-zinc-400"
                                    value={activeProduct.ai_data?.description || ""}
                                    onChange={(e) => updateProduct(activeProduct.sku, { description: e.target.value })}
                                    placeholder="Empty..."
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label className="text-[10px] font-bold text-zinc-900 uppercase">Product Type</Label>
                                    <select
                                        className="w-full text-[13px] bg-white border-zinc-200 rounded-md h-9 px-2 focus:ring-1 focus:ring-zinc-400 outline-none"
                                        value={activeProduct.ai_data?.product_type || activeProduct.ai_data?.type || activeProduct.ai_data?.category || ""}
                                        onChange={(e) => updateProduct(activeProduct.sku, { product_type: e.target.value })}
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
                                <div className="space-y-2">
                                    <Label className="text-[10px] font-bold text-zinc-900 uppercase">Project Category</Label>
                                    <select
                                        className="w-full text-[13px] bg-white border-zinc-200 rounded-md h-9 px-2 focus:ring-1 focus:ring-zinc-400 outline-none"
                                        value={activeProduct.ai_data?.project_category || (["Αυτοκίνητο", "Ναυτιλιακά", "Οικοδομικά", "Ειδικές Εφαρμογές"].includes(activeProduct.ai_data?.category || "") ? activeProduct.ai_data?.category : "") || ""}
                                        onChange={(e) => updateProduct(activeProduct.sku, { project_category: e.target.value })}
                                    >
                                        <option value="">Επιλέξτε Κατηγορία Έργου</option>
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
                        </div>
                    </div>
                </section>

                <hr className="border-t border-zinc-200" />

                {/* Specs & Variants Grid */}
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-12">

                    {/* Technical Specs */}
                    <section className="space-y-4">
                        <Label className="text-[10px] font-bold text-zinc-900 uppercase">Technical Specifications</Label>
                        <div className="border border-zinc-200 rounded-md overflow-hidden text-sm relative">
                            {(!activeProduct.ai_data?.technical_specs || Object.keys(activeProduct.ai_data.technical_specs).length === 0) ? (
                                <div className="p-4 text-center text-xs text-zinc-500 bg-zinc-50">No specifications found.</div>
                            ) : (
                                <table className="w-full text-left">
                                    <tbody className="divide-y divide-zinc-100">
                                        {Object.entries(activeProduct.ai_data.technical_specs)
                                            .filter(([_, v]) => v !== null && v !== undefined)
                                            .map(([key, value]) => (
                                                <tr key={key} className="bg-white hover:bg-zinc-50/50">
                                                    <td className="p-2 font-medium text-zinc-600 border-r border-zinc-100 w-1/3 bg-zinc-50/50 text-[11px] uppercase tracking-wider">
                                                        {key.replace(/_/g, ' ')}
                                                    </td>
                                                    <td className="p-0">
                                                        <Input
                                                            className="h-full w-full border-none bg-transparent rounded-none px-3 focus-visible:ring-1 focus-visible:ring-inset text-zinc-900 text-sm"
                                                            value={Array.isArray(value) ? value.join(", ") : String(value)}
                                                            onChange={(e) => updateProduct(activeProduct.sku, { technical_specs: { ...activeProduct.ai_data?.technical_specs, [key]: e.target.value } })}
                                                        />
                                                    </td>
                                                </tr>
                                            ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </section>

                    {/* Dynamic Variants Sidebar */}
                    <div className="space-y-8">
                        {/* Variants */}
                        <section className="space-y-4">
                            <div className="flex items-center justify-between">
                                <Label className="text-[10px] font-bold text-zinc-900 uppercase">Dynamic Variants</Label>
                                <Button variant="ghost" size="sm" onClick={addVariant} className="h-6 text-[10px] font-bold text-zinc-600 hover:text-zinc-900 px-2 rounded-sm border border-zinc-200">
                                    <Plus className="w-3 h-3 mr-1" /> Add
                                </Button>
                            </div>

                            <div className="border border-zinc-200 rounded-md overflow-hidden bg-zinc-50">
                                {activeProduct.ai_data?.variants && activeProduct.ai_data.variants.length > 0 ? (
                                    <table className="w-full text-left text-xs">
                                        <thead className="border-b border-zinc-200 text-[10px] uppercase text-zinc-500 bg-zinc-100/50">
                                            <tr>
                                                <th className="p-2 font-medium">Suffix</th>
                                                <th className="p-2 font-medium">Value</th>
                                                <th className="w-10"></th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-zinc-100 bg-white">
                                            {activeProduct.ai_data.variants.map((v, vIdx) => (
                                                <tr key={vIdx}>
                                                    <td className="p-1">
                                                        <Input
                                                            className="h-7 px-2 text-[10px] font-mono uppercase border-transparent focus-visible:ring-1 rounded-sm"
                                                            value={v.sku_suffix}
                                                            onChange={(e) => {
                                                                const variants = [...(activeProduct.ai_data?.variants || [])];
                                                                variants[vIdx].sku_suffix = e.target.value.toUpperCase();
                                                                updateProduct(activeProduct.sku, { variants });
                                                            }}
                                                        />
                                                    </td>
                                                    <td className="p-1">
                                                        <Input
                                                            className="h-7 px-2 text-xs border-transparent focus-visible:ring-1 rounded-sm"
                                                            value={v.option_value}
                                                            onChange={(e) => {
                                                                const variants = [...(activeProduct.ai_data?.variants || [])];
                                                                variants[vIdx].option_value = e.target.value;
                                                                variants[vIdx].variant_name = `Color: ${e.target.value}`;
                                                                updateProduct(activeProduct.sku, { variants });
                                                            }}
                                                        />
                                                    </td>
                                                    <td className="text-center">
                                                        <button onClick={() => removeVariant(vIdx)} className="text-zinc-300 hover:text-red-500">
                                                            <Trash2 className="w-3.5 h-3.5" />
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                ) : (
                                    <div className="text-xs text-zinc-400 text-center py-6">No variants mapped.</div>
                                )}
                            </div>
                        </section>

                        {/* Tags */}
                        <section className="space-y-4">
                            <Label className="text-[10px] font-bold text-zinc-900 uppercase">Tags</Label>
                            <div className="flex flex-wrap gap-1.5 p-3 rounded-md border border-zinc-200 bg-zinc-50 min-h-[60px] content-start">
                                {activeProduct.ai_data?.tags?.map((tag, tIdx) => (
                                    <Badge key={tIdx} variant="secondary" className="bg-white border-zinc-200 text-zinc-600 hover:bg-zinc-100 font-normal pr-1 gap-1 text-[10px]">
                                        {tag}
                                        <button
                                            onClick={() => updateProduct(activeProduct.sku, { tags: activeProduct.ai_data?.tags?.filter((_, i) => i !== tIdx) })}
                                            className="text-zinc-400 hover:text-red-500 rounded-full"
                                        >
                                            <Trash2 className="w-3 h-3" />
                                        </button>
                                    </Badge>
                                ))}
                                <Button variant="outline" size="sm" onClick={() => { const t = prompt("Tag:"); if (t) updateProduct(activeProduct.sku, { tags: [...(activeProduct.ai_data?.tags || []), t] }); }} className="h-5 px-2 text-[9px] bg-transparent border-dashed text-zinc-500 uppercase tracking-widest rounded-sm border-zinc-300 hover:bg-zinc-200">
                                    + Add
                                </Button>
                            </div>
                        </section>
                    </div>
                </div>
            </div>
        </div>
    ) : null;

    const footerActions = activeProduct ? (
        <SharedWizardFooter
            isSaving={true}
            rightContent={
                <div className="flex gap-2">
                    {(hasResults || hasFailures) && (
                        <Button variant="ghost" size="sm" onClick={onStartScan} className="text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 rounded-sm font-medium">
                            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                            {hasFailures ? "Retry Failed" : "Re-run Scan"}
                        </Button>
                    )}
                    <Button onClick={handleComplete} className="bg-zinc-900 hover:bg-zinc-800 text-white rounded-none font-medium h-9 px-6 ml-2">
                        Approve & Continue
                        <ChevronRight className="w-4 h-4 ml-1.5" />
                    </Button>
                </div>
            }
        />
    ) : null;

    return (
        <WizardLayout
            sidebarList={sidebarList}
            mainContent={mainContent}
            footerActions={activeProduct ? footerActions : undefined}
            sidebarTitle={<SharedWizardSidebarTitle count={localProducts.length} />}
            headerContent={activeProduct && (
                <SharedWizardHeader
                    title={activeProduct.ai_data?.title || activeProduct.pylon_data?.name || activeProduct.name || activeProduct.sku}
                    phaseLabel="Phase 1: Metadata Extraction"
                    icon={Wand2}
                    onPrev={() => setActiveIndex(prev => Math.max(0, prev - 1))}
                    onNext={() => setActiveIndex(prev => Math.min(localProducts.length - 1, prev + 1))}
                    prevDisabled={activeIndex === 0}
                    nextDisabled={activeIndex === localProducts.length - 1}
                />
            )}
        />
    );
}
