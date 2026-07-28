from __future__ import annotations

import unittest

from analyzer_v43_incremental import build_incremental_plan


class ProfileAwareHandPlanTests(unittest.TestCase):
    def test_body_hands_basic_runs_geometry_only_hands(self):
        plan = build_incremental_plan("initial", requested_profile="BODY_HANDS_BASIC")
        self.assertEqual(
            plan["modules"],
            ["body", "left_hand", "right_hand", "measurements"],
        )
        self.assertFalse(any(camera.startswith("hand_") for camera in plan["cameras"]))
        self.assertFalse(plan["moduleOptions"]["left_hand"]["includeFingers"])
        self.assertFalse(plan["moduleOptions"]["right_hand"]["requiresVisualEvidence"])

    def test_full_humanoid_runs_full_finger_modules(self):
        plan = build_incremental_plan("initial", requested_profile="FULL_HUMANOID")
        self.assertTrue(plan["moduleOptions"]["left_hand"]["includeFingers"])
        self.assertTrue(plan["moduleOptions"]["right_hand"]["requiresVisualEvidence"])
        self.assertTrue(any(camera.startswith("hand_l_") for camera in plan["cameras"]))
        self.assertTrue(any(camera.startswith("hand_r_") for camera in plan["cameras"]))

    def test_basic_hand_reanalysis_stays_geometry_only(self):
        plan = build_incremental_plan(
            "reanalyze_left_hand",
            requested_profile="BODY_HANDS_BASIC",
        )
        self.assertEqual(plan["modules"], ["left_hand"])
        self.assertEqual(plan["cameras"], [])
        self.assertEqual(plan["landmarks"], ["wrist_l", "palm_l"])
        self.assertFalse(plan["moduleOptions"]["left_hand"]["includeFingers"])

    def test_explicit_hand_reanalysis_from_body_basic_runs_full_hand(self):
        plan = build_incremental_plan(
            "reanalyze_right_hand",
            requested_profile="BODY_BASIC",
        )
        self.assertTrue(plan["moduleOptions"]["right_hand"]["includeFingers"])
        self.assertTrue(any(camera.startswith("hand_r_") for camera in plan["cameras"]))
        self.assertTrue(plan["moduleOptions"]["right_hand"]["explicitEvidenceRequest"])

    def test_explicit_finger_landmark_overrides_basic_hand_profile(self):
        plan = build_incremental_plan(
            "reanalyze_landmark",
            requested_profile="BODY_HANDS_BASIC",
            landmark="index_02_l",
        )
        self.assertEqual(plan["landmarks"], ["index_02_l"])
        self.assertTrue(plan["moduleOptions"]["left_hand"]["includeFingers"])
        self.assertLessEqual(len(plan["cameras"]), 2)

    def test_full_landmark_reanalysis_uses_only_two_hand_views(self):
        plan = build_incremental_plan(
            "reanalyze_landmark",
            requested_profile="FULL_HUMANOID",
            landmark="ring_03_r",
        )
        self.assertEqual(plan["modules"], ["right_hand"])
        self.assertEqual(plan["landmarks"], ["ring_03_r"])
        self.assertLessEqual(len(plan["cameras"]), 2)
        self.assertTrue(plan["moduleOptions"]["right_hand"]["includeFingers"])


if __name__ == "__main__":
    unittest.main()
