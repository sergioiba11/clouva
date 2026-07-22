"""Blender smoke test for Avatar Analyzer phase 1 geometry and diagnostic GLB."""
from __future__ import annotations

import sys
import tempfile
from pathlib import Path

import bpy

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from body_analyzer import analyze_body
from diagnostic_builder import build_diagnostic_glb


def cube(name, location, scale):
    bpy.ops.mesh.primitive_cube_add(location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
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
        cube("ArmL", (0.52, 0.0, 1.25), (0.30, 0.09, 0.09)),
        cube("ArmR", (-0.52, 0.0, 1.25), (0.30, 0.09, 0.09)),
        sphere("HandL", (0.86, 0.0, 1.20), 0.11),
        sphere("HandR", (-0.86, 0.0, 1.20), 0.11),
        cube("LegL", (0.16, 0.0, 0.52), (0.13, 0.14, 0.52)),
        cube("LegR", (-0.16, 0.0, 0.52), (0.13, 0.14, 0.52)),
        cube("FootL", (0.16, -0.13, 0.06), (0.14, 0.25, 0.08)),
        cube("FootR", (-0.16, -0.13, 0.06), (0.14, 0.25, 0.08)),
    ]
    bpy.ops.object.select_all(action="DESELECT")
    for obj in pieces:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = pieces[0]
    bpy.ops.object.join()
    pieces[0].name = "Body"
    return [pieces[0]]


def main():
    meshes = build_avatar()
    report, _vectors, _classes = analyze_body(meshes)
    required = [
        "pelvis", "neck", "head", "shoulder_l", "shoulder_r", "elbow_l",
        "elbow_r", "wrist_l", "wrist_r", "knee_l", "knee_r", "ankle_l", "ankle_r",
    ]
    missing = [name for name in required if name not in report["landmarks"]]
    assert not missing, missing
    assert report["dimensions"]["height"] > 1.5
    assert 0.0 <= report["symmetry"]["score"] <= 1.0
    with tempfile.TemporaryDirectory(prefix="clouva-avatar-analyzer-test-") as temp:
        output = Path(temp) / "diagnostic_landmarks.glb"
        proof = build_diagnostic_glb(output, meshes, report["landmarks"], report["dimensions"]["height"])
        assert output.is_file() and output.stat().st_size > 1024
        assert proof["landmarkObjects"] >= len(required)
    print("[clouva] Avatar Analyzer phase 1 body + diagnostic GLB OK")


if __name__ == "__main__":
    main()
