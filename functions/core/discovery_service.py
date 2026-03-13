import os
import re
import time
import random
from typing import List, Dict, Any, Optional
from google import genai
from google.genai import types
try:
    from dotenv import load_dotenv
    # Load environment variables
    load_dotenv(os.path.join(os.path.dirname(__file__), "../.env"))
except ImportError:
    pass

# Config
PROJECT_ID = os.getenv("GOOGLE_CLOUD_PROJECT", "pavlicevits-9a889")
LOCATION = "us-central1"
MODEL_NAME = "gemini-2.5-flash"

class DiscoveryService:
    def __init__(self):
        self.client = genai.Client(
            vertexai=True,
            project=PROJECT_ID,
            location=LOCATION
        )
        self.google_search_tool = types.Tool(
            google_search=types.GoogleSearch()
        )

    def _generate_with_retry(self, model_name: str, contents: List[Any], config: types.GenerateContentConfig, max_retries: int = 3) -> Any:
        """Helper to call Gemini with exponential backoff on 429s."""
        last_exception = Exception("Max retries exceeded")
        for i in range(max_retries):
            try:
                return self.client.models.generate_content(
                    model=model_name,
                    contents=contents,
                    config=config
                )
            except Exception as e:
                last_exception = e
                if "429" in str(e) or "RESOURCE_EXHAUSTED" in str(e):
                    wait_time = (i + 1) + (random.random() * 2)
                    print(f"DiscoveryService: 429 Resource Exhausted. Retrying in {wait_time:.1f}s... ({i+1}/{max_retries})")
                    time.sleep(wait_time)
                else:
                    raise e
        raise last_exception

    def _grounded_search(self, prompt: str) -> Dict[str, Any]:
        """Low-level grounded search call. Returns text + source URLs."""
        try:
            response = self._generate_with_retry(
                model_name=MODEL_NAME,
                contents=[prompt],
                config=types.GenerateContentConfig(
                    tools=[self.google_search_tool],
                    temperature=0.2
                )
            )
            
            generated_text = response.text if response.text else ""
            
            source_urls = []
            if response.candidates and response.candidates[0].grounding_metadata:
                metadata = response.candidates[0].grounding_metadata
                if metadata.grounding_chunks:
                    for chunk in metadata.grounding_chunks:
                        if chunk.web and chunk.web.uri:
                            source_urls.append(chunk.web.uri)
            
            return {"text": generated_text, "source_urls": list(dict.fromkeys(source_urls))}
        except Exception as e:
            print(f"ERROR: Grounded search failed: {e}")
            return {"text": "", "source_urls": [], "error": str(e)}

    def search_and_enrich(self, product_name: str, search_query: Optional[str] = None) -> Dict[str, Any]:
        """Two-phase grounded search for metadata."""
        query_to_use = search_query if search_query else product_name
        catalogue_prompt = f"Find the OFFICIAL manufacturer's product page or TDS for: '{query_to_use}'."
        print(f"DiscoveryService: Searching metadata for '{query_to_use}'")
        return self._grounded_search(catalogue_prompt)

    def search_for_images(self, product_name: str) -> Dict[str, Any]:
        """
        Specialized grounded search to find high-quality product images.
        Consolidated strategy: triggered only after metadata stabilization.
        """
        prompt = f"""Find high-quality, professional product photography and official gallery images for the product: '{product_name}'.
        
        CRITICAL EXCLUSIONS:
        - DO NOT return logos, icons, or navigation buttons.
        - DO NOT return CLP/GHS hazard pictograms (e.g., flame, toxic, corrosive, environment).
        - DO NOT return technical diagrams or generic chemical symbols.
        - DO NOT return images that are just text labels.
        
        SEARCH STRATEGY:
        1. Locate the manufacturer's official product page or media gallery.
        2. Find high-resolution e-commerce listings from specialized paint/automotive shops.
        3. Prioritize "Packshots" (product on pure white background) or "Lifestyle" (product in clean studio setting).
        
        EXTRACT:
        - Direct image URLs (.jpg, .png, .webp).
        - URLs of product gallery pages.
        """

        print(f"DiscoveryService: Refined Image Search for '{product_name}'")
        
        try:
            response = self._generate_with_retry(
                model_name=MODEL_NAME,
                contents=[prompt],
                config=types.GenerateContentConfig(
                    tools=[self.google_search_tool],
                    temperature=0.7 
                )
            )
            
            generated_text = response.text if response.text else ""
            
            # LLM-SMART EXTRACTION: Pull direct image URLs from the generated text
            # The model is explicitly told to extract .jpg, .png, etc.
            direct_images = re.findall(r'(https?://[^\s\'"<>]+?\.(?:jpg|jpeg|png|webp))', generated_text, re.IGNORECASE)
            
            source_urls = []
            if response.candidates and response.candidates[0].grounding_metadata:
                metadata = response.candidates[0].grounding_metadata
                if metadata.grounding_chunks:
                    for chunk in metadata.grounding_chunks:
                        if chunk.web and chunk.web.uri:
                            source_urls.append(chunk.web.uri)
            
            # Prioritize direct images discovered by LLM over source page URLs
            combined_urls = list(dict.fromkeys(direct_images + source_urls))
            
            return {"text": generated_text, "source_urls": combined_urls}
        except Exception as e:
            print(f"ERROR: Image grounded search failed: {e}")
            return {"text": "", "source_urls": []}

    def search_product_entities(self, product_name: str) -> Dict[str, Any]:
        """Finds variants and entities."""
        entity_prompt = f"Search for product listings and variants for: '{product_name}'."
        return self._grounded_search(entity_prompt)
