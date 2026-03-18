"use client";

import { useEffect, useState, use } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useRouter } from "next/navigation";
import {
    ChevronLeft,
    Loader2,
    ImageIcon,
    AlertCircle,
    CheckCircle2,
    Settings,
} from "lucide-react";
import Image from "next/image";
import { getCategoryImage } from "@/lib/categories";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface Variant {
    sku_suffix: string;
    variant_name: string;
    option_name: string;
    option_value: string;
    pylon_sku: string;
}

interface StagingProduct {
    sku: string;
    status: string;
    pylon_data: {
        name: string;
        price_retail: number;
        price_bulk?: number;
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
        technical_specs?: Record<string, any>;
        attributes?: Record<string, any>;
        variants?: Variant[];
        images?: Array<{ url: string; suffix?: string }>;
        variant_images?: Record<string, Array<{ url: string }>>;
        generated_images?: Record<string, string>;
        selected_images?: Record<string, string>;
    };
    shopify_product_id?: string;
    shopify_handle?: string;
}

export default function ProductDetailPage({ params }: { params: Promise<{ sku: string }> }) {
    const { sku } = use(params);
    const router = useRouter();
    const [product, setProduct] = useState<StagingProduct | null>(null);
    const [loading, setLoading] = useState(true);
    const [selectedImagePreview, setSelectedImagePreview] = useState<string | null>(null);
    useEffect(() => {
        const fetchProduct = async () => {
            if (!db) return;
            try {
                const docRef = doc(db, "staging_products", sku);
                const docSnap = await getDoc(docRef);

                if (docSnap.exists()) {
                    const data = docSnap.data() as StagingProduct;
                    setProduct(data);
                }
            } catch (err) {
                console.error("Error fetching product:", err);
            } finally {
                setLoading(false);
            }
        };
        fetchProduct();
    }, [sku]);

    if (loading) {
        return (
            <div className="h-full flex items-center justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
            </div>
        );
    }

    if (!product) {
        return (
            <div className="h-full flex flex-col items-center justify-center gap-4 text-zinc-500">
                <AlertCircle className="w-8 h-8" />
                <p className="text-sm font-medium">Product Not Found</p>
                <Button variant="outline" onClick={() => router.push('/admin/products')}>Back to Catalogue</Button>
            </div>
        );
    }

    const baseStudioImg = product.ai_data?.images?.find((img) => img.suffix === 'base' || img.suffix?.toLowerCase() === 'base' || !img.suffix)?.url;
    const defaultImage = baseStudioImg || product.ai_data?.generated_images?.base || product.ai_data?.images?.[0]?.url || product.ai_data?.selected_images?.base || product.ai_data?.variant_images?.base?.[0]?.url;
    const mainImage = selectedImagePreview || defaultImage;
    const isPublished = !!product.shopify_product_id;

    return (
        <div className="flex flex-col h-[calc(100vh-3.5rem)] bg-white overflow-hidden">
            {/* Minimalist Top Nav */}
            <div className="flex items-center justify-between h-14 px-6 border-b border-zinc-200 shrink-0 bg-zinc-50/50">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" size="sm" onClick={() => router.push('/admin/products')} className="text-zinc-500 hover:text-zinc-900 -ml-2 h-8 px-2">
                        <ChevronLeft className="w-4 h-4 mr-1" /> Back
                    </Button>
                    <div className="h-4 w-px bg-zinc-300" />
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-zinc-500">{sku}</span>
                        {isPublished && <Badge variant="outline" className="border-emerald-200 text-emerald-700 bg-emerald-50 text-[9px] py-0 px-1.5 h-4">SYNCED</Badge>}
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <Button
                        variant="secondary"
                        size="sm"
                        className="h-8 bg-zinc-800 text-zinc-100 hover:bg-zinc-700 hover:text-white text-xs border border-zinc-700 gap-2"
                        onClick={() => router.push(`/admin/lab?skus=${sku}`)}
                    >
                        <Settings className="w-3.5 h-3.5" /> Manage
                    </Button>
                </div>
            </div>

            {/* Split View Content */}
            <div className="flex flex-1 overflow-hidden">

                {/* Visuals Sidebar (Left) */}
                <div className="w-[380px] border-r border-zinc-200 bg-zinc-50/30 flex flex-col overflow-y-auto">
                    <div className="p-6 space-y-6">
                        {/* Main Image Hero */}
                        <div className="aspect-[4/5] rounded-lg border border-zinc-200 bg-white shadow-sm flex items-center justify-center relative overflow-hidden group">
                            {mainImage ? (
                                <img src={mainImage} alt={product.ai_data?.title || product.pylon_data.name} className="w-full h-full object-contain p-4 group-hover:scale-105 transition-transform duration-500 mix-blend-multiply" />
                            ) : (
                                <div className="flex flex-col items-center gap-2 text-zinc-400">
                                    <ImageIcon className="w-8 h-8" />
                                    <span className="text-[10px] uppercase font-medium">No Visual</span>
                                </div>
                            )}
                        </div>

                        {/* Thumbnails */}
                        {(() => {
                            const imageSet = new Set<string>();
                            const images: {url: string}[] = [];
                            
                            const addImage = (url: string | undefined) => {
                                if (url && !imageSet.has(url)) {
                                    imageSet.add(url);
                                    images.push({ url });
                                }
                            };

                            addImage(baseStudioImg);
                            addImage(product.ai_data?.generated_images?.base);
                            addImage(product.ai_data?.selected_images?.base);

                            if (images.length > 0) {
                                return (
                                    <div className="grid grid-cols-4 gap-2">
                                        {images.map((img, i) => (
                                            <div key={i} onClick={() => setSelectedImagePreview(img.url)} className={cn("aspect-square rounded-md bg-white overflow-hidden cursor-pointer hover:border-zinc-400 transition-colors p-1", mainImage === img.url ? "border-2 border-zinc-900 shadow-sm" : "border border-zinc-200")}>
                                                <img src={img.url} className="w-full h-full object-cover rounded-sm mix-blend-multiply" />
                                            </div>
                                        ))}
                                    </div>
                                );
                            }
                            return null;
                        })()}

                        {/* Status Block */}
                        <div className="rounded-lg border border-zinc-200 bg-white p-4 space-y-3">
                            <h3 className="text-xs font-semibold text-zinc-900 border-b border-zinc-100 pb-2">Readiness Status</h3>
                            <div className="space-y-2 text-xs">
                                <div className="flex justify-between items-center">
                                    <span className="text-zinc-500">Metadata Enriched</span>
                                    {product.ai_data?.title ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : <span className="w-1.5 h-1.5 rounded-full bg-zinc-300" />}
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-zinc-500">Visuals Sourced</span>
                                    {mainImage ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : <span className="w-1.5 h-1.5 rounded-full bg-zinc-300" />}
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-zinc-500">Shopify Link</span>
                                    {isPublished ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : <span className="w-1.5 h-1.5 rounded-full bg-zinc-300" />}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Curation Form (Right) */}
                <div className="flex-1 overflow-y-auto bg-white p-8 lg:p-12">
                    <div className="max-w-3xl mx-auto space-y-12">

                        {/* Core Data */}
                        <section className="space-y-6">
                            <div className="space-y-4">
                                <label className="text-xs font-semibold text-zinc-900">Greek Title</label>
                                <div className="text-lg font-medium border-b-2 border-zinc-200 pb-2 bg-transparent">
                                    {product.ai_data?.title || product.pylon_data.name}
                                </div>
                                <div className="text-[10px] text-zinc-400 font-mono">Original: {product.pylon_data.name}</div>
                            </div>

                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
                                <div className="space-y-2">
                                    <label className="text-xs font-semibold text-zinc-900">Product Type</label>
                                    <div className="text-[13px] bg-zinc-50 border border-zinc-200 h-9 px-3 py-2 rounded-md flex items-center shadow-sm">
                                        {product.ai_data?.product_type || product.ai_data?.type || product.ai_data?.category || "Uncategorized"}
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs font-semibold text-zinc-900">Project Category</label>
                                    <div className="flex items-center gap-3">
                                        <div className="relative w-9 h-9 shrink-0">
                                            <Image
                                                src={getCategoryImage(product.ai_data?.project_category || (["Αυτοκίνητο", "Ναυτιλιακά", "Οικοδομικά", "Ειδικές Εφαρμογές"].includes(product.ai_data?.category || "") ? product.ai_data?.category : "") || "")}
                                                alt={product.ai_data?.project_category || "Uncategorized"}
                                                fill
                                                className="object-contain drop-shadow-[2px_4px_8px_rgba(0,0,0,0.1)]"
                                            />
                                        </div>
                                        <div className="text-[13px] bg-zinc-50 border border-zinc-200 h-9 px-3 py-2 rounded-md flex-1 flex items-center shadow-sm whitespace-nowrap overflow-hidden text-ellipsis">
                                            {product.ai_data?.project_category || (["Αυτοκίνητο", "Ναυτιλιακά", "Οικοδομικά", "Ειδικές Εφαρμογές"].includes(product.ai_data?.category || "") ? product.ai_data?.category : "") || "Uncategorized"}
                                        </div>
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs font-semibold text-zinc-900">Retail Price (€)</label>
                                    <div className="text-[13px] bg-zinc-50 border border-zinc-200 h-9 px-3 py-2 rounded-md">
                                        {(product.pylon_data.price_retail || 0).toFixed(2)}
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs font-semibold text-zinc-900">Wholesale Price (€)</label>
                                    <div className="text-[13px] bg-zinc-50 border border-zinc-200 h-9 px-3 py-2 rounded-md">
                                        {(product.pylon_data.price_bulk || 0).toFixed(2)}
                                    </div>
                                </div>
                            </div>
                        </section>

                        <hr className="border-zinc-100" />

                        {/* Semantic Description */}
                        <section className="space-y-4">
                            <label className="text-xs font-semibold text-zinc-900 flex items-center justify-between">
                                Greek Semantic Description
                                <Badge variant="outline" className="text-[9px] font-normal text-zinc-500 py-0 border-zinc-200">AI Authored</Badge>
                            </label>
                            <div className="min-h-[200px] text-sm bg-zinc-50/50 border border-zinc-200 rounded-md p-4 leading-relaxed whitespace-pre-wrap">
                                {product.ai_data?.description || product.pylon_data.description || <span className="text-zinc-400 italic">Awaiting enrichment...</span>}
                            </div>
                        </section>

                        {/* Technical Specs & Variants Side-by-Side */}
                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">

                            {/* Technical Specs */}
                            <section className="space-y-4">
                                <label className="text-xs font-semibold text-zinc-900">Technical Specifications</label>
                                <div className="rounded-lg border border-zinc-200 overflow-hidden text-sm">
                                    {Object.entries(product.ai_data?.technical_specs || {}).length > 0 ? (
                                        <table className="w-full text-left">
                                            <tbody className="divide-y divide-zinc-100">
                                                {Object.entries(product.ai_data?.technical_specs || {}).map(([key, value]) => (
                                                    <tr key={key} className="bg-white hover:bg-zinc-50/50">
                                                        <td className="p-2.5 font-medium text-zinc-600 border-r border-zinc-100 w-1/3 bg-zinc-50/50">
                                                            {key}
                                                        </td>
                                                        <td className="p-2.5 text-zinc-900">
                                                            {Array.isArray(value) ? value.join(", ") : String(value)}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    ) : (
                                        <div className="p-4 text-center text-xs text-zinc-500 bg-zinc-50">No specifications found.</div>
                                    )}
                                </div>
                            </section>

                            {/* Dynamic Variants */}
                            <section className="space-y-4">
                                <label className="text-xs font-semibold text-zinc-900 flex items-center justify-between">
                                    Dynamic Variants
                                    <Badge variant="outline" className="text-[9px] font-normal text-indigo-600 bg-indigo-50 border-indigo-200 py-0">Mapped to Shopify</Badge>
                                </label>
                                <div className="rounded-lg border border-zinc-200 overflow-hidden text-sm">
                                    {(product.ai_data?.variants || []).length > 0 ? (
                                        <table className="w-full text-left">
                                            <thead className="bg-zinc-50 border-b border-zinc-200 text-[10px] uppercase text-zinc-500">
                                                <tr>
                                                    <th className="p-2 font-medium">SKU Suffix</th>
                                                    <th className="p-2 font-medium">Option</th>
                                                    <th className="p-2 font-medium">Value</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-zinc-100 bg-white">
                                                {(product.ai_data?.variants || []).map((v, i) => (
                                                    <tr key={i}>
                                                        <td className="p-2 font-mono text-xs text-zinc-500">{v.sku_suffix}</td>
                                                        <td className="p-2 font-medium text-zinc-900">{v.option_name}</td>
                                                        <td className="p-2 text-zinc-600">{v.option_value}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    ) : (
                                        <div className="p-4 text-center text-xs text-zinc-500 bg-zinc-50">No dynamic variants detected.</div>
                                    )}
                                </div>
                            </section>
                        </div>

                        {/* Tags */}
                        <section className="space-y-4 pb-12">
                            <label className="text-xs font-semibold text-zinc-900">Tags</label>
                            <div className="flex flex-wrap gap-2">
                                {(product.ai_data?.tags || []).map((tag, i) => (
                                    <Badge key={i} variant="secondary" className="bg-zinc-100 text-zinc-700 font-normal px-2">
                                        {tag}
                                    </Badge>
                                ))}
                                {(!product.ai_data?.tags || product.ai_data.tags.length === 0) && (
                                    <div className="text-xs text-zinc-500 italic">No tags</div>
                                )}
                            </div>
                        </section>
                    </div>
                </div>
            </div>
        </div>
    );
}
