from __future__ import annotations

import copy
import hashlib
import json
import math
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any
import sys

_VENDOR_DIR = Path(__file__).resolve().parent / "_vendor"
if _VENDOR_DIR.is_dir():
    vendor_path = str(_VENDOR_DIR)
    if vendor_path not in sys.path:
        sys.path.insert(0, vendor_path)

import numpy as np
import trimesh
from scipy.spatial import cKDTree


class GarmentAnalyzerError(RuntimeError):
    pass


@dataclass
class GarmentAnalysisArtifacts:
    analysis_id: str
    preview_glb_path: Path
    analysis_json_path: Path
    analysis: dict[str, Any]


@dataclass
class UniversalFitArtifacts:
    fit_id: str
    glb_path: Path
    fit_json_path: Path
    analysis_json_path: Path
    collision_json_path: Path
    fit_json: dict[str, Any]


CATEGORY_KEYWORDS: dict[str, tuple[str, ...]] = {
    "top": (
        "remera", "tshirt", "t-shirt", "shirt", "camiseta", "top", "musculosa",
        "hoodie", "buzo", "sweater", "sudadera", "jacket", "campera", "chaqueta",
        "vest", "chaleco", "blusa", "blouse", "sweatshirt",
    ),
    "lower": (
        "pantalon", "pantalón", "pants", "trouser", "jean", "short", "bermuda",
        "skirt", "falda", "jogger", "cargo", "lower",
    ),
    "headwear": (
        "gorra", "cap", "hat", "beanie", "sombrero", "bonnet", "casco", "helmet",
    ),
    "footwear": (
        "zapatilla", "shoe", "shoes", "sneaker", "boot", "bota", "calzado", "footwear",
    ),
    "accessory": (
        "cadena", "chain", "collar", "necklace", "aro", "earring", "anillo", "ring",
        "pulsera", "bracelet", "mochila", "backpack", "bag", "bolso", "gafas", "glasses",
        "accessory", "accesorio", "reloj", "watch",
    ),
}

FIT_MULTIPLIERS = {
    "base": 1.02,
    "regular": 1.08,
    "oversized": 1.16,
}


def _load_scene(path: Path) -> trimesh.Scene:
    loaded = trimesh.load(path, force="scene", process=False)
    if isinstance(loaded, trimesh.Trimesh):
        scene = trimesh.Scene()
        scene.add_geometry(loaded, node_name="mesh", geom_name="mesh")
        return scene
    if isinstance(loaded, trimesh.Scene):
        return loaded.copy()
    raise GarmentAnalyzerError("No se pudo abrir el GLB")


def _combined_mesh(path: Path) -> trimesh.Trimesh:
    scene = _load_scene(path)
    geoms: list[trimesh.Trimesh] = []
    for node_name in scene.graph.nodes_geometry:
        transform, geometry_name = scene.graph[node_name]
        geom = scene.geometry.get(geometry_name)
        if not isinstance(geom, trimesh.Trimesh):
            continue
        mesh = geom.copy()
        mesh.apply_transform(np.asarray(transform, dtype=np.float64))
        geoms.append(mesh)
    if not geoms:
        raise GarmentAnalyzerError("El GLB no contiene mallas triangulares")
    mesh = trimesh.util.concatenate(geoms)
    if len(mesh.vertices) == 0 or len(mesh.faces) == 0:
        raise GarmentAnalyzerError("La malla está vacía")
    return mesh



def _face_component_indices(mesh: trimesh.Trimesh) -> list[np.ndarray]:
    """Return face components without networkx or scipy."""
    faces = np.asarray(mesh.faces, dtype=np.int64)
    if len(faces) == 0:
        return []

    parent = np.arange(len(faces), dtype=np.int64)
    rank = np.zeros(len(faces), dtype=np.uint8)

    def find(index: int) -> int:
        root = index
        while parent[root] != root:
            root = int(parent[root])
        while parent[index] != index:
            nxt = int(parent[index])
            parent[index] = root
            index = nxt
        return root

    def union(a: int, b: int) -> None:
        root_a = find(a)
        root_b = find(b)
        if root_a == root_b:
            return
        if rank[root_a] < rank[root_b]:
            parent[root_a] = root_b
        elif rank[root_a] > rank[root_b]:
            parent[root_b] = root_a
        else:
            parent[root_b] = root_a
            rank[root_a] += 1

    vertex_owner: dict[int, int] = {}
    for face_index, face in enumerate(faces):
        for vertex_index in face:
            key = int(vertex_index)
            previous = vertex_owner.get(key)
            if previous is None:
                vertex_owner[key] = face_index
            else:
                union(face_index, previous)

    groups: dict[int, list[int]] = {}
    for index in range(len(faces)):
        groups.setdefault(find(index), []).append(index)
    return [np.asarray(indices, dtype=np.int64) for indices in groups.values()]


def _bbox_gap(a_min: np.ndarray, a_max: np.ndarray, b_min: np.ndarray, b_max: np.ndarray) -> np.ndarray:
    return np.maximum(np.maximum(a_min - b_max, b_min - a_max), 0.0)


def _component_metrics(mesh: trimesh.Trimesh) -> dict[str, Any]:
    """
    Count raw disconnected face islands and also a geometry-aware effective count.

    Clothing GLBs frequently duplicate seam/material vertices, so pieces that visually
    touch can be disconnected topologically.  The effective count clusters nearby
    bounding boxes for analysis only; materials and source geometry are not modified.
    """
    components = _face_component_indices(mesh)
    if not components:
        return {
            "raw_count": 0,
            "effective_count": 0,
            "largest_face_share": 0.0,
            "nearby_components_grouped": False,
        }

    vertices = np.asarray(mesh.vertices, dtype=np.float64)
    faces = np.asarray(mesh.faces, dtype=np.int64)
    whole_size = np.maximum(vertices.max(axis=0) - vertices.min(axis=0), 1e-9)
    diagonal = float(np.linalg.norm(whole_size))
    proximity = max(diagonal * 0.022, 1e-7)

    boxes: list[tuple[np.ndarray, np.ndarray, int]] = []
    for face_ids in components:
        vertex_ids = np.unique(faces[face_ids].reshape(-1))
        points = vertices[vertex_ids]
        boxes.append((points.min(axis=0), points.max(axis=0), int(len(face_ids))))

    parent = np.arange(len(boxes), dtype=np.int64)

    def find(index: int) -> int:
        while parent[index] != index:
            parent[index] = parent[int(parent[index])]
            index = int(parent[index])
        return index

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    for i in range(len(boxes)):
        a_min, a_max, _ = boxes[i]
        for j in range(i + 1, len(boxes)):
            b_min, b_max, _ = boxes[j]
            gap = _bbox_gap(a_min, a_max, b_min, b_max)
            overlap_axes = int(np.count_nonzero(gap <= 1e-12))
            # Group seam/material islands that overlap in at least two axes and are
            # only a tiny distance apart in the remaining direction.
            if float(np.linalg.norm(gap)) <= proximity or (overlap_axes >= 2 and float(gap.max()) <= proximity * 2.0):
                union(i, j)

    roots = {find(index) for index in range(len(boxes))}
    largest_faces = max(face_count for _, _, face_count in boxes)
    return {
        "raw_count": int(len(components)),
        "effective_count": int(len(roots)),
        "largest_face_share": float(largest_faces / max(len(faces), 1)),
        "nearby_components_grouped": bool(len(roots) < len(components)),
        "grouping_distance_relative": 0.022,
    }

def _rotation_candidates() -> list[np.ndarray]:
    import itertools

    out: list[np.ndarray] = []
    for perm in itertools.permutations(range(3)):
        for signs in itertools.product((-1.0, 1.0), repeat=3):
            matrix = np.zeros((3, 3), dtype=np.float64)
            for new_axis, old_axis in enumerate(perm):
                matrix[new_axis, old_axis] = signs[new_axis]
            if np.linalg.det(matrix) > 0.5:
                out.append(matrix)
    return out


def _source_up_tie_break_penalty(rotation: np.ndarray, category: str) -> float:
    """Prefer the glTF +Y up convention only when geometry scores tie.

    Garment proportions identify which source axis is semantic height, but a
    pure bounding-box score cannot distinguish +height from -height.  GLB/glTF
    assets are Y-up, so when two candidates have the same geometry score we
    prefer the candidate that maps source +Y to semantic +Z.  Front/back stays
    reviewable as a Z-axis 180-degree ambiguity.
    """
    if category not in {"top", "lower"}:
        return 0.0
    matrix = np.asarray(rotation, dtype=np.float64)
    if matrix.shape != (3, 3):
        return 1.0
    source_y_to_semantic_z = float(matrix[2, 1])
    if source_y_to_semantic_z > 0.5:
        return 0.0
    if source_y_to_semantic_z < -0.5:
        return 1.0
    return 0.5


def _text_blob(template_info: dict[str, Any]) -> str:
    parts = [
        template_info.get("name"),
        template_info.get("code"),
        template_info.get("category"),
        template_info.get("category_label"),
        template_info.get("normalized_category"),
        template_info.get("file_name"),
    ]
    return " ".join(str(item) for item in parts if item).lower()


def _category_from_metadata(template_info: dict[str, Any]) -> tuple[str, float, str]:
    text = _text_blob(template_info)
    normalized = str(template_info.get("normalized_category") or "").lower()
    aliases = {
        "tshirt": "top",
        "hoodie": "top",
        "top": "top",
        "shirt": "top",
        "pants": "lower",
        "shorts": "lower",
        "lower": "lower",
        "headwear": "headwear",
        "footwear": "footwear",
        "accessory": "accessory",
    }
    if normalized in aliases:
        return aliases[normalized], 0.98, f"normalized_category:{normalized}"
    for category, words in CATEGORY_KEYWORDS.items():
        matches = [word for word in words if word in text]
        if matches:
            return category, min(0.97, 0.78 + 0.04 * len(matches)), f"metadata:{matches[0]}"
    return "unknown", 0.25, "geometry_required"


