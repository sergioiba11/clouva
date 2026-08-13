from pathlib import Path
from types import SimpleNamespace

import numpy as np

from ear_anchors import (
    LOWER_LOBE_MAX_FRACTION,
    LOWER_LOBE_MIN_FRACTION,
    _find_lobe_surface,
    _validate_pair,
)


class Record:
    def __init__(self, vertices, faces):
        self.vertices_canonical = np.asarray(vertices, dtype=np.float64)
        self.faces = np.asarray(faces, dtype=np.int64)


class Scene:
    def __init__(self, record):
        self.records = {0: record}

    def triangle_details(self, geometry_id, triangle_id):
        return {
            "mesh_id": "mesh",
            "primitive_id": 0,
            "source_vertex_indices": self.records[geometry_id].faces[triangle_id].astype(int).tolist(),
        }


def _triangle(x, y, z, sign):
    # Winding is corrected by the production code; these are lateral triangles.
    return [
        [x, y - 0.006, z - 0.004],
        [x + sign * 0.002, y + 0.006, z - 0.003],
        [x + sign * 0.001, y, z + 0.006],
    ]


def test_real_finder_rejects_high_ear_and_selects_lower_target_band():
    envelope = SimpleNamespace(
        center_x=0.0, center_y=0.0, center_z=1.596, height=1.8,
        radius_x=0.197, min_z=1.378, max_z=1.814,
        front_surface_y=-0.174, back_surface_y=0.179,
    )
    vertices = []
    faces = []
    for tri in [
        _triangle(-0.185, 0.040, 1.562, -1),  # old wrong/high location
        _triangle(-0.185, 0.040, 1.497, -1),  # real lower-lobe target
    ]:
        start = len(vertices)
        vertices.extend(tri)
        faces.append([start, start + 1, start + 2])
    hit = _find_lobe_surface(Scene(Record(vertices, faces)), envelope, "left")
    assert abs(hit["canonical_position"][2] - 1.496) < 0.018
    fraction = hit["lower_zone_fraction"]
    assert LOWER_LOBE_MIN_FRACTION <= fraction <= LOWER_LOBE_MAX_FRACTION
    assert min(hit["barycentric"]) >= 0.10


def test_pair_is_not_ready_when_vertical_target_or_height_pair_fails():
    scene = SimpleNamespace(records={})
    envelope = SimpleNamespace(
        center_x=0.0, center_y=0.0, center_z=1.596, height=1.8,
        radius_x=0.197, min_z=1.378, max_z=1.814,
        front_surface_y=-0.174, back_surface_y=0.179,
    )

    def anchor(side, p):
        return {
            "side": side,
            "canonical_position": p,
            "barycentric": [0.2, 0.3, 0.5],
            "validation": {"lateral_alignment": 0.95},
        }

    good = [anchor("left", [-0.185, 0.04, 1.497]), anchor("right", [0.185, 0.04, 1.501])]
    assert _validate_pair(scene, good, envelope) == []
    bad = [anchor("left", [-0.185, 0.04, 1.562]), anchor("right", [0.185, 0.04, 1.534])]
    codes = {item["code"] for item in _validate_pair(scene, bad, envelope)}
    assert "EARLOBE_VERTICAL_LOCK_FAILED" in codes
    assert "EARLOBE_HEIGHT_ASYMMETRY" in codes


def test_patch_changes_real_analyzer_and_hides_unready_pins():
    root = Path(__file__).resolve().parents[2]
    analyzer = (root / "backend" / "analyzer.py").read_text(encoding="utf-8")
    frontend = (root / "frontend" / "src" / "main.jsx").read_text(encoding="utf-8")
    assert "clouva-anatomy-lab-v0.7.2-real-lobe-vertical-lock" in analyzer
    assert 'item.get("validation", {}).get("vertical_lock") is True' in analyzer
    assert '.filter((item) => item.state === "surface_anchor_ready")' in frontend
