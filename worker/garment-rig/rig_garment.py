import bpy
import os
import sys
from mathutils import Vector
from mathutils.kdtree import KDTree


def args():
    values = sys.argv[sys.argv.index("--") + 1 :]
    if len(values) != 6:
        raise RuntimeError("Expected avatar.glb garment.glb output.glb category art.png color")
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


def select_only(obj):
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def prepare_garment(objects):
    """Conserva y une todas las partes reales de una prenda.

    Muchos GLB llegan separados en torso, mangas, capucha, puños, etc. El
    código anterior elegía solamente la malla con más vértices y borraba las
    demás. Si esa malla eran las mangas, luego se escalaban como si fueran el
    buzo completo y aparecían gigantes sobre la cabeza.
    """
    meshes = [obj for obj in mesh_objects(objects) if len(obj.data.vertices) >= 3]
    if not meshes:
        raise RuntimeError("Garment GLB has no usable mesh")

    # Desvincular cada pieza de empties/armatures importados sin alterar su
    # posición mundial. También quitamos rigs y pesos anteriores: CLOUVA
    # vuelve a calcularlos contra el avatar oficial.
    for obj in meshes:
        world_matrix = obj.matrix_world.copy()
        obj.parent = None
        obj.matrix_world = world_matrix
        for modifier in list(obj.modifiers):
            if modifier.type == "ARMATURE":
                obj.modifiers.remove(modifier)
        obj.vertex_groups.clear()
        obj.hide_set(False)
        obj.hide_viewport = False
        obj.hide_render = False

    bpy.context.view_layer.update()

    # Unir las piezas en coordenadas mundiales para obtener una sola caja
    # englobante coherente y aplicar el mismo fitting a torso/mangas/capucha.
    bpy.ops.object.select_all(action="DESELECT")
    active = max(meshes, key=lambda obj: len(obj.data.vertices))
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = active
    if len(meshes) > 1:
        bpy.ops.object.join()
    garment = bpy.context.view_layer.objects.active
    garment.name = "CLOUVA_Garment"

    # Fijar rotación y escala importadas dentro de la geometría. La ubicación
    # se conserva para poder centrarla después mediante coordenadas mundiales.
    select_only(garment)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    bpy.context.view_layer.update()

    # Ya no hacen falta armatures, empties ni cámaras del GLB de la prenda.
    for obj in list(objects):
        if obj != garment and obj.name in bpy.data.objects:
            bpy.data.objects.remove(obj, do_unlink=True)

    print(
        f"[fit-debug] garment_parts={len(meshes)} joined_vertices={len(garment.data.vertices)} "
        f"location={tuple(round(v, 4) for v in garment.location)}",
        flush=True,
    )
    return garment


def bbox_world(obj):
    corners = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    mins = Vector((min(v.x for v in corners), min(v.y for v in corners), min(v.z for v in corners)))
    maxs = Vector((max(v.x for v in corners), max(v.y for v in corners), max(v.z for v in corners)))
    return mins, maxs


def bbox_vertices_in_z(obj, bottom_z, top_z):
    """BBox mundial usando solo geometría situada dentro del rango vertical.

    Así una remera no toma el ancho de pies, pelo o manos que quedan fuera del
    torso. Se deja un pequeño margen para no perder vértices de borde.
    """
    height = max(top_z - bottom_z, 1e-6)
    margin = height * 0.04
    matrix = obj.matrix_world
    points = []
    for vertex in obj.data.vertices:
        point = matrix @ vertex.co
        if bottom_z - margin <= point.z <= top_z + margin:
            points.append(point)

    if len(points) < 8:
        fallback_min, fallback_max = bbox_world(obj)
        return (
            Vector((fallback_min.x, fallback_min.y, bottom_z)),
            Vector((fallback_max.x, fallback_max.y, top_z)),
        )

    mins = Vector((min(v.x for v in points), min(v.y for v in points), bottom_z))
    maxs = Vector((max(v.x for v in points), max(v.y for v in points), top_z))
    return mins, maxs


