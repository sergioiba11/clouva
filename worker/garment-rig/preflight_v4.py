"""Non-destructive canonical preflight for CLOUVA Avatar Analyzer V4.

The source file is never written. This module inspects the already imported
analysis copy, builds triangulated BMesh copies for diagnostics and records the
space/unit/topology contract used by the following stages.
"""
from __future__ import annotations

from collections import defaultdict, deque
import math
from typing import Any

import bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree

VERSION = "clouva-avatar-preflight-v4.0"
SELF_INTERSECTION_TRIANGLE_LIMIT = 6000


def _vec(value: Vector):
    return [float(value.x), float(value.y), float(value.z)]


def _matrix(value):
    return [[float(value[row][column]) for column in range(4)] for row in range(4)]


def _world_points(meshes):
    return [obj.matrix_world @ vertex.co for obj in meshes for vertex in obj.data.vertices]


def _bounds(points):
    minimum = Vector(tuple(min(point[index] for point in points) for index in range(3)))
    maximum = Vector(tuple(max(point[index] for point in points) for index in range(3)))
    return minimum, maximum, maximum - minimum


def _unit_estimate(height: float):
    candidates = [
        ("meters", 1.0, 0.45, 3.5),
        ("centimeters", 0.01, 45.0, 350.0),
        ("millimeters", 0.001, 450.0, 3500.0),
    ]
    for name, to_meters, lower, upper in candidates:
        if lower <= height <= upper:
            return {
                "detected": name,
                "source_to_meters": to_meters,
                "estimated_height_meters": height * to_meters,
                "confidence": 0.92,
            }
    ranked = sorted(
        candidates,
        key=lambda item: abs(math.log(max(height * item[1], 1e-9) / 1.70)),
    )
    name, to_meters, _lower, _upper = ranked[0]
    return {
        "detected": name,
        "source_to_meters": to_meters,
        "estimated_height_meters": height * to_meters,
        "confidence": 0.45,
        "requires_review": True,
    }


def _components(vertex_count: int, edges):
    adjacency = defaultdict(list)
    for first, second in edges:
        adjacency[first].append(second)
        adjacency[second].append(first)
    unseen = set(range(vertex_count))
    sizes = []
    while unseen:
        root = unseen.pop()
        queue = deque([root])
        size = 0
        while queue:
            current = queue.popleft()
            size += 1
            for neighbor in adjacency.get(current, ()):
                if neighbor in unseen:
                    unseen.remove(neighbor)
                    queue.append(neighbor)
        sizes.append(size)
    return sorted(sizes, reverse=True)


def _self_intersections(obj, triangle_count: int):
    if triangle_count > SELF_INTERSECTION_TRIANGLE_LIMIT:
        return {
            "checked": False,
            "status": "skipped_for_complexity",
            "triangle_limit": SELF_INTERSECTION_TRIANGLE_LIMIT,
            "triangle_count": triangle_count,
        }
    bm = bmesh.new()
    try:
        bm.from_mesh(obj.data)
        bmesh.ops.transform(bm, matrix=obj.matrix_world, verts=bm.verts)
        bmesh.ops.triangulate(bm, faces=list(bm.faces))
        bm.faces.ensure_lookup_table()
        tree = BVHTree.FromBMesh(bm, epsilon=1e-7)
        overlaps = tree.overlap(tree)
        vertex_sets = {face.index: {vert.index for vert in face.verts} for face in bm.faces}
        non_adjacent = set()
        for first, second in overlaps:
            if first == second:
                continue
            pair = tuple(sorted((int(first), int(second))))
            if vertex_sets.get(pair[0], set()).intersection(vertex_sets.get(pair[1], set())):
                continue
            non_adjacent.add(pair)
            if len(non_adjacent) >= 1000:
                break
        return {
            "checked": True,
            "status": "potential_self_intersections" if non_adjacent else "none_detected",
            "potential_pair_count": len(non_adjacent),
            "sample_pairs": [list(pair) for pair in sorted(non_adjacent)[:20]],
            "method": "triangulated_bvh_non_adjacent_overlap",
            "approximate": True,
        }
    finally:
        bm.free()


