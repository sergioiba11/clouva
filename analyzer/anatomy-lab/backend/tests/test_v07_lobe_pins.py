from pathlib import Path
from types import SimpleNamespace

import numpy as np

from ear_anchors import INTERIOR_BARYCENTRIC, _validate_pair


def test_pin_barycentric_is_inside_triangle_not_vertex():
    assert np.allclose(INTERIOR_BARYCENTRIC, [1 / 3, 1 / 3, 1 / 3])
    assert float(np.min(INTERIOR_BARYCENTRIC)) >= 0.08
    assert abs(float(np.sum(INTERIOR_BARYCENTRIC)) - 1.0) < 1e-9


def test_pair_validation_rejects_bad_height_and_accepts_good_pair():
    scene = SimpleNamespace(records={})
    envelope = SimpleNamespace(
        center_x=0.0, center_y=0.0, center_z=1.60, height=1.8,
        radius_x=0.20, min_z=1.38, max_z=1.82,
        front_surface_y=-0.18, back_surface_y=0.18,
    )
    def anchor(side, p):
        return {
            "side": side,
            "canonical_position": p,
            "barycentric": [1/3, 1/3, 1/3],
            "validation": {"lateral_alignment": 0.8},
        }
    good = [anchor("left", [-0.16, 0.04, 1.50]), anchor("right", [0.16, 0.04, 1.505])]
    assert _validate_pair(scene, good, envelope) == []
    bad = [anchor("left", [-0.16, 0.04, 1.44]), anchor("right", [0.16, 0.04, 1.56])]
    assert any(item["code"] == "EARLOBE_HEIGHT_ASYMMETRY" for item in _validate_pair(scene, bad, envelope))


def test_frontend_uses_tiny_pins_not_hoop_rings():
    frontend = Path(__file__).resolve().parents[2] / "frontend" / "src" / "main.jsx"
    text = frontend.read_text(encoding="utf-8")
    assert "Pines exactos de lóbulos" in text
    assert "torusGeometry" not in text
    assert "0.0045" in text


def test_analyzer_has_v07_and_removes_pose_face_from_production():
    analyzer = Path(__file__).resolve().parents[1] / "analyzer.py"
    text = analyzer.read_text(encoding="utf-8")
    assert "clouva-anatomy-lab-v0.7-lobe-pins-clean-face" in text
    assert "pose_face_diagnostics" in text
    assert "production_body" in text
