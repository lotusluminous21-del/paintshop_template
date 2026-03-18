import os
import re
import time
import random
from typing import List, Dict, Any, Optional
from google.genai import types
try:
    from dotenv import load_dotenv
    # Load environment variables
    load_dotenv(os.path.join(os.path.dirname(__file__), "../.env"))
except ImportError:
    pass

from core.llm_config import LLMConfig

class DiscoveryService:
    def __init__(self):
        # We rely on the global Vertex AI context for standard text/grounding queries
        self.client = LLMConfig.get_client()
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
                model_name=LLMConfig.get_model_name(complex=True),
                contents=[prompt],
                config=types.GenerateContentConfig(
                    tools=[self.google_search_tool],
                    temperature=0.2
                )
            )
            
            generated_text = response.text if response.text else ""
            
            source_urls = []
            if response.candidates and getattr(response.candidates[0], "grounding_metadata", None):
                metadata = response.candidates[0].grounding_metadata
                if getattr(metadata, "grounding_chunks", None):
                    for chunk in metadata.grounding_chunks:
                        web_obj = getattr(chunk, "web", None)
                        if web_obj and getattr(web_obj, "uri", None):
                            source_urls.append(web_obj.uri)
            
            return {"text": generated_text, "source_urls": list(dict.fromkeys(source_urls))}
        except Exception as e:
            print(f"ERROR: Grounded search failed: {e}")
            return {"text": "", "source_urls": [], "error": str(e)}

    def search_and_enrich(self, product_name: str, search_query: Optional[str] = None) -> Dict[str, Any]:
        """Grounding extraction search for metadata."""
        query_to_use = search_query if search_query else product_name
        catalogue_prompt = (
            f"Draft a comprehensive technical brief for the product '{query_to_use}'. "
            "Using web search, locate manufacturer Technical Data Sheets (TDS) and product pages. "
            "Extract and list ALL technical specifications, detailed descriptions, available sizes/variants, "
            "packaging weights, finishes, and application methods. Be exhaustive."
        )
        print(f"DiscoveryService: Searching metadata for '{query_to_use}'")
        return self._grounded_search(catalogue_prompt)

    def search_for_images(self, product_name: str) -> Dict[str, Any]:
        # Strong trigger words to force the LLM to use the Google Search tool:
        # "Search the web for recent product pages..." or "Find pricing and availability for..."
        prompt = f"""Search the live web for e-commerce shops and official manufacturer product pages that are currently selling: '{product_name}'.
        You must gather the top 5 URLs of active product pages that feature pack-shots and lifestyle photos.
        Summarize the websites you found.
        """

        print(f"DiscoveryService: Refined Image Search for '{product_name}'")
        
        try:
            # We will attempt the search. If it fails to use the search tool (empty grounding_chunks),
            # we retry with a slightly modified Shopping-intent prompt to force its hand.
            attempts = [
                prompt,
                f"Search the web for 'buy {product_name} online'. Return the exact URLs of the shops.",
                f"Google search for '{product_name} paint spray'. List the URLs found."
            ]
            
            for attempt_prompt in attempts:
                response = self._generate_with_retry(
                    model_name=LLMConfig.get_model_name(complex=True),
                    contents=[attempt_prompt],
                    config=types.GenerateContentConfig(
                        tools=[self.google_search_tool],
                        temperature=0.4 # Slightly lower temperature to encourage tool use over hallucination
                    )
                )
                
                generated_text = response.text if response.text else ""
                
                source_urls = []
                if response.candidates and getattr(response.candidates[0], "grounding_metadata", None):
                    metadata = response.candidates[0].grounding_metadata
                    if getattr(metadata, "grounding_chunks", None):
                        for chunk in metadata.grounding_chunks:
                            web_obj = getattr(chunk, "web", None)
                            if web_obj and getattr(web_obj, "uri", None):
                                source_urls.append(web_obj.uri)
                
                combined_urls = list(dict.fromkeys(source_urls))
                
                if combined_urls:
                    # Successfully grounded!
                    return {"text": generated_text, "source_urls": combined_urls}
                    
                print(f"DiscoveryService: No grounding chunks returned for image search. Retrying with stronger search intent...")
            
            # Exhausted all attempts
            print(f"DiscoveryService: Image search completely failed to ground URLs for '{product_name}'")
            return {"text": generated_text, "source_urls": []}
            
        except Exception as e:
            print(f"ERROR: Image grounded search failed: {e}")
            return {"text": "", "source_urls": []}

    def search_product_entities(self, product_name: str) -> Dict[str, Any]:
        """Finds variants and entities."""
        entity_prompt = f"Search for product listings and variants for: '{product_name}'."
        return self._grounded_search(entity_prompt)
