"""Second-pass anatomical segmentation using externally refined V3 joints."""
from __future__ import annotations

from collections import Counter, defaultdict
from typing import Dict, Iterable, List

import bpy
from mathutils import Vector

from anatomy_segmenter import (
    AnatomySegmentation,
    VertexSample,
    _fallback_region,
    _measure_hand,
    _region_specs,
    _safe_normal,
    _segment_distance,
)


def _connected_components(obj: bpy.types.Object):
    adjacency: List[List[int]] = [[] for _ in obj.data.vertices]
    for edge in obj.data.edges:
        first, second = int(edge.vertices[0]), int(edge.vertices[1])
        adjacency[first].append(second)
        adjacency[second].append(first)
    unvisited = set(range(len(obj.data.vertices)))
    components = []
    while unvisited:
        root = next(iter(unvisited))
        unvisited.remove(root)
        stack = [root]
        component = []
        while stack:
            index = stack.pop()
            component.append(index)
            for neighbor in adjacency[index]:
                if neighbor in unvisited:
                    unvisited.remove(neighbor)
                    stack.append(neighbor)
        components.append(component)
    components.sort(key=len, reverse=True)
    return components


def _cohere_small_components(obj: bpy.types.Object, object_labels: List[str]):
    """Stabilize disconnected body pieces without flattening a connected avatar.

    Meshy and synthetic fixtures can store hands, shoes or the head as separate
    connected components inside one mesh object. Per-vertex corridor labels may
    split a small component across neighboring regions. A small component is
    relabeled only when it has a clear non-unassigned plurality; the main body
    component remains untouched.
    """
    total = max(len(object_labels), 1)
    changes = []
    for component in _connected_components(obj):
        if len(component) > total * 0.22 or len(component) < 4:
            continue
        counts = Counter(
            object_labels[index]
            for index in component
            if object_labels[index] != "unassigned"
        )
        if not counts:
            continue
        ranked = counts.most_common(2)
        region, count = ranked[0]
        second_count = ranked[1][1] if len(ranked) > 1 else 0
        support = count / float(len(component))
        margin = (count - second_count) / float(len(component))
        if count < 4 or support < 0.34 or margin < 0.08:
            continue
        previous = Counter(object_labels[index] for index in component)
        for index in component:
            object_labels[index] = region
        changes.append({
            "object": obj.name,
            "vertexCount": len(component),
            "selectedRegion": region,
            "support": float(support),
            "margin": float(margin),
            "previousLabels": dict(previous),
        })
    return changes


def segment_anatomy_v3(meshes: Iterable[bpy.types.Object], classifications: Dict[str, str],
                       refined_vectors: Dict[str, Vector], dimensions: dict,
                       refinement_diagnostics: dict | None = None):
    meshes = list(meshes)
    height = max(float(dimensions.get("height") or 0.0), 1e-5)
    width = max(float(dimensions.get("width") or 0.0), 1e-5)
    center_x = float((dimensions.get("center") or [0.0])[0])
    refined = {name: value.copy() for name, value in refined_vectors.items()}
    specs = _region_specs(refined, height)
    labels = {}
    rejected_objects = []
    component_changes = []

    for obj in meshes:
        category = classifications.get(obj.name, "unknown_rejected")
        object_labels = ["unassigned"] * len(obj.data.vertices)
        labels[obj.name] = object_labels
        if category != "body":
            rejected_objects.append({"object": obj.name, "class": category})
            continue
        for vertex in obj.data.vertices:
            point = obj.matrix_world @ vertex.co
            best_region = None
            best_score = float("inf")
            for region, (start, end, radius, sign) in specs.items():
                signed_lateral = sign * (point.x - center_x)
                lower_limb = region.startswith(("thigh_", "calf_", "foot_"))
                if signed_lateral < width * (0.018 if lower_limb else 0.075):
                    continue
                distance, raw_t, _closest = _segment_distance(point, start, end)
                outside = max(0.0, -raw_t, raw_t - 1.0)
                score = distance / max(radius, 1e-6) + outside * 3.0
                if score < best_score and score <= 1.70:
                    best_region = region
                    best_score = score
            object_labels[vertex.index] = best_region or _fallback_region(
                point, refined, center_x, width, height,
            )
        component_changes.extend(_cohere_small_components(obj, object_labels))

    # Build samples after component coherence so BVHs and measurements consume
    # exactly the final labels.
    samples = defaultdict(list)
    for obj in meshes:
        if classifications.get(obj.name, "unknown_rejected") != "body":
            continue
        object_labels = labels[obj.name]
        normal_matrix = obj.matrix_world.to_3x3()
        for vertex in obj.data.vertices:
            point = obj.matrix_world @ vertex.co
            normal = _safe_normal(normal_matrix @ vertex.normal, Vector((0.0, 0.0, 1.0)))
            region = object_labels[vertex.index]
            samples[region].append(VertexSample(obj.name, vertex.index, point, normal, region))

    measurements = {
        "leftHand": _measure_hand(
            [item.point for item in samples.get("hand_l", [])], refined["wrist_l"], refined["hand_l"],
        ),
        "rightHand": _measure_hand(
            [item.point for item in samples.get("hand_r", [])], refined["wrist_r"], refined["hand_r"],
        ),
    }
    diagnostics = {
        "method": "geodesic-cross-section-vectors-plus-region-corridors-v3",
        "limbRefinement": refinement_diagnostics or {},
        "rejectedObjects": rejected_objects,
        "componentCoherence": component_changes,
        "unassignedVertices": len(samples.get("unassigned", [])),
        "regionCount": len([name for name, values in samples.items() if values]),
        "preservesExternalRefinedVectors": True,
    }
    return AnatomySegmentation(labels, dict(samples), measurements, diagnostics, refined)
