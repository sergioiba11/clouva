import json
import os
import traceback
from pathlib import Path

import unreal


ASSET_PATH = "/Game/Characters/Clouva/Clouva-avatar-unreal"
ACTOR_LABEL = "BP_ClouvaCharacter"
COMPONENT_NAME = "ClouvaMesh"
REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
OUTPUT_DIR = os.getenv(
    "CLOUVA_AVATAR_EXPORT_DIR",
    str(REPOSITORY_ROOT / "worker" / "garment-rig" / "avatar-reference"),
)
FBX_PATH = os.path.join(OUTPUT_DIR, "AvatarReference.fbx")
JSON_PATH = os.path.join(OUTPUT_DIR, "clouva_avatar_data.json")
ERROR_PATH = os.path.join(OUTPUT_DIR, "export-error.txt")


def object_path(value):
    return value.get_path_name() if value else None


def vector(value):
    return {"x": value.x, "y": value.y, "z": value.z}


def rotator(value):
    return {"pitch": value.pitch, "yaw": value.yaw, "roll": value.roll}


def transform(value):
    return {
        "translationCm": vector(value.translation),
        "rotation": rotator(value.rotation.rotator()),
        "scale": vector(value.scale3d),
    }


def bounds(value):
    return {
        "originCm": vector(value.origin),
        "boxExtentCm": vector(value.box_extent),
        "sizeCm": {
            "x": value.box_extent.x * 2.0,
            "y": value.box_extent.y * 2.0,
            "z": value.box_extent.z * 2.0,
        },
        "sphereRadiusCm": value.sphere_radius,
    }


def find_component():
    subsystem = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    for actor in subsystem.get_all_level_actors():
        if actor.get_actor_label() != ACTOR_LABEL:
            continue
        for component in actor.get_components_by_class(unreal.SkeletalMeshComponent):
            if component.get_name() == COMPONENT_NAME:
                return actor, component
    return None, None


def collect_materials(mesh):
    result = []
    for index, slot in enumerate(mesh.get_editor_property("materials")):
        material = slot.get_editor_property("material_interface")
        result.append({
            "index": index,
            "slotName": str(slot.get_editor_property("material_slot_name")),
            "importedSlotName": str(slot.get_editor_property("imported_material_slot_name")),
            "material": object_path(material),
        })
    return result


def collect_sockets(mesh):
    result = []
    for index in range(mesh.num_sockets()):
        socket = mesh.get_socket_by_index(index)
        result.append({
            "name": str(socket.get_editor_property("socket_name")),
            "bone": str(socket.get_editor_property("bone_name")),
            "relativeLocationCm": vector(socket.get_editor_property("relative_location")),
            "relativeRotation": rotator(socket.get_editor_property("relative_rotation")),
            "relativeScale": vector(socket.get_editor_property("relative_scale")),
        })
    return result


def collect_bones(component, mesh):
    result = []
    for index in range(component.get_num_bones()):
        name = str(component.get_bone_name(index))
        parent = str(component.get_parent_bone(name))
        result.append({
            "index": index,
            "name": name,
            "parent": None if parent in ("None", "") else parent,
            "referencePoseLocalTransform": transform(component.get_ref_pose_transform(index)),
        })
    return result


def export_fbx(mesh):
    task = unreal.AssetExportTask()
    task.set_editor_property("object", mesh)
    task.set_editor_property("filename", FBX_PATH)
    task.set_editor_property("automated", True)
    task.set_editor_property("prompt", False)
    task.set_editor_property("replace_identical", True)
    task.set_editor_property("exporter", unreal.SkeletalMeshExporterFBX())
    options = unreal.FbxExportOption()
    options.set_editor_property("ascii", False)
    options.set_editor_property("collision", False)
    options.set_editor_property("level_of_detail", False)
    task.set_editor_property("options", options)
    success = unreal.Exporter.run_asset_export_task(task)
    return success, [str(error) for error in task.get_editor_property("errors")]


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    mesh = unreal.load_asset(ASSET_PATH)
    if not mesh:
        raise RuntimeError("No se encontro el Skeletal Mesh: " + ASSET_PATH)
    actor, component = find_component()
    if not actor or not component:
        raise RuntimeError("No se encontro BP_ClouvaCharacter.ClouvaMesh en el nivel abierto")

    export_ok, export_errors = export_fbx(mesh)
    skeleton = mesh.get_editor_property("skeleton")
    physics_asset = mesh.get_editor_property("physics_asset")
    imported = mesh.get_imported_bounds()
    extended = mesh.get_bounds()

    payload = {
        "schemaVersion": 1,
        "source": "Unreal Engine 5.8",
        "units": "centimeters",
        "coordinateSystem": {"up": "+Z", "forward": str(mesh.get_forward_axis())},
        "skeletalMesh": object_path(mesh),
        "skeleton": object_path(skeleton),
        "physicsAsset": object_path(physics_asset),
        "actor": {
            "label": actor.get_actor_label(),
            "path": object_path(actor),
            "worldTransform": transform(actor.get_actor_transform()),
        },
        "component": {
            "name": component.get_name(),
            "path": object_path(component),
            "relativeTransform": transform(component.get_relative_transform()),
            "worldTransform": transform(component.get_world_transform()),
        },
        "bounds": {
            "imported": bounds(imported),
            "extended": bounds(extended),
        },
        "materials": collect_materials(mesh),
        "sockets": collect_sockets(mesh),
        "morphTargets": list(mesh.get_all_morph_target_names()),
        "skinWeightProfiles": list(mesh.get_all_skin_weight_profile_names()),
        "bones": collect_bones(component, mesh),
        "fbx": {
            "path": os.path.basename(FBX_PATH),
            "exported": bool(export_ok),
            "errors": export_errors,
            "includes": ["LOD0 geometry", "reference skeleton", "bind pose", "vertex skin weights"],
        },
    }
    with open(JSON_PATH, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
    if os.path.exists(ERROR_PATH):
        os.remove(ERROR_PATH)
    unreal.log("CLOUVA avatar exportado: " + FBX_PATH)
    unreal.log("CLOUVA metadata exportada: " + JSON_PATH)


try:
    main()
except Exception:
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    message = traceback.format_exc()
    with open(ERROR_PATH, "w", encoding="utf-8") as handle:
        handle.write(message)
    unreal.log_error(message)
