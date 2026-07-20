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
COPY app.py app_v5.py app_v6.py app_v7.py app_v8.py app_v9.py app_v10.py app_v11.py app_v12.py app_v13.py avatar_reference.py rig_garment.py rig_garment_v5.py rig_garment_v10.py rig_garment_v11.py rig_garment_v12.py rig_garment_v13.py rig_garment_v14.py rig_garment_v15.py rig_garment_v16.py rig_garment_v17.py rig_garment_v18.py rig_garment_v19.py rig_garment_v20.py rig_garment_v21.py rig_garment_v22.py rig_garment_v23.py rig_garment_v24.py rig_garment_v25.py rig_garment_v26.py rig_garment_v27.py rig_garment_v28.py rig_garment_v29.py rig_object.py attach_object.py export_unreal.py export_unreal_clean.py export_unreal_v31.py inspect_garment.py test_export_unreal_units.py test_avatar_reference.py test_roundtrip_signature.py test_shared_space_v39.py test_prebind_space_v40.py ./
COPY avatar-reference ./avatar-reference
RUN mv app.py app_legacy.py \
    && mv app_v13.py app.py \
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
    && cp rig_garment_v29.py rig_garment.py \
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

# Blender ejecuta scripts con su propio Python embebido. Copiamos los módulos internos
# al directorio oficial para que funcionen aunque el proceso no herede PYTHONPATH.
RUN mkdir -p /opt/blender/4.2/scripts/modules \
    && cp /app/rig_garment_legacy.py /opt/blender/4.2/scripts/modules/rig_garment_legacy.py \
    && cp /app/avatar_reference.py /opt/blender/4.2/scripts/modules/avatar_reference.py

ENV PYTHONPATH=/app
ENV CLOUVA_RIG_VERSION=v40
ENV CLOUVA_UNREAL_ROOT_RESTORE=v32
ENV CLOUVA_UPPER_VOLUME_REPAIR=v33
ENV CLOUVA_RIG_DIAGNOSTICS=v38
ENV CLOUVA_GLTF_ROUNDTRIP=v40
ENV CLOUVA_RIG_ENTRYPOINT=v40
ENV CLOUVA_RIG_SPACE_CONTRACT=v40
ENV CLOUVA_PREBIND_SPACE=v40
ENV CLOUVA_MEMORY_GUARD=v38
ENV CLOUVA_MAX_CONCURRENT_BLENDER_JOBS=1
ENV CLOUVA_MAX_GARMENT_POLYGONS=30000
ENV CLOUVA_LEGACY_GARMENT_RECOVERY=v29
ENV CLOUVA_WORKER_INSPECTOR=v2
ENV CLOUVA_GARMENT_SOURCE_ROUTING=v30
ENV CLOUVA_GARMENT_MESH_NORMALIZATION=v31
ENV CLOUVA_GARMENT_MODULE_LOADER=v31.2
ENV CLOUVA_AVATAR_REFERENCE_PATH=/app/avatar-reference/AvatarReference.fbx
ENV CLOUVA_AVATAR_REFERENCE_METADATA_PATH=/app/avatar-reference/clouva_avatar_data.json

