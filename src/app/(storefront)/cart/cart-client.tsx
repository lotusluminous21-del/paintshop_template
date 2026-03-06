"use client"

import * as React from "react"
import { Cart } from "@/lib/shopify/types"
import { Trash2, Lock, ArrowLeft, ShieldCheck } from "lucide-react"
import { cn } from "@/lib/utils"
import Image from "next/image"
import Link from "next/link"
import { useCartStore } from "@/store/cart-store"
import { updateCartItemQuantity, removeCartItem } from "@/app/actions/cart"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { IndexedFadeInUp, StaggerContainer, FadeInUp } from "@/components/ui/motion"

export function CartClient({ initialCart }: { initialCart?: Cart | null }) {
    const { cart, setCart, isSyncing, setIsSyncing } = useCartStore();
    const [isCheckingOut, setIsCheckingOut] = React.useState(false);

    // Sync initial server cart to Zustand if the server cart differs
    React.useEffect(() => {
        if (initialCart && (!cart || cart.id !== initialCart.id)) {
            setCart(initialCart);
        }
    }, [initialCart, cart, setCart]);

    // Use zustand cart as primary display logic instead of raw initial
    const displayCart = cart || initialCart;

    const handleUpdateQuantity = async (lineId: string, newQuantity: number) => {
        if (isSyncing) return;
        setIsSyncing(true);
        // Optimistic bounds
        const q = Math.max(1, newQuantity);
        try {
            const updatedCart = await updateCartItemQuantity(lineId, q);
            if (updatedCart) setCart(updatedCart);
        } catch (e) {
            console.error(e);
        }
        setIsSyncing(false);
    };

    const handleRemoveLine = async (lineId: string) => {
        if (isSyncing) return;
        setIsSyncing(true);
        try {
            const updatedCart = await removeCartItem(lineId);
            if (updatedCart) setCart(updatedCart);
        } catch (e) {
            console.error(e);
        }
        setIsSyncing(false);
    }

    const handleCheckout = () => {
        if (!displayCart?.checkoutUrl) return;
        setIsCheckingOut(true);
        window.location.href = displayCart.checkoutUrl;
    };

    const hasItems = displayCart && displayCart.lines.edges.length > 0;

    if (!hasItems) {
        return (
            <div className="flex-1 w-full max-w-6xl mx-auto px-4 md:px-8 mt-12 md:mt-24 z-10 flex flex-col items-center justify-center min-h-[400px]">
                <IndexedFadeInUp index={0}>
                    <h1 className="text-3xl font-extrabold text-[#0B1221] mb-4">Your Cart is Empty</h1>
                </IndexedFadeInUp>
                <IndexedFadeInUp index={1}>
                    <p className="text-[#4b5563] mb-8">Looks like you haven't added any products to your cart yet.</p>
                </IndexedFadeInUp>
                <IndexedFadeInUp index={2}>
                    <Link href="/categories">
                        <Button variant="default" className="rounded-full bg-[#0B1221] text-white hover:bg-black p-6 font-bold h-12 inline-flex items-center gap-2">
                            <ArrowLeft className="w-5 h-5" />
                            Continue Shopping
                        </Button>
                    </Link>
                </IndexedFadeInUp>
            </div>
        )
    }

    return (
        <div className="w-full bg-[#FAFAFB]">
            {/* Top offset wrapper mapping the standard page */}
            <main className="w-full max-w-[1280px] mx-auto px-4 md:px-8 py-10 md:py-16">

                <IndexedFadeInUp index={0}>
                    <h1 className="text-3xl md:text-[40px] font-extrabold text-[#0B1221] tracking-tight mb-8 md:mb-12">
                        Shopping Cart
                    </h1>
                </IndexedFadeInUp>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 md:gap-14">

                    {/* LEFT COLUMN: Cart Items */}
                    <div className="lg:col-span-7 xl:col-span-8 flex flex-col gap-8">

                        <StaggerContainer className={cn("flex flex-col gap-6 md:gap-8 transition-opacity", isSyncing && "opacity-60")}>
                            {displayCart.lines.edges.map(({ node }, index) => {
                                // Add bottom border to all but last item
                                const isLast = index === displayCart.lines.edges.length - 1;
                                return (
                                    <FadeInUp inStaggerGroup key={node.id} className={cn("flex flex-col sm:flex-row gap-6 pb-6 md:pb-8", !isLast && "border-b border-[#E5E7EB]")}>

                                        {/* Product Image */}
                                        <div className="sm:w-[120px] h-[120px] shrink-0 rounded-2xl bg-white border border-[#E5E7EB] shadow-[0_1px_2px_rgba(0,0,0,0.02)] relative flex items-center justify-center overflow-hidden p-2">
                                            {node.merchandise.image && (
                                                <Image
                                                    src={node.merchandise.image.url}
                                                    alt={node.merchandise.title}
                                                    fill
                                                    className="object-contain p-2"
                                                />
                                            )}
                                        </div>

                                        {/* Product Info & Actions */}
                                        <div className="flex-1 flex flex-col min-w-0">

                                            {/* Top Row: Title & Remove */}
                                            <div className="flex justify-between items-start gap-4">
                                                <div>
                                                    <h3 className="font-bold text-[#0B1221] text-lg leading-snug">
                                                        {node.merchandise.product.title}
                                                    </h3>
                                                    {node.merchandise.title !== "Default Title" && (
                                                        <p className="text-[13px] font-medium text-[#6B7280] mt-1">
                                                            {node.merchandise.title}
                                                        </p>
                                                    )}
                                                </div>

                                                {/* Trash Icon */}
                                                <button
                                                    onClick={() => handleRemoveLine(node.id)}
                                                    disabled={isSyncing}
                                                    className="text-[#9CA3AF] hover:text-[#EF4444] transition-colors p-2 -mr-2"
                                                >
                                                    <Trash2 className="w-[18px] h-[18px]" />
                                                </button>
                                            </div>

                                            {/* Bottom Row: Price & Quantity */}
                                            <div className="mt-auto flex justify-between items-end">
                                                <span className="font-extrabold text-[#0B1221] text-[17px]">
                                                    {node.merchandise.price.currencyCode === 'EUR' ? '€' : '$'}{Number(node.merchandise.price.amount).toFixed(2)}
                                                </span>

                                                <div className="inline-flex items-center rounded-lg bg-transparent border border-[#E5E7EB] p-[2px] shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
                                                    <button
                                                        onClick={() => handleUpdateQuantity(node.id, node.quantity - 1)}
                                                        disabled={isSyncing || node.quantity <= 1}
                                                        className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-[#F3F4F6] text-[#4B5563] disabled:opacity-50 transition-colors"
                                                    >
                                                        -
                                                    </button>
                                                    <span className="w-8 text-center text-sm font-bold text-[#0B1221]">
                                                        {node.quantity}
                                                    </span>
                                                    <button
                                                        onClick={() => handleUpdateQuantity(node.id, node.quantity + 1)}
                                                        disabled={isSyncing}
                                                        className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-[#F3F4F6] text-[#4B5563] disabled:opacity-50 transition-colors"
                                                    >
                                                        +
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </FadeInUp>
                                )
                            })}
                        </StaggerContainer>

                        {/* Continue Shopping Link */}
                        <FadeInUp delay={0.2} className="pt-4 mt-2">
                            <Link href="/categories" className="inline-flex items-center gap-2 text-[14px] font-semibold text-[#6B7280] hover:text-[#0B1221] transition-colors">
                                <ArrowLeft className="w-4 h-4" />
                                Continue Shopping
                            </Link>
                        </FadeInUp>

                    </div>

                    {/* RIGHT COLUMN: Order Summary */}
                    <FadeInUp delay={0.2} className="lg:col-span-5 xl:col-span-4 mt-8 lg:mt-0">
                        <div className="bg-[#F8F9FA] border border-[#E5E7EB] rounded-2xl p-6 lg:p-8 sticky top-32 shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
                            <h2 className="text-[20px] font-bold text-[#0B1221] mb-6">Order Summary</h2>

                            <div className="space-y-4 mb-6">
                                <div className="flex justify-between items-center text-[15px]">
                                    <span className="font-semibold text-[#6B7280]">Subtotal</span>
                                    <span className="font-bold text-[#0B1221]">
                                        {displayCart.cost.subtotalAmount.currencyCode === 'EUR' ? '€' : '$'}{Number(displayCart.cost.subtotalAmount.amount).toFixed(2)}
                                    </span>
                                </div>
                                <div className="flex justify-between items-center text-[15px]">
                                    <span className="font-semibold text-[#6B7280]">Shipping</span>
                                    <span className="font-bold text-[#10B981]">Free</span>
                                </div>
                                <div className="flex justify-between items-center text-[15px]">
                                    <span className="font-semibold text-[#6B7280]">Tax</span>
                                    <span className="font-bold text-[#0B1221]">
                                        {displayCart.cost.totalTaxAmount ?
                                            (displayCart.cost.totalTaxAmount.currencyCode === 'EUR' ? '€' : '$') + Number(displayCart.cost.totalTaxAmount.amount).toFixed(2)
                                            : 'Calculated at checkout'
                                        }
                                    </span>
                                </div>
                            </div>

                            <div className="pt-6 border-t border-[#E5E7EB] mb-8 flex justify-between items-end mt-2">
                                <span className="font-bold text-[#0B1221] text-[17px]">Total</span>
                                <span className="font-black text-[#0B1221] text-[32px] leading-tight">
                                    {displayCart.cost.totalAmount.currencyCode === 'EUR' ? '€' : '$'}{Number(displayCart.cost.totalAmount.amount).toFixed(2)}
                                </span>
                            </div>

                            {/* Promo Code */}
                            <div className="mb-4">
                                <label className="block text-[11px] font-bold text-[#9CA3AF] tracking-widest uppercase mb-2">PROMO CODE</label>
                                <div className="flex gap-2">
                                    <Input
                                        placeholder="Enter code"
                                        className="h-12 bg-white border border-[#E5E7EB] shadow-[0_1px_2px_rgba(0,0,0,0.02)] !rounded-[14px] px-4 focus-visible:ring-1 focus-visible:ring-[#0B1221] transition-all"
                                    />
                                    <Button
                                        className="h-12 bg-[#171B26] hover:bg-black text-white px-6 !rounded-[14px] font-semibold tracking-wide border-0 shadow-none transition-colors"
                                    >
                                        Apply
                                    </Button>
                                </div>
                            </div>

                            {/* Checkout Button */}
                            <button
                                className="w-full h-[56px] bg-[#171B26] hover:bg-black text-white rounded-none font-bold tracking-[0.12em] text-[12px] mt-8 flex items-center justify-center gap-3 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                onClick={handleCheckout}
                                disabled={isCheckingOut || !displayCart.checkoutUrl || isSyncing}
                            >
                                {isCheckingOut ? (
                                    "Preparing checkout..."
                                ) : (
                                    <>
                                        PROCEED TO CHECKOUT
                                        <Lock className="w-[14px] h-[14px] opacity-90" strokeWidth={1.5} />
                                    </>
                                )}
                            </button>

                            {/* Trust badges stub */}
                            <div className="mt-6 flex flex-col items-center gap-3">
                                <div className="flex items-center gap-2 text-[#9CA3AF] text-xs font-medium">
                                    <ShieldCheck className="w-[14px] h-[14px]" />
                                    <span>Secure Checkout powered by Pavlicevits Pay</span>
                                </div>
                                <div className="flex gap-2 opacity-30 mt-1">
                                    <div className="w-[42px] h-[26px] bg-black rounded-sm"></div>
                                    <div className="w-[42px] h-[26px] bg-black rounded-sm"></div>
                                    <div className="w-[42px] h-[26px] bg-black rounded-sm"></div>
                                </div>
                            </div>

                        </div>
                    </FadeInUp>

                </div>
            </main>
        </div>
    )
}
