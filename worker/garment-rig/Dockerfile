FROM python:3.11-slim-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
    wget \
    xz-utils \
    libxi6 \
    libxrender1 \
    libxrandr2 \
    libxfixes3 \
    libxcursor1 \
    libxinerama1 \
    libxkbcommon0 \
    libgl1 \
    libegl1 \
    libsm6 \
    && rm -rf /var/lib/apt/lists/*

ENV BLENDER_VERSION=4.2.3
ENV BLENDER_URL=https://download.blender.org/release/Blender4.2/blender-${BLENDER_VERSION}-linux-x64.tar.xz

RUN wget -q "$BLENDER_URL" -O /tmp/blender.tar.xz \
    && mkdir -p /opt/blender \
    && tar -xJf /tmp/blender.tar.xz -C /opt/blender --strip-components=1 \
    && rm /tmp/blender.tar.xz \
    && ln -s /opt/blender/blender /usr/local/bin/blender

RUN pip install --no-cache-dir --break-system-packages fastapi uvicorn pydantic python-multipart

WORKDIR /app
COPY app.py app_v5.py app_v6.py app_v7.py app_v8.py app_v9.py app_v10.py app_v11.py app_v12.py app_v13.py app_v14.py app_v15.py app_v16.py avatar_reference.py complete_avatar_rig.py complete_avatar_rig_v3.py complete_avatar_rig_v6.py complete_avatar_rig_v7.py complete_avatar_rig_v8.py complete_avatar_rig_v9.py complete_avatar_rig_v10.py complete_avatar_rig_v11.py autorig_avatar_v12.py autorig_avatar_v16.py test_autorig_avatar_v12.py rig_garment.py rig_garment_v5.py rig_garment_v10.py rig_garment_v11.py rig_garment_v12.py rig_garment_v13.py rig_garment_v14.py rig_garment_v15.py rig_garment_v16.py rig_garment_v17.py rig_garment_v18.py rig_garment_v19.py rig_garment_v20.py rig_garment_v21.py rig_garment_v22.py rig_garment_v23.py rig_garment_v24.py rig_garment_v25.py rig_garment_v26.py rig_garment_v27.py rig_garment_v28.py rig_garment_v29.py rig_garment_v30.py rig_garment_v31.py rig_garment_v32.py rig_garment_v33.py rig_object.py attach_object.py export_unreal.py export_unreal_clean.py export_unreal_v31.py inspect_garment.py test_complete_avatar_rig_v7.py test_complete_avatar_rig_v8.py test_complete_avatar_rig_v9.py test_complete_avatar_rig_v10.py test_export_unreal_units.py test_avatar_reference.py test_roundtrip_signature.py test_shared_space_v39.py test_prebind_space_v40.py test_anatomical_fit_v41.py test_canonical_bind_v43.py ./
COPY avatar-reference ./avatar-reference
RUN mv app.py app_legacy.py \
    && mv app_v16.py app.py \
    && mv rig_garment.py rig_garment_legacy.py \
    && mv rig_garment_v5.py rig_garment_v9.py \
    && mv rig_garment_v10.py rig_garment_v10_base.py \
    && mv rig_garment_v11.py rig_garment_v11_base.py \
    && mv rig_garment_v12.py rig_garment_v12_base.py \
    && mv rig_garment_v13.py rig_garment_v13_base.py \
    && mv rig_garment_v14.py rig_garment_v14_base.py \
    && mv rig_garment_v15.py rig_garment_v15_base.py \
    && mv rig_garment_v16.py rig_garment_v16_base.py \
    && mv rig_garment_v17.py rig_garment_v17_base.py \
    && mv rig_garment_v18.py rig_garment_v18_base.py \
    && mv rig_garment_v19.py rig_garment_v19_base.py \
    && mv rig_garment_v20.py rig_garment_v20_base.py \
    && cp rig_garment_v33.py rig_garment.py \
    && sed -i 's/"rig_garment_v10.py"/"rig_garment_v10_base.py"/' /app/rig_garment_v11_base.py \
    && sed -i 's/"rig_garment_v11.py"/"rig_garment_v11_base.py"/' /app/rig_garment_v12_base.py \
    && sed -i 's/"rig_garment_v12.py"/"rig_garment_v12_base.py"/' /app/rig_garment_v13_base.py \
    && sed -i 's/"rig_garment_v13.py"/"rig_garment_v13_base.py"/' /app/rig_garment_v14_base.py \
    && sed -i 's/"rig_garment_v14.py"/"rig_garment_v14_base.py"/' /app/rig_garment_v15_base.py \
    && sed -i 's/"rig_garment_v15.py"/"rig_garment_v15_base.py"/' /app/rig_garment_v16_base.py \
    && sed -i 's/"rig_garment_v16.py"/"rig_garment_v16_base.py"/' /app/rig_garment_v17_base.py \
    && sed -i 's/"rig_garment_v17.py"/"rig_garment_v17_base.py"/' /app/rig_garment_v18_base.py \
    && sed -i 's/"rig_garment_v18.py"/"rig_garment_v18_base.py"/' /app/rig_garment_v19_base.py \
    && sed -i 's/"rig_garment_v19.py"/"rig_garment_v19_base.py"/' /app/rig_garment_v20_base.py

RUN mkdir -p /opt/blender/4.2/scripts/modules \
    && cp /app/rig_garment_legacy.py /opt/blender/4.2/scripts/modules/rig_garment_legacy.py \
    && cp /app/avatar_reference.py /opt/blender/4.2/scripts/modules/avatar_reference.py

ENV PYTHONPATH=/app
ENV CLOUVA_RIG_VERSION=v43
ENV CLOUVA_UNREAL_ROOT_RESTORE=v32
ENV CLOUVA_UPPER_VOLUME_REPAIR=v33
ENV CLOUVA_RIG_DIAGNOSTICS=v43
ENV CLOUVA_GLTF_ROUNDTRIP=v40
ENV CLOUVA_RIG_ENTRYPOINT=v43
ENV CLOUVA_RIG_SPACE_CONTRACT=v40
ENV CLOUVA_PREBIND_SPACE=v40
ENV CLOUVA_CANONICAL_BIND=v43
ENV CLOUVA_ANATOMICAL_FIT=v42
ENV CLOUVA_CLEAN_ATTEMPT=v43
ENV CLOUVA_LOADER_FIX=v43.1
ENV CLOUVA_MEMORY_GUARD=v38
ENV CLOUVA_MAX_CONCURRENT_BLENDER_JOBS=1
ENV CLOUVA_MAX_GARMENT_POLYGONS=30000
ENV CLOUVA_LEGACY_GARMENT_RECOVERY=v29
ENV CLOUVA_WORKER_INSPECTOR=v2
ENV CLOUVA_GARMENT_SOURCE_ROUTING=v30
ENV CLOUVA_GARMENT_MESH_NORMALIZATION=v31
ENV CLOUVA_GARMENT_MODULE_LOADER=v31.2
ENV CLOUVA_AVATAR_COMPLETE_RIG=v16-fresh-schema-autorig
ENV CLOUVA_UNREAL_MOLD_RIG=v2
ENV CLOUVA_AVATAR_REFERENCE_PATH=/app/avatar-reference/AvatarReference.fbx
ENV CLOUVA_AVATAR_REFERENCE_METADATA_PATH=/app/avatar-reference/clouva_avatar_data.json

RUN test -f /app/app.py \
    && test -f /app/app_v15.py \
    && test -f /app/complete_avatar_rig.py \
    && test -f /app/complete_avatar_rig_v3.py \
    && test -f /app/complete_avatar_rig_v6.py \
    && test -f /app/complete_avatar_rig_v7.py \
    && test -f /app/complete_avatar_rig_v8.py \
    && test -f /app/complete_avatar_rig_v9.py \
    && test -f /app/complete_avatar_rig_v10.py \
    && test -f /app/complete_avatar_rig_v11.py \
    && test -f /app/autorig_avatar_v12.py \
    && test -f /app/autorig_avatar_v16.py \
    && test -f /app/test_autorig_avatar_v12.py \
    && test -f /app/test_complete_avatar_rig_v7.py \
    && test -f /app/test_complete_avatar_rig_v8.py \
    && test -f /app/test_complete_avatar_rig_v9.py \
    && test -f /app/test_complete_avatar_rig_v10.py \
    && test -f /app/rig_garment.py \
    && test -f /app/rig_garment_v27.py \
    && test -f /app/rig_garment_v28.py \
    && test -f /app/rig_garment_v29.py \
    && test -f /app/rig_garment_v30.py \
    && test -f /app/rig_garment_v31.py \
    && test -f /app/rig_garment_v32.py \
    && test -f /app/rig_garment_v33.py \
    && test -f /app/test_shared_space_v39.py \
    && test -f /app/test_prebind_space_v40.py \
    && test -f /app/test_anatomical_fit_v41.py \
    && test -f /app/test_canonical_bind_v43.py \
    && test -f /app/avatar-reference/AvatarReference.fbx \
    && test -f /app/avatar-reference/clouva_avatar_data.json \
    && python3 -m py_compile /app/app.py /app/complete_avatar_rig.py /app/complete_avatar_rig_v3.py /app/complete_avatar_rig_v6.py /app/complete_avatar_rig_v7.py /app/complete_avatar_rig_v8.py /app/complete_avatar_rig_v9.py /app/complete_avatar_rig_v10.py /app/complete_avatar_rig_v11.py /app/autorig_avatar_v12.py /app/autorig_avatar_v16.py /app/test_autorig_avatar_v12.py /app/test_complete_avatar_rig_v7.py /app/test_complete_avatar_rig_v8.py /app/test_complete_avatar_rig_v9.py /app/test_complete_avatar_rig_v10.py \
    && python3 -c "import app; paths={getattr(route, 'path', '') for route in app.app.routes}; avatar_route=next(route for route in app.app.routes if getattr(route, 'path', '') == '/avatar/complete-rig' and 'POST' in (getattr(route, 'methods', set()) or set())); assert '/rig' in paths; assert '/avatar/complete-rig' in paths; assert '/rig-with-unreal-mold' in paths; assert '/diagnostics/unreal-mold' in paths; assert '/diagnostics/avatar-complete-rig' in paths; assert '/diagnostics/health' in paths; assert '/diagnostics/latest-rig-failure' in paths; assert '/diagnostics/canonical-bind' in paths; assert app.MAX_CONCURRENT_BLENDER_JOBS == 1; assert app.CLEAN_ATTEMPT_VERSION == 'v43-fresh-source-per-attempt'; assert app.COMPLETE_AVATAR_RIG_VERSION == 'v15-anatomical-landmark-autorig'; assert app.COMPLETE_AVATAR_RIG_SCRIPT.name == 'autorig_avatar_v16.py'; assert app.current.COMPLETE_AVATAR_RIG_VERSION == 'v15-anatomical-landmark-autorig'; assert app.current.COMPLETE_AVATAR_RIG_SCRIPT.name == 'autorig_avatar_v16.py'; assert avatar_route.endpoint.__globals__['COMPLETE_AVATAR_RIG_SCRIPT'].name == 'autorig_avatar_v16.py'; print('[clouva] Worker API + fresh schema AutoRig V16 route OK')" \
    && env PYTHONPATH=/app /opt/blender/blender --background --factory-startup --python-exit-code 1 --python-expr "import autorig_avatar_v16 as module; armature,proof=module.create_fresh_schema_armature(); assert len(armature.data.bones)==24; assert proof['bonesCreated']==24; assert proof['reusedArmature'] is False; assert armature.get('clouva_generated_from_scratch') is True; print('[clouva] AutoRig V16 creates a brand-new 24-bone schema armature OK')" \
    && env PYTHONPATH=/app /opt/blender/blender --background --factory-startup --python-exit-code 1 --python-expr "import importlib.util,bpy; spec=importlib.util.spec_from_file_location('clouva_rig_v6','/app/complete_avatar_rig_v6.py'); module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module); bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False); bpy.ops.object.armature_add(); arm=bpy.context.object; bpy.context.view_layer.objects.active=arm; bpy.ops.object.mode_set(mode='EDIT'); bones=arm.data.edit_bones; neck=bones[0]; neck.name='Neck'; neck.head=(0,0,1); neck.tail=(0,0,1.2); head=bones.new('Head'); head.head=(0,0,1.2); head.tail=(0,0,1.5); head.parent=neck; terminal=bones.new('head_end'); terminal.head=(0,0,1.5); terminal.tail=(0,0,2.5); terminal.parent=head; bpy.ops.object.mode_set(mode='OBJECT'); chosen=module.choose_anatomical_head(arm); assert chosen.name=='Head', chosen.name; print('[clouva] V6 anatomical head selection OK', chosen.name)" \
    && env PYTHONPATH=/app /opt/blender/blender --background --factory-startup --python-exit-code 1 --python /app/test_complete_avatar_rig_v9.py \
    && env PYTHONPATH=/app /opt/blender/blender --background --factory-startup --python-exit-code 1 --python /app/test_complete_avatar_rig_v10.py \
    && env PYTHONPATH=/app /opt/blender/blender --background --factory-startup --python-exit-code 1 --python /app/test_autorig_avatar_v12.py \
    && cd /tmp \
    && env -u PYTHONPATH /opt/blender/blender --background --factory-startup --python-exit-code 1 --python-expr "import avatar_reference; assert hasattr(avatar_reference, 'canonicalize_and_validate_bones'); print('[clouva] avatar_reference available without PYTHONPATH')" \
    && cd /app \
    && env -u CLOUVA_AVATAR_REFERENCE_PATH -u CLOUVA_AVATAR_REFERENCE_METADATA_PATH PYTHONPATH=/app /opt/blender/blender --background --factory-startup --python-exit-code 1 --python /app/test_export_unreal_units.py \
    && env PYTHONPATH=/app /opt/blender/blender --background --factory-startup --python-exit-code 1 --python /app/test_avatar_reference.py \
    && env PYTHONPATH=/app /opt/blender/blender --background --factory-startup --python-exit-code 1 --python-expr "import importlib.util; spec=importlib.util.spec_from_file_location('clouva_rig_v43','/app/rig_garment.py'); module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module); assert module.main.__name__ == 'production_main'; assert module.LOADER_FIX_VERSION == 431; assert module.CANONICAL_BIND_VERSION == 43; assert module.ANATOMICAL_FIT_VERSION == 42; assert module.PREBIND_SPACE_VERSION == 40; assert module.SPACE_CONTRACT_VERSION == 40; assert module.MAX_GARMENT_POLYGONS == 30000; assert module.legacy.validate_unreal_avatar_reference.__name__ == 'validate_unreal_avatar_reference_v43'; assert module.legacy.prepare_garment.__name__ == 'prepare_garment_fresh_v40'; assert module.legacy.copy_weights.__name__ == 'copy_weights_anatomical_v42'; assert module.legacy.export_glb.__name__ == 'export_glb_v40'; assert module.v9.validate_roundtrip_v9.__name__ == 'validate_roundtrip_v40'; print('[clouva] V43 canonical bind + loader fix + V42 anatomical fit + V40 export contracts OK')" \
    && env PYTHONPATH=/app /opt/blender/blender --background --factory-startup --python-exit-code 1 --python-expr "import importlib.util; spec=importlib.util.spec_from_file_location('clouva_rig_v43_decimate','/app/rig_garment.py'); module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module); module.legacy.clear_scene(); module.legacy.bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=5); obj=module.legacy.bpy.context.object; before=len(obj.data.polygons); result=module.reduce_object_polygons(obj, 2000, 'docker-test'); after=len(obj.data.polygons); assert before > 4000; assert result['reduced']; assert 100 <= after <= 2400; print('[clouva] V38 memory guard retained under V43 OK', before, after)" \
    && env PYTHONPATH=/app /opt/blender/blender --background --factory-startup --python-exit-code 1 --python-expr "import importlib.util; from mathutils import Vector; spec=importlib.util.spec_from_file_location('clouva_rig_v43_volume','/app/rig_garment.py'); module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module); module.legacy.clear_scene(); module.legacy.bpy.ops.mesh.primitive_cube_add(); garment=module.legacy.bpy.context.object; garment.dimensions=(0.7526,0.9387,0.8856); module.legacy.bpy.context.view_layer.update(); result=module.previous.previous.previous.previous.previous.previous.previous.previous.previous.ensure_upper_volume_before_rig(garment, Vector((-0.5,-0.5,-0.5)), Vector((0.5,0.5,0.5)), 'hoodie'); assert result['repaired']; assert result['afterRatios'][0] >= 0.82; assert result['afterRatios'][1] >= 0.70; assert result['afterRatios'][2] >= 0.82; print('[clouva] V33 upper-volume repair retained under V43 OK')" \
    && env PYTHONPATH=/app /opt/blender/blender --background --factory-startup --python-exit-code 1 --python /app/test_roundtrip_signature.py \
    && env PYTHONPATH=/app /opt/blender/blender --background --factory-startup --python-exit-code 1 --python /app/test_shared_space_v39.py \
    && env PYTHONPATH=/app /opt/blender/blender --background --factory-startup --python-exit-code 1 --python /app/test_prebind_space_v40.py \
    && env PYTHONPATH=/app /opt/blender/blender --background --factory-startup --python-exit-code 1 --python /app/test_anatomical_fit_v41.py \
    && env PYTHONPATH=/app /opt/blender/blender --background --factory-startup --python-exit-code 1 --python /app/test_canonical_bind_v43.py

ENV BLENDER_BIN=/usr/local/bin/blender
EXPOSE 8000
CMD ["python3", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