def inspect_mesh(obj, global_diagonal: float):
    mesh = obj.data
    epsilon = max(global_diagonal * 1e-7, 1e-9)
    quantization = max(global_diagonal * 1e-6, 1e-8)
    buckets = defaultdict(int)
    for vertex in mesh.vertices:
        point = obj.matrix_world @ vertex.co
        key = tuple(round(float(point[index]) / quantization) for index in range(3))
        buckets[key] += 1
    duplicate_vertices = sum(count - 1 for count in buckets.values() if count > 1)

    edge_use = defaultdict(int)
    edge_pairs = []
    degenerate = 0
    triangle_count = 0
    zero_normals = 0
    for polygon in mesh.polygons:
        indices = list(polygon.vertices)
        triangle_count += max(0, len(indices) - 2)
        if len(set(indices)) < 3 or float(polygon.area) <= epsilon * epsilon:
            degenerate += 1
        if polygon.normal.length <= 1e-10:
            zero_normals += 1
        for index, first in enumerate(indices):
            second = indices[(index + 1) % len(indices)]
            pair = tuple(sorted((int(first), int(second))))
            edge_use[pair] += 1
    edge_pairs.extend(edge_use)
    boundary_edges = sum(1 for count in edge_use.values() if count == 1)
    non_manifold_edges = sum(1 for count in edge_use.values() if count > 2)
    components = _components(len(mesh.vertices), edge_pairs)
    determinant = float(obj.matrix_world.to_3x3().determinant())
    intersections = _self_intersections(obj, triangle_count)
    return {
        "name": obj.name,
        "vertex_count": len(mesh.vertices),
        "polygon_count": len(mesh.polygons),
        "triangulated_triangle_count": triangle_count,
        "temporary_triangulation": "bmesh_copy_only",
        "duplicate_vertex_count": duplicate_vertices,
        "degenerate_face_count": degenerate,
        "zero_normal_face_count": zero_normals,
        "boundary_edge_count": boundary_edges,
        "non_manifold_edge_count": non_manifold_edges,
        "connected_component_count": len(components),
        "connected_component_sizes": components[:20],
        "loose_component_count": max(0, len(components) - 1),
        "closed": boundary_edges == 0 and non_manifold_edges == 0,
        "open": boundary_edges > 0,
        "matrix_world": _matrix(obj.matrix_world),
        "matrix_determinant": determinant,
        "negative_transform": determinant < 0.0,
        "self_intersection": intersections,
    }


def run_preflight(meshes, orientation: dict[str, Any] | None = None):
    meshes = list(meshes)
    points = _world_points(meshes)
    if not points:
        raise RuntimeError("Avatar Analyzer V4 preflight requires mesh geometry")
    minimum, maximum, size = _bounds(points)
    diagonal = max(float(size.length), 1e-8)
    height = max(float(size.x), float(size.y), float(size.z))
    reports = [inspect_mesh(obj, diagonal) for obj in meshes]
    total_components = sum(item["connected_component_count"] for item in reports)
    topology = "closed" if all(item["closed"] for item in reports) else "open"
    if any(item["non_manifold_edge_count"] for item in reports):
        topology = "non_manifold"
    potential_self_intersections = sum(
        int((item["self_intersection"] or {}).get("potential_pair_count") or 0)
        for item in reports
    )
    orientation = orientation or {}
    return {
        "version": VERSION,
        "non_destructive": True,
        "source_file_modified": False,
        "analysis_copy_only": True,
        "bounds": {"minimum": _vec(minimum), "maximum": _vec(maximum), "size": _vec(size), "diagonal": diagonal},
        "units": _unit_estimate(height),
        "topology_classification": topology,
        "mesh_count": len(meshes),
        "connected_component_count": total_components,
        "loose_component_count": sum(item["loose_component_count"] for item in reports),
        "duplicate_vertex_count": sum(item["duplicate_vertex_count"] for item in reports),
        "degenerate_face_count": sum(item["degenerate_face_count"] for item in reports),
        "boundary_edge_count": sum(item["boundary_edge_count"] for item in reports),
        "non_manifold_edge_count": sum(item["non_manifold_edge_count"] for item in reports),
        "potential_self_intersection_pair_count": potential_self_intersections,
        "normal_recalculation_policy": "temporary_copy_only_when_incoherent",
        "coordinate_spaces": {
            "object_space": "per-object source coordinates retained in orientation.sourceMatrixWorld",
            "normalized_space": orientation.get("canonicalMatrix"),
            "normalized_to_source": orientation.get("inverseCanonicalMatrix"),
            "world_space": "temporary canonical Blender world",
            "camera_space": "stored per view in camera_manifest_v4.json",
        },
        "meshes": reports,
    }
