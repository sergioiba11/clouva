from __future__ import annotations

import numpy as np
from camera_rig import OrthoCamera
from canonical_space import CanonicalTransform
from raycast_scene import AnatomyRaycastScene
from result_contract import SurfaceLandmark

def _source_position(canonical_position: np.ndarray, transform: CanonicalTransform) -> list[float]:
    point = np.ones(4, dtype=np.float64)
    point[:3] = canonical_position
    source = transform.canonical_to_source @ point
    return source[:3].astype(float).tolist()

def project_candidates(candidates: list[dict], view_name: str, camera: OrthoCamera, buffers: dict,
                       scene: AnatomyRaycastScene, transform: CanonicalTransform, radius: int = 4) -> list[SurfaceLandmark]:
    resolution = camera.resolution
    output: list[SurfaceLandmark] = []
    valid = buffers["valid"]
    for candidate in candidates:
        target_column = int(np.clip(float(candidate["x"]) * resolution, 0, resolution - 1))
        target_row = int(np.clip(float(candidate["y"]) * resolution, 0, resolution - 1))
        best = None
        for ring in range(radius + 1):
            for dy in range(-ring, ring + 1):
                for dx in range(-ring, ring + 1):
                    if ring and max(abs(dx), abs(dy)) != ring:
                        continue
                    row = int(np.clip(target_row + dy, 0, resolution - 1))
                    column = int(np.clip(target_column + dx, 0, resolution - 1))
                    if not bool(valid[row, column]):
                        continue
                    distance = float(dx * dx + dy * dy)
                    geometry_id = int(buffers["geometry_ids"][row, column])
                    triangle_id = int(buffers["primitive_ids"][row, column])
                    if geometry_id not in scene.records or triangle_id < 0:
                        continue
                    if best is None or distance < best[0]:
                        best = (distance, row, column, geometry_id, triangle_id)
            if best is not None:
                break
        if best is None:
            continue
        _, row, column, geometry_id, triangle_id = best
        canonical_position = buffers["world_position"][row, column].astype(np.float64)
        normal = buffers["primitive_normals"][row, column].astype(np.float64)
        barycentric = buffers["barycentric"][row, column].astype(np.float64)
        details = scene.triangle_details(geometry_id, triangle_id)
        confidence = float(np.clip(candidate.get("visibility", 1.0) * candidate.get("presence", 1.0), 0.0, 1.0))
        output.append(SurfaceLandmark(
            name=str(candidate["name"]),
            group=str(candidate.get("group") or "unknown"),
            state="verified_single_view",
            confidence=confidence,
            geometry_id=geometry_id,
            mesh_id=details["mesh_id"],
            primitive_id=int(details["primitive_id"]),
            triangle_id=triangle_id,
            source_vertex_indices=details["source_vertex_indices"],
            barycentric=barycentric.astype(float).tolist(),
            canonical_position=canonical_position.astype(float).tolist(),
            source_position=_source_position(canonical_position, transform),
            surface_normal=normal.astype(float).tolist(),
            confirmed_views=[view_name],
            detector_index=int(candidate.get("index", -1)),
            side=candidate.get("side"),
        ))
    return output
