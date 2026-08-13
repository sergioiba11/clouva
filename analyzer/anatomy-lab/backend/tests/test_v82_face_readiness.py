from types import SimpleNamespace

import numpy as np

from face_validation import validate_face_landmarks
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


def test_stylized_avatar_semantic_points_are_not_rejected_by_over_tight_z_bands():
    envelope = SimpleNamespace(
        min_z=1.3794008519252143,
        max_z=1.8143999519348144,
        min_x=-0.20,
        max_x=0.20,
        center_x=0.0,
        center_z=1.5969,
        radius_x=0.197,
        radius_z=0.239,
        front_cutoff_y=0.044,
    )
    semantics = [
        landmark("left_eye_outer", [-0.088, -0.12, 1.560]),
        landmark("right_eye_outer", [0.088, -0.12, 1.544]),
        landmark("nose_tip", [0.004, -0.154, 1.483]),
        landmark("mouth_left", [-0.043, -0.148, 1.446]),
        landmark("mouth_right", [0.038, -0.144, 1.437]),
        landmark("chin", [0.0, -0.072, 1.382]),
    ]
    details = [landmark(f"face_{index:03d}", [0.0, -0.12, 1.52]) for index in range(200)]
    accepted, rejected, metrics = validate_face_landmarks([*semantics, *details], envelope, 478)
    assert not rejected
    assert len(accepted) == 206
    assert metrics["required_semantic_verified"] == 6
    assert metrics["face_landmarks_ready"] is True
