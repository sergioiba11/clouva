"""CLOUVA Base-Mesh / Auto-Rig worker script.

Run with Blender:
  blender --background --python scripts/blender/rig_clothing.py -- \
    --avatar /work/clouva-base-rig-v1.glb \
    --garment /work/input.glb \
    --output /work/output.glb \
    --category hoodie

For a previously validated template add --template-mode. In that mode the script
keeps the existing topology and skin weights and only rebinds compatible meshes to
the official CLOUVA armature.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any, Iterable

import bpy


def parse_args() -> argparse.Namespace:
    argv = sys.argv
    argv = argv[argv.index("--") + 1 :] if "--" in argv else []
    parser = argparse.ArgumentParser(description="Rig a CLOUVA garment to the official avatar")
    parser.add_argument("--avatar", required=True)
    parser.add_argument("--garment", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--category", default="accessory")
    parser.add_argument("--template-mode", action="store_true")
    parser.add_argument("--adjustments-json", default="{}")
    parser.add_argument("--report", default="")
    parser.add_argument("--max-unweighted-ratio", type=float, default=0.01)
    return parser.parse_args(argv)


def import_glb(path: str) -> list[bpy.types.Object]:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [obj for obj in bpy.data.objects if obj not in before]


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.armatures, bpy.data.materials):
        for datablock in list(datablocks):
            if datablock.users == 0:
                datablocks.remove(datablock)


def find_armature(objects: Iterable[bpy.types.Object]) -> bpy.types.Object:
    armatures = [obj for obj in objects if obj.type == "ARMATURE"]
    if not armatures:
        raise RuntimeError("El avatar oficial no contiene un Armature")
    armatures.sort(key=lambda obj: len(obj.data.bones), reverse=True)
    return armatures[0]


def mesh_objects(objects: Iterable[bpy.types.Object]) -> list[bpy.types.Object]:
    return [obj for obj in objects if obj.type == "MESH"]


def find_weight_source(avatar_objects: list[bpy.types.Object], armature: bpy.types.Object) -> bpy.types.Object:
    candidates: list[bpy.types.Object] = []
    for obj in mesh_objects(avatar_objects):
        has_armature = any(
            modifier.type == "ARMATURE" and modifier.object == armature
            for modifier in obj.modifiers
        )
        if has_armature or len(obj.vertex_groups) > 0:
            candidates.append(obj)
    if not candidates:
        raise RuntimeError("No se encontró una malla corporal con pesos para transferir")
    candidates.sort(key=lambda obj: len(obj.data.vertices), reverse=True)
    return candidates[0]


def apply_object_transform(obj: bpy.types.Object) -> None:
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    obj.select_set(False)


def apply_adjustments(obj: bpy.types.Object, adjustments: dict[str, Any]) -> None:
    scale = float(adjustments.get("scale", 100)) / 100.0
    width = float(adjustments.get("width", 100)) / 100.0
    length = float(adjustments.get("length", 100)) / 100.0
    height = float(adjustments.get("height", 0)) / 100.0
    x = float(adjustments.get("x", 0)) / 100.0
    y = float(adjustments.get("y", 0)) / 100.0
    depth = float(adjustments.get("distance", 0)) / 100.0
    rotation = math.radians(float(adjustments.get("rotation", 0)))

    obj.scale.x *= scale * width
    obj.scale.y *= scale * max(0.05, 1.0 + depth)
    obj.scale.z *= scale * length
    obj.location.x += x
    obj.location.y += y
    obj.location.z += height
    obj.rotation_euler.z += rotation
    apply_object_transform(obj)


def remove_existing_skinning(obj: bpy.types.Object) -> None:
    for modifier in list(obj.modifiers):
        if modifier.type in {"ARMATURE", "DATA_TRANSFER", "SURFACE_DEFORM"}:
            obj.modifiers.remove(modifier)
    obj.vertex_groups.clear()


def transfer_vertex_weights(
    source: bpy.types.Object,
    target: bpy.types.Object,
) -> None:
    modifier = target.modifiers.new(name="CLOUVA_WeightTransfer", type="DATA_TRANSFER")
    modifier.object = source
    modifier.use_vert_data = True
    modifier.data_types_verts = {"VGROUP_WEIGHTS"}
    modifier.vert_mapping = "POLYINTERP_NEAREST"
    modifier.layers_vgroup_select_src = "ALL"
    modifier.layers_vgroup_select_dst = "NAME"
    modifier.mix_mode = "REPLACE"
    modifier.mix_factor = 1.0

    bpy.context.view_layer.objects.active = target
    target.select_set(True)
    try:
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    except RuntimeError as exc:
        target.select_set(False)
        raise RuntimeError(f"Falló Data Transfer para {target.name}: {exc}") from exc
    target.select_set(False)


def bind_armature(obj: bpy.types.Object, armature: bpy.types.Object) -> None:
    for modifier in list(obj.modifiers):
        if modifier.type == "ARMATURE":
            modifier.object = armature
            modifier.use_vertex_groups = True
            return
    modifier = obj.modifiers.new(name="CLOUVA_Armature", type="ARMATURE")
    modifier.object = armature
    modifier.use_vertex_groups = True
    obj.parent = armature
    obj.matrix_parent_inverse = armature.matrix_world.inverted()


def normalize_and_limit_weights(obj: bpy.types.Object, max_influences: int = 4) -> tuple[int, int]:
    group_names = {group.index: group.name for group in obj.vertex_groups}
    weighted = 0
    unweighted = 0

    for vertex in obj.data.vertices:
        influences = [entry for entry in vertex.groups if entry.weight > 1e-6 and entry.group in group_names]
        influences.sort(key=lambda entry: entry.weight, reverse=True)
        keep = influences[:max_influences]
        remove = influences[max_influences:]

        for entry in remove:
            obj.vertex_groups[entry.group].remove([vertex.index])

        total = sum(entry.weight for entry in keep)
        if total <= 1e-8:
            unweighted += 1
            continue

        weighted += 1
        for entry in keep:
            obj.vertex_groups[entry.group].add([vertex.index], entry.weight / total, "REPLACE")

    return weighted, unweighted


def remove_invalid_groups(obj: bpy.types.Object, armature: bpy.types.Object) -> list[str]:
    bone_names = {bone.name for bone in armature.data.bones}
    removed: list[str] = []
    for group in list(obj.vertex_groups):
        if group.name not in bone_names:
            removed.append(group.name)
            obj.vertex_groups.remove(group)
    return removed


def validate_mesh(
    obj: bpy.types.Object,
    armature: bpy.types.Object,
    max_unweighted_ratio: float,
) -> dict[str, Any]:
    removed_groups = remove_invalid_groups(obj, armature)
    weighted, unweighted = normalize_and_limit_weights(obj)
    total = max(1, len(obj.data.vertices))
    ratio = unweighted / total
    armature_modifiers = [modifier for modifier in obj.modifiers if modifier.type == "ARMATURE"]

    errors: list[str] = []
    if not armature_modifiers:
        errors.append("sin Armature Modifier")
    if not obj.vertex_groups:
        errors.append("sin Vertex Groups")
    if ratio > max_unweighted_ratio:
        errors.append(f"{ratio:.2%} de vértices sin peso")

    return {
        "mesh": obj.name,
        "vertices": total,
        "weightedVertices": weighted,
        "unweightedVertices": unweighted,
        "unweightedRatio": ratio,
        "removedInvalidGroups": removed_groups,
        "errors": errors,
    }


def preserve_template_skinning(obj: bpy.types.Object, armature: bpy.types.Object) -> None:
    if not obj.vertex_groups:
        raise RuntimeError(f"La plantilla {obj.name} no contiene pesos existentes")
    bind_armature(obj, armature)


def rig_raw_mesh(obj: bpy.types.Object, source: bpy.types.Object, armature: bpy.types.Object) -> None:
    remove_existing_skinning(obj)
    transfer_vertex_weights(source, obj)
    bind_armature(obj, armature)


def export_rigged_glb(
    output_path: str,
    armature: bpy.types.Object,
    garments: list[bpy.types.Object],
    avatar_objects: list[bpy.types.Object],
) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    armature.select_set(True)
    for garment in garments:
        garment.select_set(True)
    for obj in avatar_objects:
        if obj.type == "MESH" and obj not in garments:
            obj.hide_render = True
            obj.select_set(False)

    bpy.context.view_layer.objects.active = armature
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=output_path,
        export_format="GLB",
        use_selection=True,
        export_skins=True,
        export_animations=False,
        export_apply=False,
    )


def main() -> None:
    args = parse_args()
    adjustments = json.loads(args.adjustments_json or "{}")
    clear_scene()

    avatar_objects = import_glb(args.avatar)
    armature = find_armature(avatar_objects)
    weight_source = find_weight_source(avatar_objects, armature)
    garment_objects = import_glb(args.garment)
    garments = mesh_objects(garment_objects)
    if not garments:
        raise RuntimeError("El GLB de referencia no contiene ninguna malla")

    reports: list[dict[str, Any]] = []
    for garment in garments:
        apply_adjustments(garment, adjustments)
        if args.template_mode:
            preserve_template_skinning(garment, armature)
        else:
            rig_raw_mesh(garment, weight_source, armature)
        reports.append(validate_mesh(garment, armature, args.max_unweighted_ratio))

    errors = [error for report in reports for error in report["errors"]]
    if errors:
        raise RuntimeError("Validación de rig fallida: " + "; ".join(errors))

    export_rigged_glb(args.output, armature, garments, avatar_objects)
    report = {
        "ok": True,
        "strategy": "preserve_existing_skinning" if args.template_mode else "transfer_from_avatar",
        "category": args.category,
        "avatar": args.avatar,
        "garment": args.garment,
        "output": args.output,
        "meshes": reports,
    }
    report_path = Path(args.report) if args.report else Path(args.output).with_suffix(".report.json")
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # Blender must return a non-zero code to the worker.
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        raise
