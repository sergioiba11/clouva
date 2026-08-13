from __future__ import annotations

import re
from pathlib import Path
from typing import Any
from urllib.parse import quote, unquote, urlparse

import httpx

from clouva_connector import (
    SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_URL,
    validate_user,
)

REFERENCE_TABLE = "creator_reference_assets"
CLOTHING_TABLE = "clothing_items"
REFERENCE_BUCKET = "creator-reference-assets"
MAX_GLB_BYTES = 250 * 1024 * 1024


class TemplateLibraryError(RuntimeError):
    pass


def _headers(access_token: str) -> dict[str, str]:
    if not access_token or not access_token.strip():
        raise TemplateLibraryError("Conectá tu cuenta CLOUVA para abrir la biblioteca")
    return {
        "apikey": SUPABASE_PUBLISHABLE_KEY,
        "Authorization": f"Bearer {access_token.strip()}",
        "Accept": "application/json",
    }


def _postgrest_rows(table: str, access_token: str, user_id: str) -> list[dict[str, Any]]:
    url = (
        f"{SUPABASE_URL}/rest/v1/{table}?"
        f"user_id=eq.{quote(user_id)}&select=*&order=updated_at.desc&limit=500"
    )
    with httpx.Client(follow_redirects=True, timeout=30) as client:
        response = client.get(url, headers=_headers(access_token))
    if response.status_code != 200:
        detail = response.text[:500]
        raise TemplateLibraryError(
            f"No se pudo leer {table} ({response.status_code}). {detail}"
        )
    payload = response.json()
    return payload if isinstance(payload, list) else []


