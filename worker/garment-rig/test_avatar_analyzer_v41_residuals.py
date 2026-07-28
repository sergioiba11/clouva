from __future__ import annotations

import unittest

from analyzer_v41_residuals import apply_residual_repairs_v41


def _landmark(state: str, reasons=None, accepted=False):
    return {
        "state": state,
        "validationState": state,
        "accepted": accepted,
        "verified": accepted,
        "display": accepted,
        "viewsConfirmed": 2,
        "rejectionReasons": list(reasons or []),
    }


def _analysis(left_report=None, right_report=None):
    return {
        "requestedRigProfile": "BODY_BASIC",
        "requested_rig_profile": "BODY_BASIC",
        "bodyRigReady": True,
        "rigReadinessApproved": True,
        "requestedProfileReady": True,
        "overall_status": "approved",
        "status": "valid",
        "topology_capabilities": {
            "left_hand_supported": True,
            "right_hand_supported": True,
            "left_five_fingers_supported": False,
            "right_five_fingers_supported": False,
            "left_hand_mode": "simplified_mitten",
            "right_hand_mode": "simplified_mitten",
            "left_finger_rig_mode": "full",
            "right_finger_rig_mode": "full",
        },
        "diagnostics": {
            "v4Attempt": {
                "hands": {
                    "left": left_report or {"handBaseReady": True, "fingerRigMode": "full", "topology": {}},
                    "right": right_report or {"handBaseReady": True, "fingerRigMode": "full", "topology": {}},
                }
            }
        },
        "landmarks": {
            "jaw_center": _landmark("technical_mismatch", ["RAY_RESIDUAL_TOO_HIGH"]),
            "nose_tip": _landmark("technical_mismatch", ["TRIANGULATED_POINT_WRONG_REGION"]),
            "eye_l_center": _landmark("no_visual_evidence", ["NO_VISUAL_EVIDENCE"]),
            "eye_r_center": _landmark("insufficient_views", ["INSUFFICIENT_TECHNICALLY_VALID_VIEWS"]),
            "thumb_01_l": _landmark("topology_invalid", ["HAND_TOPOLOGY_LIMITED"]),
        },
        "metrics": {},
        "rig_profiles": {
            "BODY_BASIC": {"supported": True, "missing": []},
            "body_only": {"supported": True, "missing": []},
            "BODY_FACE": {"supported": False, "missing": ["jaw"]},
            "BODY_HANDS_BASIC": {"supported": True, "missing": []},
            "body_with_hands": {"supported": True, "missing": []},
            "FULL_HUMANOID": {"supported": False, "missing": ["left_five_finger_topology"]},
            "full_humanoid": {"supported": False, "missing": ["left_five_finger_topology"]},
            "FULL_BODY_HANDS_FACE": {"supported": False, "missing": ["jaw"]},
            "full_humanoid_with_face": {"supported": False, "missing": ["jaw"]},
        },
        "warnings": [],
    }


