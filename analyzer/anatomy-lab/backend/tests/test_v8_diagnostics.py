from types import SimpleNamespace
import numpy as np

from analyzer import _derive_internal_joints, _estimate_hand_focus


def test_internal_joints_include_source_position():
    canonical = SimpleNamespace(canonical_to_source=np.array([
        [1, 0, 0, 0],
        [0, 0, 1, 0],
        [0, -1, 0, 0],
        [0, 0, 0, 1],
    ], dtype=float))
    landmarks = [
        {"name": "left_shoulder", "group": "body", "canonical_position": [-0.2, 0.1, 1.3], "confidence": 1.0},
        {"name": "right_shoulder", "group": "body", "canonical_position": [0.2, 0.1, 1.3], "confidence": 1.0},
    ]
    joints = _derive_internal_joints(landmarks, canonical)
    neck = next(item for item in joints if item["name"] == "neck")
    assert neck["canonical_position"] == [0.0, 0.1, 1.3]
    assert np.allclose(neck["source_position"], [0.0, 1.3, -0.1])


def test_hand_focus_uses_outer_geometry():
    vertices = np.array([
        [-0.55, -0.03, 0.78], [-0.50, 0.04, 0.90], [-0.46, 0.00, 0.84],
        [0.55, -0.03, 0.78], [0.50, 0.04, 0.90], [0.46, 0.00, 0.84],
    ] * 10, dtype=float)
    scene = SimpleNamespace(
        bounds_min=np.array([-0.56, -0.19, 0.0]),
        bounds_max=np.array([0.56, 0.19, 1.8]),
        vertices=vertices,
    )
    left_center, left_size = _estimate_hand_focus(scene, [], "left")
    right_center, right_size = _estimate_hand_focus(scene, [], "right")
    assert left_center[0] < -0.2
    assert right_center[0] > 0.2
    assert left_size >= 0.18 and right_size >= 0.18
