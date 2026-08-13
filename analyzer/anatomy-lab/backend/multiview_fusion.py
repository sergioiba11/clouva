from __future__ import annotations

from collections import defaultdict
import numpy as np
from result_contract import SurfaceLandmark

def _key(item: SurfaceLandmark) -> tuple[str, str | None, str]:
    return item.name, item.side, item.group

def fuse_landmarks(items: list[SurfaceLandmark]) -> list[SurfaceLandmark]:
    grouped: dict[tuple[str, str | None, str], list[SurfaceLandmark]] = defaultdict(list)
    for item in items:
        grouped[_key(item)].append(item)
    output = []
    for observations in grouped.values():
        positions = np.asarray([item.canonical_position for item in observations], dtype=np.float64)
        median = np.median(positions, axis=0)
        distances = np.linalg.norm(positions - median, axis=1)
        scale = max(float(np.median(distances) * 3.0), 0.025)
        inliers = [item for item, distance in zip(observations, distances) if distance <= scale] or observations
        # Never average points from different triangles: that moves the fused
        # landmark into empty space and makes markers float. Select the exact
        # surface observation closest to the robust median, using confidence
        # only as a tie-breaker. Triangle, barycentrics and position therefore
        # remain an internally consistent surface anchor.
        best = min(
            inliers,
            key=lambda item: (
                float(np.linalg.norm(np.asarray(item.canonical_position, dtype=np.float64) - median)),
                -float(item.confidence),
            ),
        )
        best.confirmed_views = sorted({view for item in inliers for view in item.confirmed_views})
        best.confidence = float(np.mean([item.confidence for item in inliers]))
        best.state = "verified_multiview" if len(best.confirmed_views) >= 2 else "verified_single_view"
        output.append(best)
    return sorted(output, key=lambda item: (item.group, item.side or "", item.name))
