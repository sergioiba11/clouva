import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


SCENE_SCALE_LENGTH_METERS = 1.0


def args_after_separator():
    return sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in (bpy.data.meshes, bpy.data.armatures, bpy.data.materials, bpy.data.images):
        for datablock in list(collection):
            if datablock.users == 0:
                collection.remove(datablock)


def configure_scene():
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.length_unit = "METERS"
    scene.unit_settings.scale_length = SCENE_SCALE_LENGTH_METERS


def finite_vector(value):
    return all(math.isfinite(float(value[index])) for index in range(3))


def bounds(points):
    if not points:
        return None
    minimum = Vector((
        min(float(point.x) for point in points),
        min(float(point.y) for point in points),
        min(float(point.z) for point in points),
    ))
    maximum = Vector((
        max(float(point.x) for point in points),
        max(float(point.y) for point in points),
        max(float(point.z) for point in points),
    ))
    return minimum, maximum, maximum - minimum


def vector_cm(value):
    return [round(float(component) * 100.0, 4) for component in value]


def relative_shape_error(raw_bounds, evaluated_bounds):
    if not raw_bounds or not evaluated_bounds:
        return None
    raw_min, raw_max, raw_size = raw_bounds
    evaluated_min, evaluated_max, evaluated_size = evaluated_bounds
    raw_center = (raw_min + raw_max) * 0.5
    evaluated_center = (evaluated_min + evaluated_max) * 0.5
    size_errors = [
        abs(float(evaluated_size[index]) - float(raw_size[index]))
        / max(abs(float(raw_size[index])), 1e-8)
        for index in range(3)
    ]
    center_scale = max(max(abs(float(component)) for component in raw_size), 1e-8)
    center_error = (evaluated_center - raw_center).length / center_scale
    return {
        "sizeErrors": [round(value, 6) for value in size_errors],
        "maximumSizeError": round(max(size_errors), 6),
        "centerError": round(float(center_error), 6),
        "different": bool(max(size_errors) > 0.05 or center_error > 0.03),
    }


def custom_properties(obj):
    wanted = (
        "clouvaCategory",
        "clouvaTargetDimensions",
        "clouvaSafeBoundsDimensions",
        "clouvaFinalDimensions",
        "clouvaGeometryCleanupVersion",
        "clouvaLegacyVisibleGeometryBaked",
        "clouvaLegacyVisibleGeometryBakeVersion",
        "clouvaVolumeContractVersion",
        "clouvaRoundtripContractVersion",
        "clouvaBodyContractVersion",
        "clouvaRigVersion",
    )
    result = {}
    for key in wanted:
        if key not in obj:
            continue
        value = obj[key]
        try:
            json.dumps(value)
            result[key] = value
        except TypeError:
            result[key] = str(value)
    return result


