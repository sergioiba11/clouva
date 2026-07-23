from __future__ import annotations

import copy
import unittest

from analyzer_v4_contract import (
    APPROVED_STATES,
    BODY_REQUIRED,
    calibrate_landmark,
    group_root_causes,
    upgrade_analysis_v4,
)
from camera_projection_self_test_v4 import validate_manifest


def verified(position, region="body"):
    return {
        "position": list(position),
        "internalJointPosition": list(position),
        "accepted": True,
        "rayHit": True,
        "viewsConfirmed": 3,
        "triangulationInliers": 3,
        "detectorConfidence": 0.88,
        "visualConfidence": 0.84,
        "triangulationConfidence": 0.82,
        "regionConfidence": 0.90,
        "topologyConfidence": 0.90,
        "region": region,
    }


def base_analysis():
    positions = {
        "pelvis": (0.0, 0.0, 0.92), "spine_01": (0.0, 0.0, 1.05),
        "spine_02": (0.0, 0.0, 1.20), "chest": (0.0, 0.0, 1.38),
        "neck": (0.0, 0.0, 1.55), "head": (0.0, 0.0, 1.72),
        "shoulder_l": (0.29, 0.0, 1.43), "shoulder_r": (-0.29, 0.0, 1.43),
        "elbow_l": (0.53, 0.0, 1.18), "elbow_r": (-0.53, 0.0, 1.18),
        "wrist_l": (0.72, 0.0, 0.98), "wrist_r": (-0.72, 0.0, 0.98),
        "hip_l": (0.15, 0.0, 0.90), "hip_r": (-0.15, 0.0, 0.90),
        "knee_l": (0.15, 0.0, 0.50), "knee_r": (-0.15, 0.0, 0.50),
        "ankle_l": (0.15, 0.0, 0.10), "ankle_r": (-0.15, 0.0, 0.10),
        "foot_l": (0.15, -0.12, 0.04), "foot_r": (-0.15, -0.12, 0.04),
    }
    landmarks = {name: verified(positions[name]) for name in BODY_REQUIRED}
    landmarks.update({
        "root": verified((0.0, 0.0, 0.88)),
        "skull_base": verified((0.0, 0.0, 1.60)),
        "head_top": verified((0.0, 0.0, 1.88)),
        "clavicle_l": verified((0.16, 0.0, 1.44)),
        "clavicle_r": verified((-0.16, 0.0, 1.44)),
        "hand_l": verified((0.79, 0.0, 0.94), "hand_l"),
        "hand_r": verified((-0.79, 0.0, 0.94), "hand_r"),
    })
    return {
        "version": "clouva-avatar-analyzer-v3.2",
        "runId": "a" * 32,
        "status": "needs_review",
        "source": {"sha256": "b" * 64},
        "isHumanoid": True,
        "humanoidConfidence": 0.91,
        "dimensions": {
            "height": 1.88,
            "width": 0.58,
            "bounds": {"minimum": [-0.85, -0.30, 0.0], "maximum": [0.85, 0.30, 1.90]},
        },
        "landmarks": landmarks,
        "segmentation": {
            "regions": {
                "head": {"vertexCount": 200},
                "hand_l": {"vertexCount": 80},
                "hand_r": {"vertexCount": 80},
            },
        },
        "diagnostics": {
            "hands": {
                "left": {"topology": {"branchCount": 0}},
                "right": {"topology": {"branchCount": 0}},
            },
        },
        "warnings": [],
    }


class ConfidenceGateTests(unittest.TestCase):
    def test_zero_views_and_inliers_never_show_full_confidence(self):
        record = calibrate_landmark("nose_tip", {
            "accepted": True,
            "rawConfidence": 1.0,
            "detectorConfidence": 1.0,
            "viewsConfirmed": 0,
            "triangulationInliers": 0,
            "rayHit": False,
        }, {"left_five_fingers_supported": False, "right_five_fingers_supported": False})
        self.assertEqual(record["visual_confidence"], 0.0)
        self.assertEqual(record["triangulation_confidence"], 0.0)
        self.assertNotEqual(record["state"], "verified")
        self.assertLess(record["final_confidence"], 1.0)

    def test_missing_finger_branch_is_unsupported_not_invented(self):
        record = calibrate_landmark("index_01_l", verified((0.8, 0.0, 0.9), "hand"), {
            "left_five_fingers_supported": False,
            "right_five_fingers_supported": False,
        })
        self.assertEqual(record["state"], "topology_invalid")
        self.assertEqual(record["final_confidence"], 0.0)
        self.assertFalse(record["accepted"])


