from __future__ import annotations

import sys
import tempfile
from pathlib import Path

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
    "run_id": "smoke-v094",
    "readiness": {"garment_mold_input_ready": True},
    "canonical_space": {
        "canonical_to_source_matrix": [[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]],
        "source_to_canonical_matrix": [[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]],
    },
    "body_measurements": {
        "scale": {"geometry_to_meters": 1.0},
        "sections": {
            "neck": section(1.40, 12.0, 13.5),
            "chest": section(1.15, 29.0, 22.0),
            "waist": section(1.02, 26.5, 20.0),
            "hip": section(0.80, 33.0, 20.0),
            "left_bicep": {"circumference_cm": 29.0},
            "right_bicep": {"circumference_cm": 29.5},
        },
    },
    "garment_anchors": [
        anchor("shoulder_left", -0.15, 0.0, 1.31),
        anchor("shoulder_right", 0.15, 0.0, 1.31),
        anchor("armpit_left", -0.13, 0.0, 1.17),
        anchor("armpit_right", 0.13, 0.0, 1.17),
        anchor("elbow_left", -0.34, 0.03, 1.06),
        anchor("elbow_right", 0.34, 0.03, 1.06),
    ],
}

with tempfile.TemporaryDirectory() as temp:
    temp_path = Path(temp)
    body = trimesh.creation.uv_sphere(count=[32, 32])
    body.apply_scale([0.15, 0.11, 0.45])
    body.apply_translation([0.0, 0.0, 1.03])
    body_path = temp_path / "body.glb"
    trimesh.Scene(body).export(body_path)

    result = generate_tshirt_mold(payload, temp_path, source_glb=body_path, fit="oversized")
    assert result["version"] == VERSION
    assert result["mesh"]["connected_shells"] == 1
    assert result["mesh"]["nonmanifold_edge_count"] == 0
    assert result["mesh"]["boundary_loop_count"] == 4
    assert result["mesh"]["symmetry_locked"] is True
    assert result["mesh"]["neck_geometry_locked"] is True
    assert result["torso"]["anatomical_shoulder_profile_ready"] is True
    assert result["torso"]["armhole_half_angle_degrees"] <= 21.0
    assert result["clearance"]["available"] is True, result["clearance"]
    assert result["clearance"]["method"] == "iterative_signed_triangle_clearance_with_smoothing"
    assert "face_subdivision" in result["clearance"]
    assert result["clearance"]["zero_penetration_ready"] is True, result["clearance"]
    assert result["clearance"]["negative_signed_samples"] == 0, result["clearance"]
    assert result["readiness"]["anatomical_shoulder_profile_ready"] is True
    assert result["readiness"]["face_collision_subdivision_ready"] is True
    assert result["readiness"]["triangle_surface_clearance_ready"] is True
    assert Path(temp, result["assets"]["glb"]).is_file()
    assert Path(temp, result["assets"]["fit_json"]).is_file()
print("V094_SMOKE_OK")
