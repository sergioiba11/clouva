from types import SimpleNamespace

import numpy as np
import trimesh

from ear_anchors import build_earlobe_anchors
from multiview_fusion import fuse_landmarks
from result_contract import SurfaceLandmark


def surface(name, position, triangle_id, confidence=1.0, group="body"):
    return SurfaceLandmark(
        name=name,
        group=group,
        state="verified_single_view",
        confidence=confidence,
        geometry_id=0,
        mesh_id="mesh",
        primitive_id=0,
        triangle_id=triangle_id,
        source_vertex_indices=[0, 1, 2],
        barycentric=[0.2, 0.3, 0.5],
        canonical_position=list(position),
        source_position=list(position),
        surface_normal=[0.0, -1.0, 0.0],
        confirmed_views=[f"view_{triangle_id}"],
    )


def test_multiview_fusion_keeps_one_exact_triangle_surface_point():
    items = [
        surface("nose", [0.0, -0.1, 1.5], 10, confidence=0.8),
        surface("nose", [0.02, -0.1, 1.5], 11, confidence=0.9),
    ]
    fused = fuse_landmarks(items)[0]
    assert fused.canonical_position in ([0.0, -0.1, 1.5], [0.02, -0.1, 1.5])
    assert fused.canonical_position != [0.01, -0.1, 1.5]
    assert fused.triangle_id in (10, 11)
    assert len(fused.confirmed_views) == 2


def test_builds_two_surface_earlobe_anchors_with_barycentrics():
    left = trimesh.creation.box(extents=(0.18, 0.10, 0.24))
    left.apply_translation([-0.95, -0.08, 1.52])
    right = trimesh.creation.box(extents=(0.18, 0.10, 0.24))
    right.apply_translation([0.95, -0.08, 1.52])
    mesh = trimesh.util.concatenate([left, right])
    vertices = np.asarray(mesh.vertices, dtype=float)
    faces = np.asarray(mesh.faces, dtype=int)
    record = SimpleNamespace(
        vertices_canonical=vertices,
        vertices_source=vertices,
        faces=faces,
        mesh_id="ears",
        primitive_id=0,
        source_vertex_indices=np.arange(len(vertices), dtype=int),
    )

    class Scene:
        records = {0: record}

        @staticmethod
        def triangle_details(geometry_id, triangle_id):
            face = record.faces[triangle_id]
            return {
                "mesh_id": record.mesh_id,
                "primitive_id": record.primitive_id,
                "source_vertex_indices": record.source_vertex_indices[face].tolist(),
            }

    body = [
        surface("left_ear", [-0.95, -0.08, 1.55], 0, confidence=0.9),
        surface("right_ear", [0.95, -0.08, 1.55], 1, confidence=0.9),
    ]
    transform = SimpleNamespace(canonical_to_source=np.eye(4))
    envelope = SimpleNamespace(center_x=0.0, center_y=0.0, center_z=1.60, height=2.0)

    anchors, warnings = build_earlobe_anchors(Scene(), body, transform, envelope)
    assert {item["name"] for item in anchors} == {"left_earlobe_anchor", "right_earlobe_anchor"}
    for anchor in anchors:
        assert anchor["state"] in {"surface_anchor_ready", "surface_anchor_review"}
        assert abs(sum(anchor["barycentric"]) - 1.0) < 1e-6
        assert min(anchor["barycentric"]) >= 0.08
        assert anchor["triangle_id"] >= 0
        assert len(anchor["attachment_direction"]) == 3
        assert anchor["attachment_direction"][2] < 0