# Nombres reales de huesos del avatar oficial actual, con alias comunes
# por si el rig cambia en el futuro.
BONE_ALIASES = {
    "hips": ["Hips", "mixamorig:Hips", "pelvis", "Pelvis"],
    "spine_top": ["Spine02", "Spine2", "Spine1", "Spine01", "mixamorig:Spine2", "chest", "Chest"],
    "neck": ["neck", "Neck", "mixamorig:Neck"],
    "left_shoulder": ["LeftShoulder", "mixamorig:LeftShoulder", "shoulder.L", "Shoulder_L"],
    "left_up_leg": ["LeftUpLeg", "mixamorig:LeftUpLeg", "thigh.L", "UpLeg_L"],
    "left_foot": ["LeftFoot", "mixamorig:LeftFoot", "foot.L", "Foot_L"],
    "left_toe": ["LeftToeBase", "mixamorig:LeftToeBase", "toe.L"],
}


def find_bone_head_world(armature, aliases):
    for name in aliases:
        bone = armature.pose.bones.get(name)
        if bone is not None:
            return armature.matrix_world @ bone.head
    return None


def body_region_bbox(body, armature, category):
    """Caja de la zona anatómica real correspondiente a la prenda."""
    bpy.context.view_layer.update()
    body_min, body_max = bbox_world(body)
    hips = find_bone_head_world(armature, BONE_ALIASES["hips"])
    spine_top = find_bone_head_world(armature, BONE_ALIASES["spine_top"])
    neck = find_bone_head_world(armature, BONE_ALIASES["neck"])
    shoulder = find_bone_head_world(armature, BONE_ALIASES["left_shoulder"])
    up_leg = find_bone_head_world(armature, BONE_ALIASES["left_up_leg"])
    foot = find_bone_head_world(armature, BONE_ALIASES["left_foot"])
    toe = find_bone_head_world(armature, BONE_ALIASES["left_toe"])

    if category in ("hoodie", "shirt", "jacket") and hips and (neck or shoulder or spine_top):
        top_z = (neck or shoulder or spine_top).z
        bottom_z = hips.z
        region_min, region_max = bbox_vertices_in_z(body, bottom_z, top_z)
        print(
            f"[fit-debug] category={category} torso_z=({bottom_z:.4f},{top_z:.4f}) "
            f"region=({tuple(round(v, 4) for v in region_min)}, {tuple(round(v, 4) for v in region_max)})",
            flush=True,
        )
        return region_min, region_max

    if category in ("pants", "shorts") and hips and (foot or up_leg):
        bottom_z = (foot or body_min).z
        if category == "shorts" and up_leg:
            bottom_z = up_leg.z - (hips.z - up_leg.z) * 0.45
        region_min, region_max = bbox_vertices_in_z(body, bottom_z, hips.z)
        print(f"[fit-debug] category={category} legs_z=({bottom_z:.4f},{hips.z:.4f})", flush=True)
        return region_min, region_max

    if category == "shoes" and (foot or toe):
        top_z = (toe or foot).z + 0.15 * (body_max.z - body_min.z)
        region_min, region_max = bbox_vertices_in_z(body, body_min.z, top_z)
        print(f"[fit-debug] category={category} shoes_z=({body_min.z:.4f},{top_z:.4f})", flush=True)
        return region_min, region_max

    print(
        f"[fit-debug] category={category} FALLBACK cuerpo entero "
        f"hips={hips} neck={neck} shoulder={shoulder} up_leg={up_leg} foot={foot} toe={toe}",
        flush=True,
    )
    return body_min, body_max


