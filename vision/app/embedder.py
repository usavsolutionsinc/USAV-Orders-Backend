"""DINOv2 image -> L2-normalized embedding vector.

DINOv2 is a self-supervised backbone: strong general visual features with no
fine-tuning, which is exactly what lets us add new products by enrolling photos
instead of retraining. We use the pooled CLS embedding, L2-normalized so a dot
product == cosine similarity.
"""
from __future__ import annotations

import numpy as np
import torch
from PIL import Image
from transformers import AutoImageProcessor, AutoModel

from .config import settings


def _resolve_device(pref: str) -> str:
    if pref == "cpu":
        return "cpu"
    if pref == "cuda":
        if not torch.cuda.is_available():
            raise RuntimeError(
                "DEVICE=cuda but torch.cuda.is_available() is False. On a 5070 Ti "
                "(Blackwell) install the cu128 torch build — see vision/README.md."
            )
        return "cuda"
    return "cuda" if torch.cuda.is_available() else "cpu"


class Embedder:
    def __init__(self) -> None:
        self.device = _resolve_device(settings.device)
        self.processor = AutoImageProcessor.from_pretrained(settings.embed_model)
        self.model = AutoModel.from_pretrained(settings.embed_model).to(self.device).eval()
        # Probe so a broken Blackwell/torch combo fails loudly at startup, not on
        # the first request.
        with torch.no_grad():
            _ = self.model(
                **self.processor(
                    images=Image.new("RGB", (224, 224)), return_tensors="pt"
                ).to(self.device)
            )

    @property
    def dim(self) -> int:
        return int(self.model.config.hidden_size)

    @torch.no_grad()
    def embed(self, image: Image.Image) -> np.ndarray:
        """One PIL image -> (dim,) float32 unit vector."""
        inputs = self.processor(images=image.convert("RGB"), return_tensors="pt").to(self.device)
        out = self.model(**inputs)
        # pooler_output when present, else mean over patch tokens.
        feats = getattr(out, "pooler_output", None)
        if feats is None:
            feats = out.last_hidden_state.mean(dim=1)
        vec = feats[0].float().cpu().numpy()
        norm = np.linalg.norm(vec)
        return (vec / norm).astype("float32") if norm > 0 else vec.astype("float32")
