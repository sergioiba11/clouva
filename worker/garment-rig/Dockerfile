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
    libglib2.0-0 \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

ENV BLENDER_VERSION=4.2.3
ENV BLENDER_URL=https://download.blender.org/release/Blender4.2/blender-${BLENDER_VERSION}-linux-x64.tar.xz

RUN wget -q "$BLENDER_URL" -O /tmp/blender.tar.xz \
    && mkdir -p /opt/blender \
    && tar -xJf /tmp/blender.tar.xz -C /opt/blender --strip-components=1 \
    && rm /tmp/blender.tar.xz \
    && ln -s /opt/blender/blender /usr/local/bin/blender

RUN pip install --no-cache-dir --break-system-packages \
    fastapi uvicorn pydantic python-multipart \
    mediapipe==0.10.14 numpy==1.26.4

RUN mkdir -p /app/models \
    && wget -q https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task -O /app/models/face_landmarker.task \
    && wget -q https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task -O /app/models/hand_landmarker.task \
    && test -s /app/models/face_landmarker.task \
    && test -s /app/models/hand_landmarker.task

WORKDIR /app
COPY *.py ./
COPY avatar_analyzer_version.json ./
COPY avatar-reference ./avatar-reference

RUN mv app.py app_legacy.py \
    && mv app_v18.py app.py \
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
ENV CLOUVA_AVATAR_COMPLETE_RIG=v16-analyzer-v4-profile-gated
ENV CLOUVA_AVATAR_ANALYZER=v4.1-exact-surface-boundary-aware
ENV CLOUVA_AVATAR_ANALYZER_V32_PRESERVED=true
ENV CLOUVA_AUX_PYTHON=/usr/local/bin/python3
ENV CLOUVA_FACE_LANDMARKER_MODEL=/app/models/face_landmarker.task
ENV CLOUVA_HAND_LANDMARKER_MODEL=/app/models/hand_landmarker.task
ENV CLOUVA_LANDMARK_DETECTOR_SCRIPT=/app/landmark_detector_2d.py
ENV CLOUVA_UNREAL_MOLD_RIG=v2
ENV CLOUVA_AVATAR_REFERENCE_PATH=/app/avatar-reference/AvatarReference.fbx
ENV CLOUVA_AVATAR_REFERENCE_METADATA_PATH=/app/avatar-reference/clouva_avatar_data.json

