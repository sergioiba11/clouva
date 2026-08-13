from pathlib import Path
from types import SimpleNamespace

import numpy as np

from analyzer import _derive_internal_joints, _repair_fused_left_right
from face_validation import validate_face_landmarks
from result_contract import SurfaceLandmark


def surface(name, position, group="face"):
    return SurfaceLandmark(
        name=name,
        group=group,
        state="verified_single_view",
        confidence=1.0,
        geometry_id=0,
        mesh_id="mesh",
        primitive_id=0,
        triangle_id=1,
        source_vertex_indices=[0, 1, 2],
        barycentric=[0.2, 0.3, 0.5],
        canonical_position=list(position),
        source_position=list(position),
        surface_normal=[0.0, -1.0, 0.0],
        detector_index=int(name.split("_")[1]) if name.startswith("face_") else None,
    )


def test_real_stylized_face_edge_cases_become_valid_without_forcing_ready():
    envelope = SimpleNamespace(
        center_x=-0.0000278,
        center_y=0.00204,
        center_z=1.60086,
        radius_x=0.19698,
        radius_z=0.23489,
        min_x=-0.19486,
        max_x=0.19480,
        min_z=1.38732,
        max_z=1.81440,
        front_surface_y=-0.17457,
        back_surface_y=0.17866,
        front_cutoff_y=0.04443,
        height=1.8,
    )
    semantics = [
        surface("left_eye_outer", [-0.0876, -0.1241, 1.5501]),
        surface("right_eye_outer", [0.0942, -0.1204, 1.5372]),
        surface("nose_tip", [-0.0017, -0.1729, 1.4727]),
        surface("mouth_left", [-0.0396, -0.1491, 1.4431]),
        surface("mouth_right", [0.0456, -0.1431, 1.4377]),
        surface("chin", [0.0036, -0.0293, 1.3816]),
        surface("forehead", [0.0030, -0.1722, 1.6390]),
    ]
    chin_details = [
        surface("face_148", [-0.0183, -0.0258, 1.3861]),
        surface("face_175", [0.0030, -0.0302, 1.3846]),
        surface("face_377", [0.0261, -0.0191, 1.3838]),
    ]
    details = [surface(f"face_{i:03d}", [0.0, -0.12, 1.52]) for i in range(468)]
    accepted, rejected, metrics = validate_face_landmarks(
        [*semantics, *chin_details, *details], envelope, 478
    )
    assert not rejected
    assert metrics["required_semantic_verified"] == 6
    assert metrics["critical_semantic_rejected"] == []
    assert metrics["face_landmarks_ready"] is True


def test_centerline_joints_use_geometry_center_when_provided():
    canonical = SimpleNamespace(canonical_to_source=np.eye(4))
    landmarks = [
        {"name": "left_shoulder", "group": "body", "canonical_position": [-0.2, -0.03, 1.3], "confidence": 1.0},
        {"name": "right_shoulder", "group": "body", "canonical_position": [0.23, 0.08, 1.3], "confidence": 1.0},
        {"name": "left_hip", "group": "body", "canonical_position": [-0.1, -0.02, 0.8], "confidence": 1.0},
        {"name": "right_hip", "group": "body", "canonical_position": [0.12, 0.07, 0.8], "confidence": 1.0},
    ]
    envelope = SimpleNamespace(center_x=0.0, center_y=0.0, center_z=1.6)
    joints = _derive_internal_joints(
        landmarks, canonical, face_envelope=envelope, body_center=(0.0, 0.0)
    )
    by_name = {item["name"]: item for item in joints}
    assert by_name["head"]["canonical_position"] == [0.0, 0.0, 1.6]
    assert by_name["neck"]["canonical_position"][:2] == [0.0, 0.0]
    assert by_name["chest"]["canonical_position"][:2] == [0.0, 0.0]
    assert by_name["pelvis"]["canonical_position"][:2] == [0.0, 0.0]


def test_fused_left_right_pair_is_ordered_by_canonical_x():
    left = surface("left_shoulder", [0.2, 0.0, 1.3], group="body")
    right = surface("right_shoulder", [-0.2, 0.0, 1.3], group="body")
    repaired = _repair_fused_left_right([left, right], 0.0)
    by_name = {item.name: item for item in repaired}
    assert by_name["left_shoulder"].canonical_position[0] < 0
    assert by_name["right_shoulder"].canonical_position[0] > 0


def test_frontend_hides_pose_face_and_uses_distinct_earring_rings():
    frontend = Path(__file__).resolve().parents[2] / "frontend" / "src" / "main.jsx"
    text = frontend.read_text(encoding="utf-8")
    assert "BODY_HEAD_NAMES" in text
    assert "body_head: false" in text
    assert "torusGeometry" not in text
    assert "Pines exactos de lóbulos" in text
