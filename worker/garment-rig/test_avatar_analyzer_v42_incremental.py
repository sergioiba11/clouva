from __future__ import annotations

import copy
import unittest

from analyzer_v42_incremental import (
    build_cache_key,
    build_incremental_plan,
    dedupe_warnings,
    merge_incremental_analysis,
    modules_for_profile,
    warning_fingerprint,
)
from test_avatar_analyzer_v43_profiles import ProfileAwareHandPlanTests  # noqa: F401


class ProfileExecutionTests(unittest.TestCase):
    def test_body_basic_skips_optional_modules(self):
        self.assertEqual(modules_for_profile("BODY_BASIC"), ["body", "measurements"])
        plan = build_incremental_plan("initial", requested_profile="BODY_BASIC")
        self.assertEqual(plan["modules"], ["body", "measurements"])
        self.assertFalse(any(camera.startswith(("face_", "hand_")) for camera in plan["cameras"]))

    def test_body_face_does_not_execute_hands(self):
        self.assertEqual(modules_for_profile("BODY_FACE"), ["body", "face", "measurements"])

    def test_full_humanoid_does_not_execute_face(self):
        self.assertEqual(
            modules_for_profile("FULL_HUMANOID"),
            ["body", "left_hand", "right_hand", "measurements"],
        )


class TargetedPlanTests(unittest.TestCase):
    def test_left_hand_is_actually_isolated(self):
        plan = build_incremental_plan("reanalyze_left_hand", requested_profile="FULL_HUMANOID")
        self.assertEqual(plan["modules"], ["left_hand"])
        self.assertTrue(plan["cameras"])
        self.assertTrue(all(name.startswith("hand_l_") for name in plan["cameras"]))
        self.assertTrue(all(not name.endswith("_r") for name in plan["landmarks"]))
        self.assertNotIn("right_hand", plan["replaceModules"])
        self.assertNotIn("face", plan["replaceModules"])

    def test_landmark_plan_replaces_one_record(self):
        plan = build_incremental_plan(
            "reanalyze_landmark",
            requested_profile="FULL_HUMANOID",
            landmark="index_02_l",
        )
        self.assertEqual(plan["modules"], ["left_hand"])
        self.assertEqual(plan["landmarks"], ["index_02_l"])
        self.assertEqual(plan["replaceLandmarks"], ["index_02_l"])
        self.assertLessEqual(len(plan["cameras"]), 2)

    def test_plan_hash_is_deterministic(self):
        first = build_incremental_plan("reanalyze_right_hand", requested_profile="FULL_HUMANOID")
        second = build_incremental_plan("reanalyze_right_hand", requested_profile="FULL_HUMANOID")
        self.assertEqual(first["planHash"], second["planHash"])


class CacheContractTests(unittest.TestCase):
    def test_cache_key_changes_for_relevant_versions_and_config(self):
        common = {
            "source_sha256": "a" * 64,
            "requested_profile": "BODY_BASIC",
            "configuration": {"render": {"resolution": 320}},
            "detector_version": "detector-1",
            "module": "body",
        }
        first = build_cache_key(**common, module_version="4.2.0")
        same = build_cache_key(**copy.deepcopy(common), module_version="4.2.0")
        changed_module = build_cache_key(**common, module_version="4.2.1")
        changed_detector = build_cache_key(**{**common, "detector_version": "detector-2"}, module_version="4.2.0")
        changed_config = build_cache_key(**{**common, "configuration": {"render": {"resolution": 384}}}, module_version="4.2.0")
        self.assertEqual(first, same)
        self.assertNotEqual(first, changed_module)
        self.assertNotEqual(first, changed_detector)
        self.assertNotEqual(first, changed_config)


class WarningReplacementTests(unittest.TestCase):
    def test_replacing_left_hand_preserves_other_modules(self):
        previous = {
            "landmarks": {
                "index_01_l": {"position": [1, 0, 0], "accepted": False},
                "index_01_r": {"position": [-1, 0, 0], "accepted": True},
            },
            "warnings": [
                {"code": "OLD_LEFT", "module": "left_hand", "landmark": "index_01_l"},
                {"code": "KEEP_RIGHT", "module": "right_hand", "landmark": "index_01_r"},
                {"code": "KEEP_BODY", "module": "body", "landmark": "chest"},
            ],
            "modules": {
                "body": {"version": "1"},
                "left_hand": {"version": "1"},
                "right_hand": {"version": "1"},
            },
        }
        plan = build_incremental_plan("reanalyze_left_hand", requested_profile="FULL_HUMANOID")
        result = merge_incremental_analysis(previous, {
            "left_hand": {
                "landmarks": {"index_01_l": {"position": [2, 0, 0], "accepted": True}},
                "warnings": [{"code": "NEW_LEFT", "landmark": "index_01_l"}],
                "manifest": {"version": "2"},
            },
        }, plan)
        self.assertEqual(result["landmarks"]["index_01_l"]["position"], [2, 0, 0])
        self.assertEqual(result["landmarks"]["index_01_r"]["position"], [-1, 0, 0])
        codes = {item["code"] for item in result["warnings"]}
        self.assertNotIn("OLD_LEFT", codes)
        self.assertIn("NEW_LEFT", codes)
        self.assertIn("KEEP_RIGHT", codes)
        self.assertIn("KEEP_BODY", codes)

    def test_identical_warning_fingerprints_are_grouped(self):
        warning = {
            "code": "RAY_MISS",
            "module": "left_hand",
            "landmark": "index_tip_l",
            "camera": "hand_l_palmar",
            "position2D": [0.5, 0.4],
            "expectedRegion": ["hand_l", "index_l"],
            "actualRegion": None,
            "triangleId": None,
            "sourceVersion": "v4.2",
        }
        grouped = dedupe_warnings([warning, copy.deepcopy(warning)])
        self.assertEqual(len(grouped), 1)
        self.assertEqual(grouped[0]["occurrences"], 2)
        self.assertEqual(grouped[0]["fingerprint"], warning_fingerprint(warning))

    def test_previous_identical_root_cause_is_marked_repeated(self):
        warning = {"code": "RAY_MISS", "module": "face", "landmark": "nose_tip", "camera": "face_front"}
        fingerprint = warning_fingerprint(warning)
        grouped = dedupe_warnings([warning], {fingerprint})
        self.assertTrue(grouped[0]["same_root_cause_repeated"])


if __name__ == "__main__":
    unittest.main()
