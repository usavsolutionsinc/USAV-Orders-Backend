"""Enroll reference photos into the index. No model retraining.

Usage:
    python -m vision.scripts.enroll_folder [path]

`path` defaults to the configured REFERENCE_DIR. It can be either:
  • a parent folder of per-SKU subfolders:  reference/<SKU>/*.jpg
  • a single SKU folder:                    reference/BOSE-QC35-II/*.jpg
"""
from __future__ import annotations

import sys
from pathlib import Path

from vision.app.config import settings
from vision.app.engine import get_engine


def main() -> None:
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else settings.reference_path
    if not target.exists():
        raise SystemExit(f"path not found: {target}")
    print(f"Enrolling from {target} ...")
    engine = get_engine()
    added = engine.enroll_dir(target)
    total = sum(added.values())
    print(f"\nDone. Added {total} image(s) across {len(added)} SKU(s).")
    print(f"Index now: {engine.index.size} vectors / {engine.index.sku_count} SKUs.")


if __name__ == "__main__":
    main()
