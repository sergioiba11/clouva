from __future__ import annotations

import re
from pathlib import Path
from typing import Any
from urllib.parse import quote, unquote, urlparse

import httpx

SUPABASE_URL = "https://dpawotcignpexkirhfsk.supabase.co"
SUPABASE_PUBLISHABLE_KEY = "sb_publishable_0_fUt2edSzw90ahVNL2AeQ_P9J6wBB4"
AVATAR_BUCKET = "avatars"
MAX_GLB_BYTES = 250 * 1024 * 1024
DERIVED_RIG_PATTERN = re.compile(r"(?:complete-rigged|rigged|processed|final)(?:[-_.]|$)", re.I)


class ClouvaConnectionError(RuntimeError):
    pass


def public_config() -> dict[str, str]:
    return {
        "supabaseUrl": SUPABASE_URL,
        "publishableKey": SUPABASE_PUBLISHABLE_KEY,
    }


def _headers(access_token: str) -> dict[str, str]:
    if not access_token.strip():
        raise ClouvaConnectionError("Sesión de CLOUVA requerida")
    return {
        "apikey": SUPABASE_PUBLISHABLE_KEY,
        "Authorization": f"Bearer {access_token.strip()}",
        "Accept": "application/json",
    }


def _json_object(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _https_url(value: Any) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None
    candidate = value.strip()
    return candidate if candidate.startswith("https://") else None


def _looks_derived(value: str | None) -> bool:
    return bool(value and DERIVED_RIG_PATTERN.search(value))


def _clean_storage_path(value: Any) -> str | None:
    """Return a bucket-relative path, never a full URL.

    Older CLOUVA rows used storage_path for a relative Supabase path, while
    newer rows may put a complete GCS URL there. Treating that URL as a path
    creates /avatars/https://... and causes NoSuchKey.
    """
    if not isinstance(value, str) or not value.strip():
        return None
    candidate = value.strip()
    if candidate.startswith(("https://", "http://")):
        return None
    candidate = candidate.replace("\\", "/").lstrip("/")
    if candidate.startswith(f"{AVATAR_BUCKET}/"):
        candidate = candidate[len(AVATAR_BUCKET) + 1:]
    return candidate or None


def _storage_path_from_supabase_url(value: Any) -> str | None:
    """Recover avatars/<object> URLs as bucket-relative paths."""
    url = _https_url(value)
    if not url:
        return None
    parsed = urlparse(url)
    if parsed.netloc != urlparse(SUPABASE_URL).netloc:
        return None
    marker_variants = (
        f"/storage/v1/object/public/{AVATAR_BUCKET}/",
        f"/storage/v1/object/authenticated/{AVATAR_BUCKET}/",
        f"/storage/v1/object/sign/{AVATAR_BUCKET}/",
    )
    for marker in marker_variants:
        if marker in parsed.path:
            return unquote(parsed.path.split(marker, 1)[1]).lstrip("/") or None
    return None


def _source_candidates(row: dict[str, Any]) -> list[dict[str, str]]:
    """Build clean source candidates in durability order.

    We prefer permanent Supabase objects, then permanent public URLs, then
    generator URLs. Every candidate is tried at download time; a stale path no
    longer prevents a valid fallback from loading.
    """
    metadata = _json_object(row.get("metadata"))
    remote_urls = _json_object(metadata.get("meshy_remote_urls"))
    candidates: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()

    def add(kind: str, value: Any) -> None:
        if kind == "storage":
            source = _clean_storage_path(value) or _storage_path_from_supabase_url(value)
        else:
            source = _https_url(value)
        if not source or _looks_derived(source):
            return
        key = (kind, source)
        if key in seen:
            return
        seen.add(key)
        candidates.append({"kind": kind, "source": source})

    # Bucket-relative paths are the most stable when present.
    add("storage", metadata.get("permanent_glb_path"))
    add("storage", row.get("storage_path"))

    # Public/permanent URLs. Some current rows store a full GCS URL in
    # storage_path, so it must also be considered as an external URL.
    add("external_url", metadata.get("permanent_glb_url"))
    add("external_url", metadata.get("original_meshy_url"))
    add("external_url", row.get("model_url"))
    add("external_url", row.get("storage_path"))

    # Last resort: Meshy signed output, which may eventually expire.
    add("external_url", remote_urls.get("glb"))
    return candidates


def _resolve_row_source(row: dict[str, Any]) -> tuple[str | None, str | None]:
    candidates = _source_candidates(row)
    if not candidates:
        return None, None
    first = candidates[0]
    kind = "storage" if first["kind"] == "storage" else "external_url"
    return first["source"], kind


def validate_user(access_token: str) -> dict[str, Any]:
    with httpx.Client(follow_redirects=True, timeout=30) as client:
        response = client.get(f"{SUPABASE_URL}/auth/v1/user", headers=_headers(access_token))
    if response.status_code != 200:
        raise ClouvaConnectionError("La sesión local de CLOUVA venció. Volvé a entrar.")
    user = response.json()
    if not isinstance(user, dict) or not user.get("id"):
        raise ClouvaConnectionError("Supabase no devolvió un usuario válido")
    return user


def _postgrest_get(path: str, access_token: str) -> list[dict[str, Any]]:
    with httpx.Client(follow_redirects=True, timeout=30) as client:
        response = client.get(f"{SUPABASE_URL}/rest/v1/{path}", headers=_headers(access_token))
    if response.status_code != 200:
        detail = response.text[:500]
        raise ClouvaConnectionError(
            f"CLOUVA no permitió leer el avatar activo ({response.status_code}). {detail}"
        )
    payload = response.json()
    return payload if isinstance(payload, list) else []


def fetch_active_avatar(access_token: str) -> dict[str, Any]:
    user = validate_user(access_token)
    user_id = str(user["id"])
    select = quote("id,name,status,model_url,storage_path,metadata,updated_at", safe=",")
    path = (
        "user_avatars?"
        f"user_id=eq.{quote(user_id)}&is_active=eq.true&archived_at=is.null&"
        f"select={select}&order=updated_at.desc&limit=1"
    )
    rows = _postgrest_get(path, access_token)
    if rows:
        row = rows[0]
        candidates = _source_candidates(row)
        if candidates:
            first = candidates[0]
            return {
                "avatarId": row.get("id"),
                "name": row.get("name") or "Avatar activo",
                "status": row.get("status"),
                "updatedAt": row.get("updated_at"),
                "source": first["source"],
                "sourceKind": first["kind"],
                "candidateCount": len(candidates),
                "downloadCandidates": candidates,
                "userEmail": user.get("email"),
            }

    profile_path = (
        "profiles?"
        f"id=eq.{quote(user_id)}&select=avatar_3d_url&limit=1"
    )
    profiles = _postgrest_get(profile_path, access_token)
    profile_url = _https_url(profiles[0].get("avatar_3d_url")) if profiles else None
    if profile_url and not _looks_derived(profile_url):
        candidate = {"kind": "external_url", "source": profile_url}
        return {
            "avatarId": None,
            "name": "Avatar del perfil",
            "status": "profile_fallback",
            "updatedAt": None,
            "source": profile_url,
            "sourceKind": "external_url",
            "candidateCount": 1,
            "downloadCandidates": [candidate],
            "userEmail": user.get("email"),
        }
    raise ClouvaConnectionError("No encontramos un GLB original limpio en tu avatar activo de CLOUVA")


def _download_stream(url: str, headers: dict[str, str] | None, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    total = 0
    try:
        with httpx.Client(follow_redirects=True, timeout=httpx.Timeout(120, connect=30)) as client:
            with client.stream("GET", url, headers=headers) as response:
                if response.status_code != 200:
                    detail = response.read()[:500].decode("utf-8", errors="replace")
                    raise ClouvaConnectionError(
                        f"HTTP {response.status_code}: {detail}"
                    )
                with destination.open("wb") as stream:
                    for chunk in response.iter_bytes(1024 * 1024):
                        if not chunk:
                            continue
                        total += len(chunk)
                        if total > MAX_GLB_BYTES:
                            raise ClouvaConnectionError("El avatar activo supera el límite local de 250 MB")
                        stream.write(chunk)
    except Exception:
        destination.unlink(missing_ok=True)
        raise

    with destination.open("rb") as stream:
        magic = stream.read(4)
    if magic != b"glTF":
        destination.unlink(missing_ok=True)
        raise ClouvaConnectionError("La fuente no devolvió un GLB válido")


def download_active_avatar(access_token: str, destination: Path) -> dict[str, Any]:
    avatar = fetch_active_avatar(access_token)
    candidates = avatar.get("downloadCandidates")
    if not isinstance(candidates, list) or not candidates:
        candidates = [{"kind": avatar.get("sourceKind"), "source": avatar.get("source")}]

    failures: list[str] = []
    for index, candidate in enumerate(candidates, start=1):
        if not isinstance(candidate, dict):
            continue
        kind = str(candidate.get("kind") or "")
        source = str(candidate.get("source") or "")
        if not source:
            continue
        if kind == "storage":
            safe_path = quote(source.lstrip("/"), safe="/")
            url = f"{SUPABASE_URL}/storage/v1/object/authenticated/{AVATAR_BUCKET}/{safe_path}"
            headers = _headers(access_token)
        else:
            url = source
            headers = None
        try:
            _download_stream(url, headers, destination)
            avatar["source"] = source
            avatar["sourceKind"] = kind
            avatar["selectedCandidate"] = index
            avatar.pop("downloadCandidates", None)
            return avatar
        except Exception as exc:
            failures.append(f"{index}:{kind}:{str(exc)[:180]}")

    destination.unlink(missing_ok=True)
    short = " | ".join(failures[:4])
    raise ClouvaConnectionError(
        "Encontramos el avatar activo, pero ninguna de sus fuentes pudo descargarse. "
        f"Intentos: {short}"
    )
