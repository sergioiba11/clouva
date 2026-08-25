import json
import sys

import bpy
import numpy as np


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def load_triangles(path):
    clear_scene()
    bpy.ops.import_scene.gltf(filepath=path)
    bpy.context.view_layer.update()
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    garment = max(meshes, key=lambda obj: len(obj.data.polygons))
    matrix = garment.matrix_world
    points = np.asarray([(matrix @ vertex.co)[:] for vertex in garment.data.vertices], dtype=np.float64)
    garment.data.calc_loop_triangles()
    triangles = np.asarray(
        [[points[int(index)] for index in triangle.vertices] for triangle in garment.data.loop_triangles],
        dtype=np.float64,
    )
    return points, triangles


def quantiles(values):
    values = np.asarray(values, dtype=np.float64)
    return {
        "min": float(np.min(values)),
        "q01": float(np.quantile(values, 0.01)),
        "q05": float(np.quantile(values, 0.05)),
        "median": float(np.median(values)),
        "q95": float(np.quantile(values, 0.95)),
        "q99": float(np.quantile(values, 0.99)),
        "max": float(np.max(values)),
    }


def triangle_metrics(triangles):
    edges = np.stack(
        (
            np.linalg.norm(triangles[:, 1] - triangles[:, 0], axis=1),
            np.linalg.norm(triangles[:, 2] - triangles[:, 1], axis=1),
            np.linalg.norm(triangles[:, 0] - triangles[:, 2], axis=1),
        ),
        axis=1,
    )
    cross = np.cross(triangles[:, 1] - triangles[:, 0], triangles[:, 2] - triangles[:, 0])
    double_area = np.linalg.norm(cross, axis=1)
    longest = np.max(edges, axis=1)
    shortest_altitude = double_area / np.maximum(longest, 1e-12)
    aspect = longest / np.maximum(shortest_altitude, 1e-12)
    return edges, cross, double_area * 0.5, aspect


def summarize(path):
    points, triangles = load_triangles(path)
    edges, cross, areas, aspect = triangle_metrics(triangles)
    return {
        "path": path,
        "vertices": int(len(points)),
        "triangles": int(len(triangles)),
        "boundsMin": points.min(axis=0).tolist(),
        "boundsMax": points.max(axis=0).tolist(),
        "edgeLength": quantiles(edges.reshape(-1)),
        "triangleArea": quantiles(areas),
        "aspectRatio": quantiles(aspect),
        "degenerateTriangleRatio": float(np.mean(areas < np.median(areas) * 1e-4)),
        "points": points,
        "trianglesData": triangles,
        "edgesData": edges,
        "crossData": cross,
        "areasData": areas,
    }


def compare(reference, candidate):
    if len(reference["trianglesData"]) != len(candidate["trianglesData"]):
        return {"comparable": False}
    ref_edges = reference["edgesData"]
    cand_edges = candidate["edgesData"]
    edge_ratio = cand_edges / np.maximum(ref_edges, 1e-12)
    area_ratio = candidate["areasData"] / np.maximum(reference["areasData"], 1e-12)
    ref_normals = reference["crossData"] / np.maximum(
        np.linalg.norm(reference["crossData"], axis=1, keepdims=True), 1e-12
    )
    cand_normals = candidate["crossData"] / np.maximum(
        np.linalg.norm(candidate["crossData"], axis=1, keepdims=True), 1e-12
    )
    normal_dot = np.sum(ref_normals * cand_normals, axis=1)
    return {
        "comparable": True,
        "edgeStretchRatio": quantiles(edge_ratio.reshape(-1)),
        "areaRatio": quantiles(area_ratio),
        "edgeOutsideHalfToDoubleRatio": float(np.mean((edge_ratio < 0.5) | (edge_ratio > 2.0))),
        "edgeOutsideTwoThirdsToOneHalfRatio": float(np.mean((edge_ratio < (2.0 / 3.0)) | (edge_ratio > 1.5))),
        "normalFlipRatio": float(np.mean(normal_dot < 0.0)),
        "normalDot": quantiles(normal_dot),
    }


def public(summary):
    return {key: value for key, value in summary.items() if not key.endswith("Data") and key != "points"}


def main():
    values = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if len(values) < 2:
        raise RuntimeError("Expected at least two GLB paths")
    summaries = [summarize(path) for path in values]
    report = {
        "meshes": [public(summary) for summary in summaries],
        "comparisonsToFirst": [compare(summaries[0], summary) for summary in summaries[1:]],
    }
    print("CLOUVA_QUALITY " + json.dumps(report, separators=(",", ":")), flush=True)


if __name__ == "__main__":
    main()