RUN test -f /app/app.py \
    && test -f /app/rig_garment.py \
    && test -f /app/rig_garment_v27.py \
    && test -f /app/rig_garment_v28.py \
    && test -f /app/rig_garment_v29.py \
    && test -f /app/test_shared_space_v39.py \
    && test -f /app/test_prebind_space_v40.py \
    && test -f /app/avatar-reference/AvatarReference.fbx \
    && test -f /app/avatar-reference/clouva_avatar_data.json \
    && python3 -c "import app; paths={getattr(route, 'path', '') for route in app.app.routes}; assert '/rig' in paths; assert '/diagnostics/health' in paths; assert '/diagnostics/latest-rig-failure' in paths; assert app.MAX_CONCURRENT_BLENDER_JOBS == 1; print('[clouva] Worker API routes OK')" \
    && cd /tmp \
    && env -u PYTHONPATH /opt/blender/blender --background --factory-startup --python-exit-code 1 --python-expr "import avatar_reference; assert hasattr(avatar_reference, 'canonicalize_and_validate_bones'); print('[clouva] avatar_reference available without PYTHONPATH')" \
    && cd /app \
    && env -u CLOUVA_AVATAR_REFERENCE_PATH -u CLOUVA_AVATAR_REFERENCE_METADATA_PATH PYTHONPATH=/app /opt/blender/blender --background --factory-startup --python-exit-code 1 --python /app/test_export_unreal_units.py \
    && env PYTHONPATH=/app /opt/blender/blender --background --factory-startup --python-exit-code 1 --python /app/test_avatar_reference.py \
    && env PYTHONPATH=/app /opt/blender/blender --background --factory-startup --python-exit-code 1 --python-expr "import importlib.util; spec=importlib.util.spec_from_file_location('clouva_rig_v40','/app/rig_garment.py'); module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module); assert module.main.__name__ == 'production_main'; assert module.PREBIND_SPACE_VERSION == 40; assert module.SPACE_CONTRACT_VERSION == 40; assert module.MAX_GARMENT_POLYGONS == 30000; assert module.legacy.validate_unreal_avatar_reference.__name__ == 'validate_unreal_avatar_reference_v40'; assert module.legacy.prepare_garment.__name__ == 'prepare_garment_fresh_v40'; assert module.legacy.export_glb.__name__ == 'export_glb_v40'; assert module.v9.validate_roundtrip_v9.__name__ == 'validate_roundtrip_v40'; print('[clouva] V40 entrypoint and pre-bind contracts OK')" \
    && env PYTHONPATH=/app /opt/blender/blender --background --factory-startup --python-exit-code 1 --python-expr "import importlib.util; spec=importlib.util.spec_from_file_location('clouva_rig_v40_decimate','/app/rig_garment.py'); module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module); module.legacy.clear_scene(); module.legacy.bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=5); obj=module.legacy.bpy.context.object; before=len(obj.data.polygons); result=module.reduce_object_polygons(obj, 2000, 'docker-test'); after=len(obj.data.polygons); assert before > 4000; assert result['reduced']; assert 100 <= after <= 2400; print('[clouva] V38 memory guard retained under V40 OK', before, after)" \
    && env PYTHONPATH=/app /opt/blender/blender --background --factory-startup --python-exit-code 1 --python-expr "import importlib.util; from mathutils import Vector; spec=importlib.util.spec_from_file_location('clouva_rig_v40_volume','/app/rig_garment.py'); module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module); module.legacy.clear_scene(); module.legacy.bpy.ops.mesh.primitive_cube_add(); garment=module.legacy.bpy.context.object; garment.dimensions=(0.7526,0.9387,0.8856); module.legacy.bpy.context.view_layer.update(); result=module.previous.previous.previous.previous.previous.previous.ensure_upper_volume_before_rig(garment, Vector((-0.5,-0.5,-0.5)), Vector((0.5,0.5,0.5)), 'hoodie'); assert result['repaired']; assert result['afterRatios'][0] >= 0.82; assert result['afterRatios'][1] >= 0.70; assert result['afterRatios'][2] >= 0.82; print('[clouva] V33 upper-volume repair retained under V40 OK')" \
    && env PYTHONPATH=/app /opt/blender/blender --background --factory-startup --python-exit-code 1 --python /app/test_roundtrip_signature.py \
    && env PYTHONPATH=/app /opt/blender/blender --background --factory-startup --python-exit-code 1 --python /app/test_shared_space_v39.py \
    && env PYTHONPATH=/app /opt/blender/blender --background --factory-startup --python-exit-code 1 --python /app/test_prebind_space_v40.py

ENV BLENDER_BIN=/usr/local/bin/blender
EXPOSE 8000
CMD ["python3", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
