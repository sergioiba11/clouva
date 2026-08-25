import json
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree


SURFACE_PREVIEW_VERSION = 2


def parse_args():
    values = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if len(values) != 5:
        raise RuntimeError("Expected avatar.glb fitted.glb output.glb report.json fit_mode")
    return values


def clear_scene():
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def import_glb(path):
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    bpy.context.view_layer.update()
    return [obj for obj in bpy.context.scene.objects if obj not in before]


def select_only(objects, active=None):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = active or objects[0]


def prepare_garment(objects):
    meshes = [obj for obj in objects if obj.type == "MESH" and len(obj.data.vertices) >= 3]
    if not meshes:
        raise RuntimeError("The fitted garment has no mesh")
    for obj in meshes:
        world = obj.matrix_world.copy()
        obj.parent = None
        obj.matrix_world = world
        obj.hide_set(False)
        obj.hide_viewport = False
        obj.hide_render = False
    bpy.context.view_layer.update()
    active = max(meshes, key=lambda value: len(value.data.vertices))
    select_only(meshes, active)
    if len(meshes) > 1:
        bpy.ops.object.join()
    garment = bpy.context.view_layer.objects.active
    garment.name = "CLOUVA_Surface_Fitted_Garment"
    select_only([garment])
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    garment.data.validate(verbose=False)
    garment.data.update()
    return garment


def body_meshes(objects):
    meshes = [obj for obj in objects if obj.type == "MESH" and len(obj.data.vertices) >= 20]
    if not meshes:
        raise RuntimeError("The analyzed avatar has no body mesh")
    return meshes