def _section_width(vertices: np.ndarray, z0: float, z1: float) -> tuple[float, float, int]:
    z_min = float(vertices[:, 2].min())
    z_max = float(vertices[:, 2].max())
    height = max(z_max - z_min, 1e-9)
    mask = (vertices[:, 2] >= z_min + height * z0) & (vertices[:, 2] <= z_min + height * z1)
    points = vertices[mask]
    if len(points) < 4:
        return 0.0, 0.0, int(len(points))
    spans = points.max(axis=0) - points.min(axis=0)
    return float(spans[0]), float(spans[1]), int(len(points))


def _orientation_score(vertices: np.ndarray, rotation: np.ndarray, category: str) -> tuple[float, dict[str, Any]]:
    local = vertices @ rotation.T
    bounds_min = local.min(axis=0)
    bounds_max = local.max(axis=0)
    size = np.maximum(bounds_max - bounds_min, 1e-9)
    x, y, z = [float(v) for v in size]
    top_w, top_d, top_count = _section_width(local, 0.72, 1.0)
    bottom_w, bottom_d, bottom_count = _section_width(local, 0.0, 0.28)

    if category == "top":
        # Width includes sleeves, depth should remain the thinnest axis and Z is garment length.
        score = abs(math.log(max(x / z, 1e-9) / 1.15))
        score += abs(math.log(max(y / x, 1e-9) / 0.34)) * 1.25
        if top_w + 1e-9 < bottom_w * 0.72:
            score += 1.2
        if top_count > bottom_count * 2.2:
            score += 0.35
    elif category == "lower":
        score = abs(math.log(max(z / x, 1e-9) / 1.55))
        score += abs(math.log(max(y / x, 1e-9) / 0.46))
        if top_w + 1e-9 < bottom_w * 0.82:
            score += 1.6
    elif category == "headwear":
        score = abs(math.log(max(x / y, 1e-9) / 1.05))
        score += abs(math.log(max(z / x, 1e-9) / 0.65))
    elif category == "footwear":
        # Semantic X=pair width, Y=toe/heel length, Z=height.
        score = abs(math.log(max(y / x, 1e-9) / 1.35))
        score += abs(math.log(max(z / y, 1e-9) / 0.38))
    else:
        # Generic stable orientation: Z should be one of the two longest axes and Y should be the thinnest.
        ordered = sorted([x, y, z], reverse=True)
        score = abs(math.log(max(y / ordered[-1], 1e-9)))
        if z < ordered[1] * 0.80:
            score += 0.5

    center = (bounds_min + bounds_max) * 0.5
    symmetry = abs(float(center[0] - np.median(local[:, 0]))) / max(x, 1e-9)
    score += symmetry * 0.25
    return float(score), {
        "local_vertices": local,
        "bounds_min": bounds_min,
        "bounds_max": bounds_max,
        "size": size,
        "top_width": top_w,
        "top_depth": top_d,
        "bottom_width": bottom_w,
        "bottom_depth": bottom_d,
        "top_count": top_count,
        "bottom_count": bottom_count,
    }


def _geometry_category(size: np.ndarray) -> tuple[str, float, str]:
    x, y, z = [float(v) for v in size]
    sorted_size = sorted([x, y, z], reverse=True)
    if z >= sorted_size[0] * 0.92 and y <= max(x, z) * 0.55:
        return "lower", 0.52, "geometry:tall_thin"
    if x >= z * 0.95 and y <= x * 0.48:
        return "top", 0.50, "geometry:wide_flat"
    if max(x, y) <= z * 0.65:
        return "accessory", 0.40, "geometry:compact_vertical"
    return "unknown", 0.30, "geometry:ambiguous"


def _boundary_components(vertices: np.ndarray, faces: np.ndarray) -> list[np.ndarray]:
    """Find boundary vertex components using edge counts; no networkx required."""
    edge_counts: dict[tuple[int, int], int] = {}
    for face in np.asarray(faces, dtype=np.int64):
        a, b, c = [int(value) for value in face]
        for u, v in ((a, b), (b, c), (c, a)):
            key = (u, v) if u < v else (v, u)
            edge_counts[key] = edge_counts.get(key, 0) + 1
    adjacency: dict[int, set[int]] = {}
    for (u, v), count in edge_counts.items():
        if count != 1:
            continue
        adjacency.setdefault(u, set()).add(v)
        adjacency.setdefault(v, set()).add(u)
    out: list[np.ndarray] = []
    visited: set[int] = set()
    for start_vertex in adjacency:
        if start_vertex in visited:
            continue
        stack = [start_vertex]
        component: list[int] = []
        visited.add(start_vertex)
        while stack:
            current = stack.pop()
            component.append(current)
            for nxt in adjacency.get(current, ()):
                if nxt not in visited:
                    visited.add(nxt)
                    stack.append(nxt)
        if len(component) >= 3:
            out.append(np.asarray(component, dtype=np.int64))
    return out


def _choose_neck_boundary(local: np.ndarray, faces: np.ndarray) -> tuple[np.ndarray | None, dict[str, Any]]:
    bmin = local.min(axis=0)
    bmax = local.max(axis=0)
    size = np.maximum(bmax - bmin, 1e-9)
    center = (bmin + bmax) * 0.5
    candidates: list[tuple[float, np.ndarray, dict[str, Any]]] = []
    boundaries = _boundary_components(local, faces)
    for vertex_ids in boundaries:
        points = local[vertex_ids]
        pmin, pmax = points.min(axis=0), points.max(axis=0)
        spans = pmax - pmin
        c = points.mean(axis=0)
        z01 = float((c[2] - bmin[2]) / size[2])
        x_center = abs(float(c[0] - center[0])) / size[0]
        width_ratio = float(spans[0] / size[0])
        depth_ratio = float(spans[1] / size[1])
        if z01 < 0.62 or x_center > 0.28:
            continue
        if not (0.035 <= width_ratio <= 0.58):
            continue
        if depth_ratio > 0.95:
            continue
        # Prefer a high, central, medium-sized opening. Tiny seam holes lose points.
        score = (1.0 - z01) * 2.6 + x_center * 2.1
        score += abs(width_ratio - 0.20) * 1.2
        score += max(0.0, 0.05 - width_ratio) * 8.0
        score += 0.20 / max(len(vertex_ids), 3)
        candidates.append((float(score), vertex_ids, {
            "center": c.astype(float).tolist(),
            "spans": spans.astype(float).tolist(),
            "z01": z01,
            "x_center_norm": x_center,
            "vertex_count": int(len(vertex_ids)),
        }))
    if not candidates:
        return None, {"boundary_component_count": int(len(boundaries)), "candidate_count": 0}
    candidates.sort(key=lambda item: item[0])
    _, ids, meta = candidates[0]
    meta.update({"boundary_component_count": int(len(boundaries)), "candidate_count": int(len(candidates))})
    return ids, meta


def _surface_vertex(
    local: np.ndarray,
    target: np.ndarray,
    size: np.ndarray,
    mask: np.ndarray | None = None,
    prefer_front: bool | None = None,
) -> tuple[list[float], dict[str, Any]]:
    indices = np.arange(len(local), dtype=np.int64)
    if mask is not None and int(np.count_nonzero(mask)) >= 8:
        indices = indices[mask]
    points = local[indices]
    safe_size = np.maximum(size, 1e-9)
    delta = (points - target) / safe_size
    distance = np.sum(delta * delta, axis=1)
    if prefer_front is not None:
        y01 = (points[:, 1] - local[:, 1].min()) / max(float(size[1]), 1e-9)
        surface_bias = (1.0 - y01) if prefer_front else y01
        distance = distance + surface_bias * 0.16
    local_index = int(np.argmin(distance))
    vertex_index = int(indices[local_index])
    normalized_distance = float(math.sqrt(max(float(distance[local_index]), 0.0)))
    confidence = float(np.clip(math.exp(-normalized_distance * 3.2), 0.30, 0.99))
    return local[vertex_index].astype(float).tolist(), {
        "vertex_index": vertex_index,
        "distance_normalized": normalized_distance,
        "confidence": confidence,
        "surface_locked": True,
        "method": "nearest_surface_vertex",
    }


def _structural_midpoint(
    local: np.ndarray,
    seed: np.ndarray,
    size: np.ndarray,
    *,
    source_meta: dict[str, Any] | None = None,
    method: str = "local_opposed_surface_midpoint",
) -> tuple[list[float], dict[str, Any]]:
    """Place a structural landmark inside the garment, between front and back.

    Garment surface landmarks remain snapped to vertices. Centerline landmarks are
    different: they describe the internal axis used for fitting and must never be
    projected back onto the front or rear panel. The local section is sampled in
    semantic space (X=width, Y=depth, Z=height), so this keeps working after any
    accepted XYZ orientation correction.
    """
    seed = np.asarray(seed, dtype=np.float64)
    safe_size = np.maximum(np.asarray(size, dtype=np.float64), 1e-9)
    bounds_min = local.min(axis=0)
    bounds_max = local.max(axis=0)

    selected = np.empty((0, 3), dtype=np.float64)
    selected_factor = 0.0
    depth_span = 0.0
    min_depth_span = float(safe_size[1] * 0.06)

    # Narrow local cuts first; expand only when the mesh has too few samples.
    for factor in (1.0, 1.5, 2.25, 3.25):
        x_band = max(float(safe_size[0] * 0.055 * factor), 1e-7)
        z_band = max(float(safe_size[2] * 0.028 * factor), 1e-7)
        mask = (np.abs(local[:, 0] - seed[0]) <= x_band) & (np.abs(local[:, 2] - seed[2]) <= z_band)
        candidate = local[mask]
        if len(candidate) < 10:
            continue
        ys = candidate[:, 1]
        back_depth = float(np.quantile(ys, 0.10))
        front_depth = float(np.quantile(ys, 0.90))
        candidate_span = max(front_depth - back_depth, 0.0)
        selected = candidate
        selected_factor = factor
        depth_span = candidate_span
        if len(candidate) >= 16 and candidate_span >= min_depth_span:
            break

    fallback = len(selected) < 10 or depth_span < min_depth_span
    if fallback:
        back_depth = float(bounds_min[1])
        front_depth = float(bounds_max[1])
        depth_span = max(front_depth - back_depth, 0.0)
        midpoint_depth = (back_depth + front_depth) * 0.5
        resolved_method = "semantic_bounds_midpoint_fallback"
        confidence = 0.55
        sample_count = int(len(selected))
    else:
        ys = selected[:, 1]
        back_depth = float(np.quantile(ys, 0.10))
        front_depth = float(np.quantile(ys, 0.90))
        midpoint_depth = (back_depth + front_depth) * 0.5
        span_quality = float(np.clip(depth_span / max(float(safe_size[1] * 0.30), 1e-9), 0.0, 1.0))
        sample_quality = float(np.clip(len(selected) / 48.0, 0.0, 1.0))
        confidence = float(np.clip(0.62 + span_quality * 0.20 + sample_quality * 0.13, 0.62, 0.95))
        resolved_method = method
        sample_count = int(len(selected))

    source_meta = source_meta or {}
    source_confidence = float(source_meta.get("confidence", confidence) or confidence)
    if not fallback:
        confidence = float(np.clip(confidence * 0.72 + source_confidence * 0.28, 0.62, 0.96))

    point = [float(seed[0]), float(midpoint_depth), float(seed[2])]
    meta: dict[str, Any] = {
        "confidence": confidence,
        "surface_locked": False,
        "landmark_type": "structural_internal",
        "method": resolved_method,
        "depth_axis": 1,
        "back_depth": back_depth,
        "front_depth": front_depth,
        "midpoint_depth": float(midpoint_depth),
        "depth_span": float(depth_span),
        "sample_count": sample_count,
        "sample_window_factor": float(selected_factor),
        "fallback_used": bool(fallback),
    }
    if source_meta.get("vertex_index") is not None:
        meta["source_surface_vertex_index"] = int(source_meta["vertex_index"])
    if source_meta.get("method"):
        meta["source_surface_method"] = str(source_meta["method"])
    return point, meta


