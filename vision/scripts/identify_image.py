"""Identify a product from a single image file (offline test, no server).

Usage:
    python -m vision.scripts.identify_image path/to/photo.jpg
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

from vision.app.engine import get_engine


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("usage: python -m vision.scripts.identify_image <image>")
    path = Path(sys.argv[1])
    if not path.exists():
        raise SystemExit(f"file not found: {path}")
    engine = get_engine()
    with Image.open(path) as im:
        candidates = engine.identify(im)
    if not candidates:
        print("No candidates — is the index empty? Enroll some references first.")
        return
    print(f"Top {len(candidates)} for {path.name}:")
    for i, c in enumerate(candidates, 1):
        print(f"  {i}. {c['sku']:30s}  {c['score']:.4f}")


if __name__ == "__main__":
    main()
