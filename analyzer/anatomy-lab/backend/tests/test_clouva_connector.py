from clouva_connector import (
    _clean_storage_path,
    _resolve_row_source,
    _source_candidates,
    _storage_path_from_supabase_url,
)


def test_prefers_clean_storage_path():
    source, kind = _resolve_row_source({
        "storage_path": "users/a/avatar.glb",
        "model_url": "https://example.com/model.glb",
        "metadata": {"original_meshy_url": "https://example.com/original.glb"},
    })
    assert source == "users/a/avatar.glb"
    assert kind == "storage"


def test_full_gcs_storage_path_is_not_misread_as_supabase_object_key():
    row = {
        "storage_path": "https://storage.googleapis.com/clouva-avatars/u/a/source/avatar.glb",
        "model_url": "https://storage.googleapis.com/clouva-avatars/u/a/source/avatar.glb",
        "metadata": {},
    }
    candidates = _source_candidates(row)
    assert candidates == [{
        "kind": "external_url",
        "source": "https://storage.googleapis.com/clouva-avatars/u/a/source/avatar.glb",
    }]
    assert _clean_storage_path(row["storage_path"]) is None


def test_prefers_permanent_supabase_path_over_external_urls():
    row = {
        "storage_path": "https://storage.googleapis.com/clouva-avatars/u/a/source/avatar.glb",
        "model_url": "https://storage.googleapis.com/clouva-avatars/u/a/source/avatar.glb",
        "metadata": {
            "permanent_glb_path": "u/a/source/avatar-meshy.glb",
            "permanent_glb_url": "https://project.supabase.co/storage/v1/object/public/avatars/u/a/source/avatar-meshy.glb",
        },
    }
    candidates = _source_candidates(row)
    assert candidates[0] == {"kind": "storage", "source": "u/a/source/avatar-meshy.glb"}
    assert any(item["kind"] == "external_url" for item in candidates)


def test_extracts_path_from_current_project_supabase_url():
    url = (
        "https://dpawotcignpexkirhfsk.supabase.co/storage/v1/object/public/avatars/"
        "u/a/source/avatar-meshy.glb"
    )
    assert _storage_path_from_supabase_url(url) == "u/a/source/avatar-meshy.glb"


def test_rejects_derived_storage_and_uses_original_meshy():
    source, kind = _resolve_row_source({
        "storage_path": "users/a/avatar-complete-rigged.glb",
        "model_url": "https://example.com/avatar-final.glb",
        "metadata": {"original_meshy_url": "https://example.com/original.glb"},
    })
    assert source == "https://example.com/original.glb"
    assert kind == "external_url"