def _internalize_landmark(
    name: str,
    landmarks: dict[str, list[float]],
    quality: dict[str, dict[str, Any]],
    local: np.ndarray,
    size: np.ndarray,
    *,
    method: str = "local_opposed_surface_midpoint",
) -> None:
    seed_value = landmarks.get(name)
    if not isinstance(seed_value, list) or len(seed_value) != 3:
        return
    source_meta = quality.get(name, {})
    point, meta = _structural_midpoint(
        local,
        np.asarray(seed_value, dtype=np.float64),
        size,
        source_meta=source_meta,
        method=method,
    )
    landmarks[name] = point
    quality[name] = meta


def _landmarks_for_category(
    local: np.ndarray,
    faces: np.ndarray,
    category: str,
) -> tuple[dict[str, list[float]], dict[str, dict[str, Any]], dict[str, Any]]:
    """Create surface anchors plus an internal structural centerline."""
    bmin = local.min(axis=0)
    bmax = local.max(axis=0)
    size = np.maximum(bmax - bmin, 1e-9)
    center = (bmin + bmax) * 0.5
    x01 = (local[:, 0] - bmin[0]) / size[0]
    z01 = (local[:, 2] - bmin[2]) / size[2]

    landmarks: dict[str, list[float]] = {}
    quality: dict[str, dict[str, Any]] = {}

    def add(name: str, target01: tuple[float, float, float], mask: np.ndarray | None = None, prefer_front: bool | None = None) -> None:
        target = bmin + size * np.asarray(target01, dtype=np.float64)
        point, meta = _surface_vertex(local, target, size, mask=mask, prefer_front=prefer_front)
        landmarks[name] = point
        quality[name] = meta

    add("center", (0.50, 1.00, 0.50), mask=(np.abs(x01 - 0.50) < 0.15) & (np.abs(z01 - 0.50) < 0.18), prefer_front=True)
    add("top", (0.50, 0.50, 1.00), mask=z01 > 0.90)
    add("bottom", (0.50, 0.50, 0.00), mask=z01 < 0.10)
    add("left", (0.00, 0.50, 0.50), mask=x01 < 0.08)
    add("right", (1.00, 0.50, 0.50), mask=x01 > 0.92)
    add("front", (0.50, 1.00, 0.50), mask=(np.abs(x01 - 0.50) < 0.18) & (np.abs(z01 - 0.50) < 0.20), prefer_front=True)
    add("back", (0.50, 0.00, 0.50), mask=(np.abs(x01 - 0.50) < 0.18) & (np.abs(z01 - 0.50) < 0.20), prefer_front=False)

    neck_meta: dict[str, Any] = {}
    if category == "top":
        neck_ids, neck_meta = _choose_neck_boundary(local, faces)
        if neck_ids is not None and len(neck_ids):
            neck_points = local[neck_ids]
            # Use the front-most central boundary vertex so the marker is visible and surface-locked.
            neck_center_x = float(np.median(neck_points[:, 0]))
            score = np.abs((neck_points[:, 0] - neck_center_x) / size[0]) - ((neck_points[:, 1] - bmin[1]) / size[1]) * 0.18
            chosen = int(neck_ids[int(np.argmin(score))])
            landmarks["neck_center"] = local[chosen].astype(float).tolist()
            quality["neck_center"] = {
                "vertex_index": chosen,
                "distance_normalized": 0.0,
                "confidence": 0.86,
                "surface_locked": True,
                "method": "boundary_neck_candidate",
                **neck_meta,
            }
        else:
            add("neck_center", (0.50, 1.00, 0.93), mask=(np.abs(x01 - 0.50) < 0.18) & (z01 > 0.72), prefer_front=True)
            quality["neck_center"]["method"] = "surface_fallback_no_neck_boundary"
            quality["neck_center"]["confidence"] = min(float(quality["neck_center"]["confidence"]), 0.58)

        add("left_shoulder", (0.27, 1.00, 0.82), mask=(x01 > 0.12) & (x01 < 0.42) & (z01 > 0.68), prefer_front=True)
        add("right_shoulder", (0.73, 1.00, 0.82), mask=(x01 > 0.58) & (x01 < 0.88) & (z01 > 0.68), prefer_front=True)
        add("left_armhole", (0.31, 1.00, 0.63), mask=(x01 > 0.18) & (x01 < 0.43) & (z01 > 0.44) & (z01 < 0.76), prefer_front=True)
        add("right_armhole", (0.69, 1.00, 0.63), mask=(x01 > 0.57) & (x01 < 0.82) & (z01 > 0.44) & (z01 < 0.76), prefer_front=True)
        add("chest_center", (0.50, 1.00, 0.63), mask=(np.abs(x01 - 0.50) < 0.16) & (z01 > 0.50) & (z01 < 0.74), prefer_front=True)
        add("waist_center", (0.50, 1.00, 0.31), mask=(np.abs(x01 - 0.50) < 0.18) & (z01 > 0.20) & (z01 < 0.42), prefer_front=True)
        add("hem_center", (0.50, 1.00, 0.02), mask=(np.abs(x01 - 0.50) < 0.22) & (z01 < 0.12), prefer_front=True)
    elif category == "lower":
        add("waist_center", (0.50, 1.00, 0.96), mask=(np.abs(x01 - 0.50) < 0.20) & (z01 > 0.82), prefer_front=True)
        add("hip_center", (0.50, 1.00, 0.76), mask=(np.abs(x01 - 0.50) < 0.20) & (z01 > 0.63) & (z01 < 0.86), prefer_front=True)
        add("crotch_center", (0.50, 1.00, 0.50), mask=(np.abs(x01 - 0.50) < 0.16) & (z01 > 0.38) & (z01 < 0.62), prefer_front=True)
        add("left_leg_opening", (0.28, 1.00, 0.02), mask=(x01 < 0.48) & (z01 < 0.12), prefer_front=True)
        add("right_leg_opening", (0.72, 1.00, 0.02), mask=(x01 > 0.52) & (z01 < 0.12), prefer_front=True)
    elif category == "headwear":
        add("head_center", (0.50, 1.00, 0.50), prefer_front=True)
        add("crown_top", (0.50, 0.50, 1.00), mask=z01 > 0.86)
        add("base_center", (0.50, 1.00, 0.03), mask=z01 < 0.16, prefer_front=True)
        add("front_tip", (0.50, 1.00, 0.30), prefer_front=True)
    elif category == "footwear":
        add("sole_center", (0.50, 0.50, 0.02), mask=z01 < 0.12)
        add("toe_center", (0.50, 1.00, 0.25), prefer_front=True)
        add("heel_center", (0.50, 0.00, 0.25), prefer_front=False)
    else:
        add("anchor_center", (0.50, 1.00, 0.50), prefer_front=True)

    # Surface anchors answer “where is the cloth?”. These centerline points answer
    # “where is the internal fitting axis?”. They must remain between opposed
    # surfaces and must not be snapped back to a mesh vertex.
    structural_names: tuple[str, ...]
    if category == "top":
        structural_names = ("center", "neck_center", "chest_center", "waist_center", "hem_center")
    elif category == "lower":
        structural_names = ("center", "waist_center", "hip_center", "crotch_center")
    elif category == "headwear":
        structural_names = ("center", "head_center")
    else:
        structural_names = ("center",)

    for structural_name in structural_names:
        _internalize_landmark(
            structural_name,
            landmarks,
            quality,
            local,
            size,
            method=(
                "neck_boundary_opposed_midpoint"
                if structural_name == "neck_center" and neck_meta.get("candidate_count", 0)
                else "local_opposed_surface_midpoint"
            ),
        )

    confidences = [float(item.get("confidence", 0.0)) for item in quality.values()]
    diagnostics = {
        "method": "surface_and_structural_landmarks_v1.3.5",
        "surface_locked_count": int(sum(1 for item in quality.values() if item.get("surface_locked"))),
        "structural_internal_count": int(sum(1 for item in quality.values() if item.get("landmark_type") == "structural_internal")),
        "structural_landmarks": [
            name for name, item in quality.items()
            if item.get("landmark_type") == "structural_internal"
        ],
        "mean_confidence": float(np.mean(confidences)) if confidences else 0.0,
        "minimum_confidence": float(min(confidences)) if confidences else 0.0,
        "neck_boundary": neck_meta,
    }
    return landmarks, quality, diagnostics

