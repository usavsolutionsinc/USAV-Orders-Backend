"""Golden-set + unit regression tests for label identify.

Two layers:
  1. classify() UNIT tests — pure, no GPU, instant. Pin the lexicon rules that were
     hard-won (AWRCC1 vs AWRCC2, SoundTouch 300 vs 10, paperwork rejection, the
     product-label anchor). These catch a lexicon regression in milliseconds.
  2. GOLDEN image tests — run the real OCR on each product's verified example image
     (from data/ocr_labels.json) and assert it still reads the same model. Catches
     OCR/model drift end to end.

Run:  python -m vision.scripts.test_golden          # both layers
      python -m vision.scripts.test_golden --unit   # fast, no GPU
Exits non-zero on any failure (CI-friendly).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from vision.app.label_ocr import classify

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

# ── 1. classify() unit cases: (ocr_text, strict, expected_model) ──────────────
# expected None = should NOT match. These encode the precision lessons.
UNIT_CASES: list[tuple[str, bool, str | None]] = [
    # model-code disambiguation
    ("BOSE Wave music system MODEL AWRCC1 SER NO 033", True, "Bose Wave Music System AWRCC1"),
    ("WAVE Radio/CD II direct MODEL AWRCC2 U.S. PAT", True, "Bose Wave Music System AWRCC2"),
    ("BOSE WAVE RADIO/CD MODEL AWRC-1P SER", True, "Bose Wave Radio/CD AWRC-1P"),
    ("BOSE WAVE Radio/CD MODEL AWRC1G", True, "Bose Wave Radio/CD AWRC1G"),
    # generation markers
    ("BOSE WAVE music system IV MODEL 417788 MADE IN", True, "Bose Wave Music System IV"),
    ("BOSE WAVE music system III Systeme MADE IN", True, "Bose Wave Music System III"),
    # SoundTouch granularity — 300 soundbar must NOT become SoundTouch 10
    ("BOSE SOUNDTOUCH 300 SOUNDBAR MODEL 421650 SER", True, "Bose SoundTouch 300 Soundbar"),
    ("BOSE SOUNDTOUCH 10 wireless MODEL 416776", True, "Bose SoundTouch 10"),
    ("BOSE SOUNDTOUCH PEDESTAL MODEL 412534 SER NO", True, "Bose SoundTouch Pedestal"),
    # Solo: the FCC-string "418775Solo5" must resolve to the soundbar, not Solo 5
    ("Solo Soundbar 2 MODEL 418775 BOSE CORP MADE IN", True, "Bose Solo Soundbar Series II"),
    # docks
    ("BOSE SoundDock Series III digital music system MODEL", True, "Bose SoundDock Series III"),
    ("BOSE SoundDock Series II digital music MODEL", True, "Bose SoundDock Series II"),
    # strict filter: paperwork must be rejected even with a model code present
    ("USAV Solutions REPAIR SERVICE for Model AWRCC1 AWRCC2 SKU: 0000A-RS", True, None),
    ("Return to Amazon FBA ... compatible AWRCC1 AWRCC2 tracking 1Z", True, None),
    # strict filter: a model code with NO product-label anchor is rejected
    ("just AWRCC1 floating with no anchor words", True, None),
    # loose mode: same text DOES match (used as a fallback suggestion)
    ("just AWRCC1 floating with no anchor words", False, "Bose Wave Music System AWRCC1"),
]


def run_unit() -> tuple[int, int]:
    print("── classify() unit tests ──")
    passed = failed = 0
    for text, strict, expected in UNIT_CASES:
        got, _ = classify(text, strict=strict)
        ok = got == expected
        passed += ok
        failed += not ok
        mark = "ok " if ok else "FAIL"
        if not ok:
            print(f"  {mark} strict={int(strict)} expected={expected!r} got={got!r}  «{text[:40]}…»")
    print(f"  {passed}/{passed + failed} passed")
    return passed, failed


def run_golden() -> tuple[int, int]:
    print("\n── golden image tests (real OCR) ──")
    labels_path = DATA / "ocr_labels.json"
    if not labels_path.exists():
        print("  (no ocr_labels.json — run ocr_extract first; skipping)")
        return 0, 0
    labels = json.loads(labels_path.read_text())
    from vision.app.label_ocr import LabelIdentifier
    li = LabelIdentifier(gpu=True)

    passed = failed = 0
    for model, info in sorted(labels.items(), key=lambda kv: -kv[1]["count"]):
        ex = info.get("examples") or []
        if not ex:
            continue
        img = Path(ex[0]["path"])
        if not img.exists():
            print(f"  skip {model} (example missing)")
            continue
        from PIL import Image
        got = li.identify(Image.open(img))["model"]
        ok = got == model
        passed += ok
        failed += not ok
        print(f"  {'ok ' if ok else 'FAIL'} {model:34s} {'' if ok else f'-> got {got!r}'}")
    print(f"  {passed}/{passed + failed} passed")
    return passed, failed


def main() -> None:
    unit_only = "--unit" in sys.argv
    p1, f1 = run_unit()
    p2, f2 = (0, 0) if unit_only else run_golden()
    total_fail = f1 + f2
    print(f"\nTOTAL: {p1 + p2} passed, {total_fail} failed")
    sys.exit(1 if total_fail else 0)


if __name__ == "__main__":
    main()
