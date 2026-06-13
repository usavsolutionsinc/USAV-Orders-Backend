"""Measure top-1 identify accuracy on a held-out eval set.

For every image under data/eval/<zoho_item_id>/*, run it through the SAME identify
path the service uses (embed -> kNN over the enrolled index) and check whether the
top-1 SKU equals the folder it came from. Reports overall accuracy, per-product
accuracy, and the most common confusions (which product got predicted instead).

    python -m vision.scripts.eval_index            # uses data/eval
    python -m vision.scripts.eval_index data/eval
"""
from __future__ import annotations

import sys
from collections import defaultdict
from pathlib import Path

from PIL import Image

from vision.app.config import settings
from vision.app.engine import get_engine

_IMG_EXT = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}


def main() -> None:
    eval_root = Path(sys.argv[1]) if len(sys.argv) > 1 else (settings.reference_path.parent / "eval")
    if not eval_root.exists():
        raise SystemExit(f"eval dir not found: {eval_root}")

    engine = get_engine()
    print(f"index: {engine.index.size} vectors / {engine.index.sku_count} SKUs  device={engine.embedder.device}\n")

    total = correct = 0
    top3_correct = 0
    per_prod_total: dict[str, int] = defaultdict(int)
    per_prod_correct: dict[str, int] = defaultdict(int)
    confusions: dict[tuple[str, str], int] = defaultdict(int)
    # readable names from the dataset manifest if present
    names: dict[str, str] = {}
    import json
    man = eval_root.parent / "dataset_manifest.json"
    if man.exists():
        for p in json.loads(man.read_text()).get("products", []):
            names[p["zoho_item_id"]] = (p.get("name") or p["zoho_item_id"])[:48]

    for sku_dir in sorted(eval_root.iterdir()):
        if not sku_dir.is_dir():
            continue
        true_sku = sku_dir.name
        for img in sorted(sku_dir.iterdir()):
            if img.suffix.lower() not in _IMG_EXT:
                continue
            try:
                with Image.open(img) as im:
                    cands = engine.identify(im)
            except Exception as exc:  # noqa: BLE001
                print(f"  ! {img.name}: {exc}")
                continue
            total += 1
            per_prod_total[true_sku] += 1
            pred = cands[0]["sku"] if cands else None
            if pred == true_sku:
                correct += 1
                per_prod_correct[true_sku] += 1
            else:
                confusions[(true_sku, pred or "∅")] += 1
            if any(c["sku"] == true_sku for c in cands[:3]):
                top3_correct += 1

    if total == 0:
        raise SystemExit("no eval images found")

    print("=== PER-PRODUCT TOP-1 ACCURACY ===")
    print("acc     n   name")
    for sku in sorted(per_prod_total, key=lambda s: per_prod_correct[s] / per_prod_total[s]):
        n = per_prod_total[sku]
        acc = per_prod_correct[sku] / n
        flag = "" if acc == 1.0 else "  <--"
        print(f"{acc*100:5.0f}%  {n:3d}  {names.get(sku, sku)}{flag}")

    print(f"\nOVERALL top-1: {correct}/{total} = {correct/total*100:.1f}%   top-3: {top3_correct/total*100:.1f}%")
    perfect = sum(1 for s in per_prod_total if per_prod_correct[s] == per_prod_total[s])
    print(f"products at 100%: {perfect}/{len(per_prod_total)}")

    if confusions:
        print("\n=== TOP CONFUSIONS (true -> predicted) ===")
        for (t, p), c in sorted(confusions.items(), key=lambda x: -x[1])[:12]:
            print(f"  {c:3d}x  {names.get(t, t)[:34]:34s} -> {names.get(p, p)[:34]}")


if __name__ == "__main__":
    main()