def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _analysis_status(
    category: str,
    overall_confidence: float,
    orientation_confidence: float,
    orientation_ambiguous: bool,
    landmark_confidence: float,
) -> str:
    if category == "unknown" or overall_confidence < 0.45:
        return "incomplete"
    if orientation_ambiguous or orientation_confidence < 0.70:
        return "doubtful"
    if landmark_confidence < 0.62 or overall_confidence < 0.70:
        return "doubtful"
    return "ok"

def _safe_code(template_info: dict[str, Any]) -> str:
    raw = str(template_info.get("code") or template_info.get("name") or "garment")
    return "".join(ch if ch.isalnum() or ch in "-_" else "-" for ch in raw).strip("-") or "garment"


def _axis_quarter_turn_rotation(
    x_quarter_turns: int = 0,
    y_quarter_turns: int = 0,
    z_quarter_turns: int = 0,
) -> np.ndarray:
    """Build the same XYZ Euler correction used by the Three.js garment viewer."""
    ax = (int(x_quarter_turns) % 4) * (math.pi / 2.0)
    ay = (int(y_quarter_turns) % 4) * (math.pi / 2.0)
    az = (int(z_quarter_turns) % 4) * (math.pi / 2.0)

    cx, sx = math.cos(ax), math.sin(ax)
    cy, sy = math.cos(ay), math.sin(ay)
    cz, sz = math.cos(az), math.sin(az)

    rx = np.asarray([[1.0, 0.0, 0.0], [0.0, cx, -sx], [0.0, sx, cx]], dtype=np.float64)
    ry = np.asarray([[cy, 0.0, sy], [0.0, 1.0, 0.0], [-sy, 0.0, cy]], dtype=np.float64)
    rz = np.asarray([[cz, -sz, 0.0], [sz, cz, 0.0], [0.0, 0.0, 1.0]], dtype=np.float64)
    return rz @ ry @ rx


def _quarter_turn_rotation(quarter_turns: int) -> np.ndarray:
    """Backward-compatible Z-axis helper used by older callers."""
    return _axis_quarter_turn_rotation(z_quarter_turns=quarter_turns)


def _validate_manual_review_rotation(
    category: str,
    x_quarter_turns: int,
    y_quarter_turns: int,
    z_quarter_turns: int,
) -> None:
    """Keep manual review separate from semantic up-axis correction.

    The automatic analyzer already resolves the source asset into CLOUVA's
    semantic space (X width, Y depth, Z height).  Manual review may only
    resolve the remaining front/back ambiguity.  In a Z-up space that is a
    180-degree yaw around Z.  X/Y turns tilt or invert the garment and must
    never be persisted as garment semantics.
    """
    x_turns = int(x_quarter_turns) % 4
    y_turns = int(y_quarter_turns) % 4
    z_turns = int(z_quarter_turns) % 4

    if category in {"top", "lower"}:
        if x_turns != 0 or y_turns != 0:
            raise GarmentAnalyzerError(
                "ORIENTACION_MANUAL_INVALIDA: la revisión no puede inclinar ni invertir el eje vertical. "
                "Reanalizá la prenda y usá solamente Dar vuelta frente/espalda."
            )
        if z_turns not in {0, 2}:
            raise GarmentAnalyzerError(
                "ORIENTACION_MANUAL_INVALIDA: para una prenda corporal solo se admite frente normal "
                "o frente invertido 180 grados."
            )

    correction = _axis_quarter_turn_rotation(
        x_quarter_turns=x_turns,
        y_quarter_turns=y_turns,
        z_quarter_turns=z_turns,
    )
    transformed_up = correction @ np.asarray([0.0, 0.0, 1.0], dtype=np.float64)
    if category in {"top", "lower"} and not np.allclose(
        transformed_up,
        np.asarray([0.0, 0.0, 1.0], dtype=np.float64),
        atol=1e-8,
    ):
        raise GarmentAnalyzerError(
            "ORIENTACION_VERTICAL_INVALIDA: la corrección manual cambió el eje de altura."
        )


def _validate_semantic_axis_contract(category: str, size: np.ndarray) -> None:
    """Reject a reviewed orientation that leaves height on the depth axis.

    CLOUVA garment analysis uses X=width, Y=depth and Z=height.  The local
    viewer is also Z-up from v1.3.4 onward, so a top/lower garment whose Y
    span is greater than or equal to its Z span is almost certainly carrying
    a display-space X quarter turn into the semantic contract.
    """
    values = np.asarray(size, dtype=np.float64).reshape(-1)
    if values.size != 3 or not np.isfinite(values).all():
        raise GarmentAnalyzerError("Las medidas semánticas de la prenda no son válidas")

    width, depth, height = (float(values[0]), float(values[1]), float(values[2]))
    if category in {"top", "lower"} and depth >= height:
        raise GarmentAnalyzerError(
            "ORIENTACION_EJES_INVALIDA: el alto quedó sobre el eje de profundidad. "
            "Reanalizá la prenda; la revisión manual no puede modificar el eje vertical."
        )

    if category == "top" and height < width * 0.35:
        raise GarmentAnalyzerError(
            "ORIENTACION_TOP_INVALIDA: la prenda quedó demasiado baja para ser un top. "
            "Reanalizá la prenda antes de aceptar."
        )


def analyze_glb_asset(
    template_glb: Path,
    template_info: dict[str, Any],
    output_dir: Path,
) -> GarmentAnalysisArtifacts:
    output_dir.mkdir(parents=True, exist_ok=True)
    source_sha256 = _sha256(template_glb)
    safe_code = _safe_code(template_info)
    preview_path = output_dir / f"{safe_code}_analyzed.glb"
    analysis_path = output_dir / "garment_analysis.json"
    if analysis_path.is_file() and preview_path.is_file():
        try:
            cached = json.loads(analysis_path.read_text(encoding="utf-8"))
            if (
                cached.get("source", {}).get("sha256") == source_sha256
                and cached.get("version") == "clouva-garment-upright-contract-v1.3.6"
            ):
                return GarmentAnalysisArtifacts(
                    analysis_id=str(cached.get("analysis_id") or uuid.uuid4().hex),
                    preview_glb_path=preview_path,
                    analysis_json_path=analysis_path,
                    analysis=cached,
                )
        except Exception:
            pass

    mesh = _combined_mesh(template_glb)
    vertices = np.asarray(mesh.vertices, dtype=np.float64)
    category, category_confidence, category_source = _category_from_metadata(template_info)

    evaluated: list[tuple[float, np.ndarray, dict[str, Any]]] = []
    categories_to_try = [category] if category != "unknown" else ["top", "lower", "headwear", "footwear", "unknown"]
    for candidate_category in categories_to_try:
        for rotation in _rotation_candidates():
            score, details = _orientation_score(vertices, rotation, candidate_category)
            evaluated.append((
                score,
                rotation,
                {
                    **details,
                    "candidate_category": candidate_category,
                    "source_up_prior_penalty": _source_up_tie_break_penalty(rotation, candidate_category),
                },
            ))
    evaluated.sort(key=lambda item: (round(float(item[0]), 12), float(item[2].get("source_up_prior_penalty", 0.0))))
    best_score, rotation, details = evaluated[0]
    second_score = evaluated[min(1, len(evaluated) - 1)][0]

    if category == "unknown":
        geometry_category, geometry_confidence, geometry_source = _geometry_category(details["size"])
        chosen_candidate = str(details["candidate_category"])
        if chosen_candidate != "unknown":
            category = chosen_candidate
            category_confidence = max(geometry_confidence, 0.48)
            category_source = f"orientation:{chosen_candidate}"
        else:
            category, category_confidence, category_source = geometry_category, geometry_confidence, geometry_source

    local = details["local_vertices"]
    bmin = details["bounds_min"]
    bmax = details["bounds_max"]
    size = details["size"]
    center = (bmin + bmax) * 0.5
    landmarks, landmark_quality, landmark_diagnostics = _landmarks_for_category(
        local,
        np.asarray(mesh.faces, dtype=np.int64),
        category,
    )

    orientation_gap = float(second_score - best_score)
    orientation_confidence = float(np.clip(0.52 + orientation_gap * 0.18, 0.35, 0.98))
    orientation_ambiguous = bool(abs(float(second_score - best_score)) < 1e-6 or orientation_gap < 0.02)
    landmark_confidence = float(landmark_diagnostics.get("mean_confidence", 0.0))
    overall_confidence = float(np.clip(
        category_confidence * 0.42 + orientation_confidence * 0.30 + landmark_confidence * 0.28,
        0.25,
        0.98,
    ))
    component_metrics = _component_metrics(mesh)
    status = _analysis_status(
        category,
        overall_confidence,
        orientation_confidence,
        orientation_ambiguous,
        landmark_confidence,
    )

    # Canonical diagnostic preview: rotate and center the original scene while preserving materials.
    canonical_rotation = np.eye(4, dtype=np.float64)
    canonical_rotation[:3, :3] = rotation
    center_after_rotation = center
    canonical_rotation[:3, 3] = -center_after_rotation
    scene = _load_scene(template_glb)
    scene.apply_transform(canonical_rotation)

    analysis_id = uuid.uuid4().hex
    scene.export(preview_path)

    analysis = {
        "version": "clouva-garment-upright-contract-v1.3.6",
        "analysis_id": analysis_id,
        "source": {
            "sha256": source_sha256,
            "file_name": template_info.get("file_name") or template_glb.name,
            "size_bytes": int(template_glb.stat().st_size),
        },
        "analysis_status": status,
        "template": {
            "asset_key": template_info.get("asset_key"),
            "id": template_info.get("id"),
            "code": template_info.get("code"),
            "name": template_info.get("name"),
            "category": template_info.get("category"),
            "normalized_category": template_info.get("normalized_category"),
            "file_name": template_info.get("file_name"),
        },
        "classification": {
            "category": category,
            "confidence": overall_confidence,
            "source": category_source,
            "fit_strategy": {
                "top": "torso_nonuniform_fit",
                "lower": "pelvis_leg_fit",
                "headwear": "head_rigid_fit",
                "footwear": "feet_rigid_fit",
                "accessory": "semantic_anchor_fit",
                "unknown": "generic_body_anchor_fit",
            }.get(category, "generic_body_anchor_fit"),
        },
        "geometry": {
            "vertex_count": int(len(mesh.vertices)),
            "triangle_count": int(len(mesh.faces)),
            "connected_components": int(component_metrics["raw_count"]),
            "connected_components_raw": int(component_metrics["raw_count"]),
            "connected_components_effective": int(component_metrics["effective_count"]),
            "nearby_components_grouped": bool(component_metrics["nearby_components_grouped"]),
            "largest_component_face_share": float(component_metrics["largest_face_share"]),
            "watertight": bool(mesh.is_watertight),
            "source_bounds_min": vertices.min(axis=0).astype(float).tolist(),
            "source_bounds_max": vertices.max(axis=0).astype(float).tolist(),
            "semantic_bounds_min": bmin.astype(float).tolist(),
            "semantic_bounds_max": bmax.astype(float).tolist(),
            "semantic_size": size.astype(float).tolist(),
        },
        "orientation": {
            "source_to_semantic_rotation": rotation.astype(float).tolist(),
            "selected_score": float(best_score),
            "second_score": float(second_score),
            "confidence": orientation_confidence,
            "candidate_count": int(len(evaluated)),
            "score_gap": orientation_gap,
            "ambiguous": orientation_ambiguous,
            "manual_confirmation_required": bool(orientation_ambiguous or orientation_confidence < 0.70),
            "source_up_prior": "gltf_positive_y",
            "source_up_prior_penalty": float(details.get("source_up_prior_penalty", 0.0)),
            "semantic_up_preserved": bool(float(rotation[2, 1]) > 0.5) if category in {"top", "lower"} else None,
        },
        "landmarks": landmarks,
        "landmark_quality": landmark_quality,
        "landmark_diagnostics": landmark_diagnostics,
        "measurements_relative": {
            "width": float(size[0]),
            "depth": float(size[1]),
            "height": float(size[2]),
            "top_width": float(details["top_width"]),
            "bottom_width": float(details["bottom_width"]),
        },
        "validation": {
            "accepted": False,
            "accepted_at": None,
            "manual_rotation_quarter_turns": 0,
            "category_override": None,
            "orientation_confirmed": False,
            "landmarks_confirmed": False,
            "can_accept": False,
        },
        "readiness": {
            "analysis_ready": True,
            "analysis_accepted": False,
            "universal_fit_ready": False,
            "manual_review_recommended": bool(
                status != "ok"
                or orientation_ambiguous
                or component_metrics["effective_count"] > 3
            ),
        },
        "warnings": [
            *(["LOW_CLASSIFICATION_CONFIDENCE"] if overall_confidence < 0.70 else []),
            *(["ORIENTATION_AMBIGUOUS_MANUAL_CONFIRMATION_REQUIRED"] if orientation_ambiguous else []),
            *(["ORIENTATION_LOW_CONFIDENCE"] if orientation_confidence < 0.70 else []),
            *(["MANY_RAW_COMPONENTS_GROUPED_FOR_ANALYSIS"] if component_metrics["nearby_components_grouped"] else []),
            *(["LANDMARKS_REQUIRE_VISUAL_REVIEW"] if landmark_confidence < 0.72 else []),
        ],
        "asset_paths": {
            "preview_glb": preview_path.name,
            "analysis_json": analysis_path.name,
        },
    }
    analysis_path.write_text(json.dumps(analysis, ensure_ascii=False, indent=2), encoding="utf-8")
    return GarmentAnalysisArtifacts(
        analysis_id=analysis_id,
        preview_glb_path=preview_path,
        analysis_json_path=analysis_path,
        analysis=analysis,
    )


