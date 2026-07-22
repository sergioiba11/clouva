"""Geometry-first medial branch detection for CLOUVA hands."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Sequence, Tuple

from mathutils import Vector

from mesh_geodesics import RegionGraph, path_points, resample_polyline


@dataclass
class HandBranch:
    branch_id: str
    endpoint_node: Tuple[str, int]
    endpoint: Vector
    path_nodes: List[Tuple[str, int]]
    centerline: List[Vector]
    geodesic_length: float
    direct_length: float
    shared_prefix_nodes: int
    confidence: float

    def as_dict(self):
        return {
            "branchId": self.branch_id,
            "endpoint": [float(self.endpoint.x), float(self.endpoint.y), float(self.endpoint.z)],
            "centerline": [[float(point.x), float(point.y), float(point.z)] for point in self.centerline],
            "pathVertexCount": len(self.path_nodes),
            "geodesicLength": float(self.geodesic_length),
            "directLength": float(self.direct_length),
            "sharedPrefixNodes": int(self.shared_prefix_nodes),
            "branchConfidence": float(self.confidence),
        }


def _percentile(values: Sequence[float], factor: float):
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round((len(ordered) - 1) * factor)))
    return float(ordered[index])


def _local_maxima(graph: RegionGraph, distances: Dict, threshold: float):
    maxima = []
    for node, distance in distances.items():
        if distance < threshold:
            continue
        neighbors = graph.adjacency.get(node, [])
        if all(distance >= distances.get(neighbor, -1.0) for neighbor, _weight in neighbors):
            maxima.append(node)
    return maxima


def _select_diverse_endpoints(graph: RegionGraph, wrist: Vector, candidates: Sequence,
                              distances: Dict, hand_scale: float, maximum: int = 5):
    selected = []
    duplicate_cap_distance = max(hand_scale * 0.075, 1e-5)
    ranked = sorted(candidates, key=lambda node: distances.get(node, 0.0), reverse=True)
    for node in ranked:
        point = graph.points[node]
        direction = point - wrist
        if direction.length <= hand_scale * 0.34:
            continue
        if any((point - graph.points[other]).length < duplicate_cap_distance for other in selected):
            continue
        normalized = direction.normalized()
        if any(
            normalized.dot((graph.points[other] - wrist).normalized()) > 0.9995
            and abs(direction.length - (graph.points[other] - wrist).length) < hand_scale * 0.045
            and (point - graph.points[other]).length < hand_scale * 0.10
            for other in selected
        ):
            continue
        selected.append(node)
        if len(selected) >= maximum:
            break
    return selected


def _shared_prefix_length(path: Sequence, all_paths: Sequence[Sequence]):
    count = 0
    for index, node in enumerate(path):
        shared = sum(1 for other in all_paths if index < len(other) and other[index] == node)
        if shared < 2:
            break
        count = index + 1
    return count


def detect_medial_branches(graph: RegionGraph, wrist: Vector, hand_scale: float,
                           expected_maximum: int = 5):
    wrist_node = graph.nearest_node(wrist)
    if wrist_node is None or len(graph.points) < 12:
        return [], {
            "status": "needs_review",
            "reason": "HAND_GRAPH_INSUFFICIENT",
            "graphVertexCount": len(graph.points),
        }
    distances, previous = graph.dijkstra(wrist_node)
    if len(distances) < 12:
        return [], {
            "status": "needs_review",
            "reason": "HAND_GRAPH_DISCONNECTED",
            "reachableVertexCount": len(distances),
        }
    distance_threshold = _percentile(list(distances.values()), 0.78)
    maxima = _local_maxima(graph, distances, distance_threshold)
    endpoints = _select_diverse_endpoints(
        graph, wrist, maxima, distances, hand_scale, expected_maximum,
    )
    raw_paths = []
    for endpoint in endpoints:
        path = [endpoint]
        cursor = endpoint
        while cursor != wrist_node and cursor in previous:
            cursor = previous[cursor]
            path.append(cursor)
        path.reverse()
        raw_paths.append(path)

    branches: List[HandBranch] = []
    for index, (endpoint, path) in enumerate(zip(endpoints, raw_paths)):
        shared_prefix = _shared_prefix_length(path, raw_paths)
        start_index = max(0, shared_prefix - 1)
        unique_path = path[start_index:]
        points = path_points(graph, unique_path)
        if len(points) < 3:
            continue
        centerline = resample_polyline(points, 24)
        geodesic_length = sum((second - first).length for first, second in zip(points, points[1:]))
        direct_length = (points[-1] - points[0]).length
        tortuosity = geodesic_length / max(direct_length, 1e-8)
        length_confidence = max(0.0, min(1.0, geodesic_length / max(hand_scale * 0.55, 1e-8)))
        smoothness_confidence = max(0.0, min(1.0, 1.45 - tortuosity * 0.45))
        confidence = length_confidence * 0.62 + smoothness_confidence * 0.38
        branches.append(HandBranch(
            branch_id=f"branch_{index + 1}",
            endpoint_node=endpoint,
            endpoint=graph.points[endpoint].copy(),
            path_nodes=unique_path,
            centerline=centerline,
            geodesic_length=float(geodesic_length),
            direct_length=float(direct_length),
            shared_prefix_nodes=int(shared_prefix),
            confidence=float(confidence),
        ))

    branches.sort(key=lambda branch: branch.geodesic_length, reverse=True)
    status = "valid" if len(branches) == expected_maximum else "needs_review"
    return branches, {
        "status": status,
        "graphVertexCount": len(graph.points),
        "reachableVertexCount": len(distances),
        "localMaximaCount": len(maxima),
        "endpointCount": len(endpoints),
        "branchCount": len(branches),
        "distanceThreshold": float(distance_threshold),
        "duplicateCapDistance": float(max(hand_scale * 0.075, 1e-5)),
        "method": "surface-geodesic-distal-maxima-plus-shared-prefix-v3",
    }
