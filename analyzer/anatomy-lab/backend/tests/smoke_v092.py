from __future__ import annotations

import json
import math
import sys
import tempfile
from pathlib import Path

import numpy as np
import trimesh

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from garment_mold import VERSION, generate_tshirt_mold


def section(z, width, depth):
    return {
        "status": "valid",
        "z": z,
        "width_cm": width,
        "depth_cm": depth,
        "centroid": [0.0, 0.0, z],
    }


def anchor(name, x, y, z):
    return {"name": name, "canonical_position": [x, y, z]}


payload = {
    "run_id": "smoke-v092",
    "readiness": {"garment_mold_input_ready": True},
    "canonical_space": {
        "canonical_to_source_matrix": [[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]],
        "source_to_canonical_matrix": [[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]],
    },
    "body_measurements": {
        "scale": {"geometry_to_meters": 1.0},
        "sections": {
            "neck": section(1.40, 12.5, 14.0),
            "chest": section(1.15, 29.0, 22.0),
            "waist": section(1.02, 27.0, 20.5),
            "hip": section(0.80, 33.0, 20.0),
            "left_bicep": {"circumference_cm": 29.0},
            "right_bicep": {"circumference_cm": 31.0},
        },
    },
    "garment_anchors": [
        anchor("shoulder_left", -0.15, 0.0, 1.31),
        anchor("shoulder_right", 0.15, 0.0, 1.31),
        anchor("elbow_left", -0.34, 0.035, 1.06),
        anchor("elbow_right", 0.30, -0.020, 1.10),
    ],
}

with tempfile.TemporaryDirectory() as temp:
    temp_path = Path(temp)
    # Lightweight synthetic body only to exercise triangle-surface clearance.
    body = trimesh.creation.uv_sphere(count=[24, 24])
    body.apply_scale([0.15, 0.11, 0.45])
    body.apply_translation([0.0, 0.0, 1.03])
    scene = trimesh.Scene(body)
    body_path = temp_path / "body.glb"
    body_path.write_bytes(scene.export(file_type="glb"))

    result = generate_tshirt_mold(payload, temp_path, source_glb=body_path, fit="oversized")
    assert result["version"] == VERSION
    mesh = result["mesh"]
    assert mesh["connected_shells"] == 1, mesh
    assert mesh["nonmanifold_edge_count"] == 0, mesh
    assert mesh["boundary_loop_count"] == 4, mesh
    assert mesh["symmetry_locked"] is True
    assert mesh["neck_geometry_locked"] is True
    left = result["sleeves"]["left"]
    right = result["sleeves"]["right"]
    assert abs(left["length_geometry"] - right["length_geometry"]) < 1e-12
    assert abs(left["start_radius_geometry"] - right["start_radius_geometry"]) < 1e-12
    assert left["symmetry_locked"] and right["symmetry_locked"]
    neck = result["torso"]["neck_opening_geometry"]
    assert neck["center_locked"] is True
    assert neck["protected_from_collision_warp"] is True
    assert result["clearance"]["available"] is True, result["clearance"]
    assert result["clearance"]["method"] == "nearest_body_triangle_surface_clearance_projection"
    assert result["readiness"]["symmetric_pattern_ready"] is True
    assert result["readiness"]["neck_locked_ready"] is True
    assert result["readiness"]["triangle_surface_clearance_ready"] is True
    assert Path(temp, result["assets"]["glb"]).is_file()
    assert Path(temp, result["assets"]["fit_json"]).is_file()
print("V092_SMOKE_OK")