def body_bvh(meshes):
    vertices = []
    triangles = []
    for obj in meshes:
        mesh = obj.data
        mesh.calc_loop_triangles()
        offset = len(vertices)
        matrix = obj.matrix_world
        vertices.extend(matrix @ vertex.co for vertex in mesh.vertices)
        triangles.extend(
            tuple(offset + int(index) for index in triangle.vertices)
            for triangle in mesh.loop_triangles
        )
    if len(vertices) < 32 or len(triangles) < 24:
        raise RuntimeError("The analyzed avatar surface is incomplete")
    tree = BVHTree.FromPolygons(vertices, triangles, all_triangles=True)
    if tree is None:
        raise RuntimeError("Could not build the avatar collision surface")
    points = np.asarray([(point.x, point.y, point.z) for point in vertices], dtype=np.float64)
    center = Vector(tuple(float(value) for value in np.median(points, axis=0)))
    orientation_scores = []
    stride = max(1, len(triangles) // 2048)
    for triangle in triangles[::stride]:
        a, b, c = (vertices[index] for index in triangle)
        normal = (b - a).cross(c - a)
        if normal.length_squared <= 1e-12:
            continue
        normal.normalize()
        face_center = (a + b + c) / 3.0
        orientation_scores.append(float(normal.dot(face_center - center)))
    normal_sign = -1.0 if orientation_scores and float(np.median(orientation_scores)) < 0.0 else 1.0
    return tree, points, normal_sign


def nearest_surface(tree, point, normal_sign):
    location, normal, face_index, distance = tree.find_nearest(point)
    if location is None or normal is None or face_index is None or distance is None:
        raise RuntimeError("Could not project a garment vertex onto the avatar")
    normal = normal.normalized() * normal_sign
    if normal.length_squared < 0.5:
        raise RuntimeError("The avatar returned an invalid surface normal")
    return location, normal, float(distance)


def adjacency(garment, source_points, seam_radius):
    result = [set() for _ in garment.data.vertices]
    for edge in garment.data.edges:
        left, right = int(edge.vertices[0]), int(edge.vertices[1])
        result[left].add(right)
        result[right].add(left)
    # Garment exports commonly split vertices at material and UV seams. Those
    # copies occupy the same physical patch but have no mesh edge between them;
    # smoothing each island independently is what produced the detached strips
    # visible around the sleeves. Reconnect only spatially coincident/nearby
    # copies so the correction field stays continuous across authored seams.
    tree = KDTree(len(source_points))
    for index, point in enumerate(source_points):
        tree.insert(point, index)
    tree.balance()
    for index, point in enumerate(source_points):
        linked = 0
        for _co, neighbor, distance in tree.find_range(point, seam_radius):
            if neighbor == index or distance <= 1e-10:
                continue
            result[index].add(int(neighbor))
            result[int(neighbor)].add(index)
            linked += 1
            if linked >= 12:
                break
    return result


def smooth_displacements(values, neighbors, iterations=150, strength=0.36):
    current = [value.copy() for value in values]
    for _ in range(iterations):
        updated = [value.copy() for value in current]
        for index, linked in enumerate(neighbors):
            if not linked:
                continue
            average = Vector((0.0, 0.0, 0.0))
            for neighbor in linked:
                average += current[neighbor]
            average /= len(linked)
            updated[index] = current[index].lerp(average, strength)
        current = updated
    return current


def topology_quality(garment, source_points, final_points, avatar_height):
    source = np.asarray([point[:] for point in source_points], dtype=np.float64)
    final = np.asarray([point[:] for point in final_points], dtype=np.float64)
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
    nondegenerate = source_area2 > max(float(np.median(source_area2)) * 1e-4, 1e-12)
    face_usable = nondegenerate & (source_aspect < 24.0)
    all_normal_dot = np.sum(source_cross[nondegenerate] * final_cross[nondegenerate], axis=1) / np.maximum(
        source_area2[nondegenerate] * final_area2[nondegenerate], 1e-12
    )
    normal_dot = np.sum(source_cross[face_usable] * final_cross[face_usable], axis=1) / np.maximum(
        source_area2[face_usable] * final_area2[face_usable], 1e-12
    )
    area_ratios = final_area2[face_usable] / np.maximum(source_area2[face_usable], 1e-12)
    return {
        "edgeStretchP01": float(np.quantile(edge_ratios, 0.01)),
        "edgeStretchMedian": float(np.median(edge_ratios)),
        "edgeStretchP99": float(np.quantile(edge_ratios, 0.99)),
        "edgeStretchMaximum": float(np.max(edge_ratios)),
        "edgeOutsideHalfToDoubleRatio": float(np.mean((edge_ratios < 0.5) | (edge_ratios > 2.0))),
        "triangleAreaRatioP01": float(np.quantile(area_ratios, 0.01)),
        "triangleAreaRatioP99": float(np.quantile(area_ratios, 0.99)),
        "triangleFlipRatio": float(np.mean(normal_dot < 0.0)),
        "rawTriangleFlipRatio": float(np.mean(all_normal_dot < 0.0)),
    }


def stabilize_topology(garment, source_points, candidate_points, avatar_height):
    """Back off only corrections that would fold or tear their rest patch."""
    source = np.asarray([point[:] for point in source_points], dtype=np.float64)
    candidate = np.asarray([point[:] for point in candidate_points], dtype=np.float64)
    displacement = candidate - source
    edges = np.asarray(
        [[int(edge.vertices[0]), int(edge.vertices[1])] for edge in garment.data.edges],
        dtype=np.int64,
    )
    garment.data.calc_loop_triangles()
    triangles = np.asarray(
        [[int(index) for index in triangle.vertices] for triangle in garment.data.loop_triangles],
        dtype=np.int64,
    )
    source_lengths = np.linalg.norm(source[edges[:, 1]] - source[edges[:, 0]], axis=1)
    usable_edges = source_lengths > max(float(avatar_height) * 1e-6, 1e-9)
    source_cross = np.cross(
        source[triangles[:, 1]] - source[triangles[:, 0]],
        source[triangles[:, 2]] - source[triangles[:, 0]],
    )
    source_area2 = np.linalg.norm(source_cross, axis=1)
    usable_faces = source_area2 > max(float(np.median(source_area2)) * 1e-4, 1e-12)

    for _ in range(10):
        current = source + displacement
        current_lengths = np.linalg.norm(current[edges[:, 1]] - current[edges[:, 0]], axis=1)
        edge_ratio = current_lengths / np.maximum(source_lengths, 1e-12)
        bad_edges = usable_edges & ((edge_ratio < 0.64) | (edge_ratio > 1.52))

        current_cross = np.cross(
            current[triangles[:, 1]] - current[triangles[:, 0]],
            current[triangles[:, 2]] - current[triangles[:, 0]],
        )
        current_area2 = np.linalg.norm(current_cross, axis=1)
        normal_dot = np.sum(source_cross * current_cross, axis=1) / np.maximum(
            source_area2 * current_area2, 1e-12
        )
        area_ratio = current_area2 / np.maximum(source_area2, 1e-12)
        bad_faces = usable_faces & (
            (normal_dot < 0.18) | (area_ratio < 0.30) | (area_ratio > 2.30)
        )
        if not np.any(bad_edges) and not np.any(bad_faces):
            break

        bad_vertices = np.zeros(len(source), dtype=bool)
        if np.any(bad_edges):
            bad_vertices[edges[bad_edges].reshape(-1)] = True
        if np.any(bad_faces):
            bad_vertices[triangles[bad_faces].reshape(-1)] = True
        displacement[bad_vertices] *= 0.48

    return [Vector(tuple(float(value) for value in point)) for point in source + displacement]


def settings(fit_mode, avatar_height):
    height = max(float(avatar_height), 1e-5)
    mode = str(fit_mode or "regular").strip().lower()
    if mode == "oversized":
        return height * 0.0085, height * 0.0400, 0.18
    if mode == "base":
        return height * 0.0050, height * 0.0160, 0.08
    return height * 0.0065, height * 0.0260, 0.12


def world_points(obj):
    matrix = obj.matrix_world
    return np.asarray(
        [(matrix @ vertex.co)[:] for vertex in obj.data.vertices],
        dtype=np.float64,
    )


def depth_ratio(body_points, garment_points):
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
        raise RuntimeError("Not enough torso vertices to validate garment depth")
    body_depth = float(np.quantile(body_band[:, 1], 0.95) - np.quantile(body_band[:, 1], 0.05))
    garment_depth = float(np.quantile(garment_band[:, 1], 0.95) - np.quantile(garment_band[:, 1], 0.05))
    return garment_depth / max(body_depth, 1e-5), body_depth, garment_depth


def fit_surface(meshes, garment, fit_mode):
    tree, body_points, normal_sign = body_bvh(meshes)
    avatar_height = max(float(body_points[:, 2].max() - body_points[:, 2].min()), 1e-5)
    clearance, allowance, retained_looseness = settings(fit_mode, avatar_height)
    maximum_offset = clearance + allowance
    matrix = garment.matrix_world.copy()
    inverse = matrix.inverted()
    source = [matrix @ vertex.co for vertex in garment.data.vertices]
    corrected = [point.copy() for point in source]
    # Material and UV islands in the same sewn patch can be a few millimetres
    # apart after the regional fit.  Treat that narrow seam band as one cloth
    # neighbourhood so the residual collision pass cannot pull a sleeve strip
    # away from the rest of the armhole.
    neighbors = adjacency(garment, source, avatar_height * 0.0060)
    maximum_step = avatar_height * 0.012

    # Collision-only relaxation. The previous implementation projected every
    # vertex to its nearest body triangle and then clamped it there. At an
    # armpit, adjacent sleeve vertices can choose different body regions and the
    # fabric tears. Preserve all already-valid authored volume and distribute
    # only the outward collision correction as a continuous field.
    for _ in range(8):
        raw_corrections = []
        violation_count = 0
        for point in corrected:
            location, normal, _distance = nearest_surface(tree, point, normal_sign)
            signed = float((point - location).dot(normal))
            if signed < clearance:
                violation_count += 1
                distance = min(clearance - signed, maximum_step)
                raw_corrections.append(normal * distance)
            else:
                raw_corrections.append(Vector((0.0, 0.0, 0.0)))
        if violation_count == 0:
            break
        smoothed = smooth_displacements(raw_corrections, neighbors)
        corrected = [
            point + correction * 0.82
            for point, correction in zip(corrected, smoothed)
        ]
    # The wide seam-aware relaxation is the topology constraint.  A local
    # per-vertex rollback here would reintroduce discontinuities at UV seams.

    for vertex, point in zip(garment.data.vertices, corrected):
        vertex.co = inverse @ point
    garment.data.update()
    bpy.context.view_layer.update()

    final_points = world_points(garment)
    signed_offsets = []
    distances = []
    for coordinates in final_points:
        point = Vector(tuple(float(value) for value in coordinates))
        location, normal, distance = nearest_surface(tree, point, normal_sign)
        signed_offsets.append(float((point - location).dot(normal)))
        distances.append(distance)
    signed_offsets = np.asarray(signed_offsets, dtype=np.float64)
    distances = np.asarray(distances, dtype=np.float64)
    ratio, body_depth, garment_depth = depth_ratio(body_points, final_points)

    quality = topology_quality(garment, source, corrected, avatar_height)
    report = {
        "version": "clouva-blender-surface-preview-v2",
        "surfaceFitVersion": SURFACE_PREVIEW_VERSION,
        "strategy": "topology-preserving-collision-relaxation",
        "fitMode": fit_mode,
        "vertices": int(len(final_points)),
        "clearanceMeters": float(clearance),
        "maximumOffsetMeters": float(maximum_offset),
        "minimumDistanceMeters": float(distances.min()),
        "medianDistanceMeters": float(np.median(distances)),
        "p95DistanceMeters": float(np.quantile(distances, 0.95)),
        "penetrationRatio": float(np.mean(signed_offsets < 0.0)),
        "belowClearanceRatio": float(np.mean(distances < clearance * 0.78)),
        "bodyDepthMeters": body_depth,
        "garmentDepthMeters": garment_depth,
        "depthRatio": ratio,
        "normalOrientationSign": normal_sign,
        "topologyQuality": quality,
    }
    valid = all(math.isfinite(float(value)) for value in (
        report["minimumDistanceMeters"],
        report["medianDistanceMeters"],
        report["p95DistanceMeters"],
        report["penetrationRatio"],
        report["belowClearanceRatio"],
        report["depthRatio"],
    ))
    if (
        not valid
        or report["penetrationRatio"] > 0.01
        or report["belowClearanceRatio"] > 0.04
        or report["p95DistanceMeters"] > maximum_offset * 1.35
        or report["depthRatio"] < 0.66
        or report["depthRatio"] > 1.95
        or quality["edgeStretchP01"] < 0.68
        or quality["edgeStretchP99"] > 1.48
        or quality["edgeOutsideHalfToDoubleRatio"] > 0.006
        or quality["triangleAreaRatioP01"] < 0.28
        or quality["triangleAreaRatioP99"] > 2.40
        or quality["triangleFlipRatio"] > 0.006
    ):
        report["status"] = "rejected"
        print(f"[surface-preview] rejected {json.dumps(report, separators=(',', ':'))}", flush=True)
        raise RuntimeError("Surface fit validation failed")
    report["status"] = "passed"
    garment["clouvaSurfacePreviewVersion"] = SURFACE_PREVIEW_VERSION
    garment["clouvaSurfaceFitStrategy"] = report["strategy"]
    garment["clouvaSurfaceFitReport"] = json.dumps(report, separators=(",", ":"))
    return report


def export_glb(path, garment):
    select_only([garment])
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=False,
        export_animations=False,
        export_skins=False,
        export_materials="EXPORT",
        export_normals=False,
        export_tangents=False,
        export_shared_accessors=True,
        export_extras=True,
    )


def main():
    avatar_path, garment_path, output_path, report_path, fit_mode = parse_args()
    clear_scene()
    avatar_objects = import_glb(avatar_path)
    meshes = body_meshes(avatar_objects)
    garment_objects = import_glb(garment_path)
    garment = prepare_garment(garment_objects)
    report = fit_surface(meshes, garment, fit_mode)
    export_glb(output_path, garment)
    if not os.path.exists(output_path) or os.path.getsize(output_path) < 1024:
        raise RuntimeError("The fitted GLB was not exported")
    with open(report_path, "w", encoding="utf-8") as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2)
    print(f"[surface-preview] passed {json.dumps(report, separators=(',', ':'))}", flush=True)


if __name__ == "__main__":
    main()
