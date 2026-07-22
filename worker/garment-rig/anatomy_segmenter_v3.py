"""Second-pass anatomical segmentation using externally refined V3 joints."""
from __future__ import annotations

from collections import Counter, defaultdict
from typing import Dict, Iterable, List, Sequence

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


def _percentile(values: Sequence[float], factor: float):
    if not values:
        return float("inf")
    ordered = sorted(float(value) for value in values)
    index = min(len(ordered) - 1, max(0, round((len(ordered) - 1) * factor)))
    return ordered[index]


def _component_corridor_candidate(points: Sequence[Vector], specs: dict,
                                  center_x: float, width: float):
    """Choose the limb corridor that best explains an entire component.

    This uses robust component-level evidence instead of allowing a few fallback
    torso labels to dominate a disconnected arm, hand or shoe component.
    """
    candidates = []
    for region, (start, end, radius, sign) in specs.items():
        scores = []
        inside = 0
        for point in points:
            signed_lateral = sign * (point.x - center_x)
            lower_limb = region.startswith(("thigh_", "calf_", "foot_"))
            lateral_floor = width * (0.012 if lower_limb else 0.055)
            if signed_lateral < lateral_floor:
                continue
            distance, raw_t, _closest = _segment_distance(point, start, end)
            outside = max(0.0, -raw_t, raw_t - 1.0)
            score = distance / max(radius, 1e-6) + outside * 2.4
            scores.append(score)
            if score <= 2.15:
                inside += 1
        coverage = len(scores) / float(max(len(points), 1))
        inside_fraction = inside / float(max(len(points), 1))
        if coverage < 0.20 or inside_fraction < 0.12:
            continue
        robust_score = _percentile(scores, 0.55)
        metric = robust_score + (1.0 - inside_fraction) * 0.85 + (1.0 - coverage) * 0.45
        candidates.append({
            "region": region,
            "metric": float(metric),
            "robustScore": float(robust_score),
            "coverage": float(coverage),
            "insideFraction": float(inside_fraction),
        })
    if not candidates:
        return None
    candidates.sort(key=lambda item: (item["metric"], -item["insideFraction"], -item["coverage"]))
    best = candidates[0]
    if best["metric"] > 3.05:
        return None
    return best


def _cohere_small_components(obj: bpy.types.Object, object_labels: List[str],
                             specs: dict, center_x: float, width: float):
    """Stabilize disconnected anatomy using component-wide geometric evidence.

    The largest connected body component stays vertex-segmented. Smaller pieces
    such as Meshy hands, shoes, eyes embedded in the body mesh, or synthetic test
    limbs are assigned by their best anatomical corridor. Label plurality remains
    a fallback for head/neck/torso components that are not represented by a limb
    corridor.
    """
    total = max(len(object_labels), 1)
    changes = []
    for component in _connected_components(obj):
        if len(component) > total * 0.30 or len(component) < 4:
            continue
        points = [obj.matrix_world @ obj.data.vertices[index].co for index in component]
        previous = Counter(object_labels[index] for index in component)
        non_unassigned = Counter({
            label: count for label, count in previous.items() if label != "unassigned"
        })
        ranked = non_unassigned.most_common(2)
        plurality_region = ranked[0][0] if ranked else None
        plurality_count = ranked[0][1] if ranked else 0
        second_count = ranked[1][1] if len(ranked) > 1 else 0
        support = plurality_count / float(len(component))
        margin = (plurality_count - second_count) / float(len(component))
        corridor = _component_corridor_candidate(points, specs, center_x, width)

        selected_region = None
        selection_method = None
        if corridor is not None:
            plurality_is_limb = bool(plurality_region and plurality_region in specs)
            corridor_is_strong = (
                corridor["insideFraction"] >= 0.30
                or corridor["metric"] <= 2.30
            )
            corridor_beats_plurality = (
                not plurality_is_limb
                or support < 0.58
                or corridor["region"] == plurality_region
            )
            if corridor_is_strong and corridor_beats_plurality:
                selected_region = corridor["region"]
                selection_method = "component-anatomy-corridor"

        if selected_region is None and plurality_region is not None:
            if plurality_count >= 4 and support >= 0.34 and margin >= 0.08:
                selected_region = plurality_region
                selection_method = "component-label-plurality"

        if selected_region is None:
            continue
        for index in component:
            object_labels[index] = selected_region
        changes.append({
            "object": obj.name,
            "vertexCount": len(component),
            "selectedRegion": selected_region,
            "selectionMethod": selection_method,
            "support": float(support),
            "margin": float(margin),
            "corridorEvidence": corridor,
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
        component_changes.extend(
            _cohere_small_components(obj, object_labels, specs, center_x, width)
        )

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
        "method": "geodesic-cross-section-vectors-plus-component-corridors-v3",
        "limbRefinement": refinement_diagnostics or {},
        "rejectedObjects": rejected_objects,
        "componentCoherence": component_changes,
        "unassignedVertices": len(samples.get("unassigned", [])),
        "regionCount": len([name for name, values in samples.items() if values]),
        "preservesExternalRefinedVectors": True,
    }
    return AnatomySegmentation(labels, dict(samples), measurements, diagnostics, refined)
