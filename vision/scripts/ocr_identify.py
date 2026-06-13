"""OCR-based product identify + eval — the right tool for label photos.

The receiving photos are dominated by close-ups of the product label (bottom of
unit), which carry the model name/number in print. Those are visually identical to
DINOv2 (white sticker + black text) but trivial to read. This identifies a product
by OCR-ing the label and matching the text against each enrolled product's signature
tokens — model codes (AWRCC1 vs AWRCC2, VCS-10, AV35) and generation markers
(III/IV) carry almost all the discriminative weight.

    python -m vision.scripts.ocr_identify              # eval over data/eval
    python -m vision.scripts.ocr_identify <image>      # identify one image

Reports overall accuracy AND accuracy on label-legible photos (where OCR found a
confident match), since no-label photos are an embedding job, not an OCR one.
"""
from __future__ import annotations

import json
import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
_IMG_EXT = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}

# Map IV/III/II <-> digits both ways so "Wave III" matches "Wave 3".
_ROMAN = {"III": "3", "IV": "4", "II": "2", "VI": "6", "V": "5"}


def normalize(text: str) -> tuple[str, str]:
    """Return (spaced-uppercase-tokens, concatenated-alnum) forms of OCR text."""
    up = text.upper()
    for r, d in _ROMAN.items():
        up = re.sub(rf"\b{r}\b", d, up)
    spaced = re.sub(r"[^A-Z0-9]+", " ", up).strip()
    concat = re.sub(r"[^A-Z0-9]+", "", up)
    return spaced, concat


def signature(name: str) -> dict[str, int]:
    """Weighted signature tokens for a product name. Model codes dominate."""
    spaced, _ = normalize(name)
    sig: dict[str, int] = {}
    for tok in spaced.split():
        if len(tok) < 2:
            continue
        has_digit = any(c.isdigit() for c in tok)
        if has_digit and len(tok) >= 3:
            sig[tok] = 10          # strong model code: AWRCC1, AWRC1G, VCS10, AV35, 251
        elif has_digit:
            sig[tok] = 5           # short code/generation digit: 2, 5, 10, 3, 4
        elif tok in {"SOUNDDOCK", "SOUNDTOUCH", "COMPANION", "LIFESTYLE", "ACOUSTIMASS",
                      "SOUNDLINK", "CINEMATE", "SOLO", "VCS"}:
            sig[tok] = 4           # product-line words
        elif tok in {"WAVE", "RADIO", "MUSIC", "SYSTEM", "SPEAKER", "ENVIRONMENTAL",
                      "OUTDOOR", "CENTER", "CHANNEL", "TV", "CONSOLE", "CD"}:
            sig[tok] = 1
    return sig


def load_names() -> dict[str, str]:
    for f in ["dataset_manifest.json", "nas_pairing.json"]:
        p = DATA / f
        if p.exists():
            doc = json.loads(p.read_text())
            return {x["zoho_item_id"]: (x.get("name") or x["zoho_item_id"])
                    for x in doc.get("products", [])}
    return {}


class OcrMatcher:
    def __init__(self, product_ids: list[str], names: dict[str, str]):
        self.names = names
        self.sigs = {pid: signature(names.get(pid, pid)) for pid in product_ids}

    def score(self, ocr_text: str) -> list[tuple[str, int]]:
        spaced, concat = normalize(ocr_text)
        spaced_set = set(spaced.split())
        out = []
        for pid, sig in self.sigs.items():
            s = 0
            for tok, w in sig.items():
                # strong codes: substring match in the concatenated form (OCR may
                # split "AWRCC1" as "AWR CC1"); weak words: whole-token match.
                if w >= 10:
                    if tok in concat:
                        s += w
                elif tok in spaced_set:
                    s += w
            out.append((pid, s))
        out.sort(key=lambda x: x[1], reverse=True)
        return out

    def predict(self, ocr_text: str, min_score: int = 10) -> tuple[str | None, int, int]:
        ranked = self.score(ocr_text)
        top_id, top = ranked[0]
        second = ranked[1][1] if len(ranked) > 1 else 0
        if top < min_score or top == second:   # need a confident, unambiguous winner
            return None, top, second
        return top_id, top, second


def main() -> None:
    import easyocr  # heavy import; lazy
    names = load_names()

    eval_root = DATA / "eval"
    single = len(sys.argv) > 1 and Path(sys.argv[1]).is_file()

    product_ids = sorted([d.name for d in (DATA / "train").iterdir() if d.is_dir()]) \
        if (DATA / "train").exists() else sorted([d.name for d in eval_root.iterdir() if d.is_dir()])
    matcher = OcrMatcher(product_ids, names)

    print("Loading EasyOCR (GPU)...")
    reader = easyocr.Reader(["en"], gpu=True, verbose=False)

    def ocr(path: Path) -> str:
        try:
            return " ".join(reader.readtext(str(path), detail=0, paragraph=True))
        except Exception as exc:  # noqa: BLE001
            return ""

    if single:
        img = Path(sys.argv[1])
        text = ocr(img)
        print(f"OCR: {text!r}")
        pid, top, second = matcher.predict(text)
        print(f"-> {names.get(pid, pid) if pid else 'UNKNOWN'}  (score {top} vs {second})")
        return

    total = correct = 0
    labeled = labeled_correct = 0
    per_total: dict[str, int] = defaultdict(int)
    per_correct: dict[str, int] = defaultdict(int)
    for sku_dir in sorted(eval_root.iterdir()):
        if not sku_dir.is_dir():
            continue
        true_id = sku_dir.name
        for img in sorted(sku_dir.iterdir()):
            if img.suffix.lower() not in _IMG_EXT:
                continue
            text = ocr(img)
            pid, top, second = matcher.predict(text)
            total += 1
            per_total[true_id] += 1
            hit = pid == true_id
            if hit:
                correct += 1
                per_correct[true_id] += 1
            if pid is not None:          # a confident OCR match = "label legible"
                labeled += 1
                if hit:
                    labeled_correct += 1

    print("\n=== PER-PRODUCT OCR ACCURACY ===")
    print("acc     n   name")
    for pid in sorted(per_total, key=lambda s: per_correct[s] / per_total[s]):
        n = per_total[pid]
        acc = per_correct[pid] / n
        flag = "" if acc == 1.0 else "  <--"
        print(f"{acc*100:5.0f}%  {n:3d}  {names.get(pid, pid)[:48]}{flag}")

    print(f"\nOVERALL: {correct}/{total} = {correct/total*100:.1f}%")
    if labeled:
        print(f"ON LABEL-LEGIBLE PHOTOS: {labeled_correct}/{labeled} = {labeled_correct/labeled*100:.1f}%  "
              f"({labeled}/{total} = {labeled/total*100:.0f}% of photos had a readable label)")
    perfect = sum(1 for s in per_total if per_correct[s] == per_total[s])
    print(f"products at 100% overall: {perfect}/{len(per_total)}")


if __name__ == "__main__":
    main()
