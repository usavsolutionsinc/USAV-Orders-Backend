"""Unit tests for the local /analyze metadata builder.

Pure logic + fakes — no torch / EasyOCR / GPU needed, so it runs in CI on any box.

Run:  python vision/tests/test_analyze.py      (or: cd vision && python -m unittest tests.test_analyze)
"""
import os
import sys
import unittest

# Make `app` importable regardless of CWD (vision/ is the package root).
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.analyze import build_analysis, PhotoAnalyzer, DAMAGE_KEYWORDS  # noqa: E402


class BuildAnalysisTests(unittest.TestCase):
    def test_shape_matches_cloud_contract(self):
        meta = build_analysis("SER NO 123\nMODEL AWRCC1", ["Bose Wave"])
        self.assertEqual(
            set(meta.keys()),
            {"ocr_text", "labels", "damage_detected", "damage_notes", "caption"},
        )

    def test_ocr_chunks_split_dedupe_and_cap(self):
        raw = "\n".join(["LINE ONE", "LINE ONE", "li", "LINE TWO"] + [f"X{i}xx" for i in range(40)])
        meta = build_analysis(raw, [])
        self.assertLessEqual(len(meta["ocr_text"]), 20)
        # "li" (<3 chars) dropped, duplicate "LINE ONE" collapsed
        self.assertEqual(meta["ocr_text"][0], "LINE ONE")
        self.assertNotIn("li", meta["ocr_text"])

    def test_labels_capped_at_12_and_caption_from_labels(self):
        meta = build_analysis("", [f"SKU{i}" for i in range(20)])
        self.assertEqual(len(meta["labels"]), 12)
        self.assertEqual(meta["caption"], "SKU0, SKU1, SKU2")

    def test_damage_detected_from_ocr_keywords(self):
        meta = build_analysis("box is DENTED and the corner CRACKED", ["carton"])
        self.assertTrue(meta["damage_detected"])
        self.assertIn("cracked", meta["damage_notes"])
        self.assertIn("dented", meta["damage_notes"])

    def test_no_damage_clean(self):
        meta = build_analysis("clean unit in original box", ["speaker"])
        self.assertFalse(meta["damage_detected"])
        self.assertIsNone(meta["damage_notes"])

    def test_caption_falls_back_to_ocr_then_default(self):
        self.assertEqual(build_analysis("First snippet here", [])["caption"], "First snippet here")
        self.assertEqual(build_analysis("", [])["caption"], "Operations photo")

    def test_damage_keywords_align_with_ts(self):
        # guard against drift from src/lib/photos/analyze-types.ts
        for k in ("damaged", "cracked", "dented", "shattered"):
            self.assertIn(k, DAMAGE_KEYWORDS)


class FakeEngine:
    def __init__(self, ranked):
        self._ranked = ranked

    def identify(self, _image):
        return self._ranked


class FakeLabeler:
    def __init__(self, text):
        self._text = text

    def read_text(self, _image):
        return self._text


class PhotoAnalyzerTests(unittest.TestCase):
    def test_keeps_only_confident_candidates_as_labels(self):
        engine = FakeEngine([
            {"sku": "BOSE-QC35", "score": 0.91},
            {"sku": "BOSE-QC45", "score": 0.20},  # below min_score, dropped
        ])
        analyzer = PhotoAnalyzer(engine, FakeLabeler("SER NO 42"), min_score=0.4)
        meta = analyzer.analyze(object())
        self.assertEqual(meta["labels"], ["BOSE-QC35"])
        self.assertIn("SER NO 42", meta["ocr_text"])

    def test_empty_index_degrades_to_ocr_only(self):
        class Boom:
            def identify(self, _image):
                raise RuntimeError("index not built")

        analyzer = PhotoAnalyzer(Boom(), FakeLabeler("MODEL AWRCC2"))
        meta = analyzer.analyze(object())
        self.assertEqual(meta["labels"], [])
        self.assertIn("MODEL AWRCC2", meta["ocr_text"])

    def test_ocr_failure_degrades_to_label_only(self):
        class BadOcr:
            def read_text(self, _image):
                raise RuntimeError("easyocr exploded")

        engine = FakeEngine([{"sku": "BOSE-901", "score": 0.99}])
        analyzer = PhotoAnalyzer(engine, BadOcr())
        meta = analyzer.analyze(object())
        self.assertEqual(meta["ocr_text"], [])
        self.assertEqual(meta["labels"], ["BOSE-901"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
