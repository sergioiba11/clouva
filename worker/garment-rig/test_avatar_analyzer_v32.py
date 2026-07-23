"""Focused Blender/CI tests for Avatar Analyzer V3.2 contracts."""
from __future__ import annotations

import math

import bpy
from mathutils import Euler, Matrix, Vector

from analyzer_contract import (
    CRITICAL_BODY,
    FACE_REQUIRED,
    HAND_REQUIRED,
    annotate_landmarks,
    build_detection_coverage,
    calculate_rig_readiness,
)
from canonical_orientation import canonicalize_temporary_copy
from landmark_projector_3d import _offsets
from multiview_renderer_v32 import HAND_VIEW_TOKENS


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def accepted(name, position=(0.0, 0.0, 0.0), confidence=0.92):
    return {
        "name": name,
        "position": list(position),
        "internalJointPosition": list(position),
        "accepted": True,
        "verified": True,
        "display": True,
        "rawConfidence": confidence,
        "finalConfidence": confidence,
        "confidence": confidence,
        "viewsConfirmed": 3,
        "rejectionReasons": [],
    }


def test_states_preserve_raw_confidence():
    landmarks = {
        "missing": {
            "name": "missing", "accepted": False, "viewsConfirmed": 0,
            "confidence": 0.73, "finalConfidence": 0.73,
            "rejectionReasons": [],
        },
        "single": {
            "name": "single", "accepted": False, "viewsConfirmed": 1,
            "confidence": 0.68, "finalConfidence": 0.68,
            "rejectionReasons": ["INSUFFICIENT_TECHNICALLY_VALID_VIEWS"],
        },
    }
    annotate_landmarks(landmarks)
    assert landmarks["missing"]["state"] == "no_visual_evidence"
    assert abs(landmarks["missing"]["rawConfidence"] - 0.73) < 1e-8
    assert landmarks["single"]["state"] == "insufficient_views"
    assert abs(landmarks["single"]["rawConfidence"] - 0.68) < 1e-8


def full_landmarks():
    names = set(CRITICAL_BODY)
    names.update(FACE_REQUIRED)
    names.update(HAND_REQUIRED["left"])
    names.update(HAND_REQUIRED["right"])
    return annotate_landmarks({name: accepted(name) for name in names})


def valid_coverage():
    return {
        key: {
            "renderedViews": 7,
            "detectorSuccessfulViews": 5,
            "projectedSuccessfulViews": 4,
            "triangulatedViews": 3,
            "visualCoverage": 5 / 7,
            "geometricCoverage": 4 / 5,
            "technicalMismatchCount": 0,
        }
        for key in ("face", "leftHand", "rightHand")
    }


def test_readiness_gates_right_hand():
    landmarks = full_landmarks()
    coverage = valid_coverage()
    body = {"status": "valid", "humanoidConfidence": 0.96}
    face = {"status": "valid"}
    hands = {"left": {"status": "valid"}, "right": {"status": "valid"}}
    orientation = {"orientationConfidence": 0.91, "requiresOrientationReview": False}

    approved = calculate_rig_readiness(body, face, hands, landmarks, coverage, orientation)
    assert approved["approved"] is True, approved
    assert approved["score"] >= 0.82, approved

    broken = dict(coverage)
    broken["rightHand"] = {**coverage["rightHand"], "detectorSuccessfulViews": 0, "visualCoverage": 0.0}
    blocked = calculate_rig_readiness(body, face, hands, landmarks, broken, orientation)
    assert blocked["approved"] is False
    assert "RIGHT_HAND_NO_VISUAL_EVIDENCE" in blocked["gates"]


def test_detection_coverage_is_symmetric():
    views = []
    detector_views = []
    for side, suffix in (("left", "l"), ("right", "r")):
        for token in HAND_VIEW_TOKENS:
            name = f"hand_{suffix}_{token}"
            views.append({
                "name": name, "region": "hand", "side": side,
                "path": f"/{name}.png", "rendered": True,
                "proxyVertexCount": 100, "silhouetteCoverage": 0.25,
                "framingValid": True,
            })
            detector_views.append({
                "name": name, "region": "hand", "side": side,
                "candidates": [{"name": f"wrist_{suffix}"}],
            })
    coverage = build_detection_coverage(
        {"views": views},
        {"views": detector_views, "errors": []},
        {"landmarks": {}, "projectedCandidates": [], "warnings": []},
        {
            "left": {"landmarks": {}, "projectedCandidates": [], "warnings": []},
            "right": {"landmarks": {}, "projectedCandidates": [], "warnings": []},
        },
    )
    assert len(HAND_VIEW_TOKENS) == 7
    assert coverage["leftHand"]["renderedViews"] == coverage["rightHand"]["renderedViews"] == 7
    assert coverage["leftHand"]["detectorSuccessfulViews"] == coverage["rightHand"]["detectorSuccessfulViews"] == 7


def create_humanoid_proxy(rotation=(0.0, 0.0, 0.0), mirrored=False):
    clear_scene()
    objects = []
    for name, location, scale in (
        ("Body", (0.0, 0.0, 1.0), (0.45, 0.28, 1.0)),
        ("Head", (0.0, -0.03, 2.25), (0.30, 0.25, 0.30)),
        ("LeftLeg", (0.22, 0.0, -0.25), (0.16, 0.20, 0.70)),
        ("RightLeg", (-0.22, 0.0, -0.25), (0.16, 0.20, 0.70)),
        ("LeftFoot", (0.22, -0.22, -0.92), (0.18, 0.35, 0.12)),
        ("RightFoot", (-0.22, -0.22, -0.92), (0.18, 0.35, 0.12)),
    ):
        bpy.ops.mesh.primitive_cube_add(location=location)
        obj = bpy.context.object
        obj.name = name
        obj.scale = scale
        objects.append(obj)
    transform = Euler(rotation, "XYZ").to_matrix().to_4x4()
    if mirrored:
        transform = Matrix.Diagonal((-1.0, 1.0, 1.0, 1.0)) @ transform
    for obj in objects:
        obj.matrix_world = transform @ obj.matrix_world
    bpy.context.view_layer.update()
    return objects


def assert_canonical(rotation, mirrored=False):
    objects = create_humanoid_proxy(rotation, mirrored)
    report = canonicalize_temporary_copy(objects)
    size = Vector(report["canonicalBounds"]["size"])
    assert size.z > size.x and size.z > size.y, report
    assert report["canonicalApplied"] is True
    assert report["canonicalUpAxis"] == "+Z"
    assert report["canonicalFrontAxis"] == "-Y"
    assert len(report["canonicalMatrix"]) == 4
    assert len(report["inverseCanonicalMatrix"]) == 4
    return report


def test_canonical_orientation_rotated_and_mirrored():
    assert_canonical((math.radians(90.0), 0.0, 0.0))
    assert_canonical((0.0, 0.0, math.radians(180.0)))
    mirrored = assert_canonical((0.0, 0.0, 0.0), mirrored=True)
    assert mirrored["mirrored"] is True


def test_adaptive_pixel_window():
    samples = _offsets(2)
    assert len(samples) == 25
    assert samples[0] == (0, 0)
    assert len(set(samples)) == 25


def main():
    test_states_preserve_raw_confidence()
    test_readiness_gates_right_hand()
    test_detection_coverage_is_symmetric()
    test_canonical_orientation_rotated_and_mirrored()
    test_adaptive_pixel_window()
    print("[clouva] Avatar Analyzer V3.2 contract + canonical orientation tests OK")


if __name__ == "__main__":
    main()
