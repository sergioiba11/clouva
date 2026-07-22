"""Region-exact BVH geometry for CLOUVA Avatar Analyzer V3.

The same triangulated region data is used for technical renders, ray projection,
nearest-surface queries and diagnostic metadata. This removes the V2 mismatch
where MediaPipe saw an isolated proxy but Blender projected against the complete
body object.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Iterable, List, Sequence, Tuple

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree


@dataclass(frozen=True)
class TriangleMetadata:
    region: str
    source_object: str
    source_polygon: int
    source_vertices: Tuple[int, int, int]
    material_index: int
    component: str


@dataclass
class RegionGeometry:
    name: str
    vertices: List[Vector]
    triangles: List[Tuple[int, int, int]]
    metadata: List[TriangleMetadata]
    bvh: BVHTree

    def ray_cast(self, origin: Vector, direction: Vector, max_distance: float = 10000.0):
        location, normal, triangle_index, distance = self.bvh.ray_cast(
            origin, direction, max_distance,
        )
        if location is None or triangle_index is None:
            return None
        metadata = self.metadata[int(triangle_index)]
        return {
            "location": location,
            "normal": normal,
            "triangleIndex": int(triangle_index),
            "distance": float(distance),
            "region": self.name,
            "sourceObject": metadata.source_object,
            "sourcePolygon": metadata.source_polygon,
            "sourceVertices": list(metadata.source_vertices),
            "materialIndex": metadata.material_index,
            "component": metadata.component,
        }

    def nearest(self, point: Vector, max_distance: float = 10000.0):
        location, normal, triangle_index, distance = self.bvh.find_nearest(point, max_distance)
        if location is None or triangle_index is None:
            return None
        metadata = self.metadata[int(triangle_index)]
        return {
            "location": location,
            "normal": normal,
            "triangleIndex": int(triangle_index),
            "distance": float(distance),
            "region": self.name,
            "sourceObject": metadata.source_object,
            "sourcePolygon": metadata.source_polygon,
            "sourceVertices": list(metadata.source_vertices),
            "materialIndex": metadata.material_index,
            "component": metadata.component,
        }

    def bounds(self):
        if not self.vertices:
            return {
                "minimum": [0.0, 0.0, 0.0],
                "maximum": [0.0, 0.0, 0.0],
                "center": [0.0, 0.0, 0.0],
                "size": [0.0, 0.0, 0.0],
            }
        minimum = Vector(tuple(min(point[axis] for point in self.vertices) for axis in range(3)))
        maximum = Vector(tuple(max(point[axis] for point in self.vertices) for axis in range(3)))
        center = (minimum + maximum) * 0.5
        size = maximum - minimum
        return {
            "minimum": [float(value) for value in minimum],
            "maximum": [float(value) for value in maximum],
            "center": [float(value) for value in center],
            "size": [float(value) for value in size],
        }


class AnatomyBVH:
    def __init__(self, regions: Dict[str, RegionGeometry], rejected: List[dict]):
        self.regions = regions
        self.rejected = rejected
        self.region_ids = {name: index + 1 for index, name in enumerate(sorted(regions))}
        object_names = sorted({
            meta.source_object
            for geometry in regions.values()
            for meta in geometry.metadata
        })
        self.object_ids = {name: index + 1 for index, name in enumerate(object_names)}

    def has_region(self, region: str) -> bool:
        geometry = self.regions.get(region)
        return bool(geometry and geometry.triangles)

    def ray_cast(self, origin: Vector, direction: Vector,
                 regions: str | Iterable[str], max_distance: float = 10000.0):
        names = [regions] if isinstance(regions, str) else list(regions)
        best = None
        for name in names:
            geometry = self.regions.get(name)
            if geometry is None:
                continue
            hit = geometry.ray_cast(origin, direction, max_distance)
            if hit is None:
                continue
            if best is None or hit["distance"] < best["distance"]:
                best = hit
        if best is not None:
            best["regionId"] = self.region_ids.get(best["region"], 0)
            best["objectId"] = self.object_ids.get(best["sourceObject"], 0)
        return best

    def nearest(self, point: Vector, regions: str | Iterable[str], max_distance: float = 10000.0):
        names = [regions] if isinstance(regions, str) else list(regions)
        best = None
        for name in names:
            geometry = self.regions.get(name)
            if geometry is None:
                continue
            hit = geometry.nearest(point, max_distance)
            if hit is None:
                continue
            if best is None or hit["distance"] < best["distance"]:
                best = hit
        if best is not None:
            best["regionId"] = self.region_ids.get(best["region"], 0)
            best["objectId"] = self.object_ids.get(best["sourceObject"], 0)
        return best

    def proxy(self, regions: str | Iterable[str], name: str):
        names = [regions] if isinstance(regions, str) else list(regions)
        vertices: List[Vector] = []
        triangles: List[Tuple[int, int, int]] = []
        sources = []
        for region in names:
            geometry = self.regions.get(region)
            if geometry is None:
                continue
            offset = len(vertices)
            vertices.extend(point.copy() for point in geometry.vertices)
            triangles.extend(tuple(offset + value for value in triangle) for triangle in geometry.triangles)
            sources.extend(geometry.metadata)
        if not triangles:
            return None
        mesh = bpy.data.meshes.new(f"{name}_MESH")
        mesh.from_pydata([tuple(point) for point in vertices], [], triangles)
        mesh.update()
        proxy = bpy.data.objects.new(name, mesh)
        bpy.context.collection.objects.link(proxy)
        proxy["clouva_render_proxy"] = True
        proxy["anatomy_regions"] = names
        proxy["triangle_count"] = len(triangles)
        proxy["source_objects"] = sorted({item.source_object for item in sources})
        return proxy

    def report(self) -> dict:
        return {
            "version": "clouva-region-bvh-v3",
            "regionCount": len(self.regions),
            "regions": {
                name: {
                    "vertexCount": len(geometry.vertices),
                    "triangleCount": len(geometry.triangles),
                    "sourceObjects": sorted({item.source_object for item in geometry.metadata}),
                    "sourcePolygons": len({(item.source_object, item.source_polygon) for item in geometry.metadata}),
                    "bounds": geometry.bounds(),
                    "firstVertices": [
                        [float(value) for value in point]
                        for point in geometry.vertices[:6]
                    ],
                    "firstTriangles": [list(triangle) for triangle in geometry.triangles[:4]],
                }
                for name, geometry in sorted(self.regions.items())
            },
            "regionIds": self.region_ids,
            "objectIds": self.object_ids,
            "rejectedPolygonCount": len(self.rejected),
            "rejectedPolygons": self.rejected[:250],
        }


def _triangulate(indices: Sequence[int]):
    if len(indices) < 3:
        return []
    first = int(indices[0])
    return [(first, int(indices[index]), int(indices[index + 1])) for index in range(1, len(indices) - 1)]


def _majority_region(labels: Sequence[str], indices: Sequence[int]):
    counts: Dict[str, int] = {}
    for index in indices:
        region = labels[int(index)] if int(index) < len(labels) else "unassigned"
        counts[region] = counts.get(region, 0) + 1
    if not counts:
        return None
    region, count = max(counts.items(), key=lambda item: item[1])
    minimum = max(3, int(len(indices) * 0.67 + 0.999))
    if region == "unassigned" or count < minimum:
        return None
    return region


def build_anatomy_bvh(meshes: Iterable[bpy.types.Object], segmentation,
                      classifications: Dict[str, str]) -> AnatomyBVH:
    region_vertices: Dict[str, List[Vector]] = {}
    region_triangles: Dict[str, List[Tuple[int, int, int]]] = {}
    region_metadata: Dict[str, List[TriangleMetadata]] = {}
    rejected: List[dict] = []

    def append_triangle(region: str, points: Sequence[Vector], metadata: TriangleMetadata):
        vertices = region_vertices.setdefault(region, [])
        triangles = region_triangles.setdefault(region, [])
        records = region_metadata.setdefault(region, [])
        offset = len(vertices)
        vertices.extend(point.copy() for point in points)
        triangles.append((offset, offset + 1, offset + 2))
        records.append(metadata)

    for obj in meshes:
        category = classifications.get(obj.name, "unknown_rejected")
        labels = list((segmentation.labels.get(obj.name) if segmentation is not None else None) or [])
        world = obj.matrix_world.copy()
        if category == "eyes":
            labels = ["eyes"] * len(obj.data.vertices)
        elif category != "body":
            continue

        for polygon in obj.data.polygons:
            source_indices = list(polygon.vertices)
            region = "eyes" if category == "eyes" else _majority_region(labels, source_indices)
            if region is None:
                rejected.append({
                    "object": obj.name,
                    "polygon": int(polygon.index),
                    "reason": "MIXED_OR_UNASSIGNED_REGION",
                    "labels": sorted({labels[index] if index < len(labels) else "missing" for index in source_indices}),
                })
                continue
            for triangle in _triangulate(source_indices):
                points = [world @ obj.data.vertices[index].co for index in triangle]
                append_triangle(
                    region,
                    points,
                    TriangleMetadata(
                        region=region,
                        source_object=obj.name,
                        source_polygon=int(polygon.index),
                        source_vertices=tuple(int(value) for value in triangle),
                        material_index=int(polygon.material_index),
                        component=obj.name,
                    ),
                )

    regions: Dict[str, RegionGeometry] = {}
    for region, triangles in region_triangles.items():
        vertices = region_vertices[region]
        if not triangles:
            continue
        bvh = BVHTree.FromPolygons(vertices, triangles, all_triangles=True)
        regions[region] = RegionGeometry(
            name=region,
            vertices=vertices,
            triangles=triangles,
            metadata=region_metadata[region],
            bvh=bvh,
        )
    return AnatomyBVH(regions, rejected)
