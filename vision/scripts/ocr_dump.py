"""Dump raw OCR text for a sample of dataset photos, to design the Bose lexicon
and see what the labels actually contain. Read-only.

    python -m vision.scripts.ocr_dump [per_product]
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
_IMG = {".jpg", ".jpeg", ".png", ".webp"}


def main() -> None:
    import easyocr
    per = int(sys.argv[1]) if len(sys.argv) > 1 else 3
    reader = easyocr.Reader(["en"], gpu=True, verbose=False)
    eval_root = DATA / "eval"
    for d in sorted(eval_root.iterdir()):
        if not d.is_dir():
            continue
        imgs = [p for p in sorted(d.iterdir()) if p.suffix.lower() in _IMG][:per]
        print(f"\n### {d.name}")
        for img in imgs:
            try:
                txt = " ".join(reader.readtext(str(img), detail=0, paragraph=True))
            except Exception as exc:  # noqa: BLE001
                txt = f"<err {exc}>"
            txt = txt.replace("\n", " ")
            print(f"  {img.name[:24]}: {txt[:160]}")


if __name__ == "__main__":
    main()
