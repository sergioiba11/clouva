from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import trimesh

@dataclass
class MeshPrimitive:
    mesh_id: str
    primitive_id: int
    vertices_source: np.ndarray
    faces: np.ndarray
    vertex_normals_source: np.ndarray
    source_vertex_indices: np.ndarray

@dataclass
class LoadedScene:
    primitives: list[MeshPrimitive]
    bounds_min: np.ndarray
    bounds_max: np.ndarray
    metadata: dict[str, Any]

def _as_triangles(mesh: trimesh.Trimesh) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    vertices = np.asarray(mesh.vertices, dtype=np.float64)
    faces = np.asarray(mesh.faces, dtype=np.int64)
    if vertices.ndim != 2 or vertices.shape[1] != 3 or not len(vertices):
        raise ValueError("SOURCE_GEOMETRY_EMPTY")
    if faces.ndim != 2 or faces.shape[1] != 3 or not len(faces):
        raise ValueError("SOURCE_TOPOLOGY_CORRUPT")
    if not np.isfinite(vertices).all():
        raise ValueError("SOURCE_TRANSFORM_INVALID")
    if faces.min() < 0 or faces.max() >= len(vertices):
        raise ValueError("SOURCE_TOPOLOGY_CORRUPT")
    normals = np.asarray(mesh.vertex_normals, dtype=np.float64)
    if normals.shape != vertices.shape or not np.isfinite(normals).all():
        normals = np.zeros_like(vertices)
    return vertices, faces, normals

def load_glb(path: Path) -> LoadedScene:
    if path.suffix.lower() != ".glb":
        raise ValueError("Solo se aceptan archivos .glb")
    loaded = trimesh.load(path, force="scene", process=False)
    if not isinstance(loaded, trimesh.Scene):
        loaded = trimesh.Scene(loaded)
    primitives: list[MeshPrimitive] = []
    all_points: list[np.ndarray] = []
    primitive_id = 0

    for node_name in loaded.graph.nodes_geometry:
        transform, geometry_name = loaded.graph[node_name]
        geometry = loaded.geometry.get(geometry_name)
        if geometry is None or not isinstance(geometry, trimesh.Trimesh):
            continue
        mesh = geometry.copy()
        mesh.apply_transform(np.asarray(transform, dtype=np.float64))
        vertices, faces, normals = _as_triangles(mesh)
        primitives.append(MeshPrimitive(
            mesh_id=str(node_name),
            primitive_id=primitive_id,
            vertices_source=vertices,
            faces=faces,
            vertex_normals_source=normals,
            source_vertex_indices=np.arange(len(vertices), dtype=np.int64),
        ))
        primitive_id += 1
        all_points.append(vertices)

    if not primitives:
        raise ValueError("SOURCE_GEOMETRY_EMPTY")
    points = np.concatenate(all_points, axis=0)
    bounds_min = points.min(axis=0)
    bounds_max = points.max(axis=0)
    metadata = {
        "geometry_only": True,
        "has_skin": False,
        "has_skeleton": False,
        "has_morph_targets": False,
        "mesh_count": len(primitives),
        "vertex_count": int(sum(len(item.vertices_source) for item in primitives)),
        "triangle_count": int(sum(len(item.faces) for item in primitives)),
        "bounds_min": bounds_min.tolist(),
        "bounds_max": bounds_max.tolist(),
    }
    return LoadedScene(primitives=primitives, bounds_min=bounds_min, bounds_max=bounds_max, metadata=metadata)
