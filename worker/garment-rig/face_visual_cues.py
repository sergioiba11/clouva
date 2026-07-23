"""Visual-only facial cues for Avatar Analyzer V3.2 renders.

These meshes help MediaPipe detect stylized faces, but they never participate in
landmark projection. Final 3D points remain restricted to the anatomical BVH.
"""
from __future__ import annotations

from typing import Iterable

import bpy

from multiview_renderer import _complete_proxy

VISUAL_ONLY_CLASSES = {"eyebrows", "eyelashes", "teeth", "tongue"}
VISUAL_ONLY_KEYWORDS = (
    "nose", "nariz", "mouth", "boca", "lip", "labio",
    "brow", "eyebrow", "ceja", "lash", "eyelash", "pesta",
    "teeth", "tooth", "diente", "tongue", "lengua",
)
EXCLUDED_CLASSES = {"hair", "clothing", "accessories", "unknown_rejected"}


def _haystack(obj: bpy.types.Object):
    material_names = " ".join(
        slot.material.name.lower() for slot in obj.material_slots if slot.material
    )
    return f"{obj.name} {obj.data.name} {material_names}".lower()


def is_visual_face_cue(obj: bpy.types.Object, category: str, anatomy_bvh=None):
    """Return true only for useful facial signals that must remain visual-only."""
    if obj.type != "MESH" or not len(obj.data.vertices):
        return False
    if category in EXCLUDED_CLASSES:
        return False
    if category == "eyes":
        return anatomy_bvh is None or not anatomy_bvh.has_region("eyes")
    if category in VISUAL_ONLY_CLASSES:
        return True
    return any(token in _haystack(obj) for token in VISUAL_ONLY_KEYWORDS)


def add_visual_face_cues(groups: dict, meshes: Iterable[bpy.types.Object],
                         classifications: dict, anatomy_bvh=None):
    """Append render proxies without changing the strict projection geometry."""
    cues = []
    for index, obj in enumerate(meshes):
        category = str(classifications.get(obj.name) or "unknown_rejected")
        if not is_visual_face_cue(obj, category, anatomy_bvh):
            continue
        proxy = _complete_proxy(obj, f"CLOUVA_FACE_VISUAL_CUE_{index}_{obj.name}")
        if proxy is None:
            continue
        proxy["clouva_visual_only"] = True
        proxy["clouva_visual_cue_category"] = category
        proxy["clouva_projection_allowed"] = False
        groups.setdefault("face", []).append(proxy)
        cues.append({
            "proxy": proxy.name,
            "sourceObject": obj.name,
            "category": category,
            "projectionAllowed": False,
        })
    return cues
