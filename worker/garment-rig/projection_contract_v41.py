"""Pure technical-pixel identity helpers for Avatar Analyzer V4.1."""
from __future__ import annotations

import math
from typing import Any, Iterable


def reverse_region_ids(region_ids: dict[str, Any] | None) -> dict[int, str]:
    result: dict[int, str] = {}
    for name, raw_id in (region_ids or {}).items():
        try:
            region_id = int(raw_id)
        except (TypeError, ValueError):
            continue
        if region_id > 0:
            result[region_id] = str(name)
    return result


def region_name_from_id(region_ids: dict[str, Any] | None, region_id: Any) -> str | None:
    try:
        normalized = int(region_id)
    except (TypeError, ValueError):
        return None
    return reverse_region_ids(region_ids).get(normalized)


def secondary_regions_from_mask(region_ids: dict[str, Any] | None, mask: Any) -> list[str]:
    try:
        normalized_mask = int(mask or 0)
    except (TypeError, ValueError):
        normalized_mask = 0
    return sorted(
        name
        for region_id, name in reverse_region_ids(region_ids).items()
        if 0 < region_id <= 64 and normalized_mask & (1 << (region_id - 1))
    )


def _integer(value: Any, fallback: int) -> int:
    if value is None:
        return fallback
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


def _finite_triplet(value: Any) -> bool:
    if not isinstance(value, (list, tuple)) or len(value) != 3:
        return False
    try:
        return all(math.isfinite(float(component)) for component in value)
    except (TypeError, ValueError):
        return False


def technical_projection_identity(
    technical: dict[str, Any] | None,
    region_ids: dict[str, Any] | None,
    allowed_regions: Iterable[str],
) -> dict[str, Any]:
    technical = technical or {}
    allowed = {str(value) for value in allowed_regions}
    region_id = _integer(technical.get("regionId"), 0)
    region = region_name_from_id(region_ids, region_id)
    triangle_id = _integer(technical.get("triangleId"), -1)
    object_id = _integer(technical.get("objectId"), 0)
    world_position = technical.get("worldPosition")
    barycentric = technical.get("barycentricCoordinates")
    valid = bool(
        technical.get("valid")
        and _finite_triplet(world_position)
        and triangle_id >= 0
        and region
    )
    return {
        "valid": valid,
        "regionId": region_id,
        "region": region,
        "regionCompatible": bool(valid and region in allowed),
        "secondaryRegions": secondary_regions_from_mask(
            region_ids,
            technical.get("secondaryRegionMask"),
        ),
        "objectId": object_id,
        "triangleId": triangle_id,
        "worldPosition": [float(component) for component in world_position] if valid else None,
        "barycentricCoordinates": [float(component) for component in barycentric] if _finite_triplet(barycentric) else None,
    }
