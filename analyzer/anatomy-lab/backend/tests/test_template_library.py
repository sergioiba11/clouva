from template_library import _resolve_template_record


def test_resolve_template_record_r1():
    row = {
        'id': '1',
        'code': 'r1',
        'name': 'r1 — Remera',
        'bucket': 'creator-reference-assets',
        'storage_path': 'creator-reference-assets/r1.glb',
        'metadata': {},
    }
    resolved = _resolve_template_record(row)
    assert resolved is not None
    assert resolved['code'] == 'r1'
    assert resolved['storage_path'] == 'r1.glb'
