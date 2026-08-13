from __future__ import annotations

import importlib.util
from pathlib import Path
import sys

import numpy as np


MODULE_PATH = Path(__file__).resolve().parents[1] / "garment_analyzer.py"
SPEC = importlib.util.spec_from_file_location("garment_analyzer_v134_test", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


def dense_opposed_panels() -> np.ndarray:
    points: list[list[float]] = []
    for x in np.linspace(-0.4, 0.4, 41):
        for z in np.linspace(-0.7, 0.0, 36):
            curve = 0.02 * (1.0 - (x / 0.4) ** 2)
            points.append([float(x), float(0.15 + curve), float(z)])
            points.append([float(x), float(-0.15 - curve), float(z)])
    return np.asarray(points, dtype=np.float64)


def test_structural_point_is_between_opposed_surfaces() -> None:
    local = dense_opposed_panels()
    size = local.max(axis=0) - local.min(axis=0)
    point, quality = MODULE._structural_midpoint(
        local,
        np.asarray([0.0, 0.15, -0.35], dtype=np.float64),
        size,
        source_meta={"confidence": 0.90, "vertex_index": 123},
    )

    assert quality["surface_locked"] is False
    assert quality["landmark_type"] == "structural_internal"
    assert quality["fallback_used"] is False
    assert quality["sample_count"] >= 16
    assert abs(point[1]) < 1e-9
    assert abs(point[1] - (quality["front_depth"] + quality["back_depth"]) * 0.5) < 1e-12


def test_fallback_stays_internal() -> None:
    local = np.asarray([
        [-0.5, -0.2, -0.5],
        [0.5, -0.2, -0.5],
        [-0.5, 0.2, 0.5],
        [0.5, 0.2, 0.5],
    ], dtype=np.float64)
    size = local.max(axis=0) - local.min(axis=0)
    point, quality = MODULE._structural_midpoint(
        local,
        np.asarray([0.0, 0.2, 0.0], dtype=np.float64),
        size,
    )

    assert quality["fallback_used"] is True
    assert quality["method"] == "semantic_bounds_midpoint_fallback"
    assert quality["surface_locked"] is False
    assert abs(point[1]) < 1e-12


def test_top_semantic_contract_accepts_z_height() -> None:
    MODULE._validate_semantic_axis_contract(
        "top",
        np.asarray([0.825, 0.301, 0.700], dtype=np.float64),
    )


def test_top_semantic_contract_rejects_display_x_turn() -> None:
    try:
        MODULE._validate_semantic_axis_contract(
            "top",
            np.asarray([0.825, 0.700, 0.301], dtype=np.float64),
        )
    except MODULE.GarmentAnalyzerError as exc:
        assert "ORIENTACION_EJES_INVALIDA" in str(exc)
    else:
        raise AssertionError("La orientación con alto/profundidad intercambiados debía rechazarse")


def test_manual_review_accepts_front_back_yaw_only() -> None:
    MODULE._validate_manual_review_rotation("top", 0, 0, 0)
    MODULE._validate_manual_review_rotation("top", 0, 0, 2)


def test_manual_review_rejects_x_tilt() -> None:
    try:
        MODULE._validate_manual_review_rotation("top", 1, 0, 0)
    except MODULE.GarmentAnalyzerError as exc:
        assert "ORIENTACION_MANUAL_INVALIDA" in str(exc)
    else:
        raise AssertionError("Una inclinación X no debe persistirse como orientación semántica")


def test_manual_review_rejects_y_inversion() -> None:
    try:
        MODULE._validate_manual_review_rotation("top", 0, 2, 0)
    except MODULE.GarmentAnalyzerError as exc:
        assert "ORIENTACION_MANUAL_INVALIDA" in str(exc)
    else:
        raise AssertionError("Una rotación Y invierte el eje vertical en espacio Z-up")


def test_manual_review_rejects_quarter_yaw() -> None:
    try:
        MODULE._validate_manual_review_rotation("top", 0, 0, 1)
    except MODULE.GarmentAnalyzerError as exc:
        assert "ORIENTACION_MANUAL_INVALIDA" in str(exc)
    else:
        raise AssertionError("Una prenda corporal no debe quedar de costado")


def test_gltf_positive_y_breaks_up_down_tie() -> None:
    upside_down = np.asarray([
        [-1.0, 0.0, 0.0],
        [0.0, 0.0, -1.0],
        [0.0, -1.0, 0.0],
    ])
    upright = np.asarray([
        [1.0, 0.0, 0.0],
        [0.0, 0.0, -1.0],
        [0.0, 1.0, 0.0],
    ])
    assert MODULE._source_up_tie_break_penalty(upright, "top") == 0.0
    assert MODULE._source_up_tie_break_penalty(upside_down, "top") == 1.0
