from __future__ import annotations

import unittest

from analyzer_v4_contract import BODY_REQUIRED, infer_topology_capabilities, upgrade_analysis_v4
from projection_contract_v41 import region_name_from_id, technical_projection_identity

# Regression baseline: production run 494bd2980be14f398b09539991ba90ed requested BODY_BASIC.


def internal_joint(name: str):
    return {
        "name": name, "position": [0.0, 0.0, 1.0], "internalJointPosition": [0.0, 0.0, 1.0],
        "landmarkType": "internal_joint", "internalAccepted": True, "accepted": True,
        "rawConfidence": 0.88, "geometryConfidence": 0.88, "regionConfidence": 0.86,
        "viewsConfirmed": 0, "triangulationInliers": 0,
    }


def body_analysis():
    return {
        "version": "clouva-avatar-analyzer-v3.2", "isHumanoid": True, "humanoidConfidence": 0.97,
        "bodyBaseConfidence": 0.97, "dimensions": {"height": 1.8}, "orientation": {"requiresOrientationReview": False},
        "bodySubsystems": {name: {"status": "valid", "missingOrInvalid": [], "blockingWarnings": []} for name in ("body_core", "left_arm", "right_arm", "left_leg", "right_leg")},
        "landmarks": {name: internal_joint(name) for name in BODY_REQUIRED},
        "segmentation": {"regions": {"head": {"vertexCount": 500}, "hand_l": {"vertexCount": 300}, "hand_r": {"vertexCount": 320}}},
        "diagnostics": {"hands": {
            "left": {"handBaseReady": True, "fingerRigReady": False, "handMode": "simplified_mitten", "viewsDetected": 0},
            "right": {"handBaseReady": True, "fingerRigReady": False, "handMode": "five_finger_separated", "viewsDetected": 1},
        }},
        "warnings": [], "source": {"sha256": "0" * 64},
    }


class ProfileReadinessTests(unittest.TestCase):
    def test_body_basic_approved_with_face_and_fingers_pending(self):
        result = upgrade_analysis_v4(body_analysis(), "BODY_BASIC", {"invalid_views": [], "all_views_invalid": False})
        self.assertTrue(result["requestedProfileReady"])
        self.assertTrue(result["bodyRigReady"])
        self.assertTrue(result["rigReadinessApproved"])
        self.assertIn("BODY_BASIC", result["supportedRigProfiles"])
        self.assertEqual(result["overall_status"], "approved")
        self.assertTrue(all(result["landmarks"][name]["state"] == "verified_internal_geometry" for name in BODY_REQUIRED))
        self.assertEqual(result["metrics"]["insufficientViewsCount"], 0)

    def test_body_basic_blocks_orientation_review(self):
        analysis = body_analysis()
        analysis["orientation"]["requiresOrientationReview"] = True
        result = upgrade_analysis_v4(analysis, "BODY_BASIC", {"invalid_views": [], "all_views_invalid": False})
        self.assertFalse(result["requestedProfileReady"])
        self.assertIn("orientation", result["rig_profiles"]["BODY_BASIC"]["missing"])

    def test_body_basic_blocks_invalid_subsystem(self):
        analysis = body_analysis()
        analysis["bodySubsystems"]["left_arm"]["status"] = "needs_review"
        analysis["bodySubsystems"]["left_arm"]["missingOrInvalid"] = ["elbow_l"]
        result = upgrade_analysis_v4(analysis, "BODY_BASIC", {"invalid_views": [], "all_views_invalid": False})
        self.assertFalse(result["requestedProfileReady"])
        self.assertIn("subsystem:left_arm", result["rig_profiles"]["BODY_BASIC"]["missing"])

    def test_body_face_stays_blocked_without_surface_face(self):
        result = upgrade_analysis_v4(body_analysis(), "BODY_FACE", {"invalid_views": [], "all_views_invalid": False})
        self.assertFalse(result["requestedProfileReady"])
        self.assertTrue(result["bodyRigReady"])

    def test_body_hands_basic_accepts_mitten_base(self):
        result = upgrade_analysis_v4(body_analysis(), "BODY_HANDS_BASIC", {"invalid_views": [], "all_views_invalid": False})
        self.assertTrue(result["requestedProfileReady"])
        self.assertTrue(result["leftHandBaseReady"])
        self.assertTrue(result["rightHandBaseReady"])

    def test_full_humanoid_blocked_without_real_finger_branches(self):
        result = upgrade_analysis_v4(body_analysis(), "FULL_HUMANOID", {"invalid_views": [], "all_views_invalid": False})
        self.assertFalse(result["requestedProfileReady"])
        self.assertFalse(result["leftFingerRigReady"])
        self.assertFalse(result["rightFingerRigReady"])

    def test_zero_branches_never_reports_five_finger_separated(self):
        capabilities = infer_topology_capabilities(body_analysis())
        self.assertEqual(capabilities["right_detected_finger_branches"], 0)
        self.assertFalse(capabilities["right_five_fingers_supported"])
        self.assertEqual(capabilities["right_hand_mode"], "simplified_mitten")


class TechnicalProjectionIdentityTests(unittest.TestCase):
    def test_reverse_region_mapping(self):
        self.assertEqual(region_name_from_id({"head": 7}, 7), "head")

    def test_valid_technical_point_survives_missing_recast(self):
        identity = technical_projection_identity({
            "valid": True, "worldPosition": [0.1, -0.2, 1.7], "regionId": 7, "objectId": 2,
            "triangleId": 41, "barycentricCoordinates": [0.2, 0.3, 0.5],
        }, {"head": 7, "eyes": 8}, ["head", "eyes"])
        self.assertTrue(identity["valid"])
        self.assertTrue(identity["regionCompatible"])
        self.assertEqual(identity["region"], "head")

    def test_triangle_zero_is_valid(self):
        identity = technical_projection_identity({
            "valid": True, "worldPosition": [0.1, -0.2, 1.7], "regionId": 7, "objectId": 0,
            "triangleId": 0, "barycentricCoordinates": [1.0, 0.0, 0.0],
        }, {"head": 7}, ["head"])
        self.assertTrue(identity["valid"])
        self.assertEqual(identity["triangleId"], 0)

    def test_non_finite_technical_point_is_rejected(self):
        identity = technical_projection_identity({
            "valid": True, "worldPosition": [0.1, float("nan"), 1.7], "regionId": 7,
            "triangleId": 41, "barycentricCoordinates": [0.2, 0.3, 0.5],
        }, {"head": 7}, ["head"])
        self.assertFalse(identity["valid"])

    def test_wrong_technical_region_is_rejected(self):
        identity = technical_projection_identity({
            "valid": True, "worldPosition": [0.1, -0.2, 1.7], "regionId": 9, "objectId": 2, "triangleId": 41,
        }, {"head": 7, "torso": 9}, ["head"])
        self.assertTrue(identity["valid"])
        self.assertFalse(identity["regionCompatible"])


if __name__ == "__main__":
    unittest.main()
