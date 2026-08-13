from __future__ import annotations

def summarize_fingers(landmarks: list[dict]) -> dict:
    sides = {}
    for side in ("left", "right"):
        points = [item for item in landmarks if item.get("group") == "hand" and item.get("side") == side]
        names = {item.get("name") for item in points}
        fingers = {}
        for finger in ("thumb", "index", "middle", "ring", "pinky"):
            chain = [name for name in names if isinstance(name, str) and name.startswith(finger + "_")]
            fingers[finger] = {
                "semantic_chain_points": len(chain),
                "semantic_detected": len(chain) >= 3,
                "surface_topology_verified": False,
                "rig_capable": False,
            }
        semantic = all(value["semantic_detected"] for value in fingers.values())
        sides[side] = {
            "semantic_fingers_detected": semantic,
            "five_finger_surface_topology": False,
            "finger_rig_capable": False,
            "geometry_refinement_required": semantic,
            "fingers": fingers,
        }
    return sides