def fit_to_body(garment, body, armature, category):
    body_min, body_max = body_region_bbox(body, armature, category)
    garment_min, garment_max = bbox_world(garment)
    body_size = body_max - body_min
    garment_size = garment_max - garment_min

    if min(garment_size) <= 1e-6 or min(body_size) <= 1e-6:
        raise RuntimeError("Garment or body region has invalid dimensions")

    padding = {
        "hoodie": (1.10, 1.05, 1.08),
        "shirt": (1.06, 1.03, 1.06),
        "jacket": (1.12, 1.07, 1.10),
        "pants": (1.08, 1.04, 1.08),
        "shorts": (1.07, 1.04, 1.07),
        "shoes": (1.06, 1.03, 1.06),
        "accessory": (1.05, 1.05, 1.05),
    }[category]

    factors = Vector((
        body_size.x / garment_size.x * padding[0],
        body_size.y / garment_size.y * padding[1],
        body_size.z / garment_size.z * padding[2],
    ))

    # Evitar que una pieza corrupta o con ejes casi planos se convierta en un
    # bloque enorme. Las prendas válidas siguen pudiendo cambiar mucho de
    # unidad (cm, m, etc.), pero no deformarse cientos de veces entre ejes.
    median_factor = sorted((factors.x, factors.y, factors.z))[1]
    minimum = median_factor * 0.35
    maximum = median_factor * 2.85
    factors.x = max(minimum, min(factors.x, maximum))
    factors.y = max(minimum, min(factors.y, maximum))
    factors.z = max(minimum, min(factors.z, maximum))

    garment.scale = Vector((
        garment.scale.x * factors.x,
        garment.scale.y * factors.y,
        garment.scale.z * factors.z,
    ))
    bpy.context.view_layer.update()

    garment_min, garment_max = bbox_world(garment)
    garment_center = (garment_min + garment_max) * 0.5
    body_center = (body_min + body_max) * 0.5
    offset = body_center - garment_center
    garment.location += offset
    bpy.context.view_layer.update()

    final_min, final_max = bbox_world(garment)
    print(
        f"[fit-debug] garment_before_size={tuple(round(v, 4) for v in garment_size)} "
        f"body_size={tuple(round(v, 4) for v in body_size)} "
        f"scale={tuple(round(v, 4) for v in factors)} offset={tuple(round(v, 4) for v in offset)} "
        f"final_bbox=({tuple(round(v, 4) for v in final_min)}, {tuple(round(v, 4) for v in final_max)})",
        flush=True,
    )


def build_body_kdtree(body):
    matrix = body.matrix_world
    kd = KDTree(len(body.data.vertices))
    for index, vertex in enumerate(body.data.vertices):
        kd.insert(matrix @ vertex.co, index)
    kd.balance()
    return kd


def copy_weights(body, garment):
    body_groups = {group.index: group.name for group in body.vertex_groups}
    if not body_groups:
        raise RuntimeError("Avatar body has no vertex groups")

    garment.vertex_groups.clear()
    garment_groups = {name: garment.vertex_groups.new(name=name) for name in body_groups.values()}
    kd = build_body_kdtree(body)
    garment_inverse = garment.matrix_world.inverted()
    neighbors_k = 6

    for vertex in garment.data.vertices:
        world_position = garment.matrix_world @ vertex.co
        neighbors = kd.find_n(world_position, neighbors_k)

        blended = {}
        total_neighbor_weight = 0.0
        for _, body_index, distance in neighbors:
            source = body.data.vertices[body_index]
            neighbor_weight = 1.0 / max(distance, 1e-4) ** 2
            total_neighbor_weight += neighbor_weight
            for membership in source.groups:
                name = body_groups.get(membership.group)
                if not name or membership.weight <= 0.0001:
                    continue
                blended[name] = blended.get(name, 0.0) + membership.weight * neighbor_weight

        if total_neighbor_weight <= 0:
            continue

        influences = [(name, weight / total_neighbor_weight) for name, weight in blended.items()]
        influences.sort(key=lambda item: item[1], reverse=True)
        influences = influences[:4]
        total = sum(weight for _, weight in influences) or 1.0
        for name, weight in influences:
            garment_groups[name].add([vertex.index], weight / total, "REPLACE")
        vertex.co = garment_inverse @ world_position


def hex_to_rgba(value):
    value = (value or "#0a0a0a").strip().lstrip("#")
    if len(value) != 6:
        value = "0a0a0a"
    return tuple(int(value[index:index + 2], 16) / 255.0 for index in (0, 2, 4)) + (1.0,)