class FingerRigResidualTests(unittest.TestCase):
    def test_zero_branches_overrides_inherited_full(self):
        result = apply_residual_repairs_v41(_analysis())
        capabilities = result["topology_capabilities"]
        self.assertEqual(capabilities["right_verified_finger_branch_count"], 0)
        self.assertEqual(capabilities["right_finger_rig_mode"], "simplified")
        self.assertFalse(capabilities["right_five_fingers_supported"])
        self.assertFalse(result["rightFingerRigReady"])
        self.assertTrue(capabilities["right_finger_rig_mode_conflict"])

    def test_one_verified_branch_is_simplified(self):
        report = {"handBaseReady": True, "topology": {"verifiedGeodesicBranchCount": 1}}
        result = apply_residual_repairs_v41(_analysis(right_report=report))
        self.assertEqual(result["topology_capabilities"]["right_finger_rig_mode"], "simplified")

    def test_three_verified_branches_are_partial(self):
        report = {"handBaseReady": True, "topology": {"validGeodesicBranches": [1, 2, 3]}}
        result = apply_residual_repairs_v41(_analysis(right_report=report))
        self.assertEqual(result["topology_capabilities"]["right_finger_rig_mode"], "partial")
        self.assertFalse(result["topology_capabilities"]["right_five_fingers_supported"])

    def test_five_verified_branches_are_full_but_landmarks_still_gate_readiness(self):
        report = {"handBaseReady": True, "topology": {"verifiedGeodesicBranchCount": 5}}
        result = apply_residual_repairs_v41(_analysis(right_report=report))
        self.assertEqual(result["topology_capabilities"]["right_finger_rig_mode"], "full")
        self.assertTrue(result["topology_capabilities"]["right_five_fingers_supported"])
        self.assertFalse(result["rightFingerRigReady"])

    def test_visual_tips_do_not_create_geometric_branches(self):
        report = {
            "handBaseReady": True,
            "fingerRigMode": "full",
            "topology": {"visualFingertips": [1, 2, 3, 4, 5], "detectedBranchCount": 5},
        }
        result = apply_residual_repairs_v41(_analysis(right_report=report))
        self.assertEqual(result["topology_capabilities"]["right_verified_finger_branch_count"], 0)
        self.assertEqual(result["topology_capabilities"]["right_finger_rig_mode"], "simplified")

    def test_missing_hand_is_unsupported(self):
        analysis = _analysis(right_report={"handBaseReady": False, "fingerRigMode": "full"})
        analysis["topology_capabilities"]["right_hand_supported"] = False
        result = apply_residual_repairs_v41(analysis)
        self.assertEqual(result["topology_capabilities"]["right_finger_rig_mode"], "unsupported")


class MetricResidualTests(unittest.TestCase):
    def test_low_confidence_and_projection_counts_do_not_overlap(self):
        result = apply_residual_repairs_v41(_analysis())
        metrics = result["metrics"]
        self.assertEqual(result["landmarks"]["jaw_center"]["state"], "low_confidence")
        self.assertEqual(result["landmarks"]["nose_tip"]["state"], "projection_mismatch")
        self.assertEqual(metrics["lowConfidenceCount"], 1)
        self.assertEqual(metrics["projectionMismatchCount"], 1)
        self.assertEqual(metrics["technicalMismatchCount"], 1)
        self.assertEqual(metrics["noVisualEvidenceCount"], 1)
        self.assertEqual(metrics["insufficientViewsCount"], 1)
        self.assertEqual(metrics["topologyInvalidCount"], 1)

    def test_camera_invalid_is_projection_mismatch(self):
        analysis = _analysis()
        analysis["landmarks"]["camera_point"] = _landmark(
            "technical_mismatch", ["CAMERA_PROJECTION_INVALID"],
        )
        result = apply_residual_repairs_v41(analysis)
        self.assertEqual(result["landmarks"]["camera_point"]["state"], "projection_mismatch")
        self.assertEqual(result["metrics"]["projectionMismatchCount"], 2)
        self.assertEqual(result["metrics"]["technicalMismatchCount"], 2)

    def test_explicit_insufficient_views_remains_separate(self):
        result = apply_residual_repairs_v41(_analysis())
        self.assertEqual(result["landmarks"]["eye_r_center"]["state"], "insufficient_views")
        self.assertEqual(result["metrics"]["insufficientViewsCount"], 1)
        self.assertEqual(result["metrics"]["lowConfidenceCount"], 1)

    def test_body_basic_remains_approved(self):
        result = apply_residual_repairs_v41(_analysis())
        self.assertTrue(result["requestedProfileReady"])
        self.assertTrue(result["rigReadinessApproved"])
        self.assertIn("BODY_BASIC", result["supportedRigProfiles"])

    def test_conflict_warning_is_non_blocking(self):
        result = apply_residual_repairs_v41(_analysis())
        conflicts = [item for item in result["warnings"] if item.get("code") == "LEGACY_FINGER_RIG_MODE_CONFLICT"]
        self.assertEqual(len(conflicts), 2)
        self.assertTrue(all(item["blocking"] is False for item in conflicts))


if __name__ == "__main__":
    unittest.main()
