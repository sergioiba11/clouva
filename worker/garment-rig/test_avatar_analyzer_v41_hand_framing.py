from __future__ import annotations

import ast
from pathlib import Path
import unittest


ROOT = Path(__file__).parent
SHIM_PATH = ROOT / "multiview_renderer_v4.py"
BASE_PATH = ROOT / "multiview_renderer_v4_base.py"
PATCH_PATH = ROOT / "hand_framing_v41.py"
FAST_PATH = ROOT / "hand_framing_v41_fast.py"


class HandFramingSourceContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.shim = SHIM_PATH.read_text(encoding="utf-8")
        cls.base = BASE_PATH.read_text(encoding="utf-8")
        cls.patch = PATCH_PATH.read_text(encoding="utf-8")
        cls.fast = FAST_PATH.read_text(encoding="utf-8")
        cls.combined_patch = cls.patch + "\n" + cls.fast
        for source in (cls.shim, cls.base, cls.patch, cls.fast):
            ast.parse(source)

    def test_retained_renderer_is_patched_not_rewritten(self):
        self.assertIn("multiview_renderer_v4_base", self.shim)
        self.assertIn("hand_framing_v41_fast", self.shim)
        self.assertIn("install_hand_framing_patch", self.shim)
        self.assertIn("render_multiview_v4 = _base.render_multiview_v4", self.shim)

    def test_focus_and_distal_context_are_separate(self):
        self.assertIn("HAND_FOCUS_V41", self.patch)
        self.assertIn("HAND_CONTEXT_DISTAL_V41", self.patch)
        self.assertIn('f"forearm_{suffix}_distal"', self.patch)
        self.assertNotIn("HAND_CONTEXT_FULL_V41", self.patch)

    def test_distal_forearm_is_geometrically_clipped(self):
        self.assertIn("def _clip_polygon_halfspace", self.patch)
        self.assertIn("_clip_polygon_halfspace(points", self.patch)
        self.assertIn("distal_forearm_length", self.patch)
        self.assertNotIn("triangle_centroid", self.patch)

    def test_unverified_finger_aliases_do_not_enter_focus_proxy(self):
        self.assertIn("def _verified_region", self.patch)
        self.assertIn("metadata.primary_region == region", self.patch)
        self.assertIn("region in metadata.secondary_regions", self.patch)
        self.assertNotIn("anatomy_bvh.has_region", self.patch)

    def test_existing_exact_focus_mask_is_canonical_coverage(self):
        self.assertIn('view.get("silhouettePath")', self.fast)
        self.assertIn('technical["coverage"] = float(focus_mask.get("coverage") or 0.0)', self.fast)
        self.assertIn('"silhouetteCoverage": coverage', self.patch)
        self.assertIn('context.get("touchesEdge")', self.patch)
        self.assertIn('"technicalSilhouetteCoverage": coverage', self.patch)
        self.assertIn('"duplicateFocusRenderSkipped"] = True', self.fast)
        self.assertNotIn("_render_mask", self.fast)

    def test_retry_contract_remains_in_retained_renderer(self):
        self.assertIn('"maximum_retries": 2', self.base)
        self.assertIn('float(final_view.get("silhouetteCoverage") or 0.0) < hand_config["minimum_coverage"]', self.base)
        self.assertIn('float(final_view.get("silhouetteCoverage") or 0.0) > hand_config["maximum_coverage"]', self.base)
        self.assertIn('or bool(final_view.get("clippingDetected"))', self.base)

    def test_threshold_is_not_lowered(self):
        self.assertIn("HAND_MIN_COVERAGE = 0.15", self.patch)
        self.assertIn("HAND_MAX_COVERAGE = 0.90", self.patch)
        self.assertIn('"minimum_coverage": 0.15', self.base)

    def test_camera_target_stays_fixed_during_retry(self):
        retry_fragment = self.base.split("while retry_count", 1)[1]
        self.assertNotIn("target =", retry_fragment.split("after =", 1)[0])

    def test_focus_not_context_controls_camera_zoom_and_clipping_gate(self):
        self.assertIn("focus_minimum_framing = _required_framing", self.base)
        self.assertIn("current_framing = max(desired_framing, focus_minimum_framing)", self.base)
        self.assertNotIn("current_framing = max(desired_framing, context_minimum_framing)", self.base)
        self.assertIn('"contextClippingDetected"', self.base)
        self.assertIn('"focusProjectionBounds"', self.base)

    def test_context_and_focus_diagnostics_are_retained(self):
        for field in (
            '"focusProxyRegions"', '"contextProxyRegions"', '"distalForearmRatio"',
            '"focusProxyBounds"', '"contextProxyBounds"', '"focusProxyVertexCount"',
            '"contextProxyVertexCount"', '"beforeCoverage"', '"afterCoverage"',
            '"retryCount"', '"handCameraOrthoScale"', '"framingValid"',
            '"clippingDetected"', '"contextProjectionBounds"', '"wristVisible"',
        ):
            self.assertIn(field, self.base)

    def test_focus_center_and_context_edge_diagnostics_are_added(self):
        for field in (
            '"focusSilhouetteCenter"', '"focusSilhouetteCentered"',
            '"focusSilhouetteTouchesEdge"', '"contextSilhouetteTouchesEdge"',
        ):
            self.assertIn(field, self.patch)

    def test_patch_installation_is_idempotent(self):
        self.assertIn("_clouva_hand_framing_v41_installed", self.patch)
        self.assertIn("base_module._render_view = _render_view", self.patch)
        self.assertIn("base_module._enrich = _enrich", self.patch)
        self.assertIn("_geometry_patch._render_view = _render_view", self.fast)


if __name__ == "__main__":
    unittest.main()
