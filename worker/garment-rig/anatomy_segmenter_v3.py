"""Second-pass anatomical segmentation using externally refined V3 joints."""
from __future__ import annotations

from collections import defaultdict
from typing import Dict, Iterable

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
    samples = defaultdict(list)
    rejected_objects = []

    for obj in meshes:
        category = classifications.get(obj.name, "unknown_rejected")
        object_labels = ["unassigned"] * len(obj.data.vertices)
        labels[obj.name] = object_labels
        if category != "body":
            rejected_objects.append({"object": obj.name, "class": category})
            continue
        normal_matrix = obj.matrix_world.to_3x3()
        for vertex in obj.data.vertices:
            point = obj.matrix_world @ vertex.co
            normal = _safe_normal(normal_matrix @ vertex.normal, Vector((0.0, 0.0, 1.0)))
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
            region = best_region or _fallback_region(point, refined, center_x, width, height)
            object_labels[vertex.index] = region
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
        "unassignedVertices": len(samples.get("unassigned", [])),
        "regionCount": len([name for name, values in samples.items() if values]),
        "preservesExternalRefinedVectors": True,
    }
    return AnatomySegmentation(labels, dict(samples), measurements, diagnostics, refined)
