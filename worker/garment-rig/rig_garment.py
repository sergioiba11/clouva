import bpy
import sys
from mathutils import Vector
from mathutils.kdtree import KDTree


def args():
    values = sys.argv[sys.argv.index("--") + 1 :]
    if len(values) != 4:
        raise RuntimeError("Expected avatar.glb garment.glb output.glb category")
    return values


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def import_glb(path):
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [obj for obj in bpy.context.scene.objects if obj not in before]


def mesh_objects(objects):
    return [obj for obj in objects if obj.type == "MESH"]


def largest_mesh(objects):
    meshes = mesh_objects(objects)
    if not meshes:
        raise RuntimeError("No mesh found")
    return max(meshes, key=lambda obj: len(obj.data.vertices))


def find_armature(objects):
    armatures = [obj for obj in objects if obj.type == "ARMATURE"]
    if not armatures:
        raise RuntimeError("Official avatar has no armature")
    return max(armatures, key=lambda obj: len(obj.data.bones))


def bbox_world(obj):
    corners = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    mins = Vector((min(v.x for v in corners), min(v.y for v in corners), min(v.z for v in corners)))
    maxs = Vector((max(v.x for v in corners), max(v.y for v in corners), max(v.z for v in corners)))
    return mins, maxs


def fit_to_body(garment, body, category):
    body_min, body_max = bbox_world(body)
    garment_min, garment_max = bbox_world(garment)
    body_size = body_max - body_min
    garment_size = garment_max - garment_min

    if min(garment_size) <= 1e-6:
        raise RuntimeError("Garment has invalid dimensions")

    padding = {
        "hoodie": (1.12, 1.03, 1.16),
        "shirt": (1.07, 1.01, 1.10),
        "jacket": (1.14, 1.05, 1.18),
        "pants": (1.10, 1.02, 1.12),
        "shorts": (1.09, 1.02, 1.11),
        "shoes": (1.06, 1.01, 1.10),
        "accessory": (1.05, 1.05, 1.05),
    }[category]

    garment.scale.x *= body_size.x / garment_size.x * padding[0]
    garment.scale.y *= body_size.y / garment_size.y * padding[1]
    garment.scale.z *= body_size.z / garment_size.z * padding[2]
    bpy.context.view_layer.update()

    garment_min, garment_max = bbox_world(garment)
    garment_center = (garment_min + garment_max) * 0.5
    body_center = (body_min + body_max) * 0.5
    garment.location += body_center - garment_center
    bpy.context.view_layer.update()


def build_body_kdtree(body):
    matrix = body.matrix_world
    kd = KDTree(len(body.data.vertices))
    for index, vertex in enumerate(body.data.vertices):
        kd.insert(matrix @ vertex.co, index)
    kd.balance()
    return kd


def copy_weights(body, garment):
    body_groups = {group.index: group.name for group in body.vertex_groups}
    garment_groups = {name: garment.vertex_groups.new(name=name) for name in body_groups.values()}
    kd = build_body_kdtree(body)
    garment_inverse = garment.matrix_world.inverted()

    for vertex in garment.data.vertices:
        world_position = garment.matrix_world @ vertex.co
        _, body_index, _ = kd.find(world_position)
        source = body.data.vertices[body_index]
        influences = []
        for membership in source.groups:
            name = body_groups.get(membership.group)
            if name and membership.weight > 0.0001:
                influences.append((name, membership.weight))
        influences.sort(key=lambda item: item[1], reverse=True)
        influences = influences[:4]
        total = sum(weight for _, weight in influences) or 1.0
        for name, weight in influences:
            garment_groups[name].add([vertex.index], weight / total, "REPLACE")
        vertex.co = garment_inverse @ world_position


def validate(garment):
    if len(garment.data.vertices) < 50:
        raise RuntimeError("Garment mesh is too small")
    weighted = sum(1 for vertex in garment.data.vertices if len(vertex.groups) > 0)
    if weighted / len(garment.data.vertices) < 0.98:
        raise RuntimeError("Not enough vertices received skin weights")


def export(output_path, avatar_objects, garment, armature):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in avatar_objects:
        obj.select_set(True)
    garment.select_set(True)
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.export_scene.gltf(
        filepath=output_path,
        export_format="GLB",
        use_selection=True,
        export_apply=False,
        export_animations=True,
        export_skins=True,
        export_all_influences=False,
    )


def main():
    avatar_path, garment_path, output_path, category = args()
    clear_scene()

    avatar_objects = import_glb(avatar_path)
    armature = find_armature(avatar_objects)
    body = largest_mesh([obj for obj in avatar_objects if obj.type == "MESH" and obj.find_armature() == armature] or avatar_objects)

    garment_objects = import_glb(garment_path)
    garment = largest_mesh(garment_objects)
    for obj in garment_objects:
        if obj != garment:
            bpy.data.objects.remove(obj, do_unlink=True)

    fit_to_body(garment, body, category)
    copy_weights(body, garment)

    modifier = garment.modifiers.new(name="CLOUVA Armature", type="ARMATURE")
    modifier.object = armature
    garment.parent = armature
    garment.matrix_parent_inverse = armature.matrix_world.inverted()

    validate(garment)
    export(output_path, avatar_objects, garment, armature)


if __name__ == "__main__":
    main()
