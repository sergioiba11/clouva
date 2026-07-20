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
COPY app.py app_v5.py app_v6.py app_v7.py app_v8.py rig_garment.py rig_garment_v5.py rig_garment_v10.py rig_garment_v11.py rig_garment_v12.py rig_garment_v13.py rig_garment_v14.py rig_garment_v15.py rig_garment_v16.py rig_garment_v17.py rig_garment_v18.py rig_garment_v19.py rig_garment_v20.py rig_object.py attach_object.py export_unreal.py export_unreal_clean.py test_export_unreal_units.py ./
RUN mv app.py app_legacy.py \
    && mv app_v8.py app.py \
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

RUN test -f /app/app.py \
    && test -f /app/app_v5.py \
    && test -f /app/app_v6.py \
    && test -f /app/app_v7.py \
    && test -f /app/export_unreal.py \
    && test -f /app/export_unreal_clean.py \
    && test -f /app/test_export_unreal_units.py \
    && test -f /app/rig_garment.py \
    && test -f /app/rig_garment_v15_base.py \
    && test -f /app/rig_garment_v16_base.py \
    && test -f /app/rig_garment_v17_base.py \
    && test -f /app/rig_garment_v18_base.py \
    && test -f /app/rig_garment_v19_base.py \
    && test -f /opt/blender/4.2/scripts/modules/rig_garment_legacy.py \
    && python3 -c "import app; paths={getattr(route, 'path', '') for route in app.app.routes}; rig_routes=[route for route in app.app.routes if getattr(route, 'path', '') == '/rig' and 'POST' in (getattr(route, 'methods', set()) or set())]; unreal_v2_routes=[route for route in app.app.routes if getattr(route, 'path', '') == '/export/unreal-v2' and 'POST' in (getattr(route, 'methods', set()) or set())]; assert '/export/unreal-object' in paths; assert len(unreal_v2_routes) == 1; assert len(rig_routes) == 1; assert app.RIG_ROUTE_VERSION == 'v8-diagnostic-sync'; assert app.UNREAL_EXPORT_VERSION == 'v28-active-avatar-reference'; assert hasattr(app, 'run_fresh_garment_rig'); assert hasattr(app, 'resolve_user_avatar_url'); assert app.EXPORT_UNREAL_SCRIPT_PATH.name == 'export_unreal_clean.py'; print('[clouva] V28 active-avatar export routes OK')" \
    && /opt/blender/blender --background --factory-startup --python-expr "import importlib.util; spec=importlib.util.spec_from_file_location('clouva_export_unreal_clean','/app/export_unreal_clean.py'); module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module); assert module.base.run_export.__name__ == 'run_export_v28'; assert module.base.prepare_wearable_object.__name__ == 'prepare_wearable_object_v28'; assert module.base.validate_object.__name__ == 'validate_object_v28'; assert module.base.validate_fbx_roundtrip.__name__ == 'validate_fbx_roundtrip_v28'; assert hasattr(module, '_measure_avatar_reference'); assert module.base.FBX_APPLY_UNIT_SCALE is True; assert module.base.FBX_APPLY_SCALE_OPTIONS == 'FBX_SCALE_UNITS'; assert module.base.FBX_DECLARED_UNIT_SCALE_CM == 100.0; print('[clouva] V28 avatar-reference exporter import OK')" \
    && /opt/blender/blender --background --factory-startup --python /app/test_export_unreal_units.py \
    && /opt/blender/blender --background --factory-startup --python-expr "import inspect; namespace={'__name__':'clouva_rig_import_test','__file__':'/app/rig_garment.py'}; exec(compile(open('/app/rig_garment.py', encoding='utf-8').read(), '/app/rig_garment.py', 'exec'), namespace); prepare=namespace['legacy'].prepare_garment; assert namespace['v9'].validate_roundtrip_v9.__name__ == 'validate_roundtrip_v16'; assert prepare.__name__ == 'prepare_garment_v17'; assert namespace['legacy'].fit_to_body.__name__ == 'fit_to_body_v18'; assert namespace['v9'].ensure_upper_arm_weights.__name__ == 'ensure_upper_arm_weights_v19'; assert namespace['legacy'].body_region.__name__ == 'body_region_v20'; assert namespace['legacy'].validate.__name__ == 'validate_v20'; assert 'bake_visible_geometry' in prepare.__globals__; assert 'new_from_object' in inspect.getsource(prepare.__globals__['bake_visible_geometry']); assert namespace['UPPER_GARMENT_MIN_TARGET_RATIOS']['hoodie'].x >= 0.8; print('[clouva] Blender V29 legacy visible-geometry recovery OK')"

ENV BLENDER_BIN=/usr/local/bin/blender
EXPOSE 8000
CMD ["python3", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
