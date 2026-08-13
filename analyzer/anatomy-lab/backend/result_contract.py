from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any

@dataclass
class SurfaceLandmark:
    name: str
    group: str
    state: str
    confidence: float
    geometry_id: int
    mesh_id: str
    primitive_id: int
    triangle_id: int
    source_vertex_indices: list[int]
    barycentric: list[float]
    canonical_position: list[float]
    source_position: list[float]
    surface_normal: list[float]
    confirmed_views: list[str] = field(default_factory=list)
    detector_index: int | None = None
    side: str | None = None
    warnings: list[str] = field(default_factory=list)
    rejection_reason: str | None = None
    validation: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
