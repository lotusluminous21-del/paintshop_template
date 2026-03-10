import os
import httpx
from typing import Optional, Dict, Any, List
from core.logger import get_logger

logger = get_logger("shopify.client")

class ShopifyClient:
    """Client for interacting with Shopify Admin API."""
    
    API_VERSION = "2024-01"

    def __init__(self):
        self.domain = os.environ.get("SHOPIFY_STORE_DOMAIN")
        self.token = os.environ.get("SHOPIFY_ADMIN_ACCESS_TOKEN")
        
        if not self.domain or not self.token:
            logger.warning("Shopify credentials not found in environment variables.")

        self.base_url = f"https://{self.domain}/admin/api/{self.API_VERSION}"
        self._collection_cache: Dict[str, str] = {}  # title -> collection_id cache
        self._publication_cache: Dict[str, str] = {}  # channel_name -> publication_gid cache

    def get_or_create_customer(self, email: str, first_name: str = "", last_name: str = "") -> Optional[Dict[str, Any]]:
        """
        Syncs a Firebase user to Shopify.
        Checks if customer exists by email. If yes, returns it.
        If no, creates a new customer.
        """
        if not self.domain or not self.token:
            return None
        
        headers = {
            "X-Shopify-Access-Token": self.token,
            "Content-Type": "application/json"
        }
        
        try:
            with httpx.Client() as client:
                # 1. Search for existing customer
                search_url = f"{self.base_url}/customers/search.json"
                logger.info(f"Searching for Shopify customer: {email}")
                
                response = client.get(
                    search_url, 
                    headers=headers, 
                    params={"query": f"email:{email}"}
                )
                response.raise_for_status()
                
                customers = response.json().get("customers", [])
                
                if customers:
                    customer = customers[0]
                    # Fetch detailed customer info (search results might be partial? usually full but let's be safe)
                    # For performance, we can just use the search result if it has addresses.
                    # Search result usually contains 'default_address' and 'addresses'.
                    
                    logger.info(f"Found existing Shopify customer ID: {customer['id']}")
                    return customer

                # 2. Create new customer
                logger.info(f"Creating new Shopify customer for {email}")
                create_url = f"{self.base_url}/customers.json"
                payload = {
                    "customer": {
                        "email": email,
                        "first_name": first_name,
                        "last_name": last_name,
                        "verified_email": True,
                        "send_email_invite": False,
                        # Can't easily add address here without more info from user auth provider.
                        # Usually user signs up with just email/name.
                    }
                }
                
                response = client.post(create_url, json=payload, headers=headers)
                
            if response.status_code == 422:
                # Handle race condition or weak search match
                logger.warning(f"Shopify creation failed (422): {response.text}")
                return None
            
            try:
                response.raise_for_status()
            except httpx.HTTPStatusError as e:
                logger.error(f"HTTP Error {e.response.status_code}: {e.response.text}")
                raise e
            
            customer = response.json().get("customer")
            logger.info(f"Created new Shopify user ID: {customer['id']}")
            return customer
                
        except Exception as e:
            logger.error(f"Error syncing customer to Shopify: {e}")
            return None

    def get_inventory_item_id_by_sku(self, sku: str) -> Optional[str]:
        """
        Fetches the Inventory Item ID for a given SKU.
        Note: This requires querying Product Variants first.
        """
        if not self.domain or not self.token:
            return None

        headers = {
            "X-Shopify-Access-Token": self.token,
            "Content-Type": "application/json"
        }
        
        # GraphQL Query to find variant by SKU
        query = """
        {
          productVariants(first: 1, query: "sku:%s") {
            edges {
              node {
                inventoryItem {
                  id
                }
              }
            }
          }
        }
        """ % sku
        
        try:
            with httpx.Client() as client:
                response = client.post(
                    f"https://{self.domain}/admin/api/2024-01/graphql.json",
                    headers=headers,
                    json={"query": query}
                )
                response.raise_for_status()
                data = response.json()
                
                edges = data.get("data", {}).get("productVariants", {}).get("edges", [])
                if edges:
                    return edges[0]["node"]["inventoryItem"]["id"]
                return None
        except Exception as e:
            logger.error(f"Error finding inventory item for SKU {sku}: {e}")
            return None

    def update_inventory_bulk(self, adjustments: List[Dict[str, Any]], location_id: str = None) -> bool:
        """
        Updates inventory levels for multiple items.
        uses inventorySetQuantities (GraphQL).
        
        adjustments: List of dicts with 'inventoryItemId' and 'quantity'.
        """
        if not self.domain or not self.token:
            return False
            
        if not location_id:
            # TODO: Fetch default location ID if not provided
            # For now, we assume it's passed or we hardcode the primary one
            location_id = os.environ.get("SHOPIFY_LOCATION_ID")
            if not location_id:
                logger.error("SHOPIFY_LOCATION_ID is missing")
                return False

        headers = {
            "X-Shopify-Access-Token": self.token,
            "Content-Type": "application/json"
        }

        mutation = """
        mutation inventorySetQuantities($input: InventorySetQuantitiesInput!) {
          inventorySetQuantities(input: $input) {
            userErrors {
              field
              message
            }
            inventoryAdjustmentGroup {
              reason
              changes {
                name
                delta
              }
            }
          }
        }
        """
        
        # Prepare inputs
        inputs = []
        for adj in adjustments:
            inputs.append({
                "inventoryItemId": adj["inventoryItemId"],
                "quantity": adj["quantity"],
                "locationId": location_id
            })
            
        payload = {
            "query": mutation,
            "variables": {
                "input": {
                    "name": "available",
                    "reason": "correction",
                    "ignoreCompareQuantity": True,
                    "quantities": inputs
                }
            }
        }

        try:
            with httpx.Client() as client:
                response = client.post(
                    f"https://{self.domain}/admin/api/2024-01/graphql.json", 
                    headers=headers, 
                    json=payload
                )
                response.raise_for_status()
                result = response.json()
                
                errors = result.get("data", {}).get("inventorySetQuantities", {}).get("userErrors", [])
                if errors:
                    logger.error(f"Shopify Inventory Update Errors: {errors}")
                    return False
                
                logger.info(f"Successfully updated inventory for {len(inputs)} items.")
                return True
                
        except Exception as e:
            logger.error(f"Error updating Shopify inventory: {e}")
            return False

    def create_product(self, product_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """
        Creates a new product in Shopify.
        Returns the FULL product dict (including variants with IDs, images with IDs)
        so the caller can link variant images without extra API calls.
        Returns None on failure.
        """
        if not self.domain or not self.token:
            return None

        headers = {
            "X-Shopify-Access-Token": self.token,
            "Content-Type": "application/json"
        }

        url = f"{self.base_url}/products.json"
        
        try:
            with httpx.Client(timeout=60.0) as client:
                response = client.post(url, headers=headers, json={"product": product_data})
                response.raise_for_status()
                data = response.json()
                product = data.get("product")
                if not product or not product.get("id"):
                    logger.error(f"Shopify returned success but no product data")
                    return None
                return product
        except httpx.HTTPStatusError as e:
            logger.error(f"Shopify HTTP Error creating product: {e.response.status_code} - {e.response.text[:500]}")
            return None
        except Exception as e:
            logger.error(f"Error creating product in Shopify: {e}")
            return None

    def get_product_variants(self, product_id: str) -> List[Dict[str, Any]]:
        """
        Fetches all variants for a product.
        """
        if not self.domain or not self.token:
            return []
        headers = {
            "X-Shopify-Access-Token": self.token,
            "Content-Type": "application/json"
        }
        try:
            with httpx.Client() as client:
                url = f"{self.base_url}/products/{product_id}/variants.json"
                response = client.get(url, headers=headers)
                response.raise_for_status()
                return response.json().get("variants", [])
        except Exception as e:
            logger.error(f"Error fetching variants for product {product_id}: {e}")
            return []

    def _graphql_request(self, query: str, variables: Dict[str, Any] = None) -> Optional[Dict]:
        """Helper for GraphQL Admin API requests."""
        if not self.domain or not self.token:
            return None
        headers = {
            "X-Shopify-Access-Token": self.token,
            "Content-Type": "application/json"
        }
        payload = {"query": query}
        if variables:
            payload["variables"] = variables
        try:
            with httpx.Client() as client:
                response = client.post(
                    f"https://{self.domain}/admin/api/{self.API_VERSION}/graphql.json",
                    headers=headers,
                    json=payload,
                    timeout=30.0
                )
                response.raise_for_status()
                return response.json()
        except Exception as e:
            logger.error(f"GraphQL request failed: {e}")
            return None

    def get_or_create_collection(self, title: str) -> Optional[str]:
        """
        Finds an existing custom collection by title, or creates one.
        Returns the numeric collection ID. Uses session-level caching.
        """
        # Check cache first
        if title in self._collection_cache:
            return self._collection_cache[title]

        if not self.domain or not self.token:
            return None

        headers = {
            "X-Shopify-Access-Token": self.token,
            "Content-Type": "application/json"
        }

        try:
            with httpx.Client() as client:
                # 1. Search for existing collection by title
                search_url = f"{self.base_url}/custom_collections.json"
                response = client.get(
                    search_url,
                    headers=headers,
                    params={"title": title, "limit": 1}
                )
                response.raise_for_status()
                collections = response.json().get("custom_collections", [])

                if collections:
                    coll_id = str(collections[0]["id"])
                    self._collection_cache[title] = coll_id
                    logger.info(f"Found existing collection '{title}' (ID: {coll_id})")
                    return coll_id

                # 2. Create new collection
                logger.info(f"Creating new collection: '{title}'")
                create_url = f"{self.base_url}/custom_collections.json"
                payload = {
                    "custom_collection": {
                        "title": title,
                        "published": True
                    }
                }
                response = client.post(create_url, json=payload, headers=headers)
                response.raise_for_status()
                new_coll = response.json().get("custom_collection", {})
                coll_id = str(new_coll.get("id"))
                self._collection_cache[title] = coll_id
                logger.info(f"Created collection '{title}' (ID: {coll_id})")
                return coll_id

        except Exception as e:
            logger.error(f"Error getting/creating collection '{title}': {e}")
            return None

    def add_product_to_collection(self, product_id: str, collection_id: str) -> bool:
        """
        Adds a product to a custom collection via the Collects API.
        """
        if not self.domain or not self.token:
            return False

        headers = {
            "X-Shopify-Access-Token": self.token,
            "Content-Type": "application/json"
        }

        try:
            with httpx.Client() as client:
                url = f"{self.base_url}/collects.json"
                payload = {
                    "collect": {
                        "product_id": int(product_id),
                        "collection_id": int(collection_id)
                    }
                }
                response = client.post(url, json=payload, headers=headers)
                if response.status_code == 422:
                    # Product may already be in collection
                    logger.info(f"Product {product_id} already in collection {collection_id} (or validation error).")
                    return True
                response.raise_for_status()
                logger.info(f"Added product {product_id} to collection {collection_id}")
                return True
        except Exception as e:
            logger.error(f"Error adding product to collection: {e}")
            return False

    def get_product_images(self, product_id: str) -> List[Dict[str, Any]]:
        """
        Fetches all images for a product. Returns list of image dicts with 'id', 'src', etc.
        """
        if not self.domain or not self.token:
            return []

        headers = {
            "X-Shopify-Access-Token": self.token,
            "Content-Type": "application/json"
        }

        try:
            with httpx.Client() as client:
                url = f"{self.base_url}/products/{product_id}/images.json"
                response = client.get(url, headers=headers)
                response.raise_for_status()
                return response.json().get("images", [])
        except Exception as e:
            logger.error(f"Error fetching images for product {product_id}: {e}")
            return []

    def update_variant_image(self, variant_id: str, image_id: int) -> bool:
        """
        Sets the image_id for a specific variant.
        """
        if not self.domain or not self.token:
            return False

        headers = {
            "X-Shopify-Access-Token": self.token,
            "Content-Type": "application/json"
        }

        try:
            with httpx.Client() as client:
                url = f"{self.base_url}/variants/{variant_id}.json"
                payload = {
                    "variant": {
                        "id": int(variant_id),
                        "image_id": image_id
                    }
                }
                response = client.put(url, json=payload, headers=headers)
                response.raise_for_status()
                return True
        except Exception as e:
            logger.error(f"Error updating variant {variant_id} image: {e}")
            return False

    def get_publication_id(self, channel_name: str) -> Optional[str]:
        """
        Finds the publication GID for a sales channel by name.
        Uses session-level caching.
        """
        if channel_name in self._publication_cache:
            return self._publication_cache[channel_name]

        query = """
        {
            publications(first: 30) {
                edges {
                    node {
                        id
                        name
                    }
                }
            }
        }
        """
        result = self._graphql_request(query)
        if not result:
            return None

        try:
            publications = result.get("data", {}).get("publications", {}).get("edges", [])
            for edge in publications:
                node = edge.get("node", {})
                pub_name = node.get("name", "")
                pub_id = node.get("id", "")
                # Cache all publications while we're at it
                if pub_name:
                    self._publication_cache[pub_name] = pub_id

            if channel_name in self._publication_cache:
                logger.info(f"Found publication '{channel_name}' (ID: {self._publication_cache[channel_name]})")
                return self._publication_cache[channel_name]
            else:
                available = [e["node"]["name"] for e in publications if e.get("node", {}).get("name")]
                logger.warning(f"Publication '{channel_name}' not found. Available: {available}")
                return None
        except Exception as e:
            logger.error(f"Error parsing publications response: {e}")
            return None

    def publish_product_to_channel(self, product_id: str, publication_gid: str) -> bool:
        """
        Publishes a product to a sales channel using GraphQL.
        product_id should be the numeric REST ID; it will be converted to GID format.
        publication_gid should already be in gid:// format.
        """
        product_gid = f"gid://shopify/Product/{product_id}" if not str(product_id).startswith("gid://") else product_id

        query = """
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
        """
        variables = {
            "id": product_gid,
            "input": [{"publicationId": publication_gid}]
        }

        result = self._graphql_request(query, variables)
        if not result:
            return False

        try:
            data = result.get("data", {}).get("publishablePublish", {})
            user_errors = data.get("userErrors", [])
            if user_errors:
                error_msgs = "; ".join(e.get("message", "") for e in user_errors)
                logger.error(f"Shopify publish errors: {error_msgs}")
                return False

            published = data.get("publishable", {})
            logger.info(f"Published product '{published.get('title', product_id)}' to channel")
            return True
        except Exception as e:
            logger.error(f"Error publishing product to channel: {e}")
            return False

    def update_product(self, product_id: str, product_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """
        Updates an existing product in Shopify via PUT.
        Returns the FULL updated product dict (with variant IDs, image IDs).
        Returns None on failure.
        """
        if not self.domain or not self.token:
            return None

        headers = {
            "X-Shopify-Access-Token": self.token,
            "Content-Type": "application/json"
        }

        url = f"{self.base_url}/products/{product_id}.json"

        try:
            with httpx.Client(timeout=60.0) as client:
                response = client.put(url, headers=headers, json={"product": product_data})
                response.raise_for_status()
                data = response.json()
                product = data.get("product")
                if not product or not product.get("id"):
                    logger.error(f"Shopify update returned success but no product data")
                    return None
                return product
        except httpx.HTTPStatusError as e:
            logger.error(f"Shopify HTTP Error updating product {product_id}: {e.response.status_code} - {e.response.text[:500]}")
            return None
        except Exception as e:
            logger.error(f"Error updating product {product_id} in Shopify: {e}")
            return None

    def find_product_id_by_sku(self, sku: str) -> Optional[str]:
        """
        Finds a Shopify product by SKU using GraphQL.
        Returns the numeric product ID (not GID), or None if not found.
        """
        query = """
        query($query: String!) {
            products(first: 1, query: $query) {
                edges {
                    node {
                        id
                        title
                    }
                }
            }
        }
        """
        result = self._graphql_request(query, {"query": f"sku:{sku}"})
        if not result:
            return None

        try:
            edges = result.get("data", {}).get("products", {}).get("edges", [])
            if edges:
                gid = edges[0]["node"]["id"]
                # Convert gid://shopify/Product/12345 → 12345
                numeric_id = gid.split("/")[-1]
                logger.info(f"Found product for SKU '{sku}': ID {numeric_id}")
                return numeric_id
            return None
        except Exception as e:
            logger.error(f"Error parsing product search for SKU '{sku}': {e}")
            return None

    def delete_product_variants(self, product_id: str) -> int:
        """
        Deletes all variants from a product EXCEPT the first one
        (Shopify requires at least one variant to exist).
        Returns the count of deleted variants.
        """
        if not self.domain or not self.token:
            return 0

        headers = {
            "X-Shopify-Access-Token": self.token,
            "Content-Type": "application/json"
        }

        variants = self.get_product_variants(product_id)
        if len(variants) <= 1:
            return 0  # Nothing to delete

        deleted = 0
        # Skip first variant (index 0) — Shopify requires at least one
        for v in variants[1:]:
            vid = v.get("id")
            if not vid:
                continue
            try:
                with httpx.Client() as client:
                    url = f"{self.base_url}/products/{product_id}/variants/{vid}.json"
                    resp = client.delete(url, headers=headers)
                    if resp.status_code == 200:
                        deleted += 1
            except Exception as e:
                logger.warning(f"Failed to delete variant {vid}: {e}")

        logger.info(f"Deleted {deleted} old variants from product {product_id}")
        return deleted

    def ensure_metafield_definitions(self) -> int:
        """
        Ensures all pavlicevits metafield definitions exist in Shopify.
        Uses GraphQL metafieldDefinitionCreate — idempotent (skips existing).
        Returns count of newly created definitions.
        """
        DEFINITIONS = [
            # Base product metafields
            {"name": "Short Description", "key": "short_description", "type": "multi_line_text_field",
             "description": "Brief product summary for SEO and storefront cards", "pin": True},
            {"name": "Brand", "key": "brand", "type": "single_line_text_field",
             "description": "Product manufacturer brand", "pin": True},
            {"name": "Category", "key": "category", "type": "single_line_text_field",
             "description": "Product category (e.g. Primer, Topcoat, Thinner)", "pin": True},
            {"name": "AI Confidence", "key": "ai_confidence", "type": "number_decimal",
             "description": "AI enrichment confidence score (0-1)", "pin": False},
            # Paint technical specs
            {"name": "Χημική Βάση / Chemical Base", "key": "chemical_base", "type": "single_line_text_field",
             "description": "Chemical base of the paint (e.g. Epoxy, Acrylic, Polyurethane)", "pin": True},
            {"name": "Φινίρισμα / Finish", "key": "finish", "type": "single_line_text_field",
             "description": "Surface finish type (e.g. Matte, Gloss, Satin)", "pin": True},
            {"name": "Στάδιο Εφαρμογής / Sequence Step", "key": "sequence_step", "type": "single_line_text_field",
             "description": "Application sequence (e.g. Primer, Topcoat, Clearcoat)", "pin": True},
            {"name": "Κάλυψη / Coverage", "key": "coverage", "type": "single_line_text_field",
             "description": "Coverage area (e.g. 10-12 m²/L)", "pin": True},
            {"name": "Στέγνωμα στην Αφή / Touch Dry", "key": "drying_time_touch", "type": "single_line_text_field",
             "description": "Drying time to touch (e.g. 10-15 minutes)", "pin": True},
            {"name": "Επαναβαφή / Recoat Window", "key": "recoat_window", "type": "single_line_text_field",
             "description": "Time window for recoat application", "pin": True},
            {"name": "Πλήρης Σκλήρυνση / Full Cure", "key": "full_cure", "type": "single_line_text_field",
             "description": "Time to full cure (e.g. 12 hours, 7 days)", "pin": True},
            {"name": "Χρόνος Στεγνώματος / Drying Time", "key": "drying_time", "type": "single_line_text_field",
             "description": "General drying time", "pin": True},
            {"name": "Περιβάλλον Χρήσης / Environment", "key": "environment", "type": "single_line_text_field",
             "description": "Suitable environment (Indoor, Outdoor, Both)", "pin": True},
            {"name": "Ειδικό Βάρος / Weight per Volume", "key": "weight_per_volume", "type": "single_line_text_field",
             "description": "Specific gravity or weight per volume (e.g. 1.32 g/cm³)", "pin": False},
            {"name": "Πάχος Στεγνού Φιλμ / Dry Film Thickness", "key": "dry_film_thickness", "type": "single_line_text_field",
             "description": "Dry film thickness (e.g. 20-30 μm)", "pin": False},
            {"name": "Αναλογία Ανάμιξης / Mixing Ratio", "key": "mixing_ratio", "type": "single_line_text_field",
             "description": "Component mixing ratio", "pin": False},
            {"name": "Χρόνος Ζωής Μίγματος / Pot Life", "key": "pot_life", "type": "single_line_text_field",
             "description": "Working time after mixing", "pin": False},
            {"name": "VOC", "key": "voc_level", "type": "single_line_text_field",
             "description": "Volatile Organic Compound level (e.g. 780 g/L)", "pin": False},
            {"name": "Μπεκ Ψεκασμού / Spray Nozzle", "key": "spray_nozzle_type", "type": "single_line_text_field",
             "description": "Recommended spray nozzle type/size", "pin": False},
            # List fields
            {"name": "Κατάλληλες Επιφάνειες / Surfaces", "key": "surfaces", "type": "json",
             "description": "Compatible surfaces", "pin": False},
            {"name": "Ειδικές Ιδιότητες / Special Properties", "key": "special_properties", "type": "json",
             "description": "Special product properties (e.g. Anti-corrosive, UV Resistant)", "pin": False},
            {"name": "Μέθοδος Εφαρμογής / Application Method", "key": "application_method", "type": "list.single_line_text_field",
             "description": "Application methods (e.g. Spray, Brush, Roller)", "pin": False},
        ]

        mutation = """
        mutation($definition: MetafieldDefinitionInput!) {
            metafieldDefinitionCreate(definition: $definition) {
                createdDefinition {
                    id
                    name
                }
                userErrors {
                    field
                    message
                }
            }
        }
        """

        created = 0
        for defn in DEFINITIONS:
            variables = {
                "definition": {
                    "name": defn["name"],
                    "namespace": "pavlicevits",
                    "key": defn["key"],
                    "type": defn["type"],
                    "description": defn.get("description", ""),
                    "ownerType": "PRODUCT",
                    "pin": defn.get("pin", True),
                    "access": {
                        "storefront": "PUBLIC_READ"
                    }
                }
            }

            result = self._graphql_request(mutation, variables)
            if not result:
                continue

            data = result.get("data", {}).get("metafieldDefinitionCreate", {})
            errors = data.get("userErrors", [])

            if errors:
                # "Metafield definition already exists" is expected — update access
                already_exists = any(
                    "already exists" in err.get("message", "").lower() or "taken" in err.get("message", "").lower()
                    for err in errors
                )
                if already_exists:
                    # Update existing definition to ensure Storefront access is enabled
                    self._update_metafield_access(defn["key"])
                else:
                    for err in errors:
                        logger.warning(f"Metafield definition error for '{defn['key']}': {err['message']}")
            elif data.get("createdDefinition"):
                created += 1
                logger.info(f"Created metafield definition: {defn['name']} ({defn['key']})")

        logger.info(f"Metafield definitions bootstrap: {created} new, {len(DEFINITIONS) - created} already existed")
        return created

    def _update_metafield_access(self, key: str):
        """Updates an existing metafield definition to enable Storefront API public read access."""
        # First, find the definition ID
        find_query = """
        query($namespace: String!, $key: String!, $ownerType: MetafieldOwnerType!) {
            metafieldDefinitions(first: 1, namespace: $namespace, key: $key, ownerType: $ownerType) {
                edges {
                    node {
                        id
                        name
                    }
                }
            }
        }
        """
        find_result = self._graphql_request(find_query, {
            "namespace": "pavlicevits",
            "key": key,
            "ownerType": "PRODUCT"
        })
        if not find_result:
            return

        edges = find_result.get("data", {}).get("metafieldDefinitions", {}).get("edges", [])
        if not edges:
            return

        def_id = edges[0]["node"]["id"]

        update_mutation = """
        mutation($definition: MetafieldDefinitionUpdateInput!) {
            metafieldDefinitionUpdate(definition: $definition) {
                updatedDefinition {
                    id
                    name
                }
                userErrors {
                    field
                    message
                }
            }
        }
        """
        update_result = self._graphql_request(update_mutation, {
            "definition": {
                "key": key,
                "namespace": "pavlicevits",
                "ownerType": "PRODUCT",
                "access": {
                    "storefront": "PUBLIC_READ"
                }
            }
        })
        if update_result:
            update_data = update_result.get("data", {}).get("metafieldDefinitionUpdate", {})
            update_errors = update_data.get("userErrors", [])
            if update_errors:
                for err in update_errors:
                    logger.warning(f"Failed to update access for '{key}': {err.get('message', '')}")
            elif update_data.get("updatedDefinition"):
                logger.info(f"Updated Storefront access for metafield: {key}")

    def search_technical_products(
        self, 
        category: Optional[str] = None, 
        chemical_base: Optional[str] = None, 
        surfaces: Optional[List[str]] = None,
        query: Optional[str] = None,
        limit: int = 10
    ) -> List[Dict[str, Any]]:
        """
        Advanced search for products using technical filters (metafields).
        """
        # Build GraphQL filter string
        # Note: Shopify's 'query' parameter in products() can search metafields 
        # but it's often more reliable to filter in post or use specific query syntax.
        # For this implementation, we will use the 'query' syntax supported by Shopify.
        
        filter_parts = []
        if category:
            filter_parts.append(f'tag:{category} OR product_type:{category}')
        if query:
            filter_parts.append(query)
            
        # We also want to fetch the metafields so the caller can do secondary filtering if needed
        full_query = """
        query($query: String, $first: Int) {
          products(first: $first, query: $query) {
            edges {
              node {
                id
                title
                handle
                description
                tags
                productType
                metafields(first: 20, namespace: "pavlicevits") {
                  edges {
                    node {
                      key
                      value
                      type
                    }
                  }
                }
                variants(first: 5) {
                  edges {
                    node {
                      id
                      title
                      sku
                      price
                    }
                  }
                }
              }
            }
          }
        }
        """
        
        search_string = " AND ".join(filter_parts) if filter_parts else None
        
        result = self._graphql_request(full_query, {"query": search_string, "first": limit})
        if not result:
            return []
            
        products = []
        for edge in result.get("data", {}).get("products", {}).get("edges", []):
            node = edge["node"]
            
            # Extract metafields into a flat dict for easier processing
            metafields = {}
            for m_edge in node.get("metafields", {}).get("edges", []):
                m = m_edge["node"]
                metafields[m["key"]] = m["value"]
            
            # Prepare product data
            prod_data = {
                "id": node["id"],
                "title": node["title"],
                "handle": node["handle"],
                "description": node["description"],
                "tags": node["tags"],
                "product_type": node["productType"],
                "metafields": metafields,
                "variants": [v["node"] for v in node.get("variants", {}).get("edges", [])]
            }
            
            # Secondary filtering for technical base and surfaces if provided
            match = True
            if chemical_base:
                if metafields.get("chemical_base") != chemical_base:
                    match = False
            
            if surfaces and match:
                prod_surfaces_raw = metafields.get("surfaces", "[]")
                try:
                    prod_surfaces = json.loads(prod_surfaces_raw)
                    if not any(s in prod_surfaces for s in surfaces):
                        match = False
                except:
                    match = False
                    
            if match:
                products.append(prod_data)
                
        return products

    def search_products_by_query(self, search_query: str, limit: int = 20) -> List[Dict[str, Any]]:
        """
        Executes a raw Shopify GraphQL product search query.
        This is optimized for filtering at the database level using metafields.
        e.g., query: "metafield.pavlicevits.chemical_base:'Ακρυλικό'"
        """
        full_query = """
        query($query: String, $first: Int) {
          products(first: $first, query: $query) {
            edges {
              node {
                id
                title
                handle
                description
                tags
                productType
                metafields(first: 30, namespace: "pavlicevits") {
                  edges {
                    node {
                      key
                      value
                      type
                    }
                  }
                }
                variants(first: 5) {
                  edges {
                    node {
                      id
                      title
                      sku
                      price
                    }
                  }
                }
              }
            }
          }
        }
        """
        logger.info(f"Executing GraphQL search: {search_query}")
        result = self._graphql_request(full_query, {"query": search_query, "first": limit})
        if not result:
            logger.warning("GraphQL request returned empty/None result")
            return []
            
        if "errors" in result:
            logger.error(f"GraphQL request returned errors: {result['errors']}")
            return []
            
        products = []
        raw_edges = result.get("data", {}).get("products", {}).get("edges", [])
        for edge in raw_edges:
            node = edge["node"]
            metafields = {}
            for m_edge in node.get("metafields", {}).get("edges", []):
                m = m_edge["node"]
                metafields[m["key"]] = m["value"]
                
            prod_data = {
                "id": node["id"],
                "title": node["title"],
                "handle": node["handle"],
                "description": node.get("description", ""),
                "tags": node["tags"],
                "product_type": node.get("productType", ""),
                "metafields": metafields,
                "variants": [v["node"] for v in node.get("variants", {}).get("edges", [])]
            }
            products.append(prod_data)
            
        logger.info(f"GraphQL search returned {len(products)} products")
        return products
