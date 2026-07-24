"""Create a lightweight, immutable GLB copy for geometry-only avatar analysis."""
from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import struct
import tempfile
from typing import Any


GLB_MAGIC = b"glTF"
GLB_VERSION = 2
JSON_CHUNK_TYPE = 0x4E4F534A
GEOMETRY_EXTENSIONS = {
    "EXT_meshopt_compression",
    "KHR_draco_mesh_compression",
}


class GlbSanitizationError(ValueError):
    """Raised when the source is not a supported GLB 2.0 file."""


def _clean_extensions(document: dict[str, Any]) -> None:
    for key in ("extensionsUsed", "extensionsRequired"):
        values = document.get(key)
        if isinstance(values, list):
            kept = [value for value in values if value in GEOMETRY_EXTENSIONS]
            if kept:
                document[key] = kept
            else:
                document.pop(key, None)
    top_level = document.get("extensions")
    if isinstance(top_level, dict):
        kept = {key: value for key, value in top_level.items() if key in GEOMETRY_EXTENSIONS}
        if kept:
            document["extensions"] = kept
        else:
            document.pop("extensions", None)


def _sanitize_document(document: dict[str, Any]) -> dict[str, int]:
    report = {
        "attributesRemoved": 0,
        "morphTargetsRemoved": 0,
        "materialsRemoved": len(document.get("materials") or []),
        "texturesRemoved": len(document.get("textures") or []),
        "imagesRemoved": len(document.get("images") or []),
        "animationsRemoved": len(document.get("animations") or []),
        "skinsRemoved": len(document.get("skins") or []),
    }

    for mesh in document.get("meshes") or []:
        if not isinstance(mesh, dict):
            continue
        mesh.pop("weights", None)
        for primitive in mesh.get("primitives") or []:
            if not isinstance(primitive, dict):
                continue
            attributes = primitive.get("attributes")
            if isinstance(attributes, dict):
                report["attributesRemoved"] += len([key for key in attributes if key != "POSITION"])
                primitive["attributes"] = {
                    key: value for key, value in attributes.items() if key == "POSITION"
                }
            targets = primitive.pop("targets", None)
            if isinstance(targets, list):
                report["morphTargetsRemoved"] += len(targets)
            primitive.pop("material", None)
            extensions = primitive.get("extensions")
            if isinstance(extensions, dict):
                kept = {
                    key: value for key, value in extensions.items()
                    if key in GEOMETRY_EXTENSIONS
                }
                draco = kept.get("KHR_draco_mesh_compression")
                if isinstance(draco, dict) and isinstance(draco.get("attributes"), dict):
                    draco["attributes"] = {
                        key: value
                        for key, value in draco["attributes"].items()
                        if key == "POSITION"
                    }
                if kept:
                    primitive["extensions"] = kept
                else:
                    primitive.pop("extensions", None)

    for node in document.get("nodes") or []:
        if isinstance(node, dict):
            node.pop("camera", None)
            node.pop("skin", None)
            node.pop("weights", None)
            node.pop("extensions", None)

    for key in (
        "animations",
        "cameras",
        "images",
        "materials",
        "samplers",
        "skins",
        "textures",
    ):
        document.pop(key, None)
    _clean_extensions(document)

    asset = document.setdefault("asset", {"version": "2.0"})
    extras = asset.get("extras")
    if not isinstance(extras, dict):
        extras = {}
        asset["extras"] = extras
    extras["clouvaAnalysisSanitized"] = True
    extras["clouvaSourceUnmodified"] = True
    return report


def sanitize_glb_for_analysis(source: Path | str, destination: Path | str) -> dict[str, int]:
    """Strip non-geometric references without loading or rewriting the binary payload."""
    source_path = Path(source)
    destination_path = Path(destination)
    if source_path.resolve() == destination_path.resolve():
        raise GlbSanitizationError("The analysis copy must not overwrite the source GLB")

    source_size = source_path.stat().st_size
    with source_path.open("rb") as input_file:
        header = input_file.read(12)
        if len(header) != 12:
            raise GlbSanitizationError("GLB header is incomplete")
        magic, version, declared_length = struct.unpack("<4sII", header)
        if magic != GLB_MAGIC or version != GLB_VERSION:
            raise GlbSanitizationError("Expected a GLB 2.0 file")
        if declared_length != source_size:
            raise GlbSanitizationError("GLB length does not match the file size")

        chunk_header = input_file.read(8)
        if len(chunk_header) != 8:
            raise GlbSanitizationError("GLB JSON chunk is missing")
        json_length, chunk_type = struct.unpack("<II", chunk_header)
        if chunk_type != JSON_CHUNK_TYPE:
            raise GlbSanitizationError("The first GLB chunk must be JSON")
        json_payload = input_file.read(json_length)
        if len(json_payload) != json_length:
            raise GlbSanitizationError("GLB JSON chunk is incomplete")
        try:
            document = json.loads(json_payload.rstrip(b" \t\r\n\x00").decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise GlbSanitizationError("GLB JSON chunk is invalid") from exc

        report = _sanitize_document(document)
        compact_json = json.dumps(
            document,
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
        compact_json += b" " * ((-len(compact_json)) % 4)
        remaining_length = source_size - input_file.tell()
        sanitized_length = 12 + 8 + len(compact_json) + remaining_length

        destination_path.parent.mkdir(parents=True, exist_ok=True)
        handle, temporary_name = tempfile.mkstemp(
            prefix=f".{destination_path.name}.",
            suffix=".partial",
            dir=str(destination_path.parent),
        )
        os.close(handle)
        temporary_path = Path(temporary_name)
        try:
            with temporary_path.open("wb") as output_file:
                output_file.write(struct.pack("<4sII", GLB_MAGIC, GLB_VERSION, sanitized_length))
                output_file.write(struct.pack("<II", len(compact_json), JSON_CHUNK_TYPE))
                output_file.write(compact_json)
                shutil.copyfileobj(input_file, output_file, length=1024 * 1024)
            os.replace(temporary_path, destination_path)
        except Exception:
            temporary_path.unlink(missing_ok=True)
            raise

    report["sourceBytes"] = source_size
    report["analysisBytes"] = destination_path.stat().st_size
    return report
