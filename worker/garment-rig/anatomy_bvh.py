"""Boundary-aware global and regional BVHs for CLOUVA Avatar Analyzer V4.1.

Every valid body triangle is kept in the global BVH.  Mixed semantic labels are
represented as weighted metadata and are shared with compatible regional BVHs;
they are never deleted merely because they cross an anatomical boundary.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Iterable, List, Sequence, Tuple

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

from anatomy_semantics import (
    ANATOMICAL_ADJACENCY,
    UNASSIGNED_REGION,
    are_anatomical_neighbors,
    region_match,
    triangle_semantics,
)


@dataclass(frozen=True)
class TriangleMetadata:
    global_triangle_id: int
    primary_region: str
    secondary_regions: Tuple[str, ...]
    region_weights: Tuple[Tuple[str, float], ...]
    is_boundary: bool
    source_object: str
    source_polygon: int
    source_vertices: Tuple[int, int, int]
    material_index: int
    component: str

    @property
    def region(self) -> str:
        return self.primary_region

    def weights_dict(self) -> dict[str, float]:
        return {name: float(weight) for name, weight in self.region_weights}


@dataclass
class RegionGeometry:
    name: str
    vertices: List[Vector]
    triangles: List[Tuple[int, int, int]]
    metadata: List[TriangleMetadata]
    bvh: BVHTree

    def _hit(self, location, normal, triangle_index, distance):
        if location is None or triangle_index is None:
            return None
        local_triangle_index = int(triangle_index)
        metadata = self.metadata[local_triangle_index]
        triangle = self.triangles[local_triangle_index]
        world_vertices = [self.vertices[index] for index in triangle]
        return {
            "location": location,
            "normal": normal,
            "triangleIndex": int(metadata.global_triangle_id),
            "localTriangleIndex": local_triangle_index,
            "triangleWorldVertices": [list(map(float, point)) for point in world_vertices],
            "distance": float(distance),
            "region": metadata.primary_region,
            "primaryRegion": metadata.primary_region,
            "secondaryRegions": list(metadata.secondary_regions),
            "semanticWeights": metadata.weights_dict(),
            "isBoundaryTriangle": bool(metadata.is_boundary),
            "sourceObject": metadata.source_object,
            "sourcePolygon": metadata.source_polygon,
            "sourceVertices": list(metadata.source_vertices),
            "materialIndex": metadata.material_index,
            "component": metadata.component,
        }

    def ray_cast(self, origin: Vector, direction: Vector, max_distance: float = 10000.0):
        return self._hit(*self.bvh.ray_cast(origin, direction, max_distance))

    def nearest(self, point: Vector, max_distance: float = 10000.0):
        return self._hit(*self.bvh.find_nearest(point, max_distance))

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
    def __init__(
        self,
        regions: Dict[str, RegionGeometry],
        global_geometry: RegionGeometry | None,
        rejected: List[dict],
        body_source_triangle_count: int,
    ):
        self.regions = regions
        self.global_geometry = global_geometry
        self.rejected = rejected
        self.body_source_triangle_count = int(body_source_triangle_count)
        semantic_names = {
            name
            for geometry in regions.values()
            for metadata in geometry.metadata
            for name in (metadata.primary_region, *metadata.secondary_regions)
            if name != UNASSIGNED_REGION
        }
        self.region_ids = {
            name: index + 1
            for index, name in enumerate(sorted(semantic_names))
        }
        object_names = sorted({
            metadata.source_object
            for geometry in ([global_geometry] if global_geometry else [])
            for metadata in geometry.metadata
        })
        self.object_ids = {name: index + 1 for index, name in enumerate(object_names)}

    def has_region(self, region: str) -> bool:
        geometry = self.regions.get(region)
        return bool(geometry and geometry.triangles)

    def _annotate(self, hit: dict | None, requested: Iterable[str] | None = None):
        if hit is None:
            return None
        if requested is None:
            accepted, match_kind, penalty = True, "global", 1.0
        else:
            accepted, match_kind, penalty = region_match(
                hit.get("primaryRegion") or hit.get("region") or UNASSIGNED_REGION,
                hit.get("secondaryRegions") or (),
                requested,
                bool(hit.get("isBoundaryTriangle")),
            )
        if not accepted:
            return None
        hit["regionMatchType"] = match_kind
        hit["regionConfidencePenalty"] = float(penalty)
        hit["regionId"] = self.region_ids.get(hit.get("primaryRegion") or "", 0)
        hit["primaryRegionId"] = hit["regionId"]
        hit["secondaryRegionIds"] = [
            self.region_ids[name]
            for name in hit.get("secondaryRegions") or []
            if name in self.region_ids
        ]
        hit["objectId"] = self.object_ids.get(hit.get("sourceObject") or "", 0)
        return hit

    def ray_cast_global(self, origin: Vector, direction: Vector, max_distance: float = 10000.0):
        if self.global_geometry is None:
            return None
        return self._annotate(self.global_geometry.ray_cast(origin, direction, max_distance))

    def nearest_global(self, point: Vector, max_distance: float = 10000.0):
        if self.global_geometry is None:
            return None
        return self._annotate(self.global_geometry.nearest(point, max_distance))

    def ray_cast(
        self,
        origin: Vector,
        direction: Vector,
        regions: str | Iterable[str] | None = None,
        max_distance: float = 10000.0,
    ):
        if regions is None:
            return self.ray_cast_global(origin, direction, max_distance)
        names = [regions] if isinstance(regions, str) else list(regions)
        candidates = []
        seen = set()
        for name in names:
            geometry = self.regions.get(name)
            if geometry is None:
                continue
            hit = self._annotate(geometry.ray_cast(origin, direction, max_distance), names)
            if hit is None:
                continue
            key = int(hit["triangleIndex"])
            if key not in seen:
                candidates.append(hit)
                seen.add(key)
        if not candidates:
            return None
        return min(
            candidates,
            key=lambda item: (
                float(item["distance"]),
                -float(item.get("regionConfidencePenalty") or 0.0),
                int(item["triangleIndex"]),
            ),
        )

    def nearest(
        self,
        point: Vector,
        regions: str | Iterable[str] | None = None,
        max_distance: float = 10000.0,
    ):
        if regions is None:
            return self.nearest_global(point, max_distance)
        names = [regions] if isinstance(regions, str) else list(regions)
        candidates = []
        seen = set()
        for name in names:
            geometry = self.regions.get(name)
            if geometry is None:
                continue
            hit = self._annotate(geometry.nearest(point, max_distance), names)
            if hit is None:
                continue
            key = int(hit["triangleIndex"])
            if key not in seen:
                candidates.append(hit)
                seen.add(key)
        if not candidates:
            return None
        return min(
            candidates,
            key=lambda item: (
                float(item["distance"]),
                -float(item.get("regionConfidencePenalty") or 0.0),
                int(item["triangleIndex"]),
            ),
        )

    def proxy(self, regions: str | Iterable[str], name: str):
        names = [regions] if isinstance(regions, str) else list(regions)
        vertices: List[Vector] = []
        triangles: List[Tuple[int, int, int]] = []
        sources = []
        included_global_ids = set()
        for region in names:
            geometry = self.regions.get(region)
            if geometry is None:
                continue
            for triangle, metadata in zip(geometry.triangles, geometry.metadata):
                if metadata.global_triangle_id in included_global_ids:
                    continue
                included_global_ids.add(metadata.global_triangle_id)
                offset = len(vertices)
                vertices.extend(geometry.vertices[index].copy() for index in triangle)
                triangles.append((offset, offset + 1, offset + 2))
                sources.append(metadata)
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
        total = len(self.global_geometry.triangles) if self.global_geometry else 0
        metadata = self.global_geometry.metadata if self.global_geometry else []
        boundary_count = sum(1 for item in metadata if item.is_boundary)
        explained = sum(1 for item in metadata if item.primary_region != UNASSIGNED_REGION)
        coverage = total / max(self.body_source_triangle_count, 1)
        semantic_coverage = explained / max(self.body_source_triangle_count, 1)
        return {
            "version": "clouva-region-bvh-v4.1",
            "regionCount": len(self.regions),
            "regions": {
                name: {
                    "vertexCount": len(geometry.vertices),
                    "triangleCount": len(geometry.triangles),
                    "uniqueTriangleCount": len({item.global_triangle_id for item in geometry.metadata}),
                    "boundaryTriangleCount": sum(1 for item in geometry.metadata if item.is_boundary),
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
            "adjacency": [list(pair) for pair in sorted(ANATOMICAL_ADJACENCY)],
            "totalBodyTriangles": self.body_source_triangle_count,
            "globalTriangleCount": total,
            "boundaryTriangleCount": boundary_count,
            "discardedTriangleCount": len(self.rejected),
            "rejectedPolygonCount": len(self.rejected),
            "rejectedPolygons": self.rejected[:250],
            "geometricCoverage": float(coverage),
            "semanticCoverage": float(semantic_coverage),
            "coverageTargetMet": bool(coverage >= 0.995),
        }


def _triangulate(indices: Sequence[int]):
    if len(indices) < 3:
        return []
    first = int(indices[0])
    return [
        (first, int(indices[index]), int(indices[index + 1]))
        for index in range(1, len(indices) - 1)
    ]


def _query_regions(primary: str, secondary: Iterable[str], boundary: bool) -> set[str]:
    regions = {primary, *secondary}
    if boundary:
        semantic = set(regions)
        regions.update({
            candidate
            for pair in ANATOMICAL_ADJACENCY
            for candidate in pair
            if any(are_anatomical_neighbors(candidate, region) for region in semantic)
        })
    return {region for region in regions if region != UNASSIGNED_REGION}


def _make_geometry(
    name: str,
    primitives: list[tuple[Sequence[Vector], TriangleMetadata]],
) -> RegionGeometry | None:
    if not primitives:
        return None
    vertices: List[Vector] = []
    triangles: List[Tuple[int, int, int]] = []
    metadata: List[TriangleMetadata] = []
    for points, record in primitives:
        if len(points) != 3:
            continue
        offset = len(vertices)
        vertices.extend(point.copy() for point in points)
        triangles.append((offset, offset + 1, offset + 2))
        metadata.append(record)
    if not triangles:
        return None
    return RegionGeometry(
        name=name,
        vertices=vertices,
        triangles=triangles,
        metadata=metadata,
        bvh=BVHTree.FromPolygons(vertices, triangles, all_triangles=True),
    )


def build_anatomy_bvh(
    meshes: Iterable[bpy.types.Object],
    segmentation,
    classifications: Dict[str, str],
) -> AnatomyBVH:
    regional_primitives: Dict[str, list[tuple[Sequence[Vector], TriangleMetadata]]] = {}
    global_primitives: list[tuple[Sequence[Vector], TriangleMetadata]] = []
    rejected: List[dict] = []
    body_source_triangle_count = 0
    global_triangle_id = 0

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
            triangles = _triangulate(source_indices)
            body_source_triangle_count += len(triangles)
            for triangle in triangles:
                points = [world @ obj.data.vertices[index].co for index in triangle]
                if len({tuple(round(float(value), 12) for value in point) for point in points}) < 3:
                    rejected.append({
                        "object": obj.name,
                        "polygon": int(polygon.index),
                        "vertices": list(triangle),
                        "reason": "DEGENERATE_TRIANGLE",
                    })
                    continue
                semantics = (
                    {
                        "primary_region": "eyes",
                        "secondary_regions": (),
                        "region_weights": {"eyes": 1.0},
                        "is_boundary": False,
                    }
                    if category == "eyes"
                    else triangle_semantics(labels, triangle)
                )
                metadata = TriangleMetadata(
                    global_triangle_id=global_triangle_id,
                    primary_region=str(semantics["primary_region"]),
                    secondary_regions=tuple(semantics["secondary_regions"]),
                    region_weights=tuple(
                        (str(name), float(weight))
                        for name, weight in semantics["region_weights"].items()
                    ),
                    is_boundary=bool(semantics["is_boundary"]),
                    source_object=obj.name,
                    source_polygon=int(polygon.index),
                    source_vertices=tuple(int(value) for value in triangle),
                    material_index=int(polygon.material_index),
                    component=obj.name,
                )
                global_primitives.append((points, metadata))
                for region in _query_regions(
                    metadata.primary_region,
                    metadata.secondary_regions,
                    metadata.is_boundary,
                ):
                    regional_primitives.setdefault(region, []).append((points, metadata))
                global_triangle_id += 1

    global_geometry = _make_geometry("__global_body__", global_primitives)
    regions = {
        name: geometry
        for name, primitives in regional_primitives.items()
        if (geometry := _make_geometry(name, primitives)) is not None
    }
    return AnatomyBVH(
        regions,
        global_geometry,
        rejected,
        body_source_triangle_count,
    )
