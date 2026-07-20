import importlib.util
import math
import os
import sys


PREVIOUS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "rig_garment_v16.py")


def load_previous_pipeline():
    if not os.path.exists(PREVIOUS_PATH):
        raise RuntimeError(f"No se encontró el pipeline V16 en {PREVIOUS_PATH}")
    spec = importlib.util.spec_from_file_location("clouva_rig_v16", PREVIOUS_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("No se pudo crear el cargador del pipeline V16")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


previous = load_previous_pipeline()
legacy = previous.legacy
v9 = previous.v9


def validate_cleanup_contract(
    original_vertices,
    final_vertices,
    original_polygons,
    final_polygons,
    size_errors,
    center_error,
):
    original_vertices = max(int(original_vertices), 1)
    original_polygons = max(int(original_polygons), 1)
    final_vertices = int(final_vertices)
    final_polygons = int(final_polygons)
    vertex_ratio = final_vertices / original_vertices
    polygon_ratio = final_polygons / original_polygons
    maximum_size_error = max(float(value) for value in size_errors)
    center_error = float(center_error)

    values = [vertex_ratio, polygon_ratio, maximum_size_error, center_error]
    if not all(math.isfinite(value) for value in values):
        raise RuntimeError("Garment geometry cleanup produced non-finite metrics")
    if final_vertices < 50 or final_polygons < 20:
        raise RuntimeError(
            "Garment geometry became unusable during cleanup: "
            f"vertices={final_vertices}, polygons={final_polygons}"
        )
    # Merge-by-distance can legitimately remove many duplicated vertices from AI GLBs.
    # Polygon retention and unchanged outer bounds are stronger safety signals than
    # requiring an arbitrary percentage of the original split vertices.
    if polygon_ratio < 0.80:
        raise RuntimeError(
            "Garment topology was unexpectedly reduced: "
            f"polygons={original_polygons}->{final_polygons}, ratio={polygon_ratio:.4f}"
        )
    if maximum_size_error > 0.05 or center_error > 0.03:
        raise RuntimeError(
            "Garment outer geometry changed during cleanup: "
            f"sizeError={maximum_size_error:.4f}, centerError={center_error:.4f}"
        )

    return {
        "vertexRatio": round(vertex_ratio, 6),
        "polygonRatio": round(polygon_ratio, 6),
        "maximumSizeError": round(maximum_size_error, 6),
        "centerError": round(center_error, 6),
    }


def has_visible_deformation(obj):
    return any(
        modifier.type == "ARMATURE" and modifier.show_viewport
        for modifier in obj.modifiers
    )


def bake_visible_geometry(obj):
    """Freeze the currently visible legacy-rigged shape before removing its rig.

    Older CLOUVA garments can arrive with an Armature modifier whose evaluated
    geometry differs greatly from the raw rest mesh. Removing that modifier first
    makes the hoodie appear to change size by 90%+, even though Blender is merely
    showing the undeformed source mesh. Baking the evaluated object gives the fresh
    rigging pass the exact visible hoodie the creator approved.
    """
    if not has_visible_deformation(obj):
        return False

    legacy.bpy.context.view_layer.update()
    depsgraph = legacy.bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    baked_data = legacy.bpy.data.meshes.new_from_object(
        evaluated,
        preserve_all_data_layers=True,
        depsgraph=depsgraph,
    )
    if baked_data is None or len(baked_data.vertices) < 3:
        raise RuntimeError(
            f"No se pudo hornear la forma visible de la prenda antigua: {obj.name}"
        )

    old_data = obj.data
    obj.data = baked_data
    for modifier in list(obj.modifiers):
        obj.modifiers.remove(modifier)
    if old_data.users == 0:
        legacy.bpy.data.meshes.remove(old_data)

    obj["clouvaLegacyVisibleGeometryBaked"] = True
    obj["clouvaLegacyVisibleGeometryBakeVersion"] = 29
    return True


def prepare_garment_v17(objects, category):
    meshes = [obj for obj in objects if obj.type == "MESH" and len(obj.data.vertices) >= 3]
    source_armatures = [obj for obj in objects if obj.type == "ARMATURE"]
    if not meshes:
        raise RuntimeError("Garment GLB has no usable mesh")

    baked_meshes = 0
    for obj in meshes:
        # Bake before detaching the old Armature. Its current evaluated pose is the
        # approved visible shape; the raw mesh underneath may be tiny or displaced.
        world = obj.matrix_world.copy()
        if bake_visible_geometry(obj):
            baked_meshes += 1
        obj.animation_data_clear()
        obj.parent = None
        obj.matrix_world = world
        for modifier in list(obj.modifiers):
            if modifier.type == "ARMATURE":
                obj.modifiers.remove(modifier)
        obj.hide_set(False)
        obj.hide_viewport = False
        obj.hide_render = False

    legacy.bpy.context.view_layer.update()

    # The cleanup contract must compare against the baked visible geometry, not the
    # hidden rest mesh that existed below the previous rig.
    original_vertices = sum(len(obj.data.vertices) for obj in meshes)
    original_polygons = sum(len(obj.data.polygons) for obj in meshes)
    original_min, original_max = legacy.combined_bbox(meshes)
    original_size = original_max - original_min
    original_center = (original_min + original_max) * 0.5

    legacy.bpy.ops.object.select_all(action="DESELECT")
    active = max(meshes, key=lambda obj: len(obj.data.vertices))
    for obj in meshes:
        obj.select_set(True)
    legacy.bpy.context.view_layer.objects.active = active
    if len(meshes) > 1:
        legacy.bpy.ops.object.join()

    garment = legacy.bpy.context.view_layer.objects.active
    garment.name = "CLOUVA_Garment"
    garment.animation_data_clear()
    legacy.select_only(garment)
    legacy.bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

    legacy.bpy.ops.object.mode_set(mode="EDIT")
    legacy.bpy.ops.mesh.select_all(action="SELECT")
    try:
        legacy.bpy.ops.mesh.remove_doubles(threshold=0.000001)
    except Exception:
        legacy.bpy.ops.mesh.merge_by_distance(threshold=0.000001)
    try:
        legacy.bpy.ops.mesh.normals_make_consistent(inside=False)
    except Exception:
        pass
    legacy.bpy.ops.object.mode_set(mode="OBJECT")
    garment.data.validate(verbose=False)
    legacy.bpy.context.view_layer.update()

    if category in legacy.DEFORMABLE_CATEGORIES:
        garment.vertex_groups.clear()

    for source_armature in source_armatures:
        source_armature.animation_data_clear()
        if source_armature.name in legacy.bpy.data.objects:
            legacy.bpy.data.objects.remove(source_armature, do_unlink=True)

    final_vertices = len(garment.data.vertices)
    final_polygons = len(garment.data.polygons)
    final_min, final_max = legacy.bbox_world(garment)
    final_size = final_max - final_min
    final_center = (final_min + final_max) * 0.5
    size_errors = tuple(
        abs(float(final_size[index]) - float(original_size[index]))
        / max(abs(float(original_size[index])), 1e-8)
        for index in range(3)
    )
    center_scale = max(max(abs(float(value)) for value in original_size), 1e-8)
    center_error = (final_center - original_center).length / center_scale

    metrics = validate_cleanup_contract(
        original_vertices,
        final_vertices,
        original_polygons,
        final_polygons,
        size_errors,
        center_error,
    )
    garment["clouvaGeometryCleanupVersion"] = 29
    garment["clouvaLegacyVisibleGeometryBaked"] = baked_meshes > 0
    garment["clouvaLegacyBakedMeshCount"] = baked_meshes
    garment["clouvaSourceVertexCount"] = original_vertices
    garment["clouvaCleanVertexCount"] = final_vertices
    garment["clouvaSourcePolygonCount"] = original_polygons
    garment["clouvaCleanPolygonCount"] = final_polygons
    garment["clouvaVertexRetentionRatio"] = metrics["vertexRatio"]
    garment["clouvaPolygonRetentionRatio"] = metrics["polygonRatio"]
    garment["clouvaGeometryBoundsError"] = metrics["maximumSizeError"]

    print(
        "[rig-v29] topology-aware cleanup passed "
        f"vertices={original_vertices}->{final_vertices} "
        f"polygons={original_polygons}->{final_polygons} metrics={metrics} "
        f"sourceArmatures={len(source_armatures)} bakedMeshes={baked_meshes}",
        flush=True,
    )
    return garment


legacy.prepare_garment = prepare_garment_v17


if __name__ == "__main__":
    v9.main()
