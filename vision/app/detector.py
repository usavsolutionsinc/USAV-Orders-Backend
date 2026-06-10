"""Optional product crop before embedding.

On a cluttered receiving bench the frame has hands, boxes, other items. Cropping to
the dominant object focuses the embedding on the product. This uses a generic
pretrained Ultralytics detector (COCO) purely to find the largest salient box — we
don't use its class labels, only the region. It's intentionally model-agnostic so a
fine-tuned/open-vocab detector can be swapped in later.

Disabled by default (USE_DETECTOR=0); v1 embeds the full frame and relies on the
operator framing the product.
"""
from __future__ import annotations

from PIL import Image

from .config import settings


class Detector:
    def __init__(self) -> None:
        from ultralytics import YOLO  # imported lazily so it's optional

        self.model = YOLO(settings.detector_model)

    def crop_largest(self, image: Image.Image) -> Image.Image:
        """Return the largest detected box, or the original image if none."""
        rgb = image.convert("RGB")
        results = self.model.predict(rgb, verbose=False)
        best = None
        best_area = 0.0
        for r in results:
            boxes = getattr(r, "boxes", None)
            if boxes is None:
                continue
            for xyxy in boxes.xyxy.cpu().numpy():
                x1, y1, x2, y2 = xyxy[:4]
                area = max(0.0, x2 - x1) * max(0.0, y2 - y1)
                if area > best_area:
                    best_area = area
                    best = (int(x1), int(y1), int(x2), int(y2))
        if best is None:
            return rgb
        # Pad the box ~6% so we don't clip edges of the product.
        x1, y1, x2, y2 = best
        w, h = rgb.size
        px = int((x2 - x1) * 0.06)
        py = int((y2 - y1) * 0.06)
        return rgb.crop(
            (max(0, x1 - px), max(0, y1 - py), min(w, x2 + px), min(h, y2 + py))
        )