def accept_garment_analysis(
    template_glb: Path,
    template_info: dict[str, Any],
    analysis: dict[str, Any],
    output_dir: Path,
    quarter_turns: int = 0,
    rotation_x_quarter_turns: int = 0,
    rotation_y_quarter_turns: int = 0,
    rotation_z_quarter_turns: int | None = None,
    category_override: str | None = None,
    orientation_confirmed: bool = False,
    landmarks_confirmed: bool = False,
) -> GarmentAnalysisArtifacts:
    if not orientation_confirmed:
        raise GarmentAnalyzerError("Confirmá arriba y frente antes de aceptar el análisis")
    if not landmarks_confirmed:
        raise GarmentAnalyzerError("Revisá cuello, hombros y landmarks antes de aceptar")
    output_dir.mkdir(parents=True, exist_ok=True)
    mesh = _combined_mesh(template_glb)
    vertices = np.asarray(mesh.vertices, dtype=np.float64)
    base_rotation = np.asarray(analysis.get("orientation", {}).get("source_to_semantic_rotation"), dtype=np.float64)
    if base_rotation.shape != (3, 3):
        base_rotation = np.eye(3, dtype=np.float64)
    resolved_z_turns = int(quarter_turns) if rotation_z_quarter_turns is None else int(rotation_z_quarter_turns)
    category = str(category_override or analysis.get("classification", {}).get("category") or "unknown").strip().lower()
    if category not in {"top", "lower", "headwear", "footwear", "accessory", "unknown"}:
        raise GarmentAnalyzerError(f"Categoría no soportada: {category}")
    _validate_manual_review_rotation(
        category,
        rotation_x_quarter_turns,
        rotation_y_quarter_turns,
        resolved_z_turns,
    )
    correction = _axis_quarter_turn_rotation(
        x_quarter_turns=rotation_x_quarter_turns,
        y_quarter_turns=rotation_y_quarter_turns,
        z_quarter_turns=resolved_z_turns,
    )
    rotation = correction @ base_rotation
    local = vertices @ rotation.T
    bmin = local.min(axis=0)
    bmax = local.max(axis=0)
    size = np.maximum(bmax - bmin, 1e-9)
    center = (bmin + bmax) * 0.5

    _validate_semantic_axis_contract(category, size)

    accepted = copy.deepcopy(analysis)
    accepted["version"] = "clouva-garment-upright-contract-v1.3.6"
    accepted["analysis_status"] = "ok"
    accepted["classification"]["category"] = category
    accepted["classification"]["fit_strategy"] = {
        "top": "torso_nonuniform_fit",
        "lower": "pelvis_leg_fit",
        "headwear": "head_rigid_fit",
        "footwear": "feet_rigid_fit",
        "accessory": "semantic_anchor_fit",
        "unknown": "generic_body_anchor_fit",
    }.get(category, "generic_body_anchor_fit")
    accepted["geometry"]["semantic_bounds_min"] = bmin.astype(float).tolist()
    accepted["geometry"]["semantic_bounds_max"] = bmax.astype(float).tolist()
    accepted["geometry"]["semantic_size"] = size.astype(float).tolist()
    accepted["orientation"]["source_to_semantic_rotation"] = rotation.astype(float).tolist()
    accepted["orientation"]["manual_rotation_quarter_turns"] = int(resolved_z_turns) % 4
    accepted["orientation"]["manual_rotation_quarter_turns_xyz"] = {
        "x": int(rotation_x_quarter_turns) % 4,
        "y": int(rotation_y_quarter_turns) % 4,
        "z": int(resolved_z_turns) % 4,
    }
    accepted["orientation"]["manual_review_mode"] = "z_up_front_back_yaw_only"
    accepted_landmarks, accepted_quality, accepted_diagnostics = _landmarks_for_category(
        local,
        np.asarray(mesh.faces, dtype=np.int64),
        category,
    )
    accepted["landmarks"] = accepted_landmarks
    accepted["landmark_quality"] = accepted_quality
    accepted["landmark_diagnostics"] = accepted_diagnostics
    accepted["measurements_relative"].update({
        "width": float(size[0]),
        "depth": float(size[1]),
        "height": float(size[2]),
    })
    accepted["validation"] = {
        "accepted": True,
        "accepted_at": "local-workspace",
        "manual_rotation_quarter_turns": int(resolved_z_turns) % 4,
        "manual_rotation_quarter_turns_xyz": {
            "x": int(rotation_x_quarter_turns) % 4,
            "y": int(rotation_y_quarter_turns) % 4,
            "z": int(resolved_z_turns) % 4,
        },
        "category_override": category_override or None,
        "orientation_confirmed": True,
        "landmarks_confirmed": True,
        "can_accept": True,
    }
    accepted["orientation"]["manual_confirmation_required"] = False
    accepted["orientation"]["manual_confirmed"] = True
    accepted["readiness"] = {
        "analysis_ready": True,
        "analysis_accepted": True,
        "universal_fit_ready": True,
        "manual_review_recommended": False,
    }
    accepted["warnings"] = [
        warning for warning in accepted.get("warnings", [])
        if warning not in {
            "LOW_CLASSIFICATION_CONFIDENCE",
            "ORIENTATION_AMBIGUOUS_MANUAL_CONFIRMATION_REQUIRED",
            "ORIENTATION_LOW_CONFIDENCE",
            "LANDMARKS_REQUIRE_VISUAL_REVIEW",
        }
    ]

    transform = np.eye(4, dtype=np.float64)
    transform[:3, :3] = rotation
    transform[:3, 3] = -center
    scene = _load_scene(template_glb)
    scene.apply_transform(transform)

    safe_code = _safe_code(template_info)
    preview_path = output_dir / f"{safe_code}_accepted.glb"
    analysis_path = output_dir / "garment_analysis_accepted.json"
    scene.export(preview_path)
    accepted["asset_paths"] = {
        "preview_glb": preview_path.name,
        "analysis_json": analysis_path.name,
    }
    analysis_path.write_text(json.dumps(accepted, ensure_ascii=False, indent=2), encoding="utf-8")
    return GarmentAnalysisArtifacts(
        analysis_id=str(accepted.get("analysis_id") or uuid.uuid4().hex),
        preview_glb_path=preview_path,
        analysis_json_path=analysis_path,
        analysis=accepted,
    )


def _matrix_from_json(value: Any, fallback: np.ndarray | None = None) -> np.ndarray:
    try:
        matrix = np.asarray(value, dtype=np.float64)
        if matrix.shape == (4, 4) and np.isfinite(matrix).all():
            return matrix
    except Exception:
        pass
    return np.eye(4, dtype=np.float64) if fallback is None else fallback


def _transform_points(points: np.ndarray, matrix: np.ndarray) -> np.ndarray:
    hom = np.ones((len(points), 4), dtype=np.float64)
    hom[:, :3] = points
    return (matrix @ hom.T).T[:, :3]