def ensure_uv_map(obj):
    select_only(obj)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(
        angle_limit=1.15192,
        island_margin=0.02,
        area_weight=0.0,
        correct_aspect=True,
        scale_to_bounds=True,
    )
    bpy.ops.object.mode_set(mode="OBJECT")


def apply_material(garment, art_path, color):
    ensure_uv_map(garment)

    material = bpy.data.materials.new(name="CLOUVA_Garment_Material")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()

    output = nodes.new("ShaderNodeOutputMaterial")
    output.location = (700, 0)
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    shader.location = (420, 0)
    shader.inputs["Roughness"].default_value = 0.72
    shader.inputs["Base Color"].default_value = hex_to_rgba(color)
    links.new(shader.outputs["BSDF"], output.inputs["Surface"])

    if art_path and os.path.exists(art_path):
        uv_node = nodes.new("ShaderNodeUVMap")
        uv_node.location = (-700, 0)
        mapping = nodes.new("ShaderNodeMapping")
        mapping.location = (-500, 0)
        texture = nodes.new("ShaderNodeTexImage")
        texture.location = (-280, 0)
        texture.image = bpy.data.images.load(art_path, check_existing=False)
        texture.extension = "REPEAT"
        tint = nodes.new("ShaderNodeRGB")
        tint.location = (-260, -180)
        tint.outputs[0].default_value = hex_to_rgba(color)
        multiply = nodes.new("ShaderNodeMixRGB")
        multiply.location = (100, 0)
        multiply.blend_type = "MULTIPLY"
        multiply.inputs["Fac"].default_value = 1.0
        links.new(uv_node.outputs["UV"], mapping.inputs["Vector"])
        links.new(mapping.outputs["Vector"], texture.inputs["Vector"])
        links.new(texture.outputs["Color"], multiply.inputs[1])
        links.new(tint.outputs["Color"], multiply.inputs[2])
        links.new(multiply.outputs["Color"], shader.inputs["Base Color"])
        if texture.outputs.get("Alpha"):
            links.new(texture.outputs["Alpha"], shader.inputs["Alpha"])
            material.surface_render_method = "DITHERED"

    garment.data.materials.clear()
    garment.data.materials.append(material)


def validate(garment):
    if len(garment.data.vertices) < 50:
        raise RuntimeError("Garment mesh is too small")
    weighted = sum(1 for vertex in garment.data.vertices if len(vertex.groups) > 0)
    if weighted / len(garment.data.vertices) < 0.98:
        raise RuntimeError("Not enough vertices received skin weights")


def export(output_path, garment, armature):
    bpy.ops.object.select_all(action="DESELECT")
    armature.select_set(True)
    garment.select_set(True)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.export_scene.gltf(
        filepath=output_path,
        export_format="GLB",
        use_selection=True,
        export_apply=False,
        export_animations=True,
        export_skins=True,
        export_all_influences=False,
        export_materials="EXPORT",
    )


def main():
    avatar_path, garment_path, output_path, category, art_path, color = args()
    clear_scene()

    avatar_objects = import_glb(avatar_path)
    bpy.context.view_layer.update()
    armature = find_armature(avatar_objects)
    body = largest_mesh(
        [obj for obj in avatar_objects if obj.type == "MESH" and obj.find_armature() == armature]
        or avatar_objects
    )

    garment_objects = import_glb(garment_path)
    garment = prepare_garment(garment_objects)

    fit_to_body(garment, body, armature, category)
    copy_weights(body, garment)
    apply_material(garment, art_path, color)

    modifier = garment.modifiers.new(name="CLOUVA Armature", type="ARMATURE")
    modifier.object = armature

    # Preservar exactamente la transformación mundial al parentear. Hacerlo
    # explícitamente evita saltos al origen o a la cabeza por matrices locales
    # heredadas del GLB original.
    world_matrix = garment.matrix_world.copy()
    garment.parent = armature
    garment.matrix_parent_inverse = armature.matrix_world.inverted()
    garment.matrix_world = world_matrix
    bpy.context.view_layer.update()

    validate(garment)
    export(output_path, garment, armature)


if __name__ == "__main__":
    main()
