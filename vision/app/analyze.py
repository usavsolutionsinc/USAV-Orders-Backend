"""Photo analysis for the catalog/claim search index.

This is the LOCAL counterpart to the cloud GCP-Vision path in the Next app
(`src/lib/photos/analyze.ts`). The Vercel cron posts a photo here and gets back the
SAME `PhotoAnalysisMetadata` shape the cloud path produces, so a tenant can keep
every photo on its own RTX 5070 Ti box instead of uploading to Google:

    { ocr_text: [str], labels: [str], damage_detected: bool,
      damage_notes: str | None, caption: str }

It reuses what the box already loads: EasyOCR (the LabelIdentifier reader) for text
and the DINOv2 index (the Engine) for product labels — no new model. `build_analysis`
is kept pure (text + candidates in, dict out) so it unit-tests without torch/EasyOCR.
"""
from __future__ import annotations

import re

# Mirror src/lib/photos/analyze-types.ts DAMAGE_KEYWORDS so "damaged" means the same
# thing on the local path as on the cloud path.
DAMAGE_KEYWORDS = [
    "damage", "damaged", "tear", "dent", "dented", "crack", "cracked",
    "broken", "crumpled", "scratch", "scratched", "shattered",
]

_OCR_SPLIT = re.compile(r"[\n\r]+|\s{2,}")


def _ocr_chunks(raw_text: str, cap: int = 20) -> list[str]:
    """Break the OCR blob into deduped, trimmed snippets (>=3 chars)."""
    if not raw_text:
        return []
    seen: set[str] = set()
    out: list[str] = []
    for piece in _OCR_SPLIT.split(raw_text):
        s = piece.strip()
        if len(s) < 3 or s.lower() in seen:
            continue
        seen.add(s.lower())
        out.append(s[:120])
        if len(out) >= cap:
            break
    return out


def build_analysis(raw_text: str, candidate_labels: list[str]) -> dict:
    """Pure: assemble the metadata dict from OCR text + SKU candidate labels."""
    ocr_text = _ocr_chunks(raw_text)
    labels = [str(c).strip() for c in (candidate_labels or []) if str(c).strip()][:12]

    haystack = " ".join([*ocr_text, *labels]).lower()
    matched = [k for k in DAMAGE_KEYWORDS if k in haystack]
    # collapse dent/dented, crack/cracked etc. to the shorter stem for tidy notes
    notes = sorted({k for k in matched})
    damage_detected = len(matched) > 0

    if labels:
        caption = ", ".join(labels[:3])
    elif ocr_text:
        caption = ocr_text[0]
    else:
        caption = "Operations photo"

    return {
        "ocr_text": ocr_text,
        "labels": labels,
        "damage_detected": damage_detected,
        "damage_notes": ", ".join(notes) if notes else None,
        "caption": caption,
    }


class PhotoAnalyzer:
    """Wires the box's OCR reader + DINOv2 engine into build_analysis.

    `engine` is the shared Engine (DINOv2 index); `label_identifier` is the shared
    LabelIdentifier (EasyOCR). Both are already loaded by the server — we just reuse
    them. `top_labels` keeps only confident SKU candidates as labels.
    """

    def __init__(self, engine, label_identifier, *, min_score: float = 0.4, top_labels: int = 5) -> None:
        self._engine = engine
        self._labeler = label_identifier
        self._min_score = min_score
        self._top_labels = top_labels

    def _candidate_labels(self, image) -> list[str]:
        # Engine.identify -> [{sku, score}]; keep the confident ones as labels.
        try:
            ranked = self._engine.identify(image)
        except Exception:  # noqa: BLE001 — an empty/unbuilt index must not fail analysis
            return []
        out: list[str] = []
        for c in ranked[: self._top_labels]:
            if float(c.get("score", 0)) >= self._min_score and c.get("sku"):
                out.append(str(c["sku"]))
        return out

    def analyze(self, image) -> dict:
        raw_text = ""
        try:
            raw_text = self._labeler.read_text(image)
        except Exception:  # noqa: BLE001 — OCR failure degrades to label-only metadata
            raw_text = ""
        return build_analysis(raw_text, self._candidate_labels(image))
