"""Geodesic utilities over original CLOUVA mesh connectivity."""
from __future__ import annotations

import heapq
from dataclasses import dataclass
from typing import Dict, Iterable, List, Sequence, Tuple

import bpy
from mathutils import Vector

NodeKey = Tuple[str, int]


@dataclass
class RegionGraph:
    points: Dict[NodeKey, Vector]
    adjacency: Dict[NodeKey, List[Tuple[NodeKey, float]]]
    regions: Tuple[str, ...]

    def nearest_node(self, point: Vector):
        if not self.points:
            return None
        return min(self.points, key=lambda key: (self.points[key] - point).length_squared)

    def dijkstra(self, source: NodeKey, targets: set[NodeKey] | None = None):
        distances: Dict[NodeKey, float] = {source: 0.0}
        previous: Dict[NodeKey, NodeKey] = {}
        queue = [(0.0, source)]
        remaining = set(targets or [])
        while queue:
            distance, node = heapq.heappop(queue)
            if distance != distances.get(node):
                continue
            if node in remaining:
                remaining.remove(node)
                if not remaining:
                    break
            for neighbor, weight in self.adjacency.get(node, []):
                candidate = distance + weight
                if candidate < distances.get(neighbor, float("inf")):
                    distances[neighbor] = candidate
                    previous[neighbor] = node
                    heapq.heappush(queue, (candidate, neighbor))
        return distances, previous

    def shortest_path(self, source: NodeKey, target: NodeKey):
        distances, previous = self.dijkstra(source, {target})
        if target not in distances:
            return [], float("inf")
        path = [target]
        cursor = target
        while cursor != source:
            cursor = previous[cursor]
            path.append(cursor)
        path.reverse()
        return path, float(distances[target])

    def farthest(self, source: NodeKey, candidates: Iterable[NodeKey] | None = None):
        distances, _previous = self.dijkstra(source)
        pool = list(candidates) if candidates is not None else list(distances)
        pool = [node for node in pool if node in distances]
        if not pool:
            return None, 0.0
        node = max(pool, key=lambda value: distances[value])
        return node, float(distances[node])

    def connected_components(self):
        unvisited = set(self.points)
        components = []
        while unvisited:
            root = next(iter(unvisited))
            stack = [root]
            component = []
            unvisited.remove(root)
            while stack:
                node = stack.pop()
                component.append(node)
                for neighbor, _weight in self.adjacency.get(node, []):
                    if neighbor in unvisited:
                        unvisited.remove(neighbor)
                        stack.append(neighbor)
            components.append(component)
        components.sort(key=len, reverse=True)
        return components


def build_region_graph(meshes: Iterable[bpy.types.Object], segmentation,
                       regions: str | Sequence[str]) -> RegionGraph:
    allowed = (regions,) if isinstance(regions, str) else tuple(regions)
    allowed_set = set(allowed)
    points: Dict[NodeKey, Vector] = {}
    adjacency: Dict[NodeKey, List[Tuple[NodeKey, float]]] = {}

    for obj in meshes:
        labels = segmentation.labels.get(obj.name) or []
        if not labels:
            continue
        world = obj.matrix_world
        for vertex in obj.data.vertices:
            if vertex.index < len(labels) and labels[vertex.index] in allowed_set:
                key = (obj.name, int(vertex.index))
                points[key] = world @ vertex.co
                adjacency[key] = []
        for edge in obj.data.edges:
            first_index, second_index = (int(edge.vertices[0]), int(edge.vertices[1]))
            first = (obj.name, first_index)
            second = (obj.name, second_index)
            if first not in points or second not in points:
                continue
            weight = max((points[first] - points[second]).length, 1e-8)
            adjacency[first].append((second, weight))
            adjacency[second].append((first, weight))

    return RegionGraph(points=points, adjacency=adjacency, regions=allowed)


def path_points(graph: RegionGraph, path: Iterable[NodeKey]):
    return [graph.points[node].copy() for node in path if node in graph.points]


def resample_polyline(points: Sequence[Vector], count: int):
    count = max(2, int(count))
    if len(points) < 2:
        return [point.copy() for point in points]
    cumulative = [0.0]
    for first, second in zip(points, points[1:]):
        cumulative.append(cumulative[-1] + (second - first).length)
    total = cumulative[-1]
    if total <= 1e-8:
        return [points[0].copy() for _ in range(count)]
    result = []
    segment = 0
    for index in range(count):
        target = total * index / float(count - 1)
        while segment + 1 < len(cumulative) and cumulative[segment + 1] < target:
            segment += 1
        if segment + 1 >= len(points):
            result.append(points[-1].copy())
            continue
        start_distance = cumulative[segment]
        end_distance = cumulative[segment + 1]
        factor = (target - start_distance) / max(end_distance - start_distance, 1e-8)
        result.append(points[segment].lerp(points[segment + 1], factor))
    return result
