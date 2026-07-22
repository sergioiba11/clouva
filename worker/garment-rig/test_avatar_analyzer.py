"""Blender smoke test for CLOUVA Avatar Analyzer V3."""
from __future__ import annotations

import sys
import tempfile
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import bpy
from mathutils import Vector

from anatomy_bvh import build_anatomy_bvh
from anatomy_segmenter import segment_anatomy
from anatomy_segmenter_v3 import segment_anatomy_v3
from avatar_analyzer import _apply_refined_body_vectors, _sanitize_body_landmarks
from body_analyzer import analyze_body
from diagnostic_builder import build_diagnostic_glb
from hand_medial_graph import detect_medial_branches
from limb_centerline import refine_limb_joints
from mesh_geodesics import RegionGraph
from ray_triangulator import triangulate_landmark
from technical_passes import generate_technical_passes


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


class FakeSegmentation:
    def nearest(self, point, regions):
        region = regions[0] if not isinstance(regions, str) else regions
        return type("Sample", (), {"region": region, "point": point.copy()})(), 0.0


class FakeBvh:
    def nearest(self, point, regions):
        region = regions[0] if not isinstance(regions, str) else regions
        return {"location": point.copy(), "distance": 0.0, "region": region}


def ray_candidate(view, origin, target, surface_offset):
    direction = target - origin
    direction.normalize()
    surface = target + surface_offset
    return {
        "name": "index_02_l", "view": view,
        "detectorConfidence": 0.92, "viewQualityConfidence": 0.90,
        "visualConfidence": 0.92, "geometryConfidence": 0.95,
        "depthConfidence": 0.96, "normalCompatibility": 0.95,
        "regionCompatibility": 1.0, "silhouetteConfidence": 1.0,
        "hitRegion": "hand_l", "rayOrigin": list(origin),
        "rayDirection": list(direction), "position3d": list(surface),
        "surfaceNormal": [0.0, -1.0, 0.0], "hitObject": "Body",
        "faceIndex": 1, "triangleIndex": 1, "depthResidual": 0.0,
    }


def test_triangulation():
    target = Vector((0.25, -0.05, 1.10))
    candidates = [
        ray_candidate("hand_l_palm", Vector((0.25, -2.0, 1.10)), target, Vector((0.0, -0.025, 0.0))),
        ray_candidate("hand_l_lateral", Vector((2.0, -0.05, 1.10)), target, Vector((0.020, 0.0, 0.0))),
        ray_candidate("hand_l_top", Vector((0.25, -0.05, 2.5)), target, Vector((0.0, 0.0, 0.018))),
    ]
    result = triangulate_landmark(
        "index_02_l", candidates, FakeSegmentation(), "hand_l",
        region_scale=0.24, minimum_views=2, preferred_view_tokens=("palm",),
        anatomy_bvh=FakeBvh(),
    )
    assert result["accepted"] is True, result
    point = Vector(tuple(result["internalJointPosition"]))
    assert (point - target).length < 1e-4, (point, target)
    assert result["viewsConfirmed"] == 3
    assert result["depthConfidence"] > 0.9
    assert result["regionConfidence"] > 0.9


def test_five_geometric_branches():
    points = {}
    adjacency = {}
    def add(index, point):
        key = ("Hand", index)
        points[key] = Vector(point)
        adjacency[key] = []
        return key
    def connect(first, second):
        weight = (points[first] - points[second]).length
        adjacency[first].append((second, weight)); adjacency[second].append((first, weight))
    wrist = add(0, (0.0, 0.0, 0.0))
    palm = add(1, (0.0, 0.0, 0.20)); connect(wrist, palm)
    index = 2
    for lateral, length in ((-0.24, 0.62), (-0.11, 0.78), (0.02, 0.84), (0.14, 0.76), (0.27, 0.60)):
        previous = palm
        for step in range(1, 6):
            node = add(index, (lateral * step / 5.0, 0.0, 0.20 + length * step / 5.0))
            connect(previous, node)
            previous = node
            index += 1
    graph = RegionGraph(points, adjacency, ("hand_l",))
    branches, diagnostics = detect_medial_branches(graph, points[wrist], hand_scale=1.0)
    assert len(branches) == 5, diagnostics
    assert diagnostics["status"] == "valid", diagnostics
    assert all(branch.geodesic_length > 0.45 for branch in branches)


def main():
    meshes = build_avatar()
    report, vectors, classes = analyze_body(meshes)
    initial = segment_anatomy(meshes, classes, vectors, report["dimensions"])
    refined, limb_diagnostics = refine_limb_joints(meshes, initial, vectors)
    segmentation = segment_anatomy_v3(
        meshes, classes, refined, report["dimensions"], limb_diagnostics,
    )
    report, vectors = _apply_refined_body_vectors(report, vectors, refined, limb_diagnostics)
    anatomy_bvh = build_anatomy_bvh(meshes, segmentation, classes)
    bvh_report = anatomy_bvh.report()

    for region in (
        "upper_arm_l", "forearm_l", "hand_l", "upper_arm_r", "forearm_r", "hand_r",
        "thigh_l", "calf_l", "foot_l", "thigh_r", "calf_r", "foot_r", "head", "torso",
    ):
        assert anatomy_bvh.has_region(region), (region, bvh_report)
        assert bvh_report["regions"][region]["triangleCount"] > 0

    report = _sanitize_body_landmarks(report, vectors, segmentation, anatomy_bvh)
    assert report["landmarks"]["root"]["display"] is False
    assert report["landmarks"]["clavicle_l"]["display"] is False
    assert "body_core" in report["subsystems"]
    assert "left_arm" in report["subsystems"]
    assert report["limbCenterlineEvidence"]["usesFixedPercentagesAsFinalAnswer"] is False

    bpy.ops.object.camera_add(location=(0.0, -5.0, 1.2))
    camera = bpy.context.object
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 2.8
    camera.rotation_euler = ((Vector((0.0, 0.0, 1.2)) - camera.location).to_track_quat("-Z", "Y").to_euler())
    with tempfile.TemporaryDirectory(prefix="clouva-avatar-analyzer-v3-test-") as temp:
        temp_path = Path(temp)
        technical = generate_technical_passes(
            temp_path, "body_front_test", camera, anatomy_bvh,
            ("torso", "upper_arm_l", "upper_arm_r"), resolution=64,
        )
        assert technical["validPixelCount"] > 0, technical
        for key in ("depthNpy", "normalNpy", "regionIdNpy", "objectIdNpy", "curvatureNpy"):
            assert Path(technical["paths"][key]).is_file(), key

        output = temp_path / "diagnostic_landmarks.glb"
        proof = build_diagnostic_glb(output, meshes, report["landmarks"], report["dimensions"]["height"])
        assert output.is_file() and output.stat().st_size > 1024
        assert proof["surfaceOnly"] is True
        assert proof["internalSkeletonStoredInJson"] is True

    test_triangulation()
    test_five_geometric_branches()
    print("[clouva] Avatar Analyzer V3 region BVH + technical passes + geodesics + branches OK")


if __name__ == "__main__":
    main()
