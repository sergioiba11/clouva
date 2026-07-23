from __future__ import annotations

import copy
import unittest

from anatomy_semantics import region_match, triangle_semantics
from analyzer_v4_bootstrap import resolve_camera_vector_values
from analyzer_v4_contract import calibrate_landmark, upgrade_analysis_v4
from hand_modes import classify_hand_mode
from test_avatar_analyzer_v4_contract import base_analysis, verified


class BoundaryBvhSemanticsTests(unittest.TestCase):
    def test_mixed_shoulder_triangle_is_never_discarded(self):
        semantics = triangle_semantics(
            ["torso", "upper_arm_r", "torso"],
            [0, 1, 2],
        )
        self.assertEqual(semantics["primary_region"], "torso")
        self.assertEqual(semantics["secondary_regions"], ("upper_arm_r",))
        self.assertTrue(semantics["is_boundary"])
        accepted, match_kind, penalty = region_match(
            semantics["primary_region"],
            semantics["secondary_regions"],
            ["upper_arm_r"],
            semantics["is_boundary"],
        )
        self.assertTrue(accepted)
        self.assertEqual(match_kind, "secondary")
        self.assertGreater(penalty, 0.0)

    def test_neck_head_boundary_accepts_anatomical_neighbor(self):
        accepted, match_kind, penalty = region_match(
            "neck", (), ["head"], True,
        )
        self.assertTrue(accepted)
        self.assertEqual(match_kind, "adjacent_boundary")
        self.assertLess(penalty, 1.0)


class HandModeTests(unittest.TestCase):
    def test_connected_fingers_do_not_require_disconnected_components(self):
        result = classify_hand_mode({
            "vertex_count": 800,
            "connected_components": 1,
            "geodesic_branches": 5,
            "visual_fingertips": 5,
        })
        self.assertEqual(result["mode"], "five_finger_connected")
        self.assertTrue(result["fullFingerRigSupported"])

    def test_mitten_supports_hand_base_without_inventing_fingers(self):
        result = classify_hand_mode({
            "vertex_count": 420,
            "connected_components": 1,
            "geodesic_branches": 0,
            "visual_fingertips": 0,
        })
        self.assertEqual(result["mode"], "simplified_mitten")
        self.assertTrue(result["handBaseSupported"])
        self.assertFalse(result["fullFingerRigSupported"])

    def test_visual_five_with_failed_geometry_stays_connected_review(self):
        result = classify_hand_mode({
            "vertex_count": 700,
            "connected_components": 1,
            "geodesic_branches": 2,
            "visual_fingertips": 5,
        })
        self.assertEqual(result["mode"], "five_finger_connected")
        self.assertTrue(result["requiresGeometryRecovery"])


class ConfidenceAndReadinessTests(unittest.TestCase):
    def test_exact_single_view_surface_can_be_verified(self):
        record = calibrate_landmark("nose_tip", {
            "position": [0.0, -0.1, 1.7],
            "landmarkType": "surface_landmark",
            "rayHit": True,
            "viewsConfirmed": 1,
            "triangulationInliers": 1,
            "triangleId": 42,
            "barycentricCoordinates": [0.2, 0.3, 0.5],
            "detectorConfidence": 0.91,
            "visualConfidence": 0.88,
            "geometryConfidence": 0.90,
            "regionConfidence": 0.92,
            "topologyConfidence": 1.0,
        }, {})
        self.assertEqual(record["state"], "verified_single_view_depth")
        self.assertTrue(record["accepted"])

    def test_rejected_landmark_never_exposes_full_confidence(self):
        record = calibrate_landmark("nose_tip", {
            "rawConfidence": 1.0,
            "detectorConfidence": 1.0,
            "viewsConfirmed": 0,
            "triangulationInliers": 0,
            "rayHit": False,
        }, {})
        self.assertFalse(record["accepted"])
        self.assertLess(record["final_confidence"], 1.0)

    def test_body_readiness_is_independent_from_face_and_fingers(self):
        result = upgrade_analysis_v4(
            base_analysis(),
            "body_only",
            {"invalid_views": [], "all_views_invalid": False},
        )
        self.assertTrue(result["bodyRigReady"])
        self.assertFalse(result["fullHumanoidRigReady"])
        self.assertTrue(result["unrealExportReady"])

    def test_mitten_blocks_full_humanoid_but_not_body(self):
        analysis = copy.deepcopy(base_analysis())
        for side in ("left", "right"):
            analysis["diagnostics"]["hands"][side].update({
                "handMode": "simplified_mitten",
                "handBaseReady": True,
                "fingerRigReady": False,
                "fingerRigMode": "simplified",
            })
        result = upgrade_analysis_v4(
            analysis,
            "full_humanoid",
            {"invalid_views": [], "all_views_invalid": False},
        )
        self.assertTrue(result["bodyRigReady"])
        self.assertTrue(result["leftHandBaseReady"])
        self.assertTrue(result["rightHandBaseReady"])
        self.assertFalse(result["leftFingerRigReady"])
        self.assertFalse(result["rightFingerRigReady"])
        self.assertFalse(result["fullHumanoidRigReady"])
        self.assertEqual(result["overall_status"], "incompatible_with_requested_profile")


class CameraBootstrapTests(unittest.TestCase):
    def test_rejected_hand_detection_does_not_erase_body_wrist_anchor(self):
        analysis = base_analysis()
        analysis["landmarks"]["wrist_l"] = {
            "state": "insufficient_views",
            "accepted": False,
            "rejectionReasons": ["NO_VISUAL_EVIDENCE"],
        }
        analysis["landmarks"]["wrist_r"] = {
            "state": "projection_mismatch",
            "accepted": False,
            "rejectionReasons": ["NO_RAY_HIT"],
        }
        analysis["segmentation"]["refinedVectors"] = {
            "wrist_l": [0.72, 0.0, 0.98],
            "wrist_r": [-0.72, 0.0, 0.98],
        }
        values, diagnostics = resolve_camera_vector_values(analysis)
        self.assertEqual(values["wrist_l"], [0.72, 0.0, 0.98])
        self.assertEqual(values["wrist_r"], [-0.72, 0.0, 0.98])
        self.assertIn("wrist_l", diagnostics["fallbackVectors"])
        self.assertIn("wrist_r", diagnostics["fallbackVectors"])
        self.assertTrue(diagnostics["ready"])


if __name__ == "__main__":
    unittest.main()