def _source_bounds_canonical(run_result: dict[str, Any], source_to_canonical: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    source = run_result.get("source") if isinstance(run_result.get("source"), dict) else {}
    bmin = np.asarray(source.get("bounds_min", [-0.5, 0.0, -0.2]), dtype=np.float64)
    bmax = np.asarray(source.get("bounds_max", [0.5, 1.8, 0.2]), dtype=np.float64)
    corners = np.asarray([
        [x, y, z]
        for x in (bmin[0], bmax[0])
        for y in (bmin[1], bmax[1])
        for z in (bmin[2], bmax[2])
    ], dtype=np.float64)
    canonical = _transform_points(corners, source_to_canonical)
    return canonical.min(axis=0), canonical.max(axis=0)


def _anchor_points_canonical(run_result: dict[str, Any], source_to_canonical: np.ndarray) -> dict[str, np.ndarray]:
    items: list[dict[str, Any]] = []
    for key in ("garment_anchors", "landmarks", "internal_joints"):
        value = run_result.get(key)
        if isinstance(value, list):
            items.extend(item for item in value if isinstance(item, dict))
    out: dict[str, np.ndarray] = {}
    for item in items:
        name = str(item.get("name") or "").strip().lower()
        raw = item.get("source_position") or item.get("position")
        if not name or not isinstance(raw, (list, tuple)) or len(raw) != 3:
            continue
        point = _transform_points(np.asarray([raw], dtype=np.float64), source_to_canonical)[0]
        out.setdefault(name, point)
    return out


def _mean_existing(points: dict[str, np.ndarray], names: tuple[str, ...], fallback: np.ndarray) -> np.ndarray:
    found = [points[name] for name in names if name in points]
    if not found:
        return fallback.copy()
    return np.mean(np.stack(found), axis=0)


def _depth_envelope(
    points: dict[str, np.ndarray],
    names: tuple[str, ...],
) -> tuple[float, float] | None:
    """Return the observed canonical depth interval for a body region.

    Section ellipses are useful for measurements, but their reconstructed center
    and depth can miss pose-dependent extrema. Garment anchors are already locked
    to the visible front/back surfaces, so they are the safer source for fitting.
    """
    depths = [float(points[name][1]) for name in names if name in points]
    if len(depths) < 2:
        return None
    low = min(depths)
    high = max(depths)
    if not math.isfinite(low) or not math.isfinite(high) or high <= low:
        return None
    return low, high


def _joint_points_canonical(
    run_result: dict[str, Any],
    source_to_canonical: np.ndarray,
) -> dict[str, np.ndarray]:
    out: dict[str, np.ndarray] = {}
    for item in run_result.get("internal_joints", []) or []:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip().lower()
        raw = item.get("source_position") or item.get("position")
        if not name or not isinstance(raw, (list, tuple)) or len(raw) != 3:
            continue
        out[name] = _transform_points(np.asarray([raw], dtype=np.float64), source_to_canonical)[0]
    return out


def _rotation_between(source: np.ndarray, target: np.ndarray) -> np.ndarray:
    source = np.asarray(source, dtype=np.float64)
    target = np.asarray(target, dtype=np.float64)
    source /= max(float(np.linalg.norm(source)), 1e-9)
    target /= max(float(np.linalg.norm(target)), 1e-9)
    cross = np.cross(source, target)
    sine = float(np.linalg.norm(cross))
    cosine = float(np.clip(np.dot(source, target), -1.0, 1.0))
    if sine < 1e-9:
        if cosine > 0.0:
            return np.eye(3, dtype=np.float64)
        axis = np.array([0.0, 0.0, 1.0], dtype=np.float64)
        if abs(float(np.dot(axis, source))) > 0.9:
            axis = np.array([0.0, 1.0, 0.0], dtype=np.float64)
        axis -= source * float(np.dot(axis, source))
        axis /= max(float(np.linalg.norm(axis)), 1e-9)
        return -np.eye(3, dtype=np.float64) + 2.0 * np.outer(axis, axis)
    axis = cross / sine
    skew = np.array([
        [0.0, -axis[2], axis[1]],
        [axis[2], 0.0, -axis[0]],
        [-axis[1], axis[0], 0.0],
    ], dtype=np.float64)
    return np.eye(3, dtype=np.float64) + skew * sine + (skew @ skew) * (1.0 - cosine)


def _validated_arm_targets(
    run_result: dict[str, Any],
    target: dict[str, Any],
) -> dict[str, dict[str, np.ndarray]]:
    joints = _joint_points_canonical(run_result, target["source_to_canonical"])
    chest = np.asarray(target["center"], dtype=np.float64)
    geometry_to_meters = float(target["geometry_to_meters"])
    shoulder_half = (
        _measurement_cm(run_result, "shoulder_width", 24.0)
        * 0.005
        / max(geometry_to_meters, 1e-9)
    )
    left = joints.get("left_shoulder")
    right = joints.get("right_shoulder")
    measured_span = abs(float(right[0] - left[0])) if left is not None and right is not None else 0.0
    expected_span = shoulder_half * 2.0
    synthesize_x = measured_span < expected_span * 0.72 or measured_span > expected_span * 1.45
    shoulder_depth = chest[1]
    shoulder_z = chest[2] + target["dimensions"][2] * 0.30
    fit_mode = str(target.get("fit_mode") or "oversized")
    sleeve_ease_m = {"base": 0.006, "regular": 0.012, "oversized": 0.020}.get(fit_mode, 0.020)

    result: dict[str, dict[str, np.ndarray]] = {}
    for side, sign in (("left", -1.0), ("right", 1.0)):
        detected_shoulder = joints.get(f"{side}_shoulder")
        detected_elbow = joints.get(f"{side}_elbow")
        if detected_shoulder is None:
            detected_shoulder = np.array([chest[0] + sign * shoulder_half, shoulder_depth, shoulder_z])
        shoulder = np.asarray(detected_shoulder, dtype=np.float64).copy()
        if synthesize_x or sign * float(shoulder[0] - chest[0]) <= shoulder_half * 0.55:
            shoulder[0] = chest[0] + sign * shoulder_half
        if abs(float(shoulder[1] - shoulder_depth)) > target["dimensions"][1] * 0.34:
            shoulder[1] = shoulder_depth
        if detected_elbow is None:
            detected_elbow = shoulder + np.array([sign * 0.17, 0.0, -0.22], dtype=np.float64)
        elbow = np.asarray(detected_elbow, dtype=np.float64)
        direction = elbow - shoulder
        if float(np.linalg.norm(direction)) < 1e-6:
            direction = np.array([sign, 0.0, -1.0], dtype=np.float64)
        direction /= max(float(np.linalg.norm(direction)), 1e-9)
        bicep_circumference_cm = _measurement_cm(
            run_result,
            f"{side}_bicep_circumference",
            30.0,
        )
        body_radius = bicep_circumference_cm * 0.01 / (2.0 * math.pi * max(geometry_to_meters, 1e-9))
        sleeve_radius = body_radius + sleeve_ease_m / max(geometry_to_meters, 1e-9)
        result[side] = {
            "shoulder": shoulder,
            "elbow": elbow,
            "direction": direction,
            "sleeve_radius": np.asarray(sleeve_radius, dtype=np.float64),
        }
    return result


def _warp_top_sleeves(
    canonical_vertices: np.ndarray,
    semantic_vertices: np.ndarray,
    semantic_bounds_min: np.ndarray,
    semantic_bounds_max: np.ndarray,
    arm_targets: dict[str, dict[str, np.ndarray]],
) -> tuple[np.ndarray, dict[str, Any]]:
    result = np.asarray(canonical_vertices, dtype=np.float64).copy()
    bounds_min = np.asarray(semantic_bounds_min, dtype=np.float64)
    bounds_max = np.asarray(semantic_bounds_max, dtype=np.float64)
    center = (bounds_min + bounds_max) * 0.5
    size = np.maximum(bounds_max - bounds_min, 1e-9)
    half_width = size[0] * 0.5
    absx01 = np.abs(semantic_vertices[:, 0] - center[0]) / half_width
    z01 = (semantic_vertices[:, 2] - bounds_min[2]) / size[2]
    side_weight = np.clip((absx01 - 0.43) / 0.34, 0.0, 1.0)
    side_weight = side_weight * side_weight * (3.0 - 2.0 * side_weight)
    upper_weight = np.clip((z01 - 0.34) / 0.18, 0.0, 1.0)
    upper_weight = upper_weight * upper_weight * (3.0 - 2.0 * upper_weight)
    sleeve_weight = side_weight * upper_weight
    report: dict[str, Any] = {"method": "validated_shoulder_to_elbow_sleeve_warp", "sides": {}}

    for side, sign in (("left", -1.0), ("right", 1.0)):
        side_mask = (semantic_vertices[:, 0] - center[0]) * sign > 0.0
        weight = sleeve_weight * side_mask.astype(np.float64)
        target = arm_targets[side]

        # The reference garment is not guaranteed to be authored in a strict
        # T-pose.  This shirt, for example, already has diagonally descending
        # sleeves.  Rotating from a synthetic horizontal axis bends that
        # diagonal a second time and folds the sleeve into the shoulder.  Find
        # the real root-to-cuff axis in the accepted semantic geometry instead.
        sleeve_candidates = side_mask & (absx01 > 0.42) & (z01 > 0.30)
        root_candidates = sleeve_candidates & (absx01 >= 0.42) & (absx01 <= 0.61) & (z01 > 0.52)
        tip_candidates = sleeve_candidates & (absx01 >= 0.82)
        if int(np.sum(root_candidates)) >= 4 and int(np.sum(tip_candidates)) >= 4:
            source_pivot = np.median(result[root_candidates], axis=0)
            source_tip = np.median(result[tip_candidates], axis=0)
            source_direction = source_tip - source_pivot
        else:
            source_pivot = np.asarray(target["shoulder"], dtype=np.float64)
            source_direction = np.array([sign, 0.0, -0.35], dtype=np.float64)
        if sign * float(source_direction[0]) <= 1e-5 or float(np.linalg.norm(source_direction)) < 1e-6:
            source_direction = np.array([sign, 0.0, -0.35], dtype=np.float64)
        source_direction /= max(float(np.linalg.norm(source_direction)), 1e-9)
        rotation = _rotation_between(source_direction, target["direction"])
        pivot = np.asarray(target["shoulder"], dtype=np.float64)
        rotated = pivot[None, :] + (result - source_pivot[None, :]) @ rotation.T
        relative = rotated - pivot[None, :]
        axial = relative @ target["direction"]
        axis_points = pivot[None, :] + axial[:, None] * target["direction"][None, :]
        radial = rotated - axis_points
        radial_length = np.linalg.norm(radial, axis=1)
        fallback_radial = np.cross(
            np.broadcast_to(target["direction"], radial.shape),
            np.broadcast_to(np.array([0.0, 0.0, 1.0], dtype=np.float64), radial.shape),
        )
        fallback_length = np.linalg.norm(fallback_radial, axis=1)
        fallback_radial[fallback_length > 1e-9] /= fallback_length[fallback_length > 1e-9, None]
        radial_unit = np.zeros_like(radial)
        valid_radial = radial_length > 1e-9
        radial_unit[valid_radial] = radial[valid_radial] / radial_length[valid_radial, None]
        radial_unit[~valid_radial] = fallback_radial[~valid_radial]
        target_radius = float(target["sleeve_radius"])
        expanded_radius = np.maximum(radial_length, target_radius)
        rotated = axis_points + radial_unit * expanded_radius[:, None]
        result = result + (rotated - result) * weight[:, None]
        report["sides"][side] = {
            "shoulder_canonical": pivot.astype(float).tolist(),
            "elbow_canonical": target["elbow"].astype(float).tolist(),
            "direction_canonical": target["direction"].astype(float).tolist(),
            "source_direction_canonical": source_direction.astype(float).tolist(),
            "source_sleeve_root_canonical": source_pivot.astype(float).tolist(),
            "minimum_sleeve_radius_cm": float(target_radius * 100.0),
            "affected_vertices": int(np.sum(weight > 0.01)),
            "fully_warped_vertices": int(np.sum(weight > 0.95)),
        }
    return result, report


def _build_fitted_scene(
    template_glb: Path,
    analysis: dict[str, Any],
    target: dict[str, Any],
    semantic_center: np.ndarray,
    scales: np.ndarray,
    rotation: np.ndarray,
) -> tuple[trimesh.Scene, np.ndarray, dict[str, Any] | None]:
    source_scene = _load_scene(template_glb)
    fitted_scene = trimesh.Scene()
    fitted_chunks: list[np.ndarray] = []
    category = str(analysis.get("classification", {}).get("category") or "unknown")
    arm_targets = _validated_arm_targets(target["run_result"], target) if category == "top" else None
    sleeve_report: dict[str, Any] | None = None

    for index, node in enumerate(source_scene.graph.nodes_geometry):
        node_transform, geometry_name = source_scene.graph.get(node)
        source_mesh = source_scene.geometry[geometry_name]
        source_vertices = _transform_points(
            np.asarray(source_mesh.vertices, dtype=np.float64),
            np.asarray(node_transform, dtype=np.float64),
        )
        semantic_vertices = (rotation @ source_vertices.T).T
        canonical_vertices = (
            np.asarray(target["center"], dtype=np.float64)[None, :]
            + (semantic_vertices - semantic_center[None, :]) * scales[None, :]
        )
        if arm_targets is not None:
            canonical_vertices, current_report = _warp_top_sleeves(
                canonical_vertices,
                semantic_vertices,
                np.asarray(analysis["geometry"]["semantic_bounds_min"], dtype=np.float64),
                np.asarray(analysis["geometry"]["semantic_bounds_max"], dtype=np.float64),
                arm_targets,
            )
            if sleeve_report is None:
                sleeve_report = current_report
            else:
                for side in ("left", "right"):
                    sleeve_report["sides"][side]["affected_vertices"] += current_report["sides"][side]["affected_vertices"]
                    sleeve_report["sides"][side]["fully_warped_vertices"] += current_report["sides"][side]["fully_warped_vertices"]
        output_vertices = _transform_points(canonical_vertices, target["canonical_to_source"])
        fitted_mesh = source_mesh.copy()
        fitted_mesh.vertices = output_vertices
        fitted_scene.add_geometry(
            fitted_mesh,
            node_name=f"{node}-fitted-{index}",
            geom_name=f"{geometry_name}-fitted-{index}",
        )
        fitted_chunks.append(output_vertices)
    return fitted_scene, np.vstack(fitted_chunks), sleeve_report


def _measurement_cm(run_result: dict[str, Any], key: str, default: float) -> float:
    measurements = run_result.get("body_measurements") if isinstance(run_result.get("body_measurements"), dict) else {}
    values = measurements.get("values") if isinstance(measurements.get("values"), dict) else {}
    item = values.get(key)
    if isinstance(item, dict):
        value = item.get("value_cm")
        if isinstance(value, (int, float)) and math.isfinite(float(value)):
            return float(value)
    return float(default)


def _section_cm(run_result: dict[str, Any], section: str, field: str, default: float) -> float:
    measurements = run_result.get("body_measurements") if isinstance(run_result.get("body_measurements"), dict) else {}
    sections = measurements.get("sections") if isinstance(measurements.get("sections"), dict) else {}
    item = sections.get(section) if isinstance(sections.get(section), dict) else {}
    value = item.get(field)
    if isinstance(value, (int, float)) and math.isfinite(float(value)):
        return float(value)
    return float(default)


def _geometry_to_meters(run_result: dict[str, Any]) -> float:
    measurements = run_result.get("body_measurements") if isinstance(run_result.get("body_measurements"), dict) else {}
    scale = measurements.get("scale") if isinstance(measurements.get("scale"), dict) else {}
    value = scale.get("geometry_to_meters")
    if isinstance(value, (int, float)) and float(value) > 0:
        return float(value)
    return 1.0


def _target_region(
    run_result: dict[str, Any],
    analysis: dict[str, Any],
    fit_mode: str,
) -> dict[str, Any]:
    canonical_space = run_result.get("canonical_space") if isinstance(run_result.get("canonical_space"), dict) else {}
    source_to_canonical = _matrix_from_json(canonical_space.get("source_to_canonical_matrix"))
    canonical_to_source = _matrix_from_json(canonical_space.get("canonical_to_source_matrix"), np.linalg.inv(source_to_canonical))
    body_min, body_max = _source_bounds_canonical(run_result, source_to_canonical)
    body_size = np.maximum(body_max - body_min, 1e-9)
    body_center = (body_min + body_max) * 0.5
    anchors = _anchor_points_canonical(run_result, source_to_canonical)
    geometry_to_meters = _geometry_to_meters(run_result)
    cm_to_geometry = 0.01 / max(geometry_to_meters, 1e-9)
    multiplier = FIT_MULTIPLIERS.get(fit_mode, FIT_MULTIPLIERS["oversized"])
    category = str(analysis.get("classification", {}).get("category") or "unknown")

    neck_fallback = np.array([body_center[0], body_center[1], body_min[2] + body_size[2] * 0.77])
    chest_fallback = np.array([body_center[0], body_center[1], body_min[2] + body_size[2] * 0.63])
    waist_fallback = np.array([body_center[0], body_center[1], body_min[2] + body_size[2] * 0.49])
    hip_fallback = np.array([body_center[0], body_center[1], body_min[2] + body_size[2] * 0.43])
    ankle_fallback = np.array([body_center[0], body_center[1], body_min[2] + body_size[2] * 0.07])

    neck = _mean_existing(anchors, ("neck_base_front", "neck_base_back", "neck_front", "neck_back"), neck_fallback)
    chest = _mean_existing(anchors, ("chest_center", "back_center", "chest_front", "chest_back"), chest_fallback)
    waist = _mean_existing(anchors, ("waist_front", "waist_back", "waist_center"), waist_fallback)
    hip = _mean_existing(anchors, ("left_hip", "right_hip", "hip_left", "hip_right"), hip_fallback)
    ankle = _mean_existing(anchors, ("left_ankle", "right_ankle"), ankle_fallback)

    if category == "top":
        shoulder_cm = _measurement_cm(run_result, "shoulder_width", 24.0)
        chest_width_cm = _section_cm(run_result, "chest", "width_cm", 24.0)
        width_cm = max(shoulder_cm * 1.72, chest_width_cm * 1.38) * multiplier
        measured_depth = max(
            _section_cm(run_result, "chest", "depth_cm", 16.0),
            _section_cm(run_result, "waist", "depth_cm", 16.0),
        ) * cm_to_geometry
        torso_depth = _depth_envelope(
            anchors,
            (
                "neck_base_front", "neck_base_back",
                "neck_front", "neck_back",
                "chest_center", "back_center", "chest_front", "chest_back",
                "waist_front", "waist_back", "waist_center",
            ),
        )
        observed_depth = measured_depth
        if torso_depth is not None:
            observed_depth = max(observed_depth, torso_depth[1] - torso_depth[0])
            depth_center = (torso_depth[0] + torso_depth[1]) * 0.5
        else:
            depth_center = chest[1]
        # Rigid template fitting cannot follow every local torso extremum. Keep a
        # pose allowance before adding the requested ease so both the front and
        # back surfaces remain outside the body instead of cutting through it.
        ease_cm = {"base": 0.4, "regular": 1.2, "oversized": 2.4}.get(fit_mode, 2.4)
        depth = observed_depth * 1.12 + ease_cm * cm_to_geometry
        top_z = neck[2] + 1.0 * cm_to_geometry
        bottom_z = max(hip[2], waist[2] - 8.0 * cm_to_geometry)
        height = max(top_z - bottom_z, 30.0 * cm_to_geometry)
        center = np.array([chest[0], depth_center, (top_z + bottom_z) * 0.5], dtype=np.float64)
        dims = np.array([width_cm * cm_to_geometry, depth, height], dtype=np.float64)
        anchor_name = "torso"
    elif category == "lower":
        width_cm = max(_section_cm(run_result, "hip", "width_cm", 26.0), _section_cm(run_result, "waist", "width_cm", 23.0)) * multiplier
        depth_cm = max(_section_cm(run_result, "hip", "depth_cm", 18.0), _section_cm(run_result, "waist", "depth_cm", 16.0)) * (1.02 + (multiplier - 1.0) * 0.35)
        top_z = waist[2] + 2.0 * cm_to_geometry
        bottom_z = ankle[2]
        center = np.array([hip[0], hip[1], (top_z + bottom_z) * 0.5], dtype=np.float64)
        dims = np.array([width_cm * cm_to_geometry, depth_cm * cm_to_geometry, max(top_z - bottom_z, 35.0 * cm_to_geometry)], dtype=np.float64)
        anchor_name = "pelvis_legs"
    elif category == "headwear":
        face_points = [point for name, point in anchors.items() if name.startswith("face_") or name in {"forehead", "chin", "left_ear", "right_ear"}]
        if face_points:
            fp = np.stack(face_points)
            hmin, hmax = fp.min(axis=0), fp.max(axis=0)
            center = (hmin + hmax) * 0.5
            dims = np.maximum(hmax - hmin, np.array([0.14, 0.14, 0.20])) * np.array([1.20, 1.20, 0.85])
            center[2] = hmax[2] - dims[2] * 0.20
        else:
            center = np.array([body_center[0], body_center[1], body_min[2] + body_size[2] * 0.90])
            dims = np.array([body_size[0] * 0.30, body_size[1] * 0.75, body_size[2] * 0.18])
        anchor_name = "head"
    elif category == "footwear":
        center = np.array([body_center[0], body_center[1], body_min[2] + body_size[2] * 0.035])
        dims = np.array([body_size[0] * 0.50, body_size[1] * 1.25, body_size[2] * 0.10])
        anchor_name = "feet"
    elif category == "accessory":
        text = _text_blob(analysis.get("template", {}))
        if any(word in text for word in ("gorra", "hat", "cap", "beanie", "aro", "earring")):
            center = np.array([body_center[0], body_center[1], body_min[2] + body_size[2] * 0.88])
            dims = np.array([body_size[0] * 0.26, body_size[1] * 0.60, body_size[2] * 0.16])
            anchor_name = "head_accessory"
        elif any(word in text for word in ("cadena", "chain", "collar", "necklace")):
            center = neck * 0.55 + chest * 0.45
            dims = np.array([body_size[0] * 0.24, body_size[1] * 0.80, body_size[2] * 0.17])
            anchor_name = "neck_chest_accessory"
        else:
            center = chest.copy()
            dims = np.array([body_size[0] * 0.30, body_size[1] * 0.80, body_size[2] * 0.28])
            anchor_name = "torso_accessory"
    else:
        center = chest.copy()
        dims = np.array([body_size[0] * 0.42, body_size[1] * 0.90, body_size[2] * 0.32])
        anchor_name = "generic_body"

    return {
        "category": category,
        "anchor_name": anchor_name,
        "center": center,
        "dimensions": np.maximum(dims, 1e-6),
        "source_to_canonical": source_to_canonical,
        "canonical_to_source": canonical_to_source,
        "body_bounds_min": body_min,
        "body_bounds_max": body_max,
        "geometry_to_meters": geometry_to_meters,
        "fit_mode": fit_mode,
        "run_result": run_result,
    }


def _avatar_vertices(path: Path | None) -> np.ndarray:
    if not path or not path.is_file():
        return np.zeros((0, 3), dtype=np.float64)
    try:
        return np.asarray(_combined_mesh(path).vertices, dtype=np.float64)
    except Exception:
        return np.zeros((0, 3), dtype=np.float64)


def _nearest_distances(vertices: np.ndarray, body_vertices: np.ndarray, limit: int = 1600) -> dict[str, Any]:
    if len(vertices) == 0 or len(body_vertices) == 0:
        return {"available": False, "sample_count": 0, "minimum_cm": 0.0, "median_cm": 0.0}
    if len(vertices) > limit:
        idx = np.linspace(0, len(vertices) - 1, limit).astype(np.int64)
        sample = vertices[idx]
    else:
        sample = vertices
    tree = cKDTree(np.asarray(body_vertices, dtype=np.float64))
    data, _ = tree.query(np.asarray(sample, dtype=np.float64), k=1, workers=-1)
    data = np.asarray(data, dtype=np.float64)
    return {
        "available": True,
        "sample_count": int(len(data)),
        "minimum_cm": float(data.min() * 100.0),
        "median_cm": float(np.median(data) * 100.0),
    }


def fit_analyzed_glb_to_avatar(
    run_result: dict[str, Any],
    template_info: dict[str, Any],
    template_glb: Path,
    avatar_glb: Path | None,
    output_dir: Path,
    fit_mode: str = "oversized",
    analysis_override: dict[str, Any] | None = None,
) -> UniversalFitArtifacts:
    if fit_mode not in FIT_MULTIPLIERS:
        raise GarmentAnalyzerError(f"Calce no soportado: {fit_mode}")
    output_dir.mkdir(parents=True, exist_ok=True)
    if analysis_override is None:
        raise GarmentAnalyzerError("Primero analizá y aceptá la prenda en el visor separado")
    analysis = copy.deepcopy(analysis_override)
    if not analysis.get("readiness", {}).get("analysis_accepted"):
        raise GarmentAnalyzerError("El análisis de la prenda todavía no fue aceptado")
    target = _target_region(run_result, analysis, fit_mode)

    semantic_size = np.asarray(analysis["geometry"]["semantic_size"], dtype=np.float64)
    semantic_bounds_min = np.asarray(analysis["geometry"]["semantic_bounds_min"], dtype=np.float64)
    semantic_bounds_max = np.asarray(analysis["geometry"]["semantic_bounds_max"], dtype=np.float64)
    semantic_center = (semantic_bounds_min + semantic_bounds_max) * 0.5
    rotation = np.asarray(analysis["orientation"]["source_to_semantic_rotation"], dtype=np.float64)
    target_dims = np.asarray(target["dimensions"], dtype=np.float64)

    raw_scales = target_dims / np.maximum(semantic_size, 1e-9)
    geometric = float(np.exp(np.mean(np.log(np.maximum(raw_scales, 1e-9)))))
    scales = np.clip(raw_scales, geometric * 0.32, geometric * 3.20)

    semantic_transform = np.eye(4, dtype=np.float64)
    semantic_transform[:3, :3] = np.diag(scales) @ rotation
    semantic_transform[:3, 3] = np.asarray(target["center"], dtype=np.float64) - np.diag(scales) @ semantic_center
    final_matrix = np.asarray(target["canonical_to_source"], dtype=np.float64) @ semantic_transform

    scene, fitted_vertices, sleeve_alignment = _build_fitted_scene(
        template_glb,
        analysis,
        target,
        semantic_center,
        scales,
        rotation,
    )
    safe_code = "".join(ch if ch.isalnum() or ch in "-_" else "-" for ch in str(template_info.get("code") or template_info.get("name") or "garment")).strip("-") or "garment"
    glb_path = output_dir / f"{safe_code}_universal_fitted.glb"
    fit_json_path = output_dir / "universal_fit.json"
    collision_json_path = output_dir / "universal_collision_report.json"
    analysis_json_path = output_dir / "garment_analysis.json"
    scene.export(glb_path)
    analysis_json_path.write_text(json.dumps(analysis, ensure_ascii=False, indent=2), encoding="utf-8")

    clearance = _nearest_distances(fitted_vertices, _avatar_vertices(avatar_glb))
    fit_id = uuid.uuid4().hex
    fit_json = {
        "version": "clouva-universal-avatar-fit-engine-v1.3.1",
        "fit_id": fit_id,
        "run_id": run_result.get("run_id"),
        "template": analysis.get("template"),
        "analysis": analysis,
        "fit": {
            "mode": fit_mode,
            "strategy": analysis.get("classification", {}).get("fit_strategy"),
            "target_anchor": target["anchor_name"],
            "target_center_canonical": np.asarray(target["center"]).astype(float).tolist(),
            "target_dimensions_canonical": target_dims.astype(float).tolist(),
            "scale_xyz": scales.astype(float).tolist(),
            "source_to_avatar_matrix": final_matrix.astype(float).tolist(),
            "nonlinear_sleeve_alignment": sleeve_alignment,
        },
        "clearance": clearance,
        "readiness": {
            "analysis_ready": True,
            "analysis_accepted": True,
            "universal_fit_ready": True,
            "preview_ready": True,
            "manual_review_recommended": bool(
                analysis.get("readiness", {}).get("manual_review_recommended")
                or (clearance.get("available") and clearance.get("minimum_cm", 0.0) < 0.35)
            ),
        },
        "warnings": [],
        "asset_paths": {
            "glb": glb_path.name,
            "fit_json": fit_json_path.name,
            "analysis_json": analysis_json_path.name,
            "collision_json": collision_json_path.name,
        },
    }
    if fit_json["readiness"]["manual_review_recommended"]:
        fit_json["warnings"].append("UNIVERSAL_FIT_REVIEW_RECOMMENDED")
    if analysis.get("classification", {}).get("category") == "unknown":
        fit_json["warnings"].append("GENERIC_FALLBACK_ANCHOR_USED")

    collision_report = {
        "version": "clouva-universal-collision-report-v1.3.1",
        "fit_id": fit_id,
        "category": analysis.get("classification", {}).get("category"),
        "clearance": clearance,
        "status": "review_required" if fit_json["readiness"]["manual_review_recommended"] else "ok",
        "limitations": [
            "La adaptación universal usa análisis geométrico y transformación no uniforme; no reemplaza todavía una simulación de tela.",
            "GLB complejos o ambiguos pueden requerir corrección manual de categoría u orientación en una versión posterior.",
        ],
    }
    fit_json_path.write_text(json.dumps(fit_json, ensure_ascii=False, indent=2), encoding="utf-8")
    collision_json_path.write_text(json.dumps(collision_report, ensure_ascii=False, indent=2), encoding="utf-8")
    return UniversalFitArtifacts(
        fit_id=fit_id,
        glb_path=glb_path,
        fit_json_path=fit_json_path,
        analysis_json_path=analysis_json_path,
        collision_json_path=collision_json_path,
        fit_json=fit_json,
    )