RUN test -f /app/app.py \
    && test -f /app/app_v16.py \
    && test -f /app/app_v17.py \
    && test -f /app/avatar_analyzer.py \
    && test -f /app/avatar_analyzer_v4.py \
    && test -f /app/analyzer_contract.py \
    && test -f /app/analyzer_v4_contract.py \
    && test -f /app/canonical_orientation.py \
    && test -f /app/preflight_v4.py \
    && test -f /app/camera_projection_self_test_v4.py \
    && test -f /app/autorig_avatar_v18.py \
    && test -f /app/autorig_avatar_v19.py \
    && test -f /app/anatomy_segmenter.py \
    && test -f /app/ray_triangulator.py \
    && test -f /app/finger_centerline.py \
    && test -f /app/body_analyzer.py \
    && test -f /app/face_analyzer.py \
    && test -f /app/hand_analyzer.py \
    && test -f /app/multiview_renderer.py \
    && test -f /app/multiview_renderer_v32.py \
    && test -f /app/multiview_renderer_v4.py \
    && test -f /app/landmark_detector_2d.py \
    && test -f /app/landmark_projector_3d.py \
    && test -f /app/diagnostic_builder.py \
    && test -f /app/test_avatar_analyzer.py \
    && test -f /app/test_avatar_analyzer_v32.py \
    && test -f /app/test_avatar_analyzer_v4_contract.py \
    && test -f /app/test_worker_api_v32.py \
    && test -f /app/test_worker_api_v4.py \
    && test -f /app/avatar-reference/AvatarReference.fbx \
    && test -f /app/avatar-reference/clouva_avatar_data.json \
    && python3 -m py_compile /app/*.py

RUN python3 -c "from mediapipe.tasks import python; from mediapipe.tasks.python import vision; face=vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(base_options=python.BaseOptions(model_asset_path='/app/models/face_landmarker.task'),running_mode=vision.RunningMode.IMAGE,num_faces=1)); hand=vision.HandLandmarker.create_from_options(vision.HandLandmarkerOptions(base_options=python.BaseOptions(model_asset_path='/app/models/hand_landmarker.task'),running_mode=vision.RunningMode.IMAGE,num_hands=1)); face.close(); hand.close(); print('[clouva] MediaPipe Face + Hand Landmarker models load OK')"
RUN cd /app && python3 -m unittest -v test_avatar_analyzer_v4_contract.py test_avatar_analyzer_v41.py
RUN python3 /app/test_worker_api_v32.py
RUN python3 /app/test_worker_api_v4.py

RUN env PYTHONPATH=/app /opt/blender/blender --background --factory-startup --python-exit-code 1 --python-expr "import importlib.util; spec=importlib.util.spec_from_file_location('clouva_autorig_v16','/app/autorig_avatar_v16.py'); module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module); armature,proof=module.create_fresh_schema_armature(); assert len(armature.data.bones)==24; assert proof['bonesCreated']==24; assert proof['reusedArmature'] is False; assert armature.get('clouva_generated_from_scratch') is True; print('[clouva] AutoRig V16 creates a brand-new 24-bone schema armature OK')"
RUN env PYTHONPATH=/app /opt/blender/blender --background --factory-startup --python-exit-code 1 --python /app/test_avatar_analyzer.py
RUN env PYTHONPATH=/app /opt/blender/blender --background --factory-startup --python-exit-code 1 --python /app/test_avatar_analyzer_v32.py
RUN env PYTHONPATH=/app /opt/blender/blender --background --factory-startup --python-exit-code 1 --python-expr "import importlib.util,bpy; spec=importlib.util.spec_from_file_location('clouva_rig_v6','/app/complete_avatar_rig_v6.py'); module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module); bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False); bpy.ops.object.armature_add(); arm=bpy.context.object; bpy.context.view_layer.objects.active=arm; bpy.ops.object.mode_set(mode='EDIT'); bones=arm.data.edit_bones; neck=bones[0]; neck.name='Neck'; neck.head=(0,0,1); neck.tail=(0,0,1.2); head=bones.new('Head'); head.head=(0,0,1.2); head.tail=(0,0,1.5); head.parent=neck; terminal=bones.new('head_end'); terminal.head=(0,0,1.5); terminal.tail=(0,0,2.5); terminal.parent=head; bpy.ops.object.mode_set(mode='OBJECT'); chosen=module.choose_anatomical_head(arm); assert chosen.name=='Head', chosen.name; print('[clouva] V6 anatomical head selection OK', chosen.name)"
RUN env PYTHONPATH=/app /opt/blender/blender --background --factory-startup --python-exit-code 1 --python /app/test_complete_avatar_rig_v9.py
RUN env PYTHONPATH=/app /opt/blender/blender --background --factory-startup --python-exit-code 1 --python /app/test_complete_avatar_rig_v10.py
RUN env PYTHONPATH=/app /opt/blender/blender --background --factory-startup --python-exit-code 1 --python /app/test_autorig_avatar_v12.py
RUN cd /tmp && env -u PYTHONPATH /opt/blender/blender --background --factory-startup --python-exit-code 1 --python-expr "import avatar_reference; assert hasattr(avatar_reference, 'canonicalize_and_validate_bones'); print('[clouva] avatar_reference available without PYTHONPATH')"
RUN env -u CLOUVA_AVATAR_REFERENCE_PATH -u CLOUVA_AVATAR_REFERENCE_METADATA_PATH PYTHONPATH=/app /opt/blender/blender --background --factory-startup --python-exit-code 1 --python /app/test_export_unreal_units.py
RUN env PYTHONPATH=/app /opt/blender/blender --background --factory-startup --python-exit-code 1 --python /app/test_avatar_reference.py
RUN env PYTHONPATH=/app /opt/blender/blender --background --factory-startup --python-exit-code 1 --python-expr "import importlib.util; spec=importlib.util.spec_from_file_location('clouva_rig_v43','/app/rig_garment.py'); module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module); assert module.main.__name__ == 'production_main'; assert module.LOADER_FIX_VERSION == 431; assert module.CANONICAL_BIND_VERSION == 43; assert module.ANATOMICAL_FIT_VERSION == 42; assert module.PREBIND_SPACE_VERSION == 40; assert module.SPACE_CONTRACT_VERSION == 40; assert module.MAX_GARMENT_POLYGONS == 30000; assert module.legacy.validate_unreal_avatar_reference.__name__ == 'validate_unreal_avatar_reference_v43'; assert module.legacy.prepare_garment.__name__ == 'prepare_garment_fresh_v40'; assert module.legacy.copy_weights.__name__ == 'copy_weights_anatomical_v42'; assert module.legacy.export_glb.__name__ == 'export_glb_v40'; assert module.v9.validate_roundtrip_v9.__name__ == 'validate_roundtrip_v40'; print('[clouva] V43 canonical bind + loader fix + V42 anatomical fit + V40 export contracts OK')"
RUN env PYTHONPATH=/app /opt/blender/blender --background --factory-startup --python-exit-code 1 --python-expr "import importlib.util; spec=importlib.util.spec_from_file_location('clouva_rig_v43_decimate','/app/rig_garment.py'); module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module); module.legacy.clear_scene(); module.legacy.bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=5); obj=module.legacy.bpy.context.object; before=len(obj.data.polygons); result=module.reduce_object_polygons(obj, 2000, 'docker-test'); after=len(obj.data.polygons); assert before > 4000; assert result['reduced']; assert 100 <= after <= 2400; print('[clouva] V38 memory guard retained under V43 OK', before, after)"
RUN env PYTHONPATH=/app /opt/blender/blender --background --factory-startup --python-exit-code 1 --python-expr "import importlib.util; from mathutils import Vector; spec=importlib.util.spec_from_file_location('clouva_rig_v43_volume','/app/rig_garment.py'); module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module); module.legacy.clear_scene(); module.legacy.bpy.ops.mesh.primitive_cube_add(); garment=module.legacy.bpy.context.object; garment.dimensions=(0.7526,0.9387,0.8856); module.legacy.bpy.context.view_layer.update(); result=module.previous.previous.previous.previous.previous.previous.previous.previous.previous.ensure_upper_volume_before_rig(garment, Vector((-0.5,-0.5,-0.5)), Vector((0.5,0.5,0.5)), 'hoodie'); assert result['repaired']; assert result['afterRatios'][0] >= 0.82; assert result['afterRatios'][1] >= 0.70; assert result['afterRatios'][2] >= 0.82; print('[clouva] V33 upper-volume repair retained under V43 OK')"
RUN env PYTHONPATH=/app /opt/blender/blender --background --factory-startup --python-exit-code 1 --python /app/test_roundtrip_signature.py
RUN env PYTHONPATH=/app /opt/blender/blender --background --factory-startup --python-exit-code 1 --python /app/test_shared_space_v39.py
RUN env PYTHONPATH=/app /opt/blender/blender --background --factory-startup --python-exit-code 1 --python /app/test_prebind_space_v40.py
RUN env PYTHONPATH=/app /opt/blender/blender --background --factory-startup --python-exit-code 1 --python /app/test_anatomical_fit_v41.py
RUN env PYTHONPATH=/app /opt/blender/blender --background --factory-startup --python-exit-code 1 --python /app/test_canonical_bind_v43.py

ENV BLENDER_BIN=/usr/local/bin/blender
EXPOSE 8000
CMD ["python3", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
