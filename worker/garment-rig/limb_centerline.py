"""Geometry-first limb centerlines and joint evidence for Avatar Analyzer V3."""
from __future__ import annotations

from typing import Dict, Iterable, Sequence

from mathutils import Vector

from cross_section_analyzer import analyze_cross_sections, choose_joint_section
from mesh_geodesics import build_region_graph, path_points, resample_polyline


def _vec(value: Vector):
    return [float(value.x), float(value.y), float(value.z)]


def _linear_centerline(start: Vector, end: Vector, count: int = 33):
    return [start.lerp(end, index / float(max(count - 1, 1))) for index in range(count)]


def _centerline(meshes, segmentation, regions: Sequence[str], start_seed: Vector,
                end_seed: Vector, sample_count: int = 33):
    graph = build_region_graph(meshes, segmentation, regions)
    start_node = graph.nearest_node(start_seed)
    end_node = graph.nearest_node(end_seed)
    if start_node is None or end_node is None:
        return _linear_centerline(start_seed, end_seed, sample_count), {
            "method": "linear-fallback-no-region-graph",
            "geodesicEvidence": 0.0,
            "graphVertexCount": len(graph.points),
        }
    path, distance = graph.shortest_path(start_node, end_node)
    if len(path) < 3 or distance <= 1e-8:
        return _linear_centerline(start_seed, end_seed, sample_count), {
            "method": "linear-fallback-disconnected-region-graph",
            "geodesicEvidence": 0.0,
            "graphVertexCount": len(graph.points),
            "pathVertexCount": len(path),
        }
    points = resample_polyline(path_points(graph, path), sample_count)
    direct = max((end_seed - start_seed).length, 1e-8)
    geodesic_ratio = max(1.0, distance / direct)
    confidence = max(0.35, min(1.0, 1.0 / geodesic_ratio + min(len(path), 80) / 240.0))
    return points, {
        "method": "original-mesh-geodesic-centerline",
        "geodesicEvidence": float(confidence),
        "graphVertexCount": len(graph.points),
        "pathVertexCount": len(path),
        "geodesicLength": float(distance),
        "directLength": float(direct),
        "geodesicRatio": float(geodesic_ratio),
    }


def _refine_chain(meshes, segmentation, vectors: Dict[str, Vector], side: str,
                  regions: Sequence[str], start_name: str, middle_name: str,
                  distal_name: str, end_name: str, middle_prior: float,
                  distal_prior: float):
    start_seed = vectors[start_name].copy()
    end_seed = vectors[end_name].copy()
    centerline, geodesic = _centerline(
        meshes, segmentation, regions, start_seed, end_seed,
    )
    cloud = segmentation.region_points(regions)
    sections = analyze_cross_sections(cloud, centerline)
    middle_section, middle_evidence = choose_joint_section(
        sections, middle_prior, search_window=0.27,
    )
    distal_section, distal_evidence = choose_joint_section(
        sections, distal_prior, search_window=0.18,
    )
    start = sections[0].center if sections and sections[0].point_count >= 3 else start_seed
    end = sections[-1].center if sections and sections[-1].point_count >= 3 else end_seed
    middle = middle_section.center if middle_section is not None else centerline[round((len(centerline) - 1) * middle_prior)]
    distal = distal_section.center if distal_section is not None else centerline[round((len(centerline) - 1) * distal_prior)]

    # Preserve anatomical order even when weak section evidence chooses adjacent bins.
    total = sum((second - first).length for first, second in zip(centerline, centerline[1:]))
    minimum_gap = max(total * 0.08, 1e-5)
    if (middle - start).length < minimum_gap:
        middle = centerline[round((len(centerline) - 1) * middle_prior)]
        middle_evidence["orderFallbackApplied"] = True
    if (distal - middle).length < minimum_gap or (end - distal).length < minimum_gap * 0.35:
        distal = centerline[round((len(centerline) - 1) * distal_prior)]
        distal_evidence["orderFallbackApplied"] = True

    return {
        start_name: start,
        middle_name: middle,
        distal_name: distal,
        end_name: end,
    }, {
        "side": side,
        "regions": list(regions),
        "centerline": [_vec(point) for point in centerline],
        "sections": [section.as_dict() for section in sections],
        "geodesicEvidence": geodesic,
        middle_name: middle_evidence,
        distal_name: distal_evidence,
        "method": "geodesic-medial-path-plus-cross-section-evidence-v3",
    }


def refine_limb_joints(meshes: Iterable, segmentation, vectors: Dict[str, Vector]):
    meshes = list(meshes)
    refined = {name: value.copy() for name, value in vectors.items()}
    diagnostics = {}
    for suffix, side in (("l", "left"), ("r", "right")):
        arm, arm_diagnostics = _refine_chain(
            meshes, segmentation, refined, side,
            (f"upper_arm_{suffix}", f"forearm_{suffix}", f"hand_{suffix}"),
            f"shoulder_{suffix}", f"elbow_{suffix}", f"wrist_{suffix}", f"hand_{suffix}",
            middle_prior=0.46, distal_prior=0.79,
        )
        refined.update(arm)
        diagnostics[f"arm_{suffix}"] = arm_diagnostics

        leg, leg_diagnostics = _refine_chain(
            meshes, segmentation, refined, side,
            (f"thigh_{suffix}", f"calf_{suffix}", f"foot_{suffix}"),
            f"hip_{suffix}", f"knee_{suffix}", f"ankle_{suffix}", f"foot_{suffix}",
            middle_prior=0.50, distal_prior=0.84,
        )
        refined.update(leg)
        diagnostics[f"leg_{suffix}"] = leg_diagnostics

    return refined, {
        "version": "clouva-limb-centerline-v3",
        "limbs": diagnostics,
        "usesFixedPercentagesAsFinalAnswer": False,
        "priorRole": "weak-search-prior-and-fallback-only",
    }
