import { env } from '../env';

const SHOPIFY_ADMIN_API_VERSION = '2024-01'; // or latest
const SHOPIFY_DOMAIN = env.SHOPIFY_STORE_DOMAIN;
const ACCESS_TOKEN = env.SHOPIFY_ADMIN_ACCESS_TOKEN;

if (!ACCESS_TOKEN) {
    console.warn("Missing SHOPIFY_ADMIN_ACCESS_TOKEN. Admin features will fail.");
}

interface ShopifyProductInput {
    title: string;
    body_html: string;
    vendor: string;
    product_type: string;
    status?: 'active' | 'archived' | 'draft';
    published?: boolean;
    tags: string[];
    variants: Array<{
        price: string;
        sku?: string;
        option1?: string;
        inventory_management?: string | null;
        inventory_policy?: 'deny' | 'continue';
        inventory_quantity?: number;
    }>;
    options?: Array<{
        name: string;
        values: string[];
    }>;
    metafields?: any[];
    id?: number | string;
}

export async function createShopifyProduct(productData: ShopifyProductInput) {
    if (!ACCESS_TOKEN) throw new Error("Missing Admin Token");

    const url = `https://${SHOPIFY_DOMAIN}/admin/api/${SHOPIFY_ADMIN_API_VERSION}/products.json`;

    // Prepare payload
    // Shopify Admin API expects { "product": { ... } }
    const payload = {
        product: productData
    };

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': ACCESS_TOKEN
        },
        body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
        console.error("Shopify Create Error:", data);
        throw new Error(data.errors ? JSON.stringify(data.errors) : "Failed to create product");
    }

    return data.product;
}

export async function updateShopifyProduct(productId: string | number, productData: Partial<ShopifyProductInput>) {
    if (!ACCESS_TOKEN) throw new Error("Missing Admin Token");

    const url = `https://${SHOPIFY_DOMAIN}/admin/api/${SHOPIFY_ADMIN_API_VERSION}/products/${productId}.json`;

    const payload = {
        product: productData
    };

    const response = await fetch(url, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': ACCESS_TOKEN
        },
        body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
        console.error("Shopify Update Error:", data);
        throw new Error(data.errors ? JSON.stringify(data.errors) : "Failed to update product");
    }

    return data.product;
}

export async function deleteShopifyProduct(productId: string | number) {
    if (!ACCESS_TOKEN) throw new Error("Missing Admin Token");

    const url = `https://${SHOPIFY_DOMAIN}/admin/api/${SHOPIFY_ADMIN_API_VERSION}/products/${productId}.json`;

    const response = await fetch(url, {
        method: 'DELETE',
        headers: {
            'X-Shopify-Access-Token': ACCESS_TOKEN
        }
    });

    if (!response.ok) {
        const data = await response.json();
        console.error("Shopify Delete Error:", data);
        throw new Error("Failed to delete product");
    }

    return true;
}

export async function getShopifyProduct(productId: string | number) {
    if (!ACCESS_TOKEN) throw new Error("Missing Admin Token");

    const url = `https://${SHOPIFY_DOMAIN}/admin/api/${SHOPIFY_ADMIN_API_VERSION}/products/${productId}.json`;

    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'X-Shopify-Access-Token': ACCESS_TOKEN
        }
    });

    const data = await response.json();

    if (!response.ok) {
        console.error("Shopify Get Error:", data);
        throw new Error("Failed to fetch product from Shopify");
    }

    return data.product;
}

export async function shopifyGraphql(query: string, variables = {}) {
    if (!ACCESS_TOKEN) throw new Error("Missing Admin Token");

    const url = `https://${SHOPIFY_DOMAIN}/admin/api/${SHOPIFY_ADMIN_API_VERSION}/graphql.json`;

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': ACCESS_TOKEN
        },
        body: JSON.stringify({ query, variables })
    });

    const data = await response.json();
    if (!response.ok || data.errors) {
        console.error("Shopify GraphQL Error:", data.errors || data);
        throw new Error("GraphQL request failed");
    }

    return data.data;
}

export async function publishProductToChannel(productId: string | number, publicationId: string) {
    const gid = productId.toString().startsWith('gid://') ? productId : `gid://shopify/Product/${productId}`;

    const query = `
    mutation publishablePublish($id: ID!, $input: [PublicationInput!]!) {
      publishablePublish(id: $id, input: $input) {
        publishable {
          ... on Product {
            id
            title
          }
        }
        userErrors {
          field
          message
        }
      }
    }
    `;

    const variables = {
        id: gid,
        input: [{ publicationId }]
    };

    const data = await shopifyGraphql(query, variables);

    if (data.publishablePublish.userErrors && data.publishablePublish.userErrors.length > 0) {
        console.error("Shopify Publication Error:", data.publishablePublish.userErrors);
        throw new Error(data.publishablePublish.userErrors[0].message);
    }

    return data.publishablePublish.publishable;
}

export async function findProductBySku(sku: string) {
    const query = `
    query($query: String!) {
      products(first: 1, query: $query) {
        edges {
          node {
            id
            handle
            title
          }
        }
      }
    }
    `;

    const data = await shopifyGraphql(query, { query: `sku:${sku}` });
    const products = data.products.edges;

    if (products.length > 0) {
        // Return REST-compatible ID (strip gid://shopify/Product/)
        const gid = products[0].node.id;
        return {
            id: gid.split('/').pop(),
            handle: products[0].node.handle,
            title: products[0].node.title
        };
    }

    return null;
}
