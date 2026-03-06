import * as React from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { Plus } from "lucide-react";
import { Product } from "@/lib/shopify/types";
import { useMobileCenterHover } from "@/hooks/useMobileCenterHover";

interface ProductCardProps {
    product: Product;
    variant?: "standard" | "summary" | "featured";
    className?: string;
}

export function ProductCard({ product, variant = "standard", className }: ProductCardProps) {
    const { ref, isHovered } = useMobileCenterHover<HTMLDivElement>();
    const price = product.priceRange.minVariantPrice.amount;
    const currency = product.priceRange.minVariantPrice.currencyCode === "EUR" ? "€" : "$";
    const featuredImage = product.featuredImage;

    if (variant === "summary") {
        return (
            <div
                ref={ref}
                data-smart-hover={isHovered}
                className={cn(
                    "group relative flex items-center gap-[18px] p-[16px] rounded-[28px] bg-[#ffffff] transition-all duration-300",
                    "shadow-sm",
                    "hover:shadow-sm data-[smart-hover=true]:shadow-sm",
                    className
                )}
            >
                <div className="relative w-[60px] h-[60px] shrink-0 rounded-[18px] bg-[#ffffff] shadow-sm flex items-center justify-center p-[10px]">
                    {featuredImage && (
                        <div className="relative w-full h-full">
                            <Image
                                src={featuredImage.url}
                                alt={featuredImage.altText || product.title}
                                fill
                                className="object-contain drop-shadow-sm"
                            />
                        </div>
                    )}
                </div>
                <div className="flex-1 min-w-0 pr-[4px] flex flex-col justify-between py-[2px] h-[58px]">
                    <div className="flex justify-between items-center leading-none">
                        <h3 className="text-[16px] font-bold text-slate-800 truncate tracking-tight">
                            Summary
                        </h3>
                        <span className="text-[16px] font-[800] text-slate-900 tracking-tight shrink-0">
                            {currency}{price}
                        </span>
                    </div>
                    <p className="text-[14px] font-semibold text-slate-600 truncate leading-none mt-[-1px]">
                        {product.title}
                    </p>
                    <div className="flex justify-between items-center leading-none mt-[6px]">
                        <p className="text-[13px] font-medium text-slate-500 truncate">
                            Madiva solutns
                        </p>
                        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest shrink-0 mt-[2px]">
                            Board
                        </span>
                    </div>
                </div>
            </div>
        );
    }

    if (variant === "featured") {
        return (
            <div
                ref={ref}
                data-smart-hover={isHovered}
                className={cn(
                    "group relative flex flex-col items-center w-[160px] p-4 rounded-[24px] bg-[#ffffff] transition-all duration-300",
                    "shadow-sm",
                    "hover:shadow-sm data-[smart-hover=true]:shadow-sm",
                    className
                )}
            >
                <div className="relative w-full aspect-square mb-3">
                    {featuredImage && (
                        <Image
                            src={featuredImage.url}
                            alt={featuredImage.altText || product.title}
                            fill
                            className="object-contain drop-shadow-sm transition-transform duration-500 group-hover:scale-105 group-data-[smart-hover=true]:scale-105"
                        />
                    )}
                </div>
                <div className="w-full flex flex-col items-center justify-center mt-auto">
                    <h3 className="text-[14px] font-bold text-slate-800 text-center leading-[1.25] line-clamp-2 tracking-tight">
                        {product.title}
                    </h3>
                    <span className="text-[12px] font-medium text-slate-500 mt-1.5">
                        {product.productType || "Premium"}
                    </span>
                    <span className="text-[15px] font-bold text-slate-900 tracking-tight mt-1.5">
                        {currency}{price}
                    </span>
                </div>
            </div>
        );
    }

    // Standard variant
    return (
        <div
            ref={ref}
            data-smart-hover={isHovered}
            className={cn(
                "group relative flex flex-col w-[174px] p-[20px] rounded-[32px] bg-[#ffffff] transition-all duration-300",
                "shadow-sm",
                "hover:shadow-sm data-[smart-hover=true]:shadow-sm",
                className
            )}
        >
            <div className="relative w-full h-[140px] mb-[16px]">
                {featuredImage && (
                    <Image
                        src={featuredImage.url}
                        alt={featuredImage.altText || product.title}
                        fill
                        className="object-contain transition-transform duration-500 group-hover:scale-105 group-data-[smart-hover=true]:scale-105 drop-shadow-sm pt-[6px]"
                    />
                )}
            </div>

            <div className="flex flex-col flex-1 justify-end mt-auto w-full">
                <h3 className="text-[16px] font-bold text-slate-800 leading-[1.2] line-clamp-2 tracking-tight mb-[14px]">
                    {product.title}
                </h3>
                <div className="flex items-center justify-between w-full">
                    <span className="text-[18px] font-extrabold text-slate-900 tracking-tight">
                        {currency}{price}
                    </span>
                    <button
                        className="w-[42px] h-[42px] rounded-[16px] flex items-center justify-center bg-[#00E5CC] text-slate-900 shadow-sm transition-all hover:scale-105 active:scale-95 shrink-0"
                    >
                        <Plus className="w-[22px] h-[22px]" strokeWidth={2.5} />
                    </button>
                </div>
            </div>
        </div>
    );
}
