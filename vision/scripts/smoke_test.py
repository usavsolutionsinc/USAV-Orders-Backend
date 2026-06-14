"""End-to-end smoke test — no real product photos needed.

Verifies the whole chain works on this box: GPU embed -> index add -> save/load
-> kNN identify. Generates two visually-distinct synthetic SKUs, enrolls them, then
queries with a near-copy of one and asserts it ranks first.

    python -m vision.scripts.smoke_test

This does NOT touch your real index/reference dirs — it uses a temp index.
"""
from __future__ import annotations

import tempfile
from pathlib import Path

from PIL import Image, ImageDraw

from vision.app.embedder import Embedder
from vision.app.index import EmbeddingIndex


def _swatch(color: tuple[int, int, int], with_circle: bool = False) -> Image.Image:
    img = Image.new("RGB", (256, 256), color)
    d = ImageDraw.Draw(img)
    if with_circle:
        d.ellipse((64, 64, 192, 192), fill=(255, 255, 255))
    return img


def main() -> None:
    print("Loading embedder (downloads DINOv2 on first run) ...")
    emb = Embedder()
    print(f"  device={emb.device}  dim={emb.dim}")

    idx = EmbeddingIndex(emb.dim)
    idx.add("SKU-RED-PLAIN", emb.embed(_swatch((200, 30, 30))))
    idx.add("SKU-BLUE-CIRCLE", emb.embed(_swatch((30, 30, 200), with_circle=True)))
    print(f"  enrolled: {idx.size} vectors / {idx.sku_count} SKUs")

    # persist + reload to exercise the .npz round-trip
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "index.npz"
        idx.save(p)
        idx = EmbeddingIndex.load(p, emb.dim)

    # query with a slightly different blue+circle image
    q = emb.embed(_swatch((40, 50, 210), with_circle=True))
    results = idx.search(q, top_k=5, agg="max")
    print("  query (blue circle) ->")
    for i, r in enumerate(results, 1):
        print(f"    {i}. {r['sku']:20s} {r['score']:.4f}")

    top = results[0]["sku"]
    assert top == "SKU-BLUE-CIRCLE", f"expected SKU-BLUE-CIRCLE, got {top}"
    print("\nPASS — embed/index/identify pipeline works on this box.")


if __name__ == "__main__":
    main()
