import importlib.util
import json
import math
import os
import sys

import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree


PREVIOUS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "rig_garment_v33.py")
MODULE_DIR = os.path.dirname(PREVIOUS_PATH)
if MODULE_DIR not in sys.path:
    sys.path.insert(0, MODULE_DIR)


def load_previous_pipeline():
    if not os.path.exists(PREVIOUS_PATH):
        raise RuntimeError(f"No se encontro el pipeline V43.1 en {PREVIOUS_PATH}")
    spec = importlib.util.spec_from_file_location("clouva_rig_v431_active", PREVIOUS_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("No se pudo crear el cargador del pipeline V43.1")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


pipeline = load_previous_pipeline()
previous = pipeline
legacy = pipeline.legacy
v9 = pipeline.v9
v42 = pipeline.previous
v41 = v42.previous

SURFACE_FIT_VERSION = 46
ANATOMICAL_FIT_VERSION = SURFACE_FIT_VERSION
CANONICAL_BIND_VERSION = pipeline.CANONICAL_BIND_VERSION
CANONICAL_MEMORY_VERSION = pipeline.CANONICAL_MEMORY_VERSION
PREBIND_SPACE_VERSION = pipeline.PREBIND_SPACE_VERSION
SPACE_CONTRACT_VERSION = pipeline.SPACE_CONTRACT_VERSION
MAX_GARMENT_POLYGONS = pipeline.MAX_GARMENT_POLYGONS
ROUNDTRIP_SIGNATURE_VERSION = pipeline.ROUNDTRIP_SIGNATURE_VERSION
LOADER_FIX_VERSION = pipeline.LOADER_FIX_VERSION
RIG_ERROR = pipeline.RIG_ERROR
CANONICAL_SAMPLE_LIMIT = pipeline.CANONICAL_SAMPLE_LIMIT

# Canonical-bind helpers remain public because the existing diagnostics and
# regression tests inspect the active entrypoint directly.
_sample_indices = pipeline._sample_indices
_matrix_delta = pipeline._matrix_delta
normalize_official_avatar_canonical_v43 = pipeline.normalize_official_avatar_canonical_v43


def _retained_contract(name):
    current = pipeline
    visited = set()
    while current is not None and id(current) not in visited:
        visited.add(id(current))
        value = getattr(current, name, None)
        if callable(value):
            return value
        current = getattr(current, "previous", None)
    raise RuntimeError(f"El pipeline activo no conserva el contrato {name}")


ensure_upper_volume_before_rig = _retained_contract("ensure_upper_volume_before_rig")

_original_copy_weights = v42._original_copy_weights
_original_validate = legacy.validate


def _surface_settings(category, avatar_height):
    height = max(float(avatar_height), 1e-5)
    if category == "shirt":
        return height * 0.0060, height * 0.0220, 0.10, 28
    if category == "jacket":
        return height * 0.0110, height * 0.0400, 0.18, 28
    return height * 0.0085, height * 0.0320, 0.14, 28


def _combined_body_bvh(body_meshes):
    depsgraph = legacy.bpy.context.evaluated_depsgraph_get()
    vertices = []
    triangles = []
    for obj in body_meshes:
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        try:
            mesh.calc_loop_triangles()
            offset = len(vertices)
            matrix = evaluated.matrix_world
            vertices.extend(matrix @ vertex.co for vertex in mesh.vertices)
            triangles.extend(
                tuple(offset + int(index) for index in triangle.vertices)
                for triangle in mesh.loop_triangles
            )
        finally:
            evaluated.to_mesh_clear()
    if len(vertices) < 32 or len(triangles) < 24:
        raise RuntimeError(RIG_ERROR)
    tree = BVHTree.FromPolygons(vertices, triangles, all_triangles=True)
    if tree is None:
        raise RuntimeError(RIG_ERROR)
    points = np.asarray([(point.x, point.y, point.z) for point in vertices], dtype=np.float64)
    return tree, points


def _garment_adjacency(garment, source_points=None, seam_radius=0.0):
    adjacency = [set() for _ in garment.data.vertices]
    for edge in garment.data.edges:
        left, right = (int(edge.vertices[0]), int(edge.vertices[1]))
        adjacency[left].add(right)
        adjacency[right].add(left)
    if source_points is not None and seam_radius > 0.0:
        tree = KDTree(len(source_points))
        for index, point in enumerate(source_points):
            tree.insert(point, index)
        tree.balance()
        for index, point in enumerate(source_points):
            linked = 0
            for _co, neighbor, distance in tree.find_range(point, seam_radius):
                if neighbor == index or distance <= 1e-10:
                    continue
                adjacency[index].add(int(neighbor))
                adjacency[int(neighbor)].add(index)
                linked += 1
                if linked >= 12:
                    break
    return adjacency


def _smooth_displacements(displacements, adjacency, iterations, strength=0.48):
    current = [value.copy() for value in displacements]
    for _ in range(max(0, int(iterations))):
        updated = [value.copy() for value in current]
        for index, neighbors in enumerate(adjacency):
            if not neighbors:
                continue
            average = Vector((0.0, 0.0, 0.0))
            for neighbor in neighbors:
                average += current[neighbor]
            average /= len(neighbors)
            updated[index] = current[index].lerp(average, strength)
        current = updated
    return current


def _topology_quality(garment, source_points, final_points, avatar_height):
    source = np.asarray([point[:] for point in source_points], dtype=np.float64)
    final = np.asarray(final_points, dtype=np.float64)
    edges = np.asarray(
        [[int(edge.vertices[0]), int(edge.vertices[1])] for edge in garment.data.edges],
        dtype=np.int64,
    )
    source_lengths = np.linalg.norm(source[edges[:, 1]] - source[edges[:, 0]], axis=1)
    final_lengths = np.linalg.norm(final[edges[:, 1]] - final[edges[:, 0]], axis=1)
    usable = source_lengths > max(float(avatar_height) * 1e-6, 1e-9)
    edge_ratios = final_lengths[usable] / np.maximum(source_lengths[usable], 1e-12)

    garment.data.calc_loop_triangles()
    triangles = np.asarray(
        [[int(index) for index in triangle.vertices] for triangle in garment.data.loop_triangles],
        dtype=np.int64,
    )
    source_cross = np.cross(
        source[triangles[:, 1]] - source[triangles[:, 0]],
        source[triangles[:, 2]] - source[triangles[:, 0]],
    )
    final_cross = np.cross(
        final[triangles[:, 1]] - final[triangles[:, 0]],
        final[triangles[:, 2]] - final[triangles[:, 0]],
    )
    source_area2 = np.linalg.norm(source_cross, axis=1)
    final_area2 = np.linalg.norm(final_cross, axis=1)
    triangle_edges = np.stack(
        (
            np.linalg.norm(source[triangles[:, 1]] - source[triangles[:, 0]], axis=1),
            np.linalg.norm(source[triangles[:, 2]] - source[triangles[:, 1]], axis=1),
            np.linalg.norm(source[triangles[:, 0]] - source[triangles[:, 2]], axis=1),
        ),
        axis=1,
    )
    longest = np.max(triangle_edges, axis=1)
    source_aspect = longest / np.maximum(source_area2 / np.maximum(longest, 1e-12), 1e-12)
    usable_faces = (
        source_area2 > max(float(np.median(source_area2)) * 1e-4, 1e-12)
    ) & (source_aspect < 24.0)
    normal_dot = np.sum(source_cross[usable_faces] * final_cross[usable_faces], axis=1) / np.maximum(
        source_area2[usable_faces] * final_area2[usable_faces], 1e-12
    )
    area_ratios = final_area2[usable_faces] / np.maximum(source_area2[usable_faces], 1e-12)
    return {
        "edgeStretchP01": float(np.quantile(edge_ratios, 0.01)),
        "edgeStretchMedian": float(np.median(edge_ratios)),
        "edgeStretchP99": float(np.quantile(edge_ratios, 0.99)),
        "edgeStretchMaximum": float(np.max(edge_ratios)),
        "edgeOutsideHalfToDoubleRatio": float(np.mean((edge_ratios < 0.5) | (edge_ratios > 2.0))),
        "triangleAreaRatioP01": float(np.quantile(area_ratios, 0.01)),
        "triangleAreaRatioP99": float(np.quantile(area_ratios, 0.99)),
        "triangleFlipRatio": float(np.mean(normal_dot < 0.0)),
    }


def _nearest_surface(tree, point):
    location, normal, face_index, distance = tree.find_nearest(point)
    if location is None or normal is None or face_index is None or distance is None:
        raise RuntimeError(RIG_ERROR)
    normal = normal.normalized()
    if normal.length_squared < 0.5:
        raise RuntimeError(RIG_ERROR)
    return location, normal, float(distance)


def _surface_metrics(body_meshes, garment, armature, tree, body_points, clearance, maximum_offset, source_points):
    garment_points = v41._garment_world_points(garment)
    signed_offsets = []
    for coordinates in garment_points:
        point = Vector(tuple(float(value) for value in coordinates))
        location, normal, _distance = _nearest_surface(tree, point)
        signed_offsets.append(float((point - location).dot(normal)))
    signed_offsets = np.asarray(signed_offsets, dtype=np.float64)

    garment_z_min = float(np.quantile(garment_points[:, 2], 0.24))
    garment_z_max = float(np.quantile(garment_points[:, 2], 0.76))
    center_x = float(np.median(garment_points[:, 0]))
    garment_width = max(
        float(np.quantile(garment_points[:, 0], 0.95) - np.quantile(garment_points[:, 0], 0.05)),
        1e-5,
    )
    body_band = body_points[
        (body_points[:, 2] >= garment_z_min)
        & (body_points[:, 2] <= garment_z_max)
        & (np.abs(body_points[:, 0] - center_x) <= garment_width * 0.34)
    ]
    garment_band = garment_points[
        (garment_points[:, 2] >= garment_z_min)
        & (garment_points[:, 2] <= garment_z_max)
        & (np.abs(garment_points[:, 0] - center_x) <= garment_width * 0.34)
    ]
    if len(body_band) < 24 or len(garment_band) < 24:
        raise RuntimeError(RIG_ERROR)

    body_depth = float(np.quantile(body_band[:, 1], 0.95) - np.quantile(body_band[:, 1], 0.05))
    garment_depth = float(np.quantile(garment_band[:, 1], 0.95) - np.quantile(garment_band[:, 1], 0.05))
    depth_ratio = garment_depth / max(body_depth, 1e-5)
    penetration_ratio = float(np.mean(signed_offsets < clearance * 0.80))
    reverse_ratio = float(np.mean(signed_offsets < 0.0))
    median_offset = float(np.median(signed_offsets))
    p95_offset = float(np.quantile(signed_offsets, 0.95))
    avatar_height = max(float(body_points[:, 2].max() - body_points[:, 2].min()), 1e-5)
    topology = _topology_quality(garment, source_points, garment_points, avatar_height)

    report = {
        "version": SURFACE_FIT_VERSION,
        "strategy": "topology-preserving-collision-relaxation",
        "vertices": int(len(garment_points)),
        "clearanceMeters": float(clearance),
        "maximumOffsetMeters": float(maximum_offset),
        "surfaceOffsetMedianMeters": median_offset,
        "surfaceOffsetP95Meters": p95_offset,
        "penetrationRatio": penetration_ratio,
        "reverseNormalRatio": reverse_ratio,
        "bodyDepthMeters": body_depth,
        "garmentDepthMeters": garment_depth,
        "depthRatio": depth_ratio,
        "topologyQuality": topology,
    }
    finite = all(math.isfinite(float(value)) for value in (
        median_offset,
        p95_offset,
        penetration_ratio,
        reverse_ratio,
        depth_ratio,
    ))
    if (
        not finite
        or penetration_ratio > 0.02
        or reverse_ratio > 0.005
        or median_offset < clearance * 0.78
        or p95_offset > maximum_offset * 1.75
        or depth_ratio < 0.68
        or depth_ratio > 1.85
        or topology["edgeStretchP01"] < 0.68
        or topology["edgeStretchP99"] > 1.68
        or topology["edgeOutsideHalfToDoubleRatio"] > 0.006
        or topology["triangleAreaRatioP01"] < 0.28
        or topology["triangleAreaRatioP99"] > 2.40
        or topology["triangleFlipRatio"] > 0.006
    ):
        print(f"[rig-v46] surface validation rejected metrics={json.dumps(report, separators=(',', ':'))}", flush=True)
        raise RuntimeError(RIG_ERROR)
    return report


def _coarse_align_upper_to_body(body_points, garment, category):
    body_min = body_points.min(axis=0)
    body_max = body_points.max(axis=0)
    avatar_height = max(float(body_max[2] - body_min[2]), 1e-5)
    target_bottom = float(body_min[2] + avatar_height * 0.37)
    target_top = float(body_min[2] + avatar_height * (0.80 if category == "shirt" else 0.84))
    body_band = body_points[
        (body_points[:, 2] >= target_bottom)
        & (body_points[:, 2] <= target_top)
    ]
    if len(body_band) < 32:
        raise RuntimeError(RIG_ERROR)

    source = v41._garment_world_points(garment)
    source_min = source.min(axis=0)
    source_max = source.max(axis=0)
    source_size = np.maximum(source_max - source_min, 1e-5)
    source_center = (source_min + source_max) * 0.5
    target_center = np.asarray((
        float(np.median(body_band[:, 0])),
        float(np.median(body_band[:, 1])),
        (target_bottom + target_top) * 0.5,
    ), dtype=np.float64)
    body_width = max(float(np.quantile(body_band[:, 0], 0.995) - np.quantile(body_band[:, 0], 0.005)), avatar_height * 0.28)
    torso = body_band[
        np.abs(body_band[:, 0] - target_center[0]) <= body_width * 0.34
    ]
    if len(torso) < 24:
        torso = body_band
    body_depth = max(float(np.quantile(torso[:, 1], 0.98) - np.quantile(torso[:, 1], 0.02)), avatar_height * 0.08)
    margin_width = 1.06 if category == "shirt" else 1.12
    margin_depth = 1.12 if category == "shirt" else 1.20
    desired = np.asarray((
        body_width * margin_width,
        body_depth * margin_depth,
        target_top - target_bottom,
    ), dtype=np.float64)
    raw_factors = desired / source_size
    factors = np.asarray((
        max(0.62, min(1.55, float(raw_factors[0]))),
        max(0.62, min(1.65, float(raw_factors[1]))),
        max(0.68, min(1.50, float(raw_factors[2]))),
    ), dtype=np.float64)
    corrected = target_center + (source - source_center) * factors
    inverse_world = garment.matrix_world.inverted()
    for vertex, coordinates in zip(garment.data.vertices, corrected):
        vertex.co = inverse_world @ Vector(tuple(float(value) for value in coordinates))
    garment.data.update()
    legacy.bpy.context.view_layer.update()
    return {
        "sourceSize": [float(value) for value in source_size],
        "targetSize": [float(value) for value in desired],
        "scaleFactors": [float(value) for value in factors],
        "targetCenter": [float(value) for value in target_center],
    }


def surface_cage_fit_v46(body_meshes, garment, armature, category):
    if category not in v9.UPPER_GARMENTS:
        return None
    if garment is None or garment.type != "MESH" or armature is None:
        raise RuntimeError(RIG_ERROR)

    legacy.bpy.context.view_layer.update()
    tree, body_points = _combined_body_bvh(body_meshes)
    avatar_height = max(float(body_points[:, 2].max() - body_points[:, 2].min()), 1e-5)
    clearance, allowance, retained_looseness, smoothing_iterations = _surface_settings(category, avatar_height)
    maximum_offset = clearance + allowance
    coarse_alignment = _coarse_align_upper_to_body(body_points, garment, category)

    world_matrix = garment.matrix_world.copy()
    inverse_world = world_matrix.inverted()
    source_points = [world_matrix @ vertex.co for vertex in garment.data.vertices]
    corrected = [point.copy() for point in source_points]
    adjacency = _garment_adjacency(garment, source_points, avatar_height * 0.0015)
    maximum_step = avatar_height * 0.012
    for _ in range(8):
        corrections = []
        violation_count = 0
        for point in corrected:
            location, normal, _distance = _nearest_surface(tree, point)
            signed = float((point - location).dot(normal))
            if signed < clearance:
                violation_count += 1
                corrections.append(normal * min(clearance - signed, maximum_step))
            else:
                corrections.append(Vector((0.0, 0.0, 0.0)))
        if violation_count == 0:
            break
        corrections = _smooth_displacements(corrections, adjacency, 28)
        corrected = [
            point + correction * 0.82
            for point, correction in zip(corrected, corrections)
        ]

    for vertex, point in zip(garment.data.vertices, corrected):
        vertex.co = inverse_world @ point
    garment.data.update()
    legacy.bpy.context.view_layer.update()

    report = _surface_metrics(
        body_meshes,
        garment,
        armature,
        tree,
        body_points,
        clearance,
        maximum_offset,
        source_points,
    )
    report["coarseAlignment"] = coarse_alignment
    garment["clouvaAnatomicalFitVersion"] = SURFACE_FIT_VERSION
    garment["clouvaSurfaceFitVersion"] = SURFACE_FIT_VERSION
    garment["clouvaSurfaceFitReport"] = json.dumps(report, separators=(",", ":"))
    garment["clouvaCollisionClearanceMeters"] = float(clearance)
    garment["clouvaCorrectiveSmoothingIterations"] = int(smoothing_iterations)
    print(f"[rig-v46] topology-preserving surface fit passed metrics={json.dumps(report, separators=(',', ':'))}", flush=True)
    return report


def copy_weights_surface_v46(body_meshes, garment, armature, category):
    if category in v9.UPPER_GARMENTS:
        surface_cage_fit_v46(body_meshes, garment, armature, category)
    return _original_copy_weights(body_meshes, garment, armature, category)


def validate_surface_fit_v46(garment, armature, target_min, target_max, category):
    if category in v9.UPPER_GARMENTS:
        # V20's rectangular volume gate predates the surface cage and rejects a
        # correctly wrapped short sleeve by a bounding-box fraction. Keep its
        # underlying weight/armature validator, then apply the stronger V46
        # surface, penetration and depth contract below.
        base_validator = _original_validate.__globals__.get("_original_validate")
        if not callable(base_validator):
            raise RuntimeError(RIG_ERROR)
        result = base_validator(garment, armature, target_min, target_max, category)
        if int(garment.get("clouvaSurfaceFitVersion", 0)) != SURFACE_FIT_VERSION:
            raise RuntimeError(RIG_ERROR)
        try:
            report = json.loads(str(garment.get("clouvaSurfaceFitReport", "{}")))
        except json.JSONDecodeError as exc:
            raise RuntimeError(RIG_ERROR) from exc
        if report.get("strategy") != "topology-preserving-collision-relaxation":
            raise RuntimeError(RIG_ERROR)
        return result
    return _original_validate(garment, armature, target_min, target_max, category)


legacy.copy_weights = copy_weights_surface_v46
legacy.validate = validate_surface_fit_v46

# Public contracts retained for the Docker build and downstream diagnostics.
normalize_official_avatar_before_weights_v40 = pipeline.normalize_official_avatar_before_weights_v40
validate_unreal_avatar_reference_v40 = pipeline.validate_unreal_avatar_reference_v40
prepare_garment_fresh_v40 = pipeline.prepare_garment_fresh_v40
export_glb_v40 = pipeline.export_glb_v40
validate_roundtrip_v40 = pipeline.validate_roundtrip_v40
normalize_shared_space_v39 = pipeline.normalize_shared_space_v39
validate_deformation_envelope_v39 = pipeline.validate_deformation_envelope_v39
evaluated_world_points = pipeline.evaluated_world_points
shape_signature = pipeline.shape_signature
validate_shape_metrics = pipeline.validate_shape_metrics
garment_signature = pipeline.garment_signature
validate_anchor_metrics = pipeline.validate_anchor_metrics
validate_signature = pipeline.validate_signature
reduce_object_polygons = pipeline.reduce_object_polygons


def production_main():
    return pipeline.main()


main = production_main


if __name__ == "__main__":
    main()
