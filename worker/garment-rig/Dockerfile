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
COPY app.py app_v5.py app_v6.py app_v7.py app_v8.py app_v9.py app_v10.py avatar_reference.py rig_garment.py rig_garment_v5.py rig_garment_v10.py rig_garment_v11.py rig_garment_v12.py rig_garment_v13.py rig_garment_v14.py rig_garment_v15.py rig_garment_v16.py rig_garment_v17.py rig_garment_v18.py rig_garment_v19.py rig_garment_v20.py rig_object.py attach_object.py export_unreal.py export_unreal_clean.py export_unreal_v31.py inspect_garment.py test_export_unreal_units.py test_avatar_reference.py ./
COPY avatar-reference ./avatar-reference
RUN mv app.py app_legacy.py \
    && mv app_v10.py app.py \
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
    && mv rig_garment_v20.py rig_garment.py \
    && sed -i 's/"rig_garment_v10.py"/"rig_garment_v10_base.py"/' /app/rig_garment_v11_base.py \
    && sed -i 's/"rig_garment_v11.py"/"rig_garment_v11_base.py"/' /app/rig_garment_v12_base.py \
    && sed -i 's/"rig_garment_v12.py"/"rig_garment_v12_base.py"/' /app/rig_garment_v13_base.py \
    && sed -i 's/"rig_garment_v13.py"/"rig_garment_v13_base.py"/' /app/rig_garment_v14_base.py \
    && sed -i 's/"rig_garment_v14.py"/"rig_garment_v14_base.py"/' /app/rig_garment_v15_base.py \
    && sed -i 's/"rig_garment_v15.py"/"rig_garment_v15_base.py"/' /app/rig_garment_v16_base.py \
    && sed -i 's/"rig_garment_v16.py"/"rig_garment_v16_base.py"/' /app/rig_garment_v17_base.py \
    && sed -i 's/"rig_garment_v17.py"/"rig_garment_v17_base.py"/' /app/rig_garment_v18_base.py \
    && sed -i 's/"rig_garment_v18.py"/"rig_garment_v18_base.py"/' /app/rig_garment_v19_base.py \
    && sed -i 's/"rig_garment_v19.py"/"rig_garment_v19_base.py"/' /app/rig_garment.py

RUN mkdir -p /opt/blender/4.2/scripts/modules \
    && cp /app/rig_garment_legacy.py /opt/blender/4.2/scripts/modules/rig_garment_legacy.py

ENV PYTHONPATH=/app
ENV CLOUVA_RIG_VERSION=v28
ENV CLOUVA_LEGACY_GARMENT_RECOVERY=v29
ENV CLOUVA_WORKER_INSPECTOR=v2
ENV CLOUVA_GARMENT_SOURCE_ROUTING=v30
ENV CLOUVA_GARMENT_MESH_NORMALIZATION=v31
ENV CLOUVA_GARMENT_MODULE_LOADER=v31.1
ENV CLOUVA_AVATAR_REFERENCE_PATH=/app/avatar-reference/AvatarReference.fbx
ENV CLOUVA_AVATAR_REFERENCE_METADATA_PATH=/app/avatar-reference/clouva_avatar_data.json

# Compatibility base retained: v28-active-avatar-reference.
RUN test -f /app/app.py \
    && test -f /app/app_v8.py \
    && test -f /app/app_v9.py \
    && test -f /app/inspect_garment.py \
    && test -f /app/export_unreal.py \
    && test -f /app/export_unreal_clean.py \
    && test -f /app/export_unreal_v31.py \
    && test -f /app/test_export_unreal_units.py \
    && test -f /app/rig_garment.py \
    && test -f /app/rig_garment_v15_base.py \
    && test -f /app/rig_garment_v16_base.py \
    && test -f /app/rig_garment_v17_base.py \
    && test -f /app/rig_garment_v18_base.py \
    && test -f /app/rig_garment_v19_base.py \
    && test -f /opt/blender/4.2/scripts/modules/rig_garment_legacy.py \
    && python3 -c "import inspect, app; paths={getattr(route, 'path', '') for route in app.app.routes}; assert '/rig' in paths; assert '/export/unreal-v2' in paths; assert '/diagnostics/health' in paths; assert '/diagnostics/garment' in paths; assert app.WORKER_INSPECTOR_VERSION == 'v2-single-pass-awareness'; assert app.UNREAL_EXPORT_VERSION == 'v31.1-absolute-module-loader'; assert app.EXPORT_UNREAL_SCRIPT_PATH.name == 'export_unreal_v31.py'; assert app.GARMENT_SOURCE_ROUTING_VERSION == 'v30-single-pass'; model_fields=app.base.base.ValidatedUnrealExportRequestV30.model_fields; assert 'source_already_rigged' in model_fields; export_source=inspect.getsource(app.base.base.export_for_unreal_v30); assert 'if not request.source_already_rigged' in export_source; assert app.INSPECT_SCRIPT_PATH.name == 'inspect_garment.py'; print('[clouva] Inspector V2 + routing V30 + exporter V31.1 OK')" \
    && /opt/blender/blender --background --factory-startup --python-expr "import ast; source=open('/app/inspect_garment.py', encoding='utf-8').read(); tree=ast.parse(source); names={node.name for node in ast.walk(tree) if isinstance(node, ast.FunctionDef)}; assert {'inspect_asset','relative_shape_error','main'} <= names; assert 'rawGarmentReadyForRig' in source; assert 'Meshy original' in source; print('[clouva] Raw Meshy diagnostics contract OK')" \
    && cd /tmp \
    && env -u PYTHONPATH /opt/blender/blender --background --factory-startup --python-expr "import importlib.util; spec=importlib.util.spec_from_file_location('clouva_export_unreal_v31','/app/export_unreal_v31.py'); module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module); assert module.BASE_EXPORT_PATH == module.SCRIPT_DIR / 'export_unreal_clean.py'; assert module.base.prepare_wearable_object.__name__ == 'prepare_wearable_object_v31'; assert module.base.validate_object.__name__ == 'validate_object_v31'; assert module.EXPORT_VERSION == 'v31-garment-mesh-target-height'; assert module.base.FBX_APPLY_UNIT_SCALE is True; print('[clouva] V31 absolute loader works outside /app without PYTHONPATH')" \
    && cd /app \
    && env -u CLOUVA_AVATAR_REFERENCE_PATH -u CLOUVA_AVATAR_REFERENCE_METADATA_PATH PYTHONPATH=/app /opt/blender/blender --background --factory-startup --python-exit-code 1 --python /app/test_export_unreal_units.py \
    && env PYTHONPATH=/app /opt/blender/blender --background --factory-startup --python-exit-code 1 --python /app/test_avatar_reference.py \
    && /opt/blender/blender --background --factory-startup --python-expr "import inspect; namespace={'__name__':'clouva_rig_import_test','__file__':'/app/rig_garment.py'}; exec(compile(open('/app/rig_garment.py', encoding='utf-8').read(), '/app/rig_garment.py', 'exec'), namespace); prepare=namespace['legacy'].prepare_garment; assert prepare.__name__ == 'prepare_garment_v17'; assert 'bake_visible_geometry' in prepare.__globals__; assert 'new_from_object' in inspect.getsource(prepare.__globals__['bake_visible_geometry']); print('[clouva] Blender V29 legacy recovery OK')"

ENV BLENDER_BIN=/usr/local/bin/blender
EXPOSE 8000
CMD ["python3", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
