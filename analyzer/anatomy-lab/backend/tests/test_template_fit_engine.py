import tempfile
from pathlib import Path

import trimesh

from template_fit_engine import fit_template_to_run


def test_template_fit_engine_exports_artifacts():
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        template_path = tmp / 'r1.glb'
        avatar_path = tmp / 'avatar.glb'
        torso = trimesh.creation.box(extents=(0.30, 0.16, 0.50))
        torso.export(template_path)
        body = trimesh.creation.box(extents=(0.24, 0.12, 1.70))
        body.export(avatar_path)
        run_result = {
            'run_id': 'run-test',
            'body_measurements': {
                'scale': {'height_cm': 180},
                'values': {
                    'shoulder_width': {'status': 'valid', 'value_cm': 22.0},
                    'left_arm_length': {'status': 'valid', 'value_cm': 57.0},
                    'right_arm_length': {'status': 'valid', 'value_cm': 57.0},
                },
                'sections': {
                    'neck': {'width_cm': 10.0, 'depth_cm': 8.0, 'z': 1.5},
                    'chest': {'width_cm': 24.0, 'depth_cm': 16.0, 'z': 1.28},
                    'waist': {'width_cm': 22.0, 'depth_cm': 15.0, 'z': 1.05},
                    'hip': {'width_cm': 24.0, 'depth_cm': 16.0, 'z': 0.92},
                    'left_bicep': {'width_cm': 9.5},
                },
            },
            'garment_anchors': [],
            'internal_joints': [],
        }
        artifacts = fit_template_to_run(
            run_result,
            {'code': 'r1', 'name': 'r1 — Remera', 'category': 'remera'},
            template_path,
            avatar_path,
            tmp / 'out',
            fit_mode='oversized',
        )
        assert artifacts.glb_path.is_file()
        assert artifacts.fit_json_path.is_file()
        assert artifacts.meshy_payload_path.is_file()
