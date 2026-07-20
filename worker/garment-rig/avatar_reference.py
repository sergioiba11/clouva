import bpy
from mathutils import Vector


def expected_bone_parents(metadata):
    return {
        str(item["name"]): (str(item["parent"]) if item.get("parent") else None)
        for item in metadata.get("bones", [])
        if isinstance(item, dict) and item.get("name")
    }


def restore_promoted_root_bone(armature, expected_parents):
    """Restore a root bone that Blender promoted to the FBX armature object.

    Unreal's skeletal-mesh FBX exporter can represent the only skeleton root as
    the armature model node. Blender then imports every child correctly but omits
    that root from ``armature.data.bones``. Recreating only that verified root and
    parenting its expected children preserves all imported child rest matrices.
    """
    actual = {bone.name for bone in armature.data.bones}
    expected = set(expected_parents)
    missing = expected - actual
    if not missing:
        return None

    expected_roots = {name for name, parent in expected_parents.items() if parent is None}
    if len(missing) != 1 or missing != expected_roots or actual != expected - missing:
        return None

    root_name = next(iter(missing))
    child_names = [name for name, parent in expected_parents.items() if parent == root_name]
    previous_active = bpy.context.view_layer.objects.active
    bpy.ops.object.mode_set(mode="OBJECT") if bpy.context.object and bpy.context.object.mode != "OBJECT" else None
    bpy.ops.object.select_all(action="DESELECT")
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.mode_set(mode="EDIT")
    try:
        children = [armature.data.edit_bones.get(name) for name in child_names]
        children = [bone for bone in children if bone is not None]
        if not children:
            raise RuntimeError(f"Cannot restore promoted root {root_name}: no expected children were imported")

        head = sum(
            (bone.head.copy() for bone in children),
            Vector((0.0, 0.0, 0.0)),
        ) / len(children)
        guide = next((bone for bone in children if "spine" in bone.name.lower()), children[0])
        direction = guide.tail - guide.head
        if direction.length <= 1e-8:
            direction = Vector((0.0, 1.0, 0.0))
        else:
            direction.normalize()
        child_lengths = [bone.length for bone in children if bone.length > 1e-8]
        root_length = max(min(child_lengths) * 0.25 if child_lengths else 0.01, 1e-4)

        root = armature.data.edit_bones.new(root_name)
        root.head = head
        root.tail = head + direction * root_length
        root.use_deform = True
        for child in children:
            child.parent = root
            child.use_connect = False
    finally:
        bpy.ops.object.mode_set(mode="OBJECT")
        if previous_active and previous_active.name in bpy.context.view_layer.objects:
            bpy.context.view_layer.objects.active = previous_active

    print(
        f"[avatar-reference] restored FBX-promoted root bone {root_name} "
        f"with children={','.join(child_names)}",
        flush=True,
    )
    return root_name


def canonicalize_and_validate_bones(armature, metadata):
    expected_parents = expected_bone_parents(metadata)
    if not expected_parents:
        raise RuntimeError("Official Unreal avatar metadata contains no bones")

    restore_promoted_root_bone(armature, expected_parents)
    actual = {bone.name for bone in armature.data.bones}
    expected = set(expected_parents)
    missing = sorted(expected - actual)
    extra = sorted(actual - expected)
    if missing or extra:
        raise RuntimeError(
            "Official Unreal avatar rig mismatch: "
            f"missing={missing[:12]} extra={extra[:12]}"
        )

    parent_mismatches = []
    for bone in armature.data.bones:
        actual_parent = bone.parent.name if bone.parent else None
        if actual_parent != expected_parents[bone.name]:
            parent_mismatches.append(
                f"{bone.name}: expected {expected_parents[bone.name]}, got {actual_parent}"
            )
    if parent_mismatches:
        raise RuntimeError(
            "Official Unreal avatar hierarchy mismatch: " + "; ".join(parent_mismatches[:12])
        )
    return expected_parents
