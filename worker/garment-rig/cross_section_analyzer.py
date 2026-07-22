"""Cross-section evidence for limb joint refinement."""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import List, Sequence

from mathutils import Vector


@dataclass
class CrossSection:
    index: int
    factor: float
    center: Vector
    tangent: Vector
    point_count: int
    mean_radius: float
    major_radius: float
    minor_radius: float
    area_proxy: float
    curvature: float

    def as_dict(self):
        return {
            "index": self.index,
            "factor": float(self.factor),
            "center": [float(self.center.x), float(self.center.y), float(self.center.z)],
            "tangent": [float(self.tangent.x), float(self.tangent.y), float(self.tangent.z)],
            "pointCount": self.point_count,
            "meanRadius": float(self.mean_radius),
            "majorRadius": float(self.major_radius),
            "minorRadius": float(self.minor_radius),
            "areaProxy": float(self.area_proxy),
            "curvature": float(self.curvature),
        }


def _safe_normal(value: Vector, fallback: Vector):
    result = value.copy()
    if result.length <= 1e-8:
        result = fallback.copy()
    if result.length > 1e-8:
        result.normalize()
    return result


def _basis(tangent: Vector):
    tangent = _safe_normal(tangent, Vector((0.0, 0.0, 1.0)))
    reference = Vector((0.0, 0.0, 1.0))
    if abs(tangent.dot(reference)) > 0.92:
        reference = Vector((0.0, 1.0, 0.0))
    first = tangent.cross(reference)
    first = _safe_normal(first, Vector((1.0, 0.0, 0.0)))
    second = _safe_normal(tangent.cross(first), Vector((0.0, 1.0, 0.0)))
    return first, second


def analyze_cross_sections(points: Sequence[Vector], centerline: Sequence[Vector],
                           slab_fraction: float = 0.035, radius_fraction: float = 0.18):
    if len(centerline) < 2 or not points:
        return []
    total = sum((second - first).length for first, second in zip(centerline, centerline[1:]))
    slab = max(total * slab_fraction, 1e-5)
    radius_limit = max(total * radius_fraction, 1e-5)
    sections: List[CrossSection] = []
    for index, center in enumerate(centerline):
        previous = centerline[max(0, index - 1)]
        following = centerline[min(len(centerline) - 1, index + 1)]
        tangent = _safe_normal(following - previous, Vector((0.0, 0.0, 1.0)))
        first_axis, second_axis = _basis(tangent)
        selected = []
        for point in points:
            delta = point - center
            longitudinal = abs(delta.dot(tangent))
            radial = (delta - tangent * delta.dot(tangent)).length
            if longitudinal <= slab and radial <= radius_limit:
                selected.append(point)
        if selected:
            centroid = sum(selected, Vector((0.0, 0.0, 0.0))) / len(selected)
            first_values = [(point - centroid).dot(first_axis) for point in selected]
            second_values = [(point - centroid).dot(second_axis) for point in selected]
            first_radius = max(max(first_values, default=0.0) - min(first_values, default=0.0), 1e-8) * 0.5
            second_radius = max(max(second_values, default=0.0) - min(second_values, default=0.0), 1e-8) * 0.5
            major = max(first_radius, second_radius)
            minor = min(first_radius, second_radius)
            radii = [((point - centroid) - tangent * (point - centroid).dot(tangent)).length for point in selected]
            mean_radius = sum(radii) / max(len(radii), 1)
        else:
            centroid = center.copy()
            major = minor = mean_radius = 0.0
        curvature = 0.0
        if 0 < index < len(centerline) - 1:
            before = _safe_normal(centerline[index] - centerline[index - 1], tangent)
            after = _safe_normal(centerline[index + 1] - centerline[index], tangent)
            curvature = max(0.0, min(1.0, 1.0 - before.dot(after)))
        sections.append(CrossSection(
            index=index,
            factor=index / float(max(len(centerline) - 1, 1)),
            center=centroid,
            tangent=tangent,
            point_count=len(selected),
            mean_radius=float(mean_radius),
            major_radius=float(major),
            minor_radius=float(minor),
            area_proxy=float(math.pi * major * minor),
            curvature=float(curvature),
        ))
    return sections


def choose_joint_section(sections: Sequence[CrossSection], expected_factor: float,
                         search_window: float = 0.24):
    candidates = [
        section for section in sections
        if abs(section.factor - expected_factor) <= search_window and section.point_count >= 3
    ]
    if not candidates:
        return None, {
            "geometryEvidence": 0.0,
            "crossSectionEvidence": 0.0,
            "priorEvidence": 0.0,
            "reason": "NO_VALID_CROSS_SECTION",
        }
    radii = [section.mean_radius for section in candidates if section.mean_radius > 0.0]
    maximum_radius = max(radii, default=1e-8)
    minimum_radius = min(radii, default=0.0)
    denominator = max(maximum_radius - minimum_radius, 1e-8)
    ranked = []
    for section in candidates:
        narrowness = 1.0 - (section.mean_radius - minimum_radius) / denominator
        prior = max(0.0, 1.0 - abs(section.factor - expected_factor) / max(search_window, 1e-8))
        sample_confidence = min(1.0, section.point_count / 18.0)
        score = narrowness * 0.46 + section.curvature * 0.27 + prior * 0.17 + sample_confidence * 0.10
        ranked.append((score, section, narrowness, prior, sample_confidence))
    ranked.sort(key=lambda item: item[0], reverse=True)
    score, section, narrowness, prior, sample_confidence = ranked[0]
    return section, {
        "geometryEvidence": float(narrowness * 0.65 + section.curvature * 0.35),
        "crossSectionEvidence": float(sample_confidence),
        "priorEvidence": float(prior),
        "jointScore": float(score),
        "expectedFactor": float(expected_factor),
        "selectedFactor": float(section.factor),
    }
