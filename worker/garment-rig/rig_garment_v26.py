import gc
import importlib.util
import math
import os
import sys


PREVIOUS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "rig_garment_v25.py")


def load_previous_pipeline():
    if not os.path.exists(PREVIOUS_PATH):
        raise RuntimeError(f"No se encontró el pipeline V25 en {PREVIOUS_PATH}")
    spec = importlib.util.spec_from_file_location("clouva_rig_v25", PREVIOUS_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("No se pudo crear el cargador del pipeline V25")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


previous = load_previous_pipeline()
legacy = previous.legacy
v9 = previous.v9

MEMORY_GUARD_VERSION = 38
try:
    MAX_GARMENT_POLYGONS = max(
        5000,
        int(os.getenv("CLOUVA_MAX_GARMENT_POLYGONS", "30000")),
    )
except (TypeError, ValueError):
    MAX_GARMENT_POLYGONS = 30000

_original_import_glb = legacy.import_glb
_original_prepare_garment = legacy.prepare_garment


def _polygon_count(objects):
    return sum(
        len(obj.data.polygons)
        for obj in objects
        if getattr(obj, "type", None) == "MESH" and getattr(obj, "data", None) is not None
    )


def _has_visible_armature(obj):
    if getattr(obj, "type", None) != "MESH":
        return False
    try:
        if obj.find_armature() is not None:
            return True
    except Exception:
        pass
    return any(modifier.type == "ARMATURE" for modifier in obj.modifiers)


def _bounds_metrics(before_min, before_max, after_min, after_max):
    before_size = before_max - before_min
    after_size = after_max - after_min
    before_center = (before_min + before_max) * 0.5
    after_center = (after_min + after_max) * 0.5
    size_errors = [
        abs(float(after_size[index]) - float(before_size[index]))
        / max(abs(float(before_size[index])), 1e-8)
        for index in range(3)
    ]
    reference = max(max(abs(float(value)) for value in before_size), 1e-8)
    center_error = float((after_center - before_center).length) / reference
    return max(size_errors), center_error


def _release_unused_meshes():
    for mesh in list(legacy.bpy.data.meshes):
        if mesh.users == 0:
            legacy.bpy.data.meshes.remove(mesh)
    gc.collect()


def reduce_object_polygons(obj, target_polygons, reason):
    current = len(obj.data.polygons)
    target = max(100, int(target_polygons))
    if current <= target:
        return {
            "reduced": False,
            "before": current,
            "after": current,
            "target": target,
        }

    before_min, before_max = legacy.bbox_world(obj)
    if legacy.bpy.context.object and legacy.bpy.context.object.mode != "OBJECT":
        legacy.bpy.ops.object.mode_set(mode="OBJECT")
    legacy.select_only(obj)

    modifier = obj.modifiers.new(name="CLOUVA_MemoryGuard", type="DECIMATE")
    modifier.decimate_type = "COLLAPSE"
    modifier.ratio = max(0.01, min(1.0, float(target) / float(current)))
    if hasattr(modifier, "use_collapse_triangulate"):
        modifier.use_collapse_triangulate = True
    legacy.bpy.ops.object.modifier_apply(modifier=modifier.name)
    legacy.bpy.context.view_layer.update()

    after = len(obj.data.polygons)
    if after < 100:
        raise RuntimeError(
            f"La reducción de memoria dejó una prenda inutilizable: polygons={current}->{after}"
        )
    after_min, after_max = legacy.bbox_world(obj)
    size_error, center_error = _bounds_metrics(before_min, before_max, after_min, after_max)
    if not math.isfinite(size_error) or not math.isfinite(center_error):
        raise RuntimeError("La reducción de memoria produjo medidas no finitas")
    if size_error > 0.08 or center_error > 0.05:
        raise RuntimeError(
            "La reducción de memoria cambió demasiado la silueta de la prenda: "
            f"sizeError={size_error:.4f}, centerError={center_error:.4f}"
        )

    obj["clouvaMemoryGuardVersion"] = MEMORY_GUARD_VERSION
    obj["clouvaMemoryGuardReason"] = reason
    obj["clouvaMemoryGuardPolygonsBefore"] = current
    obj["clouvaMemoryGuardPolygonsAfter"] = after
    obj["clouvaMemoryGuardTarget"] = target
    _release_unused_meshes()
    print(
        "[rig-v38] memory-safe polygon reduction "
        f"reason={reason} object={obj.name} polygons={current}->{after} target={target} "
        f"sizeError={size_error:.4f} centerError={center_error:.4f}",
        flush=True,
    )
    return {
        "reduced": True,
        "before": current,
        "after": after,
        "target": target,
        "sizeError": size_error,
        "centerError": center_error,
    }


def reduce_mesh_set(objects, target_polygons, reason):
    meshes = [
        obj
        for obj in objects
        if getattr(obj, "type", None) == "MESH" and len(obj.data.polygons) >= 20
    ]
    total = _polygon_count(meshes)
    if not meshes or total <= target_polygons:
        return {"reduced": False, "before": total, "after": total}

    results = []
    remaining_target = int(target_polygons)
    remaining_total = total
    for index, obj in enumerate(sorted(meshes, key=lambda item: len(item.data.polygons), reverse=True)):
        current = len(obj.data.polygons)
        if index == len(meshes) - 1:
            object_target = max(100, remaining_target)
        else:
            object_target = max(100, round(target_polygons * current / total))
        object_target = min(current, object_target)
        results.append(reduce_object_polygons(obj, object_target, reason))
        remaining_target = max(100, remaining_target - object_target)
        remaining_total = max(0, remaining_total - current)

    return {
        "reduced": any(item["reduced"] for item in results),
        "before": total,
        "after": _polygon_count(meshes),
        "results": results,
    }


def import_glb_memory_safe_v38(path):
    objects = _original_import_glb(path)
    source_name = os.path.basename(str(path)).lower()
    if source_name != "garment.glb":
        return objects

    meshes = [obj for obj in objects if getattr(obj, "type", None) == "MESH"]
    if meshes and not any(_has_visible_armature(obj) for obj in meshes):
        result = reduce_mesh_set(meshes, MAX_GARMENT_POLYGONS, "raw-meshy-before-cleanup")
        if result.get("reduced"):
            print(
                f"[rig-v38] raw garment preflight polygons={result['before']}->{result['after']}",
                flush=True,
            )
    return objects


def prepare_garment_memory_safe_v38(objects, category):
    garment = _original_prepare_garment(objects, category)
    if category in legacy.DEFORMABLE_CATEGORIES and len(garment.data.polygons) > MAX_GARMENT_POLYGONS:
        reduce_object_polygons(
            garment,
            MAX_GARMENT_POLYGONS,
            "post-cleanup-before-weight-transfer",
        )
    garment["clouvaMemoryGuardVersion"] = MEMORY_GUARD_VERSION
    garment["clouvaMemoryGuardPolygonLimit"] = MAX_GARMENT_POLYGONS
    return garment


legacy.import_glb = import_glb_memory_safe_v38
legacy.prepare_garment = prepare_garment_memory_safe_v38

# Re-export the active V36 validation contract.
evaluated_world_points = previous.evaluated_world_points
shape_signature = previous.shape_signature
validate_shape_metrics = previous.validate_shape_metrics
garment_signature = previous.garment_signature
validate_anchor_metrics = previous.validate_anchor_metrics
validate_signature = previous.validate_signature
ROUNDTRIP_SIGNATURE_VERSION = previous.ROUNDTRIP_SIGNATURE_VERSION


def production_main():
    return previous.main()


main = production_main


if __name__ == "__main__":
    main()
