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
COPY app.py app_v5.py app_v6.py app_v7.py app_v8.py rig_garment.py rig_garment_v5.py rig_garment_v10.py rig_garment_v11.py rig_garment_v12.py rig_garment_v13.py rig_garment_v14.py rig_garment_v15.py rig_garment_v16.py rig_garment_v17.py rig_garment_v18.py rig_object.py attach_object.py export_unreal.py export_unreal_clean.py test_export_unreal_units.py ./
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
    && mv rig_garment_v18.py rig_garment.py \
    && sed -i 's/"rig_garment_v10.py"/"rig_garment_v10_base.py"/' /app/rig_garment_v11_base.py \
    && sed -i 's/"rig_garment_v11.py"/"rig_garment_v11_base.py"/' /app/rig_garment_v12_base.py \
    && sed -i 's/"rig_garment_v12.py"/"rig_garment_v12_base.py"/' /app/rig_garment_v13_base.py \
    && sed -i 's/"rig_garment_v13.py"/"rig_garment_v13_base.py"/' /app/rig_garment_v14_base.py \
    && sed -i 's/"rig_garment_v14.py"/"rig_garment_v14_base.py"/' /app/rig_garment_v15_base.py \
    && sed -i 's/"rig_garment_v15.py"/"rig_garment_v15_base.py"/' /app/rig_garment_v16_base.py \
    && sed -i 's/"rig_garment_v16.py"/"rig_garment_v16_base.py"/' /app/rig_garment_v17_base.py \
    && sed -i 's/"rig_garment_v17.py"/"rig_garment_v17_base.py"/' /app/rig_garment.py

RUN mkdir -p /opt/blender/4.2/scripts/modules \
    && cp /app/rig_garment_legacy.py /opt/blender/4.2/scripts/modules/rig_garment_legacy.py

ENV PYTHONPATH=/app
ENV CLOUVA_RIG_VERSION=v24

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
    && test -f /opt/blender/4.2/scripts/modules/rig_garment_legacy.py \
    && python3 -c "import app; paths={getattr(route, 'path', '') for route in app.app.routes}; rig_routes=[route for route in app.app.routes if getattr(route, 'path', '') == '/rig' and 'POST' in (getattr(route, 'methods', set()) or set())]; assert '/export/unreal-v2' in paths; assert '/export/unreal-object' in paths; assert len(rig_routes) == 1; assert app.RIG_ROUTE_VERSION == 'v8-diagnostic-sync'; assert app.EXPORT_UNREAL_SCRIPT_PATH.name == 'export_unreal_clean.py'; assert app.base.EXPORT_UNREAL_SCRIPT_PATH.name == 'export_unreal_clean.py'; print('[clouva] V24 API routes and clean exporters OK')" \
    && /opt/blender/blender --background --factory-startup --python-expr "import importlib.util; spec=importlib.util.spec_from_file_location('clouva_export_unreal_clean','/app/export_unreal_clean.py'); module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module); assert hasattr(module.base, 'run_export'); assert module.base.FBX_APPLY_UNIT_SCALE is True; assert module.base.FBX_APPLY_SCALE_OPTIONS == 'FBX_SCALE_UNITS'; assert module.base.FBX_DECLARED_UNIT_SCALE_CM == 100.0; print('[clouva] Metric Unreal exporter import OK')" \
    && /opt/blender/blender --background --factory-startup --python /app/test_export_unreal_units.py \
    && /opt/blender/blender --background --factory-startup --python-expr "namespace={'__name__':'clouva_rig_import_test','__file__':'/app/rig_garment.py'}; exec(compile(open('/app/rig_garment.py', encoding='utf-8').read(), '/app/rig_garment.py', 'exec'), namespace); assert namespace['v9'].validate_roundtrip_v9.__name__ == 'validate_roundtrip_v16'; assert namespace['legacy'].prepare_garment.__name__ == 'prepare_garment_v17'; assert namespace['legacy'].fit_to_body.__name__ == 'fit_to_body_v18'; source_ref, source_ratio=namespace['relative_dimension_contract'](namespace['Vector']((0.00000042,0.00000031,0.00000077)),'tiny garment'); assert source_ref > 0 and source_ratio > 0.3; print('[clouva] Blender V24 unit-independent dimension contract OK')"

ENV BLENDER_BIN=/usr/local/bin/blender
EXPOSE 8000
CMD ["python3", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