def _text(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value or None


def _metadata(row: dict[str, Any]) -> dict[str, Any]:
    value = row.get("metadata")
    return value if isinstance(value, dict) else {}


def _clean_path(value: Any, bucket: str) -> str | None:
    raw = _text(value)
    if not raw:
        return None
    if raw.startswith(("https://", "http://")):
        return _path_from_supabase_url(raw, bucket)
    raw = raw.replace("\\", "/").lstrip("/")
    if raw.startswith(f"{bucket}/"):
        raw = raw[len(bucket) + 1 :]
    return raw or None


def _path_from_supabase_url(value: str, bucket: str) -> str | None:
    parsed = urlparse(value)
    if parsed.netloc != urlparse(SUPABASE_URL).netloc:
        return None
    markers = (
        f"/storage/v1/object/public/{bucket}/",
        f"/storage/v1/object/authenticated/{bucket}/",
        f"/storage/v1/object/sign/{bucket}/",
    )
    for marker in markers:
        if marker in parsed.path:
            return unquote(parsed.path.split(marker, 1)[1]).lstrip("/") or None
    return None


def _safe_slug(value: str, fallback: str) -> str:
    cleaned = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return cleaned or fallback


def _normalize_category(value: Any, name: str = "") -> tuple[str, str, bool, str]:
    raw = (_text(value) or "").lower().strip()
    haystack = f"{raw} {name.lower()}"

    if any(token in haystack for token in ("hoodie", "buzo", "buz", "sweatshirt", "hood")):
        return "hoodie", "Hoodies / buzos", True, "fit_supported"
    if any(token in haystack for token in ("remera", "tshirt", "t-shirt", "shirt", "tee")):
        return "tshirt", "Remeras", True, "fit_supported"
    if any(token in haystack for token in ("pantal", "pants", "jean", "cargo", "short")):
        return "bottom", "Pantalones / shorts", False, "engine_pending"
    if any(token in haystack for token in ("shoe", "sneaker", "zapat", "calzado", "boot")):
        return "footwear", "Calzado", False, "engine_pending"
    if any(token in haystack for token in ("gorra", "hat", "beanie", "cap", "cadena", "collar", "ring", "anillo", "pulsera", "accessor")):
        return "accessory", "Accesorios", False, "preview_only"
    return "other", "Otros GLB", False, "preview_only"


def _official_code(name: str, file_name: str | None) -> str | None:
    candidates = [name, file_name or ""]
    for candidate in candidates:
        stem = Path(candidate).stem.lower().strip()
        if stem in {"r1", "h1"}:
            return stem
    return None


def _standardize_reference_asset(row: dict[str, Any]) -> dict[str, Any] | None:
    asset_id = _text(row.get("id"))
    if not asset_id:
        return None
    name = _text(row.get("name")) or _text(row.get("file_name")) or "GLB sin nombre"
    file_name = _text(row.get("file_name"))
    storage_path = _clean_path(row.get("rigged_storage_path"), REFERENCE_BUCKET) or _clean_path(
        row.get("storage_path"), REFERENCE_BUCKET
    )
    source_url = _text(row.get("source_url"))
    if not storage_path and not source_url:
        return None
    source_name = file_name or storage_path or urlparse(source_url or "").path
    if not str(source_name).lower().endswith(".glb"):
        return None

    normalized_category, category_label, fit_supported, compatibility = _normalize_category(
        row.get("category"), name
    )
    official_code = _official_code(name, file_name)
    code = official_code or _safe_slug(name, asset_id[:8])
    preview_settings = row.get("preview_settings") if isinstance(row.get("preview_settings"), dict) else {}
    thumbnail = _text(preview_settings.get("thumbnail_url")) or _text(preview_settings.get("thumbnail"))

    return {
        "asset_key": f"{REFERENCE_TABLE}:{asset_id}",
        "id": asset_id,
        "code": code,
        "official_code": official_code,
        "official_template": official_code in {"r1", "h1"},
        "name": name,
        "file_name": file_name or (Path(storage_path).name if storage_path else f"{code}.glb"),
        "category": _text(row.get("category")) or normalized_category,
        "normalized_category": normalized_category,
        "category_label": category_label,
        "fit_supported": fit_supported,
        "compatibility": compatibility,
        "bucket": REFERENCE_BUCKET,
        "storage_path": storage_path,
        "source_url": source_url,
        "thumbnail_url": thumbnail,
        "source_table": REFERENCE_TABLE,
        "source_label": "Assets de referencia",
        "status": _text(row.get("status")) or "reference",
        "fit_status": None,
        "rigged": bool(row.get("rigged_storage_path")),
        "wearable": False,
        "file_size": row.get("file_size"),
        "updated_at": row.get("updated_at"),
        "metadata": {
            "license": row.get("license"),
            "author": row.get("author"),
        },
    }


def _standardize_clothing_item(row: dict[str, Any]) -> dict[str, Any] | None:
    asset_id = _text(row.get("id"))
    if not asset_id:
        return None
    name = _text(row.get("name")) or "Prenda sin nombre"
    meta = _metadata(row)
    source_url = (
        _text(row.get("model_url"))
        or _text(row.get("hood_down_model_url"))
        or _text(row.get("hood_up_model_url"))
        or _text(meta.get("permanent_glb_url"))
        or _text(meta.get("meshy_model_url"))
    )
    if not source_url:
        return None
    if not urlparse(source_url).path.lower().endswith(".glb"):
        return None

    normalized_category, category_label, fit_supported, compatibility = _normalize_category(
        row.get("category"), name
    )
    code = _safe_slug(name, asset_id[:8])
    thumbnail = _text(row.get("thumbnail_url"))
    return {
        "asset_key": f"{CLOTHING_TABLE}:{asset_id}",
        "id": asset_id,
        "code": code,
        "official_code": None,
        "official_template": False,
        "name": name,
        "file_name": f"{code}.glb",
        "category": _text(row.get("category")) or normalized_category,
        "normalized_category": normalized_category,
        "category_label": category_label,
        "fit_supported": fit_supported,
        "compatibility": compatibility,
        "bucket": None,
        "storage_path": None,
        "source_url": source_url,
        "thumbnail_url": thumbnail,
        "source_table": CLOTHING_TABLE,
        "source_label": "Prendas de CLOUVA",
        "status": _text(row.get("status")) or "unknown",
        "fit_status": _text(row.get("fit_status")),
        "rigged": bool(row.get("rigged")),
        "wearable": bool(row.get("wearable")),
        "file_size": None,
        "updated_at": row.get("updated_at"),
        "metadata": {
            "fit": row.get("fit"),
            "color": row.get("color"),
            "hood_supported": row.get("hood_supported"),
        },
    }


def list_library_assets(access_token: str) -> list[dict[str, Any]]:
    try:
        user = validate_user(access_token)
    except Exception as exc:
        raise TemplateLibraryError(str(exc)) from exc
    user_id = str(user["id"])

    errors: list[str] = []
    rows_reference: list[dict[str, Any]] = []
    rows_clothing: list[dict[str, Any]] = []
    try:
        rows_reference = _postgrest_rows(REFERENCE_TABLE, access_token, user_id)
    except TemplateLibraryError as exc:
        errors.append(str(exc))
    try:
        rows_clothing = _postgrest_rows(CLOTHING_TABLE, access_token, user_id)
    except TemplateLibraryError as exc:
        errors.append(str(exc))

    assets = [
        *(item for row in rows_reference if (item := _standardize_reference_asset(row)) is not None),
        *(item for row in rows_clothing if (item := _standardize_clothing_item(row)) is not None),
    ]

    # Prefer official r1/h1, then compatible garments, then everything else.
    assets.sort(
        key=lambda item: (
            0 if item["official_template"] else 1,
            0 if item["fit_supported"] else 1,
            item["category_label"].lower(),
            item["name"].lower(),
        )
    )
    if not assets:
        detail = " | ".join(errors) if errors else "No hay GLB accesibles para esta cuenta"
        raise TemplateLibraryError(f"La biblioteca CLOUVA no devolvió ningún GLB. {detail}")
    return assets


def get_library_asset(asset_key: str, access_token: str) -> dict[str, Any]:
    wanted = asset_key.strip()
    for item in list_library_assets(access_token):
        if item["asset_key"] == wanted:
            return item
    raise TemplateLibraryError("El GLB seleccionado ya no está disponible en tu biblioteca")


def get_official_template(template_code: str, access_token: str) -> dict[str, Any]:
    wanted = template_code.strip().lower()
    for item in list_library_assets(access_token):
        if item.get("official_code") == wanted:
            return item
    raise TemplateLibraryError(f"No encontramos la plantilla oficial {wanted}")


def _download_stream(url: str, destination: Path, headers: dict[str, str] | None = None) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    total = 0
    try:
        with httpx.Client(follow_redirects=True, timeout=httpx.Timeout(180, connect=30)) as client:
            with client.stream("GET", url, headers=headers) as response:
                if response.status_code != 200:
                    detail = response.read()[:500].decode("utf-8", errors="replace")
                    raise TemplateLibraryError(f"HTTP {response.status_code}: {detail}")
                with destination.open("wb") as stream:
                    for chunk in response.iter_bytes(1024 * 1024):
                        if not chunk:
                            continue
                        total += len(chunk)
                        if total > MAX_GLB_BYTES:
                            raise TemplateLibraryError("El GLB supera el límite local de 250 MB")
                        stream.write(chunk)
    except Exception:
        destination.unlink(missing_ok=True)
        raise

    with destination.open("rb") as stream:
        magic = stream.read(4)
    if magic != b"glTF":
        destination.unlink(missing_ok=True)
        raise TemplateLibraryError("La biblioteca no devolvió un GLB válido")


def download_library_asset(asset_key: str, destination: Path, access_token: str) -> dict[str, Any]:
    asset = get_library_asset(asset_key, access_token)
    storage_path = asset.get("storage_path")
    bucket = asset.get("bucket")
    source_url = asset.get("source_url")

    if storage_path and bucket:
        storage_url = f"{SUPABASE_URL}/storage/v1/object/authenticated/{bucket}/{storage_path}"
        try:
            _download_stream(storage_url, destination, headers=_headers(access_token))
            return {**asset, "downloaded_from": "authenticated_storage", "local_path": str(destination)}
        except Exception as storage_error:
            if not source_url:
                raise TemplateLibraryError(
                    f"No se pudo descargar {asset['name']} desde Storage: {storage_error}"
                ) from storage_error

    if source_url:
        parsed_path = _path_from_supabase_url(source_url, bucket or REFERENCE_BUCKET)
        if parsed_path and bucket:
            signed_storage_url = f"{SUPABASE_URL}/storage/v1/object/authenticated/{bucket}/{parsed_path}"
            _download_stream(signed_storage_url, destination, headers=_headers(access_token))
            return {**asset, "downloaded_from": "authenticated_storage_url", "local_path": str(destination)}
        _download_stream(source_url, destination, headers=None)
        return {**asset, "downloaded_from": "external_url", "local_path": str(destination)}

    raise TemplateLibraryError("El GLB seleccionado no tiene una fuente descargable")


# Compatibility wrappers for v1.0.1 callers.
def list_real_templates(access_token: str) -> list[dict[str, Any]]:
    return [item for item in list_library_assets(access_token) if item.get("official_template")]


def download_template_glb(template_code: str, destination: Path, access_token: str) -> dict[str, Any]:
    asset = get_official_template(template_code, access_token)
    return download_library_asset(asset["asset_key"], destination, access_token)