class ProfileIsolationTests(unittest.TestCase):
    def test_face_and_full_fingers_do_not_block_body_basic(self):
        result = upgrade_analysis_v4(base_analysis(), "BODY_BASIC", {"invalid_views": [], "all_views_invalid": False})
        self.assertIn("BODY_BASIC", result["supported_rig_profiles"])
        self.assertNotIn("FULL_BODY_HANDS_FACE", result["supported_rig_profiles"])
        self.assertIn(result["overall_status"], {"approved", "approved_with_fallbacks"})
        self.assertTrue(result["criticalLandmarksVerified"])

    def test_requested_full_profile_reports_incompatibility(self):
        result = upgrade_analysis_v4(base_analysis(), "FULL_BODY_HANDS_FACE", {"invalid_views": [], "all_views_invalid": False})
        self.assertEqual(result["overall_status"], "incompatible_with_requested_profile")
        self.assertEqual(result["recommended_next_action"], "continue_with_BODY_BASIC_or_reanalyze_optional_modules")


class ShoulderCorridorTests(unittest.TestCase):
    def test_right_shoulder_uses_corridor_and_symmetry(self):
        analysis = base_analysis()
        shoulder = analysis["landmarks"]["shoulder_r"]
        shoulder.update({
            "accepted": False,
            "verified": False,
            "position": [-0.31, 0.0, 1.41],
            "internalJointPosition": [-0.31, 0.0, 1.41],
            "surfaceRegion": "upper_arm_r",
            "surfaceDistance": 0.035,
            "validationThreshold": 0.05,
            "rejectionReasons": ["BODY_INTERNAL_JOINT_OUTSIDE_REGION"],
            "rawConfidence": 0.74,
            "geometryConfidence": 0.70,
        })
        result = upgrade_analysis_v4(analysis, "BODY_BASIC", {"invalid_views": [], "all_views_invalid": False})
        repaired = result["landmarks"]["shoulder_r"]
        self.assertEqual(repaired["state"], "verified_geometry_fallback")
        self.assertEqual(repaired["verificationMethod"], "joint_corridor_with_symmetry_prior")
        self.assertTrue(result["right_shoulder_repair"]["attempted"])
        self.assertTrue(result["right_shoulder_repair"]["accepted"])
        self.assertIn("BODY_BASIC", result["supported_rig_profiles"])


class RootCauseTests(unittest.TestCase):
    def test_projection_failures_are_grouped(self):
        warnings = [
            {"code": "LANDMARK_REGION_BVH_MISS", "view": "face_front", "landmark": f"face_{index}"}
            for index in range(25)
        ]
        grouped = group_root_causes(warnings, {"invalid_views": ["face_front"]})
        self.assertEqual(len(grouped), 1)
        self.assertEqual(grouped[0]["code"], "PROJECTION_FAILURE")
        self.assertEqual(grouped[0]["occurrences"], 25)
        self.assertEqual(grouped[0]["affected_landmark_count"], 25)


class DeterminismTests(unittest.TestCase):
    def test_same_input_has_same_diagnostic_fingerprint(self):
        first = upgrade_analysis_v4(base_analysis(), "BODY_BASIC", {"invalid_views": [], "all_views_invalid": False})
        second = upgrade_analysis_v4(copy.deepcopy(base_analysis()), "BODY_BASIC", {"invalid_views": [], "all_views_invalid": False})
        self.assertEqual(first["diagnostic_fingerprint"], second["diagnostic_fingerprint"])

    def test_skeleton_planner_receives_approved_states_only(self):
        analysis = base_analysis()
        analysis["landmarks"]["nose_tip"] = {"viewsConfirmed": 0, "triangulationInliers": 0, "rawConfidence": 1.0}
        result = upgrade_analysis_v4(analysis, "BODY_BASIC", {"invalid_views": [], "all_views_invalid": False})
        self.assertNotIn("nose_tip", result["skeleton_planner_input"])
        self.assertTrue(all(item["state"] in APPROVED_STATES for item in result["skeleton_planner_input"].values()))


class CameraSelfTestTests(unittest.TestCase):
    def test_bad_matrix_invalidates_whole_camera(self):
        manifest = {
            "version": "test",
            "views": [{
                "name": "face_front",
                "matrixWorld": [[0.0, 0.0, 0.0, 0.0]] * 4,
                "resolution": [512, 512],
                "directionToCamera": [0.0, -1.0, 0.0],
                "orthoScale": 1.0,
                "technicalPasses": {"paths": {
                    "depthNpy": "d", "normalNpy": "n", "regionIdNpy": "r",
                    "objectIdNpy": "o", "exactSilhouettePng": "s",
                }},
            }],
        }
        result = validate_manifest(manifest)
        self.assertEqual(result["invalid_views"], ["face_front"])
        self.assertTrue(result["all_views_invalid"])


if __name__ == "__main__":
    unittest.main()