def inspect_asset(path: Path, role: str):
    clear_scene()
    configure_scene()
    bpy.ops.import_scene.gltf(filepath=str(path))
    bpy.context.view_layer.update()

    objects = list(bpy.context.scene.objects)
    meshes = [obj for obj in objects if obj.type == "MESH" and len(obj.data.vertices) >= 3]
    armatures = [obj for obj in objects if obj.type == "ARMATURE"]
    depsgraph = bpy.context.evaluated_depsgraph_get()

    raw_points = []
    evaluated_points = []
    mesh_rows = []
    total_vertices = 0
    total_polygons = 0
    weighted_vertices = 0

    for obj in meshes:
        raw_world = [obj.matrix_world @ vertex.co for vertex in obj.data.vertices]
        raw_points.extend(raw_world)
        total_vertices += len(obj.data.vertices)
        total_polygons += len(obj.data.polygons)

        weighted = sum(
            1
            for vertex in obj.data.vertices
            if any(group.weight > 1e-6 for group in vertex.groups)
        )
        weighted_vertices += weighted

        evaluated = obj.evaluated_get(depsgraph)
        evaluated_mesh = evaluated.to_mesh(preserve_all_data_layers=True, depsgraph=depsgraph)
        evaluated_world = []
        if evaluated_mesh is not None:
            evaluated_world = [evaluated.matrix_world @ vertex.co for vertex in evaluated_mesh.vertices]
            evaluated_points.extend(evaluated_world)
            evaluated.to_mesh_clear()

        armature_modifier = next(
            (modifier for modifier in obj.modifiers if modifier.type == "ARMATURE"),
            None,
        )
        found_armature = obj.find_armature()
        mesh_rows.append({
            "name": obj.name,
            "vertices": len(obj.data.vertices),
            "polygons": len(obj.data.polygons),
            "materials": [slot.material.name for slot in obj.material_slots if slot.material],
            "rawDimensionsCm": vector_cm(bounds(raw_world)[2]) if raw_world else None,
            "evaluatedDimensionsCm": vector_cm(bounds(evaluated_world)[2]) if evaluated_world else None,
            "weightedVertexRatio": round(weighted / max(len(obj.data.vertices), 1), 6),
            "parent": obj.parent.name if obj.parent else None,
            "parentType": obj.parent.type if obj.parent else None,
            "armatureModifier": armature_modifier.name if armature_modifier else None,
            "armatureModifierVisible": bool(armature_modifier and armature_modifier.show_viewport),
            "resolvedArmature": found_armature.name if found_armature else None,
            "modifiers": [
                {
                    "name": modifier.name,
                    "type": modifier.type,
                    "visible": bool(modifier.show_viewport),
                }
                for modifier in obj.modifiers
            ],
            "customProperties": custom_properties(obj),
        })

    raw_bounds = bounds(raw_points)
    evaluated_bounds = bounds(evaluated_points)
    difference = relative_shape_error(raw_bounds, evaluated_bounds)
    weighted_ratio = weighted_vertices / max(total_vertices, 1)
    bone_count = sum(len(armature.data.bones) for armature in armatures)
    root_names = {
        "root",
        "hips",
        "pelvis",
        "mixamorig:hips",
        "armature",
    }
    root_bones = [
        bone.name
        for armature in armatures
        for bone in armature.data.bones
        if bone.parent is None or bone.name.strip().lower() in root_names
    ]

    metadata_keys = sorted({
        key
        for row in mesh_rows
        for key in row["customProperties"].keys()
    })

    stages = [
        {
            "id": "import",
            "label": "Importación GLB",
            "status": "ok" if meshes else "error",
            "summary": f"{len(meshes)} malla(s), {len(armatures)} armature(s)",
        },
        {
            "id": "geometry",
            "label": "Geometría",
            "status": "ok" if total_vertices >= 50 and total_polygons >= 20 else "error",
            "summary": f"{total_vertices:,} vértices · {total_polygons:,} polígonos",
        },
        {
            "id": "evaluated-geometry",
            "label": "Forma visible vs. malla cruda",
            "status": "warning" if difference and difference["different"] else "ok",
            "summary": (
                f"Diferencia detectada: tamaño {difference['maximumSizeError'] * 100:.1f}% · centro {difference['centerError'] * 100:.1f}%"
                if difference and difference["different"]
                else "La forma visible coincide con la malla cruda"
            ),
        },
        {
            "id": "armature",
            "label": "Esqueleto",
            "status": "ok" if armatures and bone_count > 0 else ("warning" if role == "garment" else "error"),
            "summary": f"{bone_count} huesos · raíces: {', '.join(root_bones[:5]) or 'ninguna'}",
        },
        {
            "id": "skinning",
            "label": "Skin weights",
            "status": "ok" if weighted_ratio >= 0.995 else ("warning" if weighted_ratio > 0 else "error"),
            "summary": f"{weighted_ratio * 100:.2f}% de vértices con peso",
        },
        {
            "id": "fit-metadata",
            "label": "Datos de fitting CLOUVA",
            "status": "ok" if metadata_keys else "warning",
            "summary": ", ".join(metadata_keys) if metadata_keys else "El GLB no trae medidas CLOUVA guardadas",
        },
    ]

    result = {
        "role": role,
        "filename": path.name,
        "fileSizeBytes": path.stat().st_size if path.exists() else 0,
        "blenderVersion": bpy.app.version_string,
        "sceneScaleLength": float(bpy.context.scene.unit_settings.scale_length),
        "objectCount": len(objects),
        "meshCount": len(meshes),
        "armatureCount": len(armatures),
        "boneCount": bone_count,
        "rootBones": root_bones,
        "vertices": total_vertices,
        "polygons": total_polygons,
        "weightedVertexRatio": round(weighted_ratio, 6),
        "rawBounds": {
            "minimumCm": vector_cm(raw_bounds[0]),
            "maximumCm": vector_cm(raw_bounds[1]),
            "dimensionsCm": vector_cm(raw_bounds[2]),
        } if raw_bounds else None,
        "evaluatedBounds": {
            "minimumCm": vector_cm(evaluated_bounds[0]),
            "maximumCm": vector_cm(evaluated_bounds[1]),
            "dimensionsCm": vector_cm(evaluated_bounds[2]),
        } if evaluated_bounds else None,
        "evaluatedDifference": difference,
        "legacyRecoveryRecommended": bool(difference and difference["different"]),
        "metadataKeys": metadata_keys,
        "meshes": mesh_rows,
        "stages": stages,
    }
    return result


def main():
    values = args_after_separator()
    if len(values) < 3:
        raise RuntimeError(
            "Usage: inspect_garment.py garment.glb avatar.glb output.json [category]"
        )

    garment_path = Path(values[0]).resolve()
    avatar_path = Path(values[1]).resolve()
    output_path = Path(values[2]).resolve()
    category = values[3].strip().lower() if len(values) > 3 else "prop"

    report = {
        "ok": True,
        "category": category,
        "garment": inspect_asset(garment_path, "garment"),
        "avatar": inspect_asset(avatar_path, "avatar"),
    }
    report["stages"] = [
        *report["garment"]["stages"],
        {
            "id": "avatar-reference",
            "label": "Avatar activo de referencia",
            "status": "ok" if report["avatar"]["meshCount"] and report["avatar"]["armatureCount"] else "error",
            "summary": (
                f"{report['avatar']['meshCount']} malla(s) · {report['avatar']['boneCount']} huesos · "
                f"{report['avatar']['evaluatedBounds']['dimensionsCm'][2] if report['avatar']['evaluatedBounds'] else 0} cm de alto"
            ),
        },
    ]
    report["ok"] = not any(stage["status"] == "error" for stage in report["stages"])

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[clouva-worker-diagnostics] {json.dumps(report, separators=(',', ':'))}", flush=True)


if __name__ == "__main__":
    main()
