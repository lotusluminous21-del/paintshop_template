# functions/expert_v3/color_extract.py
# Dominant color extraction from photos using Pillow's quantize().
# No scikit-learn or OpenCV dependency.

import base64
import io
from PIL import Image, ImageOps
from expert_v4.color_utils import find_closest_ral


def _preprocess_image(img: Image.Image) -> Image.Image:
    """Center-crop to inner 70% and normalize contrast before extraction."""
    img = img.convert("RGB")
    width, height = img.size
    
    # 1. Center crop to 70% (removes edge vignetting and background objects)
    crop_w = int(width * 0.7)
    crop_h = int(height * 0.7)
    left = (width - crop_w) // 2
    top = (height - crop_h) // 2
    right = left + crop_w
    bottom = top + crop_h
    img = img.crop((left, top, right, bottom))
    
    # 2. Autocontrast (compensates for over/under exposure)
    img = ImageOps.autocontrast(img, cutoff=1)
    
    # 3. Resize to speed up quantization
    img.thumbnail((150, 150))
    return img


def extract_dominant_colors(image_bytes: bytes, n_colors: int = 5) -> list[dict]:
    """
    Extract the top N dominant colors from an image using Pillow's
    median-cut quantization algorithm.
    
    Args:
        image_bytes: Raw image bytes (JPEG/PNG)
        n_colors: Number of dominant colors to extract (default 5)
    
    Returns:
        List of dicts: [{"hex": "#4A6741", "percentage": 34.2}, ...]
        sorted by frequency (most dominant first).
    """
    img = Image.open(io.BytesIO(image_bytes))
    img = _preprocess_image(img)
    
    # Quantize: reduces image to n_colors using median-cut
    quantized = img.quantize(colors=n_colors, method=Image.Quantize.MEDIANCUT)
    
    # Get palette and pixel counts
    palette = quantized.getpalette()
    if not palette:
        return []
    
    color_counts = quantized.getcolors(maxcolors=n_colors + 1)
    if not color_counts:
        return []
    
    total_pixels = sum(count for count, _ in color_counts)
    
    results = []
    for count, palette_idx in color_counts:
        r = palette[palette_idx * 3]
        g = palette[palette_idx * 3 + 1]
        b = palette[palette_idx * 3 + 2]
        hex_color = f"#{r:02X}{g:02X}{b:02X}"
        percentage = round((count / total_pixels) * 100, 1)
        results.append({"hex": hex_color, "percentage": percentage})
    
    # Sort by percentage descending
    results.sort(key=lambda x: x["percentage"], reverse=True)
    return results


def analyze_photo_color(image_bytes: bytes, n_colors: int = 5, surface_type: str = "matte") -> dict:
    """
    Full pipeline: extract dominant colors → find closest RAL for each.
    
    Returns a structured result with dominant colors, their RAL matches,
    and a customer-facing disclaimer.
    """
    dominant = extract_dominant_colors(image_bytes, n_colors)
    
    matches = []
    for color in dominant:
        ral_match = find_closest_ral(color["hex"])
        
        # Penalize confidence for glossy surfaces due to reflections
        if surface_type == "glossy":
            if ral_match["confidence"] == "high":
                ral_match["confidence"] = "medium"
            elif ral_match["confidence"] == "medium":
                ral_match["confidence"] = "low"

        matches.append({
            "extracted_hex": color["hex"],
            "percentage": color["percentage"],
            "closest_ral": ral_match,
        })
    
    return {
        "dominant_colors": dominant,
        "ral_matches": matches,
        "disclaimer": (
            "Τα αποτελέσματα βασίζονται σε ψηφιακή ανάλυση φωτογραφίας και είναι "
            "κατά προσέγγιση. Παράγοντες όπως ο φωτισμός, η κάμερα και η συμπίεση "
            "εικόνας επηρεάζουν την ακρίβεια. Για ακριβή αντιστοιχία χρώματος, "
            "επισκεφτείτε το κατάστημά μας με δείγμα."
        ),
    }


def analyze_photo_from_base64(image_base64: str, n_colors: int = 5, surface_type: str = "matte") -> dict:
    """Convenience wrapper: accepts base64-encoded image string."""
    # Strip data URI prefix if present
    if "," in image_base64:
        image_base64 = image_base64.split(",", 1)[1]
    
    image_bytes = base64.b64decode(image_base64)
    return analyze_photo_color(image_bytes, n_colors, surface_type)
