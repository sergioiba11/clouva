from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
from numba import njit

from camera_rig import OrthoCamera
from canonical_space import CanonicalTransform, transform_points
from glb_loader import LoadedScene

_OPEN3D_IMPORT_ERROR: str | None = None
try:
    import open3d as o3d
except Exception as exc:
    o3d = None
    _OPEN3D_IMPORT_ERROR = f"{type(exc).__name__}: {exc}"


@njit(cache=True)
def _software_rasterize(
    screen_x: np.ndarray,
    screen_y: np.ndarray,
    depth: np.ndarray,
    faces: np.ndarray,
    resolution: int,
):
    z_buffer = np.full((resolution, resolution), np.inf, dtype=np.float32)
    face_buffer = np.full((resolution, resolution), -1, dtype=np.int32)
    bary_buffer = np.full((resolution, resolution, 3), np.nan, dtype=np.float32)
    eps = 1e-5

    for face_index in range(faces.shape[0]):
        i0 = faces[face_index, 0]
        i1 = faces[face_index, 1]
        i2 = faces[face_index, 2]

        z0 = depth[i0]
        z1 = depth[i1]
        z2 = depth[i2]
        if z0 <= 0.0 and z1 <= 0.0 and z2 <= 0.0:
            continue

        x0 = screen_x[i0]
        x1 = screen_x[i1]
        x2 = screen_x[i2]
        y0 = screen_y[i0]
        y1 = screen_y[i1]
        y2 = screen_y[i2]

        min_x = max(0, int(np.floor(min(x0, x1, x2))))
        max_x = min(resolution - 1, int(np.ceil(max(x0, x1, x2))))
        min_y = max(0, int(np.floor(min(y0, y1, y2))))
        max_y = min(resolution - 1, int(np.ceil(max(y0, y1, y2))))
        if min_x > max_x or min_y > max_y:
            continue

        denominator = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
        if abs(denominator) < 1e-12:
            continue

        for row in range(min_y, max_y + 1):
            py = row + 0.5
            for column in range(min_x, max_x + 1):
                px = column + 0.5
                w0 = ((y1 - y2) * (px - x2) + (x2 - x1) * (py - y2)) / denominator
                w1 = ((y2 - y0) * (px - x2) + (x0 - x2) * (py - y2)) / denominator
                w2 = 1.0 - w0 - w1
                if w0 < -eps or w1 < -eps or w2 < -eps:
                    continue
                value = w0 * z0 + w1 * z1 + w2 * z2
                if value <= 0.0 or value >= z_buffer[row, column]:
                    continue
                z_buffer[row, column] = value
                face_buffer[row, column] = face_index
                bary_buffer[row, column, 0] = w0
                bary_buffer[row, column, 1] = w1
                bary_buffer[row, column, 2] = w2

    return z_buffer, face_buffer, bary_buffer


def open3d_status() -> dict[str, Any]:
    return {
        "available": o3d is not None,
        "version": getattr(o3d, "__version__", None) if o3d is not None else None,
        "error": _OPEN3D_IMPORT_ERROR,
        "required": False,
        "fallback": "software_numba",
    }


def geometry_backend_status() -> dict[str, Any]:
    return {
        "ready": True,
        "backend": "open3d" if o3d is not None else "software_numba",
        "open3d_optional": open3d_status(),
    }


@dataclass
class GeometryRecord:
    geometry_id: int
    mesh_id: str
    primitive_id: int
    vertices_source: np.ndarray
    vertices_canonical: np.ndarray
    faces: np.ndarray
    source_vertex_indices: np.ndarray


