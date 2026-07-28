from __future__ import annotations

import ast
from pathlib import Path
import unittest


SOURCE_PATH = Path(__file__).with_name("multiview_renderer_v4.py")


class HandFramingSourceContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = SOURCE_PATH.read_text(encoding="utf-8")
        cls.tree = ast.parse(cls.source)

    def test_focus_and_distal_context_are_separate(self):
        self.assertIn("HAND_FOCUS_V41", self.source)
        self.assertIn("HAND_CONTEXT_DISTAL_V41", self.source)
        self.assertIn("forearm_{suffix}_distal", self.source)
        self.assertNotIn("def _hand_detection_proxy", self.source)

    def test_camera_extent_uses_focus_points(self):
        self.assertIn("_projected_extent(focus_points", self.source)
        self.assertNotIn("_projected_extent(context_points", self.source)

    def test_technical_coverage_excludes_full_forearm(self):
        self.assertIn("projection_regions = list(focus_regions)", self.source)
        self.assertNotIn('projection_regions = [f"forearm_{suffix}"', self.source)

    def test_context_clipping_uses_proxy_geometry(self):
        self.assertIn("_required_framing(", self.source)
        self.assertIn("_projection_frame(context_points", self.source)
        self.assertIn('"contextProjectionBounds"', self.source)
        self.assertIn('"wristVisible"', self.source)
        self.assertIn('"allWristsVisible"', self.source)

    def test_manifest_keeps_required_hand_diagnostics(self):
        for field in (
            '"focusProxyRegions"', '"contextProxyRegions"', '"distalForearmRatio"',
            '"focusProxyBounds"', '"contextProxyBounds"', '"focusProxyVertexCount"',
            '"contextProxyVertexCount"', '"beforeCoverage"', '"afterCoverage"',
            '"retryCount"', '"handCameraOrthoScale"', '"framingValid"',
            '"clippingDetected"',
        ):
            self.assertIn(field, self.source)

    def test_retry_budget_is_capped_at_two(self):
        self.assertIn('"maximum_retries": 2', self.source)
        self.assertIn('min(2, int(merged["maximum_retries"]))', self.source)

    def test_threshold_is_not_lowered_below_fifteen_percent(self):
        self.assertIn('"minimum_coverage": 0.15', self.source)
        self.assertIn('hand_config["minimum_coverage"] <= after', self.source)

    def test_camera_target_is_not_changed_during_retry(self):
        self.assertEqual(self.source.count("target = _average(focus_points"), 1)
        retry_fragment = self.source.split("while retry_count", 1)[1]
        self.assertNotIn("target =", retry_fragment.split("after =", 1)[0])


if __name__ == "__main__":
    unittest.main()
