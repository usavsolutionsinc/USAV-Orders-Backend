"""Rotation-robust OCR + fuzzy Bose lexicon: read the model off each photo's label
and group photos by the product their OWN label names (ground truth = the label,
not the timestamp). Outputs per-model counts + the clearest example per product.

    python -m vision.scripts.ocr_extract [root]   # default: data/train + data/eval

Writes vision/data/ocr_labels.json:
  { model -> { count, examples:[{path, text, score}] } }
"""
from __future__ import annotations

import json
import re
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
_IMG = {".jpg", ".jpeg", ".png", ".webp"}
import os
ROTATE = os.environ.get("OCR_ROTATE", "0") == "1"  # OCR_ROTATE=1 adds 180° pass (2x slower)

# Lexicon + matcher live in the shared module so the FastAPI service and these
# scripts agree on one rule. (Re-exported here for back-compat with reclassify.py.)
from vision.app.label_ocr import LEXICON, normalize, classify  # noqa: E402,F401


def main() -> None:
    import easyocr
    roots = [Path(sys.argv[1])] if len(sys.argv) > 1 else [DATA / "train", DATA / "eval"]
    reader = easyocr.Reader(["en"], gpu=True, verbose=False)

    # OCR cache: path -> text. OCR is the expensive step; cache it so re-running with
    # a different classify() filter is instant. Bust the cache by deleting the file
    # or bumping the key suffix when ROTATE changes.
    cache_path = DATA / "ocr_cache.json"
    suffix = "+r180" if ROTATE else ""
    cache: dict[str, str] = json.loads(cache_path.read_text()) if cache_path.exists() else {}
    dirty = 0

    def ocr(path: Path) -> str:
        nonlocal dirty
        key = str(path) + suffix
        if key in cache:
            return cache[key]
        try:
            im = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
            if max(im.size) > 2000:
                im.thumbnail((2000, 2000))  # label text legible; faster detection
            arr = np.array(im)
            rot = [180] if ROTATE else []
            text = " ".join(reader.readtext(arr, detail=0, paragraph=True, rotation_info=rot))
        except Exception:
            text = ""
        cache[key] = text
        dirty += 1
        if dirty % 100 == 0:
            cache_path.write_text(json.dumps(cache))
        return text

    groups: dict[str, list[dict]] = defaultdict(list)
    total = 0
    matched = 0
    for root in roots:
        if not root.exists():
            continue
        for sku_dir in sorted(root.iterdir()):
            if not sku_dir.is_dir():
                continue
            for img in sorted(sku_dir.iterdir()):
                if img.suffix.lower() not in _IMG:
                    continue
                total += 1
                if total % 100 == 0:
                    print(f"  ...{total} scanned, {matched} matched", file=sys.stderr, flush=True)
                text = ocr(img)
                model, score = classify(text)
                if model:
                    matched += 1
                    groups[model].append({"path": str(img), "text": text[:200], "score": score, "len": len(text)})
        # progress to stderr
        print(f"  scanned {root.name}: total={total} matched={matched}", file=sys.stderr)
    cache_path.write_text(json.dumps(cache))

    # rank models by count; pick clearest example (longest confident text) each
    out = {}
    for model, items in groups.items():
        items.sort(key=lambda x: x["len"], reverse=True)
        out[model] = {"count": len(items), "examples": items[:5]}
    ranked = sorted(out.items(), key=lambda kv: kv[1]["count"], reverse=True)

    (DATA / "ocr_labels.json").write_text(json.dumps(dict(ranked), indent=2))

    print(f"\nphotos: {total} | label-matched: {matched} ({matched/max(1,total)*100:.0f}%) | distinct models: {len(out)}")
    print("\n=== MODELS READ FROM LABELS (by photo count) ===")
    print("count  best-example")
    for model, info in ranked:
        ex = info["examples"][0]["path"].split("data")[-1] if info["examples"] else ""
        print(f"{info['count']:5d}  {model:34s} {ex}")
    print(f"\nWrote vision/data/ocr_labels.json")
    print(f"models with >=1 clean label read: {len(out)}")


if __name__ == "__main__":
    main()