class AnatomyRaycastScene:
    def __init__(self, loaded: LoadedScene, canonical: CanonicalTransform):
        self.backend = "open3d" if o3d is not None else "software_numba"
        self.scene = o3d.t.geometry.RaycastingScene() if o3d is not None else None
        self.records: dict[int, GeometryRecord] = {}

        combined_vertices: list[np.ndarray] = []
        combined_faces: list[np.ndarray] = []
        face_geometry_ids: list[np.ndarray] = []
        face_local_ids: list[np.ndarray] = []
        vertex_offset = 0

        for fallback_id, primitive in enumerate(loaded.primitives):
            vertices = transform_points(primitive.vertices_source, canonical.source_to_canonical)
            if self.scene is not None:
                mesh = o3d.t.geometry.TriangleMesh(
                    o3d.core.Tensor(vertices.astype(np.float32)),
                    o3d.core.Tensor(primitive.faces.astype(np.uint32)),
                )
                geometry_id = int(self.scene.add_triangles(mesh))
            else:
                geometry_id = fallback_id

            self.records[geometry_id] = GeometryRecord(
                geometry_id=geometry_id,
                mesh_id=primitive.mesh_id,
                primitive_id=primitive.primitive_id,
                vertices_source=primitive.vertices_source,
                vertices_canonical=vertices,
                faces=primitive.faces,
                source_vertex_indices=primitive.source_vertex_indices,
            )
            combined_vertices.append(vertices.astype(np.float32))
            combined_faces.append(primitive.faces.astype(np.int64) + vertex_offset)
            face_geometry_ids.append(np.full(len(primitive.faces), geometry_id, dtype=np.int32))
            face_local_ids.append(np.arange(len(primitive.faces), dtype=np.int32))
            vertex_offset += len(vertices)

        if not self.records:
            raise RuntimeError("GEOMETRY_SCENE_EMPTY")

        self.vertices = np.concatenate(combined_vertices, axis=0)
        self.faces = np.concatenate(combined_faces, axis=0)
        self.face_geometry_ids = np.concatenate(face_geometry_ids, axis=0)
        self.face_local_ids = np.concatenate(face_local_ids, axis=0)

        triangles = self.vertices[self.faces]
        normals = np.cross(triangles[:, 1] - triangles[:, 0], triangles[:, 2] - triangles[:, 0])
        lengths = np.linalg.norm(normals, axis=1, keepdims=True)
        self.face_normals = np.divide(normals, np.maximum(lengths, 1e-12)).astype(np.float32)
        self.bounds_min = self.vertices.min(axis=0)
        self.bounds_max = self.vertices.max(axis=0)

    def cast(self, rays: np.ndarray) -> dict[str, np.ndarray]:
        if self.scene is None:
            raise RuntimeError("SOFTWARE_BACKEND_REQUIRES_CAMERA_RENDER")
        answer = self.scene.cast_rays(o3d.core.Tensor(rays.astype(np.float32)))
        result = {key: value.numpy() for key, value in answer.items()}
        t_hit = result["t_hit"]
        valid = np.isfinite(t_hit)
        origins = rays[..., :3]
        directions = rays[..., 3:]
        world = origins + directions * t_hit[..., None]
        world[~valid] = np.nan
        uv = result.get("primitive_uvs")
        if uv is None:
            bary = np.full((*t_hit.shape, 3), np.nan, dtype=np.float32)
        else:
            u = uv[..., 0]
            v = uv[..., 1]
            bary = np.stack([1.0 - u - v, u, v], axis=-1).astype(np.float32)
            bary[~valid] = np.nan
        return {
            "valid": valid,
            "t_hit": t_hit,
            "geometry_ids": result["geometry_ids"],
            "primitive_ids": result["primitive_ids"],
            "primitive_normals": result.get("primitive_normals", np.zeros_like(world)),
            "barycentric": bary,
            "world_position": world,
        }

    def render_camera(self, camera: OrthoCamera) -> dict[str, np.ndarray]:
        if self.scene is not None:
            return self.cast(camera.rays())

        relative = self.vertices - camera.origin.astype(np.float32)
        horizontal = relative @ camera.right.astype(np.float32)
        vertical = relative @ camera.up.astype(np.float32)
        depth = relative @ camera.direction.astype(np.float32)
        resolution = int(camera.resolution)
        screen_x = ((horizontal / float(camera.width)) + 0.5) * resolution - 0.5
        screen_y = (0.5 - (vertical / float(camera.height))) * resolution - 0.5

        z_buffer, face_buffer, barycentric = _software_rasterize(
            screen_x.astype(np.float32),
            screen_y.astype(np.float32),
            depth.astype(np.float32),
            self.faces,
            resolution,
        )
        valid = face_buffer >= 0
        geometry_ids = np.full((resolution, resolution), -1, dtype=np.int32)
        primitive_ids = np.full((resolution, resolution), -1, dtype=np.int32)
        primitive_normals = np.zeros((resolution, resolution, 3), dtype=np.float32)
        world_position = np.full((resolution, resolution, 3), np.nan, dtype=np.float32)

        rows, columns = np.nonzero(valid)
        if len(rows):
            global_faces = face_buffer[rows, columns]
            geometry_ids[rows, columns] = self.face_geometry_ids[global_faces]
            primitive_ids[rows, columns] = self.face_local_ids[global_faces]
            primitive_normals[rows, columns] = self.face_normals[global_faces]
            triangle_vertices = self.vertices[self.faces[global_faces]]
            weights = barycentric[rows, columns]
            world_position[rows, columns] = np.sum(triangle_vertices * weights[:, :, None], axis=1)

        z_buffer[~valid] = np.inf
        barycentric[~valid] = np.nan
        return {
            "valid": valid,
            "t_hit": z_buffer,
            "geometry_ids": geometry_ids,
            "primitive_ids": primitive_ids,
            "primitive_normals": primitive_normals,
            "barycentric": barycentric,
            "world_position": world_position,
        }

    def triangle_details(self, geometry_id: int, triangle_id: int) -> dict[str, Any]:
        record = self.records[int(geometry_id)]
        face = record.faces[int(triangle_id)]
        return {
            "mesh_id": record.mesh_id,
            "primitive_id": record.primitive_id,
            "source_vertex_indices": record.source_vertex_indices[face].astype(int).tolist(),
            "source_triangle_vertices": record.vertices_source[face].tolist(),
            "canonical_triangle_vertices": record.vertices_canonical[face].tolist(),
        }
