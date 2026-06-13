"""Label OCR identify — read the Bose model off a product label and map it to a
canonical product. Shared by the FastAPI service (/identify-label) and the offline
scripts (ocr_extract / reclassify) so there's ONE lexicon and one matching rule.

Why OCR (not visual embedding): Bose product labels are visually near-identical to a
DINOv2 embedder (white sticker + black text), but they print the model. OCR of the
label is the reliable identifier; the model code (AWRCC1 vs AWRCC2, III vs IV) carries
the discrimination an embedder can't. Ground truth is the label, not the photo's
timestamp. See docs/visual-receiving-identify-plan.md.
"""
from __future__ import annotations

import re

# Ordered, specific-first. Each: (canonical product, regex over normalized OCR).
# Patterns tolerate common OCR confusions (1<->I, 0<->O, 2<->Z). Internal model
# numbers (416776, 417788, 418775, 421650, 412534) are included where a label shows
# the number instead of / alongside the marketing name.
LEXICON: list[tuple[str, str]] = [
    # --- Wave radios / music systems (model-code keyed; most discriminative) ---
    ("Bose Wave Radio/CD AWRC-1P",      r"AWRC[\-\s]?1P|AWAC[\-\s]?[I1]P"),
    ("Bose Wave Radio/CD AWRC1G",       r"AWRC[\s]?1G|AWRC[\s]?[I1]G"),
    ("Bose Wave Music System AWRCC2",   r"AWRCC[2Z]"),
    ("Bose Wave Music System AWRCC1",   r"AWRCC[1I]"),
    ("Bose Wave Radio AWR1-1W",         r"AWR[1I][\-\s]?1W|AWR[I1][\-\s]?[I1]W"),
    ("Bose Wave Music System IV",       r"SYSTEM\s?IV|MUSIC\s?SYSTEM\s?4\b|\b417788\b"),
    ("Bose Wave Music System III",      r"SYSTEM\s?III|MUSIC\s?SYSTEM\s?3\b"),
    # --- SoundTouch (specific variants FIRST; generic must say "10"/model #) ---
    ("Bose SoundTouch 300 Soundbar",    r"SOUND\s?TOUCH\s?300|\b421650\b"),
    ("Bose SoundTouch Pedestal",        r"SOUND\s?TOUCH\s?PEDESTAL|PEDESTAL|\b412534\b"),
    ("Bose SoundTouch 20",              r"SOUND\s?TOUCH\s?20"),
    ("Bose SoundTouch 30",              r"SOUND\s?TOUCH\s?30"),
    ("Bose SoundTouch 10",              r"SOUND\s?TOUCH\s?10|\b416776\b"),
    # --- Docks / portable ---
    ("Bose SoundDock Series III",       r"SOUND\s?DOCK\s?(SERIES\s?)?III"),
    ("Bose SoundDock Series II",        r"SOUND\s?DOCK\s?(SERIES\s?)?II\b"),
    ("Bose SoundDock 10",               r"SOUND\s?DOCK\s?10"),
    ("Bose SoundDock",                  r"SOUND\s?DOCK"),
    ("Bose SoundLink",                  r"SOUND\s?LINK"),
    # --- Companion multimedia ---
    ("Bose Companion 5",                r"COMPAN[I1]ON\s?5"),
    ("Bose Companion 3",                r"COMPAN[I1]ON\s?3"),
    ("Bose Companion 2 Series III",     r"COMPAN[I1]ON"),
    # --- Home theater / Lifestyle ---
    ("Bose Lifestyle AV35 Console",     r"AV[\-\s]?35"),
    ("Bose Control Console AV20",       r"AV[\-\s]?20"),
    ("Bose Lifestyle",                  r"LIFESTYLE"),
    ("Bose 321 Home Theater",           r"\b321\b|AV3[\-\s]?2[\-\s]?1|GSX?\s?SERIES"),
    ("Bose CineMate",                   r"CINE\s?MATE"),
    ("Bose Acoustimass",                r"ACOUSTI\s?MASS|\bAM[\-\s]?(10|15|6|5)\b"),
    ("Bose Solo Soundbar Series II",    r"SOLO\s?SOUNDBAR|SOLO\s?TV\s?SOUNDBAR|\b418775\b"),
    ("Bose Solo 5 TV Sound System",     r"(?<!\d)SOLO\s?5\b|SOLO\s?5\s?TV"),
    ("Bose TV Speaker",                 r"TV\s?SPEAKER"),
    # --- Wired speakers ---
    ("Bose VCS-10 Center Channel",      r"VCS[\-\s]?10|VCS[\-\s]?1\b"),
    ("Bose 151 SE Environmental Spk",   r"\b1510?\s?SE\b|151\s?SE|\b151\b"),
    ("Bose 251 Environmental Spk",      r"\b251\b"),
    ("Bose 161 Speakers",               r"\b161\s?(SPEAKER|SERIES|DIRECT)"),
    ("Bose 141 Bookshelf Speakers",     r"\b141\s?(SPEAKER|SERIES|BOOKSHELF)"),
    ("Bose 201 Speakers",               r"\b201\s?(SERIES|DIRECT|REFLECT)"),
    ("Bose 301 Speakers",               r"\b301\s?(SERIES|DIRECT|REFLECT)"),
    ("Bose FreeSpace",                  r"FREE\s?SPACE"),
]
_COMPILED = [(name, re.compile(pat)) for name, pat in LEXICON]

