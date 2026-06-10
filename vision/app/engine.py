"""Ties embedder + (optional) detector + index into the identify/enroll engine.

Single shared instance, created at server startup (and reused by the CLI scripts).
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image

from .config import settings
from .embedder import Embedder
from .index import EmbeddingIndex

_IMG_EXT = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}


class Engine:
    def __init__(self) -> None:
        self.embedder = Embedder()
        self.index = EmbeddingIndex.load(settings.index_file, self.embedder.dim)
        self.detector = None
        if settings.use_detector:
            from .detector import Detector

            self.detector = Detector()

    def _prep(self, image: Image.Image) -> Image.Image:
        if self.detector is not None:
            return self.detector.crop_largest(image)
        return image.convert("RGB")

    # ---- identify ----------------------------------------------------------
    def identify(self, image: Image.Image) -> list[dict]:
        vec = self.embedder.embed(self._prep(image))
        return self.index.search(vec, settings.top_k, settings.score_agg)

    # ---- enroll ------------------------------------------------------------
    def enroll_image(self, sku: str, image: Image.Image) -> int:
        vec = self.embedder.embed(self._prep(image))
        n = self.index.add(sku, vec)
        self.index.save(settings.index_file)
        return n

    def enroll_dir(self, root: Path) -> dict:
        """Enroll every image under root/<sku>/*.jpg. Returns {sku: count}."""
        root = Path(root)
        added: dict[str, int] = {}
        # If root itself is a single SKU folder (has images directly), enroll just it.
        sku_dirs = [d for d in sorted(root.iterdir()) if d.is_dir()] if root.is_dir() else []
        if not sku_dirs and root.is_dir():
            sku_dirs = [root]
        for sku_dir in sku_dirs:
            sku = sku_dir.name
            count = 0
            for img_path in sorted(sku_dir.iterdir()):
                if img_path.suffix.lower() not in _IMG_EXT:
                    continue
                try:
                    with Image.open(img_path) as im:
                        vec = self.embedder.embed(self._prep(im))
                    self.index.add(sku, vec)
                    count += 1
                except Exception as exc:  # noqa: BLE001 — skip unreadable files, keep going
                    print(f"  ! skip {img_path.name}: {exc}")
            if count:
                added[sku] = count
                print(f"  + {sku}: {count} image(s)")
        self.index.save(settings.index_file)
        return added

    def reindex(self) -> dict:
        self.index.reset()
        return self.enroll_dir(settings.reference_path)

    def status(self) -> dict:
        return {
            "embed_model": settings.embed_model,
            "device": self.embedder.device,
            "dim": self.embedder.dim,
            "detector": bool(self.detector),
            "vectors": self.index.size,
            "skus": self.index.sku_count,
        }


_engine: Engine | None = None


def get_engine() -> Engine:
    global _engine
    if _engine is None:
        _engine = Engine()
    return _engine
