"""Pure anatomical-region semantics shared by Blender and unit tests.

Mixed-label triangles are valid geometry.  They keep a primary region, every
secondary region and normalized semantic weights instead of being removed from
the regional acceleration structures.
"""
from __future__ import annotations

from collections import Counter
from typing import Iterable, Sequence


UNASSIGNED_REGION = "unassigned"


def _pair(first: str, second: str) -> tuple[str, str]:
    return tuple(sorted((first, second)))


def _side_pairs(base_a: str, base_b: str) -> set[tuple[str, str]]:
    return {_pair(f"{base_a}_{side}", f"{base_b}_{side}") for side in ("l", "r")}


ANATOMICAL_ADJACENCY = {
    *_side_pairs("upper_arm", "forearm"),
    *_side_pairs("forearm", "hand"),
    *_side_pairs("pelvis", "thigh"),
    *_side_pairs("thigh", "calf"),
    *_side_pairs("calf", "foot"),
    _pair("torso", "pelvis"),
    _pair("neck", "head"),
    _pair("torso", "neck"),
    _pair("torso", "upper_arm_l"),
    _pair("torso", "upper_arm_r"),
    _pair("torso", "clavicle_l"),
    _pair("torso", "clavicle_r"),
    _pair("clavicle_l", "upper_arm_l"),
    _pair("clavicle_r", "upper_arm_r"),
    *{
        _pair(f"hand_{side}", f"{finger}_{side}")
        for side in ("l", "r")
        for finger in ("thumb", "index", "middle", "ring", "pinky")
    },
}


def normalize_region(value: object) -> str:
    region = str(value or "").strip().lower()
    return region if region and region not in {"none", "unknown", "missing"} else UNASSIGNED_REGION


def are_anatomical_neighbors(first: str, second: str) -> bool:
    first = normalize_region(first)
    second = normalize_region(second)
    return first == second or _pair(first, second) in ANATOMICAL_ADJACENCY


def triangle_semantics(labels: Sequence[str], indices: Iterable[int]) -> dict:
    """Return deterministic semantic metadata for one triangulated primitive."""
    values = [
        normalize_region(labels[int(index)] if 0 <= int(index) < len(labels) else UNASSIGNED_REGION)
        for index in indices
    ]
    if not values:
        return {
            "primary_region": UNASSIGNED_REGION,
            "secondary_regions": (),
            "region_weights": {UNASSIGNED_REGION: 1.0},
            "is_boundary": False,
        }
    counts = Counter(values)
    ordered = sorted(counts, key=lambda region: (-counts[region], region))
    primary = ordered[0]
    total = float(len(values))
    weights = {region: counts[region] / total for region in ordered}
    return {
        "primary_region": primary,
        "secondary_regions": tuple(ordered[1:]),
        "region_weights": weights,
        "is_boundary": len(ordered) > 1,
    }


def region_match(
    primary_region: str,
    secondary_regions: Iterable[str],
    requested_regions: Iterable[str],
    is_boundary: bool,
) -> tuple[bool, str, float]:
    """Return accepted, match kind and confidence multiplier for a query."""
    requested = {normalize_region(value) for value in requested_regions}
    primary = normalize_region(primary_region)
    secondary = {normalize_region(value) for value in secondary_regions}
    if primary in requested:
        return True, "primary", 1.0
    if requested.intersection(secondary):
        return True, "secondary", 0.86
    if is_boundary and any(
        are_anatomical_neighbors(candidate, primary)
        or any(are_anatomical_neighbors(candidate, other) for other in secondary)
        for candidate in requested
    ):
        return True, "adjacent_boundary", 0.72
    return False, "incompatible", 0.0
