"""Pure technical-pixel identity helpers for Avatar Analyzer V4.1."""
from __future__ import annotations

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


def technical_projection_identity(
    technical: dict[str, Any] | None,
    region_ids: dict[str, Any] | None,
    allowed_regions: Iterable[str],
) -> dict[str, Any]:
    technical = technical or {}
    allowed = {str(value) for value in allowed_regions}
    region_id = int(technical.get("regionId") or 0)
    region = region_name_from_id(region_ids, region_id)
    triangle_id = int(technical.get("triangleId") or -1)
    world_position = technical.get("worldPosition")
    valid = bool(
        technical.get("valid")
        and isinstance(world_position, (list, tuple))
        and len(world_position) == 3
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
        "objectId": int(technical.get("objectId") or 0),
        "triangleId": triangle_id,
        "worldPosition": list(world_position) if valid else None,
        "barycentricCoordinates": technical.get("barycentricCoordinates"),
    }
