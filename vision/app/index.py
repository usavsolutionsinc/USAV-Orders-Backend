"""Persisted nearest-neighbor index over enrolled reference embeddings.

Vectors are unit-normalized, so cosine similarity == dot product. Backed by a single
.npz (vectors + parallel sku labels). Small and dependency-free; swap in FAISS here
if the vector count grows past ~100k — the public methods are the seam.
"""
from __future__ import annotations

from collections import defaultdict
from pathlib import Path

import numpy as np


class EmbeddingIndex:
    def __init__(self, dim: int) -> None:
        self.dim = dim
        self._vectors = np.zeros((0, dim), dtype="float32")
        self._skus: list[str] = []

    # ---- persistence -------------------------------------------------------
    @classmethod
    def load(cls, path: Path, dim: int) -> "EmbeddingIndex":
        idx = cls(dim)
        if path.exists():
            data = np.load(path, allow_pickle=True)
            vecs = data["vectors"].astype("float32")
            if vecs.shape[0] and vecs.shape[1] == dim:
                idx._vectors = vecs
                idx._skus = list(data["skus"])
        return idx

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        np.savez(
            path,
            vectors=self._vectors,
            skus=np.array(self._skus, dtype=object),
        )

    # ---- mutation ----------------------------------------------------------
    def add(self, sku: str, vectors: np.ndarray) -> int:
        """Append N (dim,) vectors all labeled `sku`. Returns count added."""
        vectors = np.atleast_2d(vectors).astype("float32")
        if vectors.shape[1] != self.dim:
            raise ValueError(f"expected dim {self.dim}, got {vectors.shape[1]}")
        self._vectors = np.vstack([self._vectors, vectors])
        self._skus.extend([sku] * vectors.shape[0])
        return vectors.shape[0]

    def reset(self) -> None:
        self._vectors = np.zeros((0, self.dim), dtype="float32")
        self._skus = []

    # ---- query -------------------------------------------------------------
    @property
    def size(self) -> int:
        return self._vectors.shape[0]

    @property
    def sku_count(self) -> int:
        return len(set(self._skus))

    def search(self, vec: np.ndarray, top_k: int, agg: str = "max") -> list[dict]:
        """Cosine kNN, aggregated per SKU. Returns [{sku, score}] desc by score."""
        if self.size == 0:
            return []
        sims = self._vectors @ vec.astype("float32")  # cosine, vectors are unit-norm
        per_sku: dict[str, list[float]] = defaultdict(list)
        for sku, sim in zip(self._skus, sims):
            per_sku[sku].append(float(sim))
        if agg == "mean":
            scored = [(sku, float(np.mean(v))) for sku, v in per_sku.items()]
        else:  # "max" — best matching reference photo wins
            scored = [(sku, max(v)) for sku, v in per_sku.items()]
        scored.sort(key=lambda x: x[1], reverse=True)
        return [{"sku": sku, "score": round(score, 4)} for sku, score in scored[:top_k]]