# A real Bose product label carries one of these anchors near the model code.
_ANCHOR = re.compile(r"MODEL|SER\.?\s?NO|SERIAL|MADE IN|FRAMINGHAM|BOSE CORP")
# Paperwork in-frame (Amazon return labels, USAV repair invoices) lists model codes
# that aren't the product itself — reject so they don't cause false matches.
_PAPERWORK = re.compile(
    r"REPAIR SERVICE|AMAZON|SHIPPING ADDRESS|\bRETURN\b|\bORDER\b|SKU:|USAV|"
    r"TRACKING|PACKAGE CONTENTS|GETTING STARTED|PAYPAL|INVOICE"
)


def normalize(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").upper())


def classify(text: str, strict: bool = True) -> tuple[str | None, int]:
    """(canonical product | None, hits). strict=True requires a product-label anchor
    and rejects paperwork-dominated frames — high precision for trusted auto-fill."""
    norm = normalize(text)
    norm_nospace = re.sub(r"[^A-Z0-9]", "", norm)
    if strict:
        if _PAPERWORK.search(norm):
            return None, 0
        if not _ANCHOR.search(norm):
            return None, 0
    for name, pat in _COMPILED:
        if pat.search(norm) or pat.search(norm_nospace):
            return name, 1
    return None, 0


class LabelIdentifier:
    """Lazy EasyOCR reader + lexicon matcher. One instance shared by the service."""

    def __init__(self, gpu: bool = True) -> None:
        import easyocr  # heavy; imported lazily

        self._reader = easyocr.Reader(["en"], gpu=gpu, verbose=False)

    def read_text(self, image) -> str:
        """OCR a PIL image (downscaled for speed). Returns concatenated text."""
        import numpy as np
        from PIL import ImageOps

        im = ImageOps.exif_transpose(image).convert("RGB")
        if max(im.size) > 2000:
            im.thumbnail((2000, 2000))
        return " ".join(self._reader.readtext(np.array(im), detail=0, paragraph=True))

    def identify(self, image, strict: bool = True) -> dict:
        """PIL image -> {model, raw_text, matched}. `model` is None when no confident,
        unambiguous product-label read (caller should fall back to manual search)."""
        text = self.read_text(image)
        # Try strict (trusted) first; if nothing, report the loose read for context.
        model, hits = classify(text, strict=strict)
        loose_model, _ = classify(text, strict=False)
        return {
            "model": model,
            "loose_model": loose_model,
            "raw_text": text[:400],
            "matched": model is not None,
        }
