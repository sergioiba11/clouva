"""Blender smoke test for structural Avatar Analyzer V2."""
from __future__ import annotations

import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import bpy
from mathutils import Vector

from anatomy_segmenter import segment_anatomy
from avatar_analyzer import _sanitize_body_landmarks
from body_analyzer import analyze_body
from diagnostic_builder import build_diagnostic_glb
from ray_triangulator import triangulate_landmark


def cube(name, location, scale):
    bpy.ops.mesh.primitive_cube_add(location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.subdivide(number_cuts=3)
    bpy.ops.object.mode_set(mode="OBJECT")
    return obj


def sphere(name, location, radius):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, radius=radius, location=location)
    obj = bpy.context.object
    obj.name = name
    return obj


def build_avatar():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    pieces = [
        cube("BodyTorso", (0.0, 0.0, 1.20), (0.32, 0.16, 0.45)),
        sphere("BodyHead", (0.0, -0.01, 1.92), 0.23),
        cube("BodyNeck", (0.0, 0.0, 1.62), (0.10, 0.10, 0.12)),
        cube("UpperArmL", (0.43, 0.0, 1.37), (0.18, 0.09, 0.09)),
        cube("ForearmL", (0.70, 0.0, 1.28), (0.16, 0.075, 0.075)),
        sphere("HandL", (0.91, 0.0, 1.20), 0.105),
        cube("UpperArmR", (-0.43, 0.0, 1.37), (0.18, 0.09, 0.09)),
        cube("ForearmR", (-0.70, 0.0, 1.28), (0.16, 0.075, 0.075)),
        sphere("HandR", (-0.91, 0.0, 1.20), 0.105),
        cube("ThighL", (0.16, 0.0, 0.78), (0.13, 0.14, 0.30)),
        cube("CalfL", (0.16, 0.0, 0.29), (0.105, 0.11, 0.25)),
        cube("FootL", (0.16, -0.13, 0.06), (0.14, 0.25, 0.08)),
        cube("ThighR", (-0.16, 0.0, 0.78), (0.13, 0.14, 0.30)),
        cube("CalfR", (-0.16, 0.0, 0.29), (0.105, 0.11, 0.25)),
        cube("FootR", (-0.16, -0.13, 0.06), (0.14, 0.25, 0.08)),
    ]
    bpy.ops.object.select_all(action="DESELECT")
    for obj in pieces:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = pieces[0]
    bpy.ops.object.join()
    pieces[0].name = "Body"
    return [pieces[0]]


class FakeRegionSegmentation:
    def nearest(self, point, regions):
        region = regions[0] if not isinstance(regions, str) else regions
        return SimpleNamespace(region=region, point=point.copy()), 0.0


def ray_candidate(view, origin, target, surface_offset):
    direction = target - origin
    direction.normalize()
    surface = target + surface_offset
    return {
        "name": "index_02_l",
        "view": view,
        "visualConfidence": 0.92,
        "geometryConfidence": 0.95,
        "rayOrigin": list(origin),
        "rayDirection": list(direction),
        "position3d": list(surface),
        "surfaceNormal": [0.0, -1.0, 0.0],
        "hitObject": "Body",
        "faceIndex": 1,
    }


def test_triangulation():
    target = Vector((0.25, -0.05, 1.10))
    candidates = [
        ray_candidate("hand_l_palm", Vector((0.25, -2.0, 1.10)), target, Vector((0.0, -0.025, 0.0))),
        ray_candidate("hand_l_lateral", Vector((2.0, -0.05, 1.10)), target, Vector((0.020, 0.0, 0.0))),
        ray_candidate("hand_l_top", Vector((0.25, -0.05, 2.5)), target, Vector((0.0, 0.0, 0.018))),
    ]
    result = triangulate_landmark(
        "index_02_l", candidates, FakeRegionSegmentation(), "hand_l",
        region_scale=0.24, minimum_views=2, preferred_view_tokens=("palm",),
    )
    assert result["accepted"] is True, result
    point = Vector(tuple(result["internalJointPosition"]))
    assert (point - target).length < 1e-4, (point, target)
    assert result["viewsConfirmed"] == 3
    assert result["surfaceDisplayPosition"] != result["internalJointPosition"]


def main():
    meshes = build_avatar()
    report, vectors, classes = analyze_body(meshes)
    segmentation = segment_anatomy(meshes, classes, vectors, report["dimensions"])
    segmentation_report = segmentation.as_report()

    for region in (
        "upper_arm_l", "forearm_l", "hand_l", "upper_arm_r", "forearm_r", "hand_r",
        "thigh_l", "calf_l", "foot_l", "thigh_r", "calf_r", "foot_r", "head", "torso",
    ):
        count = segmentation_report["regions"].get(region, {}).get("vertexCount", 0)
        assert count > 0, (region, segmentation_report["regions"])

    shoulder_sample, _distance = segmentation.nearest(vectors["shoulder_l"], ("upper_arm_l",))
    assert shoulder_sample is not None and shoulder_sample.region == "upper_arm_l"
    torso_sample, _torso_distance = segmentation.nearest(vectors["shoulder_l"], ("torso",))
    assert torso_sample is not None and shoulder_sample.region != torso_sample.region

    left_hand = segmentation.hand_measurement("left")
    right_hand = segmentation.hand_measurement("right")
    assert left_hand["valid"] and right_hand["valid"], (left_hand, right_hand)
    assert 0.0 < left_hand["handScale"] < report["dimensions"]["height"] * 0.25
    assert abs(left_hand["handScale"] - report["dimensions"]["height"] * 0.105) > 1e-4

    report = _sanitize_body_landmarks(meshes, report, vectors, classes, segmentation)
    assert report["landmarks"]["root"]["display"] is False
    assert report["landmarks"]["clavicle_l"]["display"] is False
    assert report["landmarks"]["clavicle_r"]["display"] is False
    for name in ("shoulder_l", "elbow_l", "wrist_l", "shoulder_r", "elbow_r", "wrist_r"):
        item = report["landmarks"][name]
        if item["display"]:
            assert item["surfaceRegion"] != "torso", (name, item)
            assert "internalJointPosition" in item
            assert "surfaceDisplayPosition" in item
            assert item["surfaceDistance"] is not None and item["surfaceDistance"] >= 0.0

    visible = sum(1 for item in report["landmarks"].values() if item.get("display", False))
    assert visible > 0
    with tempfile.TemporaryDirectory(prefix="clouva-avatar-analyzer-v2-test-") as temp:
        output = Path(temp) / "diagnostic_landmarks.glb"
        proof = build_diagnostic_glb(output, meshes, report["landmarks"], report["dimensions"]["height"])
        assert output.is_file() and output.stat().st_size > 1024
        assert proof["surfaceOnly"] is True
        assert proof["edgeObjects"] == 0
        assert proof["internalSkeletonStoredInJson"] is True
        assert proof["duplicateLandmarksHidden"] == 0

    test_triangulation()
    print("[clouva] Avatar Analyzer V2 segmentation + hand scale + ray triangulation OK")


if __name__ == "__main__":
    main()
