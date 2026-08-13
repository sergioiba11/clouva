from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from garment_analyzer import _depth_envelope, _target_region, _warp_top_sleeves


def _avatar_run() -> dict:
    return {
        "source": {"bounds_min": [-0.55, 0.0, -0.19], "bounds_max": [0.56, 1.8, 0.19]},
        "canonical_space": {
            "source_to_canonical_matrix": [[1, 0, 0, 0], [0, 0, -1, 0], [0, 1, 0, 0], [0, 0, 0, 1]],
            "canonical_to_source_matrix": [[1, 0, 0, 0], [0, 0, 1, 0], [0, -1, 0, 0], [0, 0, 0, 1]],
        },
        "body_measurements": {
            "scale": {"geometry_to_meters": 1.0},
            "values": {"shoulder_width": {"value_cm": 22.0}},
            "sections": {
                "chest": {"width_cm": 28.8, "depth_cm": 21.9},
                "waist": {"width_cm": 26.2, "depth_cm": 21.4},
                "hip": {"width_cm": 32.7, "depth_cm": 19.5},
            },
        },
        "garment_anchors": [
            {"name": "neck_base_front", "source_position": [0.0, 1.37, 0.03]},
            {"name": "neck_base_back", "source_position": [0.0, 1.37, -0.114]},
            {"name": "chest_center", "source_position": [0.0, 1.14, 0.100]},
            {"name": "back_center", "source_position": [0.0, 1.14, -0.118]},
            {"name": "waist_front", "source_position": [0.0, 1.04, 0.111]},
            {"name": "waist_back", "source_position": [0.0, 1.04, -0.103]},
            {"name": "left_hip", "source_position": [-0.12, 0.84, 0.0]},
            {"name": "right_hip", "source_position": [0.12, 0.84, 0.0]},
        ],
        "landmarks": [],
        "internal_joints": [],
    }


def test_depth_envelope_uses_surface_extrema() -> None:
    points = {
        "front": np.array([0.0, -0.111, 1.0]),
        "back": np.array([0.0, 0.118, 1.0]),
    }
    assert _depth_envelope(points, ("front", "back")) == (-0.111, 0.118)


def test_top_fit_includes_pose_allowance_and_requested_ease() -> None:
    target = _target_region(
        _avatar_run(),
        {"classification": {"category": "top"}},
        "oversized",
    )
    # Observed anchor depth is 22.9 cm. The resulting shell must exceed the
    # old 24.7 cm fit, which penetrated this avatar around the waist and back.
    assert target["dimensions"][1] >= 0.28
    assert abs(target["center"][1] - 0.0035) < 0.002


def test_sleeves_follow_the_validated_upper_arm_direction() -> None:
    semantic = np.array([
        [-0.40, 0.0, 0.50],
        [0.40, 0.0, 0.50],
        [0.00, 0.0, 0.30],
    ])
    canonical = semantic.copy()
    arms = {
        "left": {
            "shoulder": np.array([-0.20, 0.0, 0.50]),
            "elbow": np.array([-0.35, 0.0, 0.30]),
            "direction": np.array([-0.6, 0.0, -0.8]),
            "sleeve_radius": np.asarray(0.06),
        },
        "right": {
            "shoulder": np.array([0.20, 0.0, 0.50]),
            "elbow": np.array([0.35, 0.0, 0.30]),
            "direction": np.array([0.6, 0.0, -0.8]),
            "sleeve_radius": np.asarray(0.06),
        },
    }
    warped, report = _warp_top_sleeves(
        canonical,
        semantic,
        np.array([-0.40, -0.10, 0.00]),
        np.array([0.40, 0.10, 0.60]),
        arms,
    )
    assert warped[0, 2] < canonical[0, 2]
    assert warped[1, 2] < canonical[1, 2]
    assert np.allclose(warped[2], canonical[2])
    assert report["sides"]["left"]["affected_vertices"] == 1
    assert report["sides"]["right"]["affected_vertices"] == 1


def test_diagonal_source_sleeves_are_not_bent_twice() -> None:
    points: list[list[float]] = [[0.0, 0.0, 0.30]]
    for sign in (-1.0, 1.0):
        points.extend([
            [sign * 0.22, -0.03, 0.69],
            [sign * 0.22, 0.03, 0.69],
            [sign * 0.24, -0.03, 0.71],
            [sign * 0.24, 0.03, 0.71],
            [sign * 0.44, -0.03, 0.49],
            [sign * 0.44, 0.03, 0.49],
            [sign * 0.46, -0.03, 0.51],
            [sign * 0.46, 0.03, 0.51],
        ])
    semantic = np.asarray(points, dtype=np.float64)
    canonical = semantic.copy()
    diagonal = 1.0 / np.sqrt(2.0)
    arms = {
        "left": {
            "shoulder": np.array([-0.23, 0.0, 0.70]),
            "elbow": np.array([-0.43, 0.0, 0.50]),
            "direction": np.array([-diagonal, 0.0, -diagonal]),
            "sleeve_radius": np.asarray(0.04),
        },
        "right": {
            "shoulder": np.array([0.23, 0.0, 0.70]),
            "elbow": np.array([0.43, 0.0, 0.50]),
            "direction": np.array([diagonal, 0.0, -diagonal]),
            "sleeve_radius": np.asarray(0.04),
        },
    }

    warped, report = _warp_top_sleeves(
        canonical,
        semantic,
        np.array([-0.50, -0.10, 0.00]),
        np.array([0.50, 0.10, 1.00]),
        arms,
    )

    # The cuffs already point toward the elbows.  They should stay near their
    # authored height instead of receiving a second downward rotation.
    cuff_indices = [5, 6, 7, 8, 13, 14, 15, 16]
    assert float(np.min(warped[cuff_indices, 2])) > 0.43
    assert report["sides"]["left"]["source_direction_canonical"][2] < -0.5
    assert report["sides"]["right"]["source_direction_canonical"][2] < -0.5
