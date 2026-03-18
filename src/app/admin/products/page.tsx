"use client";

import { useEffect, useState, Suspense } from "react";
import { collection, onSnapshot, query, orderBy, doc, deleteDoc, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useRouter, useSearchParams } from "next/navigation";
import { publishProductAction } from "@/app/actions/publish-product"; import {
    Search,
    Globe,
    ExternalLink,
    Loader2,
    Wand2,
    CheckCircle2,
    AlertCircle,
    Plus,
    Trash2,
    ChevronRight,
    ArrowRight,
    X,
    UploadCloud,
    Settings
} from "lucide-react";
import { cn } from "@/lib/utils";

// Shadcn UI Imports
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
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

// Types
interface StagingProduct {
    sku: string;
    status: string;
    pylon_data: {
        name: string;
        price_retail: number;
    };
    ai_data?: {
        title?: string; // Greek title from new schema
        description?: string; // Greek description from new schema
        images?: Array<{ url: string; suffix?: string }>;
        variant_images?: Record<string, Array<{ url: string }>>;
        generated_images?: Record<string, string>;
        selected_images?: Record<string, string>;
    };
    shopify_product_id?: string;
    shopify_handle?: string;
}

function StagingAreaContent() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const [products, setProducts] = useState<StagingProduct[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState(searchParams.get("search") || "");
    const [selectedSkus, setSelectedSkus] = useState<Set<string>>(new Set());
    // Listen to ALL staging products
    useEffect(() => {
        if (!db) return;

        const q = query(
            collection(db, "staging_products"),
            orderBy("updated_at", "desc")
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const items: StagingProduct[] = [];
            snapshot.forEach((doc) => items.push(doc.data() as StagingProduct));
            // Keep the default order as is (newest first based on updated_at)
            setProducts(items);
            setLoading(false);
        }, (err) => {
            console.error("Firestore Listen Error:", err);
            setLoading(false);
        });

        return () => unsubscribe();
    }, []);

    const toggleSku = (sku: string) => {
        const next = new Set(selectedSkus);
        if (next.has(sku)) next.delete(sku);
        else next.add(sku);
        setSelectedSkus(next);
    };



    const filteredProducts = products.filter(p =>
        p.pylon_data.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.sku.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.ai_data?.title?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const selectMacro = (type: 'all' | 'none') => {
        if (type === 'none') {
            setSelectedSkus(new Set());
            return;
        }
        const next = new Set<string>();
        filteredProducts.forEach(p => {
            if (type === 'all') next.add(p.sku);
        });
        setSelectedSkus(next);
    };

    return (
        <div className="flex flex-col h-full bg-white rounded-lg border border-zinc-200 shadow-sm relative">

            {/* Header Toolbar */}
            <div className="flex items-center justify-between p-4 border-b border-zinc-200 bg-zinc-50/50">
                <div className="flex items-center gap-4">
                    <h1 className="text-lg font-semibold text-zinc-900 tracking-tight">Product Catalogue</h1>
                    <div className="h-4 w-px bg-zinc-300 mx-2" />

                </div>

                <div className="flex items-center gap-3">
                    <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" />
                        <Input
                            placeholder="Search SKU or Name..."
                            className="pl-8 w-64 h-8 text-xs bg-white border-zinc-200 focus:ring-1 focus:ring-zinc-400"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>
                </div>
            </div>

            {/* High-Density Data Table */}
            <ScrollArea className="flex-1 min-h-0">
                <table className="w-full text-left border-collapse text-sm">
                    <thead className="sticky top-0 bg-white z-10 border-b border-zinc-200 shadow-sm">
                        <tr>
                            <th className="w-12 p-3 font-semibold text-zinc-500 text-xs text-center border-r border-zinc-100">
                                <input
                                    type="checkbox"
                                    className="rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900"
                                    onChange={(e) => e.target.checked ? selectMacro('all') : selectMacro('none')}
                                    checked={selectedSkus.size > 0 && selectedSkus.size === filteredProducts.length}
                                />
                            </th>
                            <th className="w-16 p-3 font-semibold text-zinc-500 text-xs">Image</th>
                            <th className="w-32 p-3 font-semibold text-zinc-500 text-xs">SKU</th>
                            <th className="p-3 font-semibold text-zinc-500 text-xs">Title & Original Name</th>
                            <th className="w-24 p-3 font-semibold text-zinc-500 text-xs text-right">Price</th>
                            <th className="w-24 p-3 font-semibold text-zinc-500 text-xs text-center">Action</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 bg-white">
                        {loading ? (
                            <tr>
                                <td colSpan={7} className="h-64 text-center text-zinc-400 text-sm">
                                    <div className="flex items-center justify-center gap-2">
                                        <Loader2 className="w-4 h-4 animate-spin" /> Loading laboratory data...
                                    </div>
                                </td>
                            </tr>
                        ) : filteredProducts.length === 0 ? (
                            <tr>
                                <td colSpan={7} className="h-64 text-center text-zinc-500 text-sm">
                                    No products found matching criteria.
                                </td>
                            </tr>
                        ) : (
                            filteredProducts.map((p) => {
                                const isSelected = selectedSkus.has(p.sku);
                                const isPublished = !!p.shopify_product_id;
                                const baseStudioImg = p.ai_data?.images?.find((img) => img.suffix === 'base' || img.suffix?.toLowerCase() === 'base' || !img.suffix)?.url;
                                const imgUrl = baseStudioImg || p.ai_data?.generated_images?.base || p.ai_data?.images?.[0]?.url || p.ai_data?.selected_images?.base || p.ai_data?.variant_images?.base?.[0]?.url;

                                return (
                                    <tr
                                        key={p.sku}
                                        className={cn(
                                            "hover:bg-zinc-50 transition-colors group",
                                            isSelected ? "bg-zinc-50/80" : ""
                                        )}
                                        onClick={(e) => {
                                            // Handle row click routing, ignore if clicking checkbox
                                            // @ts-ignore
                                            if (e.target.type !== "checkbox") router.push(`/admin/products/${p.sku}`);
                                        }}
                                    >
                                        <td className="p-3 text-center border-r border-zinc-50" onClick={(e) => e.stopPropagation()}>
                                            <input
                                                type="checkbox"
                                                className="rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900 cursor-pointer"
                                                checked={isSelected}
                                                onChange={() => toggleSku(p.sku)}
                                            />
                                        </td>
                                        <td className="p-3 cursor-pointer">
                                            {imgUrl ? (
                                                <div className="w-10 h-10 rounded-md border border-zinc-200 bg-white overflow-hidden flex items-center justify-center shrink-0">
                                                    <img src={imgUrl} alt={p.sku} className="max-w-full max-h-full object-contain p-1 mix-blend-multiply" />
                                                </div>
                                            ) : (
                                                <div className="w-10 h-10 rounded-md border border-zinc-200 border-dashed bg-zinc-50 flex items-center justify-center text-zinc-300 shrink-0">
                                                    <Settings className="w-4 h-4" />
                                                </div>
                                            )}
                                        </td>
                                        <td className="p-3 font-mono text-xs text-zinc-600 cursor-pointer">
                                            {p.sku}
                                            {isPublished && <Badge variant="outline" className="ml-2 text-[9px] py-0 px-1 border-emerald-200 text-emerald-700 bg-emerald-50">SYNCED</Badge>}
                                        </td>
                                        <td className="p-3 cursor-pointer">
                                            <div className="font-medium text-zinc-900 text-sm line-clamp-1 group-hover:underline decoration-zinc-300 underline-offset-2">
                                                {p.ai_data?.title || <span className="text-zinc-400 italic">Semantic title pending...</span>}
                                            </div>
                                            <div className="text-xs text-zinc-500 line-clamp-1 mt-0.5 opacity-80">
                                                {p.pylon_data.name}
                                            </div>
                                        </td>
                                        <td className="p-3 text-right text-xs text-zinc-600 font-medium cursor-pointer">
                                            €{(p.pylon_data.price_retail || 0).toFixed(2)}
                                        </td>
                                        <td className="p-3 text-center">
                                            <Button variant="ghost" size="icon" className="h-8 w-8 text-zinc-400 hover:text-zinc-900 pointer-events-none group-hover:pointer-events-auto">
                                                <ChevronRight className="w-4 h-4" />
                                            </Button>
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </ScrollArea>

            {/* Bottom Activity Dock for Bulk Actions */}
            {selectedSkus.size > 0 && (
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-zinc-900 text-zinc-50 px-4 py-3 rounded-lg shadow-xl flex items-center gap-6 z-50 animate-in slide-in-from-bottom-4 border border-zinc-800">
                    <div className="text-sm font-medium flex items-center gap-2">
                        <Badge variant="secondary" className="bg-zinc-800 text-zinc-100 border-zinc-700 hover:bg-zinc-800 pointer-events-none">
                            {selectedSkus.size}
                        </Badge>
                        <span className="text-zinc-400">selected</span>
                    </div>

                    <div className="w-px h-6 bg-zinc-700 mx-2" />

                    <div className="flex items-center gap-2">
                        <Button
                            variant="secondary"
                            size="sm"
                            className="h-8 bg-zinc-800 text-zinc-100 hover:bg-zinc-700 hover:text-white text-xs border border-zinc-700 gap-2"
                            onClick={() => router.push(`/admin/lab?skus=${Array.from(selectedSkus).join(",")}`)}
                        >
                            <Settings className="w-3.5 h-3.5" /> Manage
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}

export default function AdminStagingAreaPage() {
    return (
        <div className="h-full">
            <Suspense fallback={
                <div className="h-full flex flex-col items-center justify-center gap-4 text-zinc-400">
                    <Loader2 className="w-8 h-8 animate-spin" />
                    <span className="font-medium text-sm">Mounting Datatable...</span>
                </div>
            }>
                <StagingAreaContent />
            </Suspense>
        </div>
    );
}
