from types import SimpleNamespace

import numpy as np

from face_validation import build_face_envelope, validate_face_landmarks
from result_contract import SurfaceLandmark


def landmark(name, position):
    return SurfaceLandmark(
        name=name,
        group="face",
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
    )


def scene():
    rng = np.random.default_rng(3)
    head = np.column_stack([
        rng.uniform(-0.14, 0.14, 1000),
        rng.uniform(-0.18, 0.18, 1000),
        rng.uniform(1.40, 1.80, 1000),
    ])
    body = np.array([[-0.5, -0.15, 0.0], [0.5, 0.15, 1.3]])
    return SimpleNamespace(
        bounds_min=np.array([-0.56, -0.19, 0.0]),
        bounds_max=np.array([0.56, 0.19, 1.8]),
        vertices=np.vstack([head, body]),
    )


def test_rejects_neck_and_back_of_head():
    envelope = build_face_envelope(scene(), [])
    items = [
        landmark("nose_tip", [0.0, -0.12, 1.57]),
        landmark("face_100", [0.02, 0.16, 1.58]),
        landmark("face_101", [0.02, -0.10, 1.32]),
    ]
    accepted, rejected, metrics = validate_face_landmarks(items, envelope, 478)
    assert [item.name for item in accepted] == ["nose_tip"]
    assert {item.rejection_reason for item in rejected} == {
        "FACE_PROJECTION_BEHIND_HEAD",
        "FACE_PROJECTION_ON_NECK",
    }
    assert metrics["rejected_face_landmarks"] == 2


def test_face_ready_requires_semantic_anchors_and_density():
    envelope = build_face_envelope(scene(), [])
    names = ["left_eye_outer", "right_eye_outer", "nose_tip", "mouth_left", "mouth_right", "chin"]
    positions = {
        "left_eye_outer": 1.64,
        "right_eye_outer": 1.64,
        "nose_tip": 1.58,
        "mouth_left": 1.50,
        "mouth_right": 1.50,
        "chin": 1.43,
    }
    items = [landmark(name, [0.0, -0.12, positions[name]]) for name in names]
    items.extend(landmark(f"face_{index:03d}", [0.0, -0.12, 1.55]) for index in range(200))
    accepted, rejected, metrics = validate_face_landmarks(items, envelope, 478)
    assert not rejected
    assert len(accepted) == 206
    assert metrics["face_landmarks_ready"] is True
