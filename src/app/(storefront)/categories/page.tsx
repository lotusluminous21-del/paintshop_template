import { getProducts, getProductTypes } from "@/lib/shopify/client";


import { CategoriesClient } from "./categories-client";
import { Metadata } from "next";

export const metadata: Metadata = {
    title: "Shop | Pavlicevits",
    description: "Browse our premium industrial coating products",
};

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function CategoriesPage({
    searchParams
}: {
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
    const params = await searchParams;
    const activeType = typeof params.type === 'string' ? params.type : 'all';
    const activeCategory = typeof params.category === 'string' ? params.category : undefined;

    // Fetch all products and product types in parallel
    const [allProducts, productTypes] = await Promise.all([
        getProducts(),
        getProductTypes(),
    ]);

    console.log("FIRST PAGE PRODUCT METAFIELDS:", JSON.stringify(allProducts[0]?.metafields, null, 2));

    return (
        <CategoriesClient
            products={allProducts}
            productTypes={productTypes}
            activeType={activeType}
            initialCategory={activeCategory}
        />
    );
}
