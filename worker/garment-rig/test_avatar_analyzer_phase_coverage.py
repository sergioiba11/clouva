from __future__ import annotations

import unittest

from analyzer_contract import build_detection_coverage, merge_phase_detection_coverage


def view(name: str, region: str, side: str | None = None,
         rendered: bool = True, framing_valid: bool = True):
    return {
        "name": name,
        "region": region,
        "side": side,
        "path": f"/tmp/{name}.png" if rendered else "",
        "rendered": rendered,
        "framingValid": framing_valid,
        "silhouetteCoverage": 0.22 if framing_valid else 0.06,
    }


class PhaseCoverageMergeTests(unittest.TestCase):
    def test_face_then_hands_preserves_every_phase(self):
        face_manifest = {
            "views": [view(f"face_{index}", "face") for index in range(7)],
        }
        face_detector = {
            "views": [
                {
                    "name": f"face_{index}",
                    "candidates": [{"name": "nose_tip"}] if index < 2 else [],
                }
                for index in range(7)
            ],
        }
        face_report = {
            "projectedCandidates": [
                {"name": "nose_tip", "view": "face_0"},
                {"name": "nose_tip", "view": "face_1"},
            ],
            "landmarks": {
                "nose_tip": {
                    "name": "nose_tip",
                    "accepted": False,
                    "viewsConfirmed": 2,
                    "rejectionReasons": ["RAY_RESIDUAL_TOO_HIGH"],
                },
            },
        }
        face_coverage = build_detection_coverage(
            face_manifest, face_detector, face_report, {},
        )
        merged = merge_phase_detection_coverage(
            {}, "face", face_coverage, {"phase": "face"},
        )

        hand_views = [
            *[view(f"hand_l_{index}", "hand", "left", framing_valid=False) for index in range(7)],
            *[view(f"hand_r_{index}", "hand", "right", framing_valid=False) for index in range(7)],
        ]
        hands_manifest = {"views": hand_views}
        hands_detector = {
            "views": [{"name": item["name"], "candidates": []} for item in hand_views],
        }
        hands_report = {
            "left": {"landmarks": {}, "projectedCandidates": []},
            "right": {"landmarks": {}, "projectedCandidates": []},
        }
        hands_coverage = build_detection_coverage(
            hands_manifest, hands_detector, {}, hands_report,
        )
        merged = merge_phase_detection_coverage(
            merged, "hands", hands_coverage, {"phase": "hands"},
        )

        self.assertEqual(merged["face"]["renderedViews"], 7)
        self.assertEqual(merged["face"]["detectorExecutedViews"], 7)
        self.assertEqual(merged["leftHand"]["renderedViews"], 7)
        self.assertEqual(merged["rightHand"]["renderedViews"], 7)
        self.assertEqual(merged["leftHand"]["framingValidViews"], 0)
        self.assertEqual(merged["rightHand"]["framingInvalidViews"], 7)
        self.assertEqual(merged["leftHand"]["evidenceStatus"], "framing_invalid")
        self.assertEqual([item["phase"] for item in merged["attempts"]], ["face", "hands"])

    def test_renderer_missing_and_detector_no_candidates_are_distinct(self):
        not_run = build_detection_coverage({"views": []}, {"views": []}, {}, {})
        self.assertEqual(not_run["face"]["evidenceStatus"], "renderer_not_run")

        missing = build_detection_coverage(
            {"views": [view("face_front", "face", rendered=False)]},
            {"views": []},
            {},
            {},
        )
        self.assertEqual(missing["face"]["evidenceStatus"], "render_missing")

        no_candidates = build_detection_coverage(
            {"views": [view("face_front", "face")]},
            {"views": [{"name": "face_front", "candidates": []}]},
            {},
            {},
        )
        self.assertEqual(no_candidates["face"]["detectorStatus"], "no_candidates")
        self.assertEqual(no_candidates["face"]["evidenceStatus"], "detector_no_candidates")


if __name__ == "__main__":
    unittest.main()
