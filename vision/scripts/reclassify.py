"""Re-classify cached OCR text with the current lexicon — instant, no OCR/GPU.
Lets us iterate the Bose lexicon without re-running EasyOCR.

    python -m vision.scripts.reclassify [strict|loose]
"""
from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

from vision.app.config import settings  # noqa: F401  (keeps path resolution consistent)
from vision.scripts.ocr_extract import classify, DATA

strict = (sys.argv[1] if len(sys.argv) > 1 else "strict") != "loose"
cache = json.loads((DATA / "ocr_cache.json").read_text())

groups: dict[str, list[dict]] = defaultdict(list)
matched = 0
for path, text in cache.items():
    model, _ = classify(text, strict=strict)
    if model:
        matched += 1
        groups[model].append({"path": path.replace("+r180", ""), "text": text[:160], "len": len(text)})

out = {}
for model, items in groups.items():
    items.sort(key=lambda x: x["len"], reverse=True)
    out[model] = {"count": len(items), "examples": items[:5]}
ranked = sorted(out.items(), key=lambda kv: kv[1]["count"], reverse=True)
(DATA / "ocr_labels.json").write_text(json.dumps(dict(ranked), indent=2))

print(f"strict={strict}  photos={len(cache)}  matched={matched} ({matched/len(cache)*100:.0f}%)  distinct products={len(out)}")
print("\ncount  product                              best-example")
for model, info in ranked:
    ex = info["examples"][0]["path"].split("scan")[-1].split("data")[-1] if info["examples"] else ""
    print(f"{info['count']:5d}  {model:36s} {ex}")
print(f"\nDISTINCT PRODUCTS WITH A CLEAN LABEL READ: {len(out)}")
