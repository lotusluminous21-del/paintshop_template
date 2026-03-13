import requests
import re
from urllib.parse import urljoin, urlparse
from typing import List, Optional
import traceback
import logging

logger = logging.getLogger(__name__)

# Minimum image dimension heuristic (pixels) — filters out icons/logos
MIN_IMAGE_DIMENSION = 150

# Patterns for URLs that are likely NOT product images
EXCLUDE_PATTERNS = [
    r'logo', r'icon', r'favicon', r'sprite', r'banner', r'avatar',
    r'placeholder', r'loading', r'spinner', r'arrow', r'btn',
    r'social', r'facebook', r'twitter', r'instagram', r'youtube',
    r'google-analytics', r'pixel', r'tracking', r'badge', r'flag',
    r'payment', r'visa', r'mastercard', r'paypal',
    r'\.svg', r'\.gif', r'data:image',
    r'1x1', r'spacer', r'blank', r'transparent',
    r'ghs-label', r'pictogram', r'hazardous', r'clp-', r'pict-09',
    r'cms', r'pylon', r'icon-', r'logo-', r'banner-', r'nav-',
]

EXCLUDE_REGEX = re.compile('|'.join(EXCLUDE_PATTERNS), re.IGNORECASE)

class ContentExtractor:
    def __init__(self):
        self.headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }

    def fetch_images_from_urls(self, urls: List[str], limit: int = 8, product_context: Optional[str] = None) -> List[str]:
        """
        Visits the provided URLs and extracts high-quality product images.
        Uses a multi-strategy approach: og:image, twitter:image, and full <img> tag parsing.
        Returns a deduplicated list of image URLs.
        """
        found_images = []
        
        logger.info(f"ContentExtractor: Extracting images from {len(urls)} sources (context: {product_context})...")

        with requests.Session() as session:
            session.headers.update(self.headers)
            
            for url in urls[:limit]:
                try:
                    # HEURISTIC: If the URL already looks like a direct image, add it immediately
                    if any(url.lower().endswith(ext) for ext in ['.jpg', '.jpeg', '.png', '.webp']):
                        found_images.append(url)
                        continue

                    logger.info(f"ContentExtractor: Fetching {url}...")
                    response = session.get(url, timeout=12.0, allow_redirects=True, verify=False)
                    response.raise_for_status()
                    
                    # If the content-type is already an image, add it
                    if 'image' in response.headers.get('Content-Type', '').lower():
                        found_images.append(response.url)
                        continue

                    logger.info(f"ContentExtractor: Resolved to {response.url}")
                    
                    images = self._extract_all_images(response.text, response.url, product_context=product_context)
                    logger.info(f"ContentExtractor: Found {len(images)} candidate images on page.")
                    found_images.extend(images)
                    
                    if len(found_images) >= 15: # Increased to provide a richer pool for Multimodal QA
                        break
                        
                except Exception as e:
                    logger.warning(f"ContentExtractor: Failed to fetch {url}: {e}")
                    continue
        
        # Deduplicate while preserving order
        unique = list(dict.fromkeys(found_images))
        logger.info(f"ContentExtractor: Total unique images found: {len(unique)}")
        return unique

    def _extract_all_images(self, html_content: str, base_url: str, product_context: Optional[str] = None) -> List[str]:
        """
        Multi-strategy image extraction from HTML content.
        Priority: og:image > twitter:image > large <img> tags
        """
        images = []
        
        # ── Context Awareness ──────────────────────────────────────
        # Create a set of relevant keywords from the product context (e.g. brand, product name)
        keywords = []
        if product_context:
            # Clean and split context into significant keywords
            clean_context = re.sub(r'[^\w\s]', ' ', product_context.lower())
            keywords = [k for k in clean_context.split() if len(k) > 2]

        def is_relevant(url: str) -> bool:
            if not keywords: return True
            url_lower = url.lower()
            # If at least one unique keyword from the product name is in the URL, it's highly likely relevant
            return any(k in url_lower for k in keywords)

        # Helper to add image while filtering
        def add_image(url: str):
            full_url = urljoin(base_url, url)
            if EXCLUDE_REGEX.search(full_url):
                return
            if not full_url.startswith(('http://', 'https://')):
                return
            
            # ELIMINATE RELEVANCE FILTERING AT EXTRACTION STAGE
            # We trust the downstream Multimodal Vision Agent to discard irrelevant images.
            # Only block explicit logo/icon assets to save bandwidth/noise.
            url_lower = full_url.lower()
            if any(x in url_lower for x in ['/logo', '/icon', '/sprite', '/favicon']):
                return
            
            # Simple extension check
            parsed = urlparse(full_url)
            path_lower = parsed.path.lower()
            if any(ext in path_lower for ext in ['.jpg', '.jpeg', '.png', '.webp']):
                images.append(full_url)

        # ── Apply Strategies ──────────────────────────────────────────
        
        # 1 & 2 & 3: Meta tags
        meta_imgs = re.findall(r'<meta[^>]*?(?:property|name)=["\'](?:og:image|twitter:image|image_src)["\'][^>]*?content=["\']([^"\']+)["\']', html_content, re.IGNORECASE)
        meta_imgs += re.findall(r'<meta[^>]*?content=["\']([^"\']+)["\'][^>]*?(?:property|name)=["\'](?:og:image|twitter:image|image_src)["\']', html_content, re.IGNORECASE)
        for img in meta_imgs:
            add_image(img)

        # 4: <img> tags
        img_tags = re.findall(r'<img[^>]*?(?:src|data-src)=["\']([^"\']+)["\']', html_content, re.IGNORECASE)
        for img in img_tags:
            # Check dimensions if possible via attributes
            if self._is_likely_small_image(img, html_content, img):
                continue
            add_image(img)

        return images
    
    def _is_likely_small_image(self, url: str, html: str, original_src: str) -> bool:
        """Heuristic check for likely small/icon images based on URL patterns and inline dimensions."""
        # Check for dimension patterns in URL (e.g., 50x50, 16x16)
        dim_match = re.search(r'(\d+)x(\d+)', url)
        if dim_match:
            try:
                w, h = int(dim_match.group(1)), int(dim_match.group(2))
                if w < MIN_IMAGE_DIMENSION or h < MIN_IMAGE_DIMENSION:
                    return True
            except:
                pass
        
        # Check for width/height attributes near the img tag in HTML
        try:
            escaped_src = re.escape(original_src)
            context_match = re.search(
                rf'<img[^>]*?(?:src|data-src)\s*=\s*["\']' + escaped_src + r'["\'][^>]*?>',
                html, re.IGNORECASE
            )
            if context_match:
                tag = context_match.group(0)
                w_match = re.search(r'width\s*=\s*["\']?(\d+)', tag, re.IGNORECASE)
                h_match = re.search(r'height\s*=\s*["\']?(\d+)', tag, re.IGNORECASE)
                if w_match and int(w_match.group(1)) < MIN_IMAGE_DIMENSION:
                    return True
                if h_match and int(h_match.group(1)) < MIN_IMAGE_DIMENSION:
                    return True
        except:
            pass
        
        return False
