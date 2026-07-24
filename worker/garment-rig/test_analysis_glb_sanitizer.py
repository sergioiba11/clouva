"""Pure-Python contract tests for the pre-Blender GLB memory sanitizer."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import struct
import tempfile
import unittest

from analysis_glb_sanitizer import GlbSanitizationError, sanitize_glb_for_analysis


def _write_glb(path: Path, document: dict, binary: bytes) -> None:
    encoded = json.dumps(document, separators=(",", ":")).encode("utf-8")
    encoded += b" " * ((-len(encoded)) % 4)
    binary += b"\x00" * ((-len(binary)) % 4)
    total = 12 + 8 + len(encoded) + 8 + len(binary)
    path.write_bytes(
        struct.pack("<4sII", b"glTF", 2, total)
        + struct.pack("<II", len(encoded), 0x4E4F534A)
        + encoded
        + struct.pack("<II", len(binary), 0x004E4942)
        + binary
    )


def _read_glb(path: Path) -> tuple[dict, bytes]:
    payload = path.read_bytes()
    json_length, json_type = struct.unpack_from("<II", payload, 12)
    assert json_type == 0x4E4F534A
    start = 20
    document = json.loads(payload[start:start + json_length].rstrip(b" ").decode("utf-8"))
    binary_header = start + json_length
    binary_length, binary_type = struct.unpack_from("<II", payload, binary_header)
    assert binary_type == 0x004E4942
    binary_start = binary_header + 8
    return document, payload[binary_start:binary_start + binary_length]


class AnalysisGlbSanitizerTests(unittest.TestCase):
    def test_strips_non_geometry_references_and_preserves_source(self):
        document = {
            "asset": {"version": "2.0"},
            "scene": 0,
            "scenes": [{"nodes": [0]}],
            "nodes": [{"mesh": 0, "skin": 0, "weights": [0.2], "translation": [0, 0, 1]}],
            "meshes": [{
                "weights": [0.2],
                "primitives": [{
                    "attributes": {
                        "POSITION": 0,
                        "NORMAL": 1,
                        "TEXCOORD_0": 2,
                        "JOINTS_0": 3,
                        "WEIGHTS_0": 4,
                    },
                    "indices": 5,
                    "material": 0,
                    "targets": [{"POSITION": 6}],
                }],
            }],
            "accessors": [{"bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC3"}] * 7,
            "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": 48}],
            "buffers": [{"byteLength": 48}],
            "materials": [{"name": "heavy"}],
            "textures": [{"source": 0}],
            "images": [{"bufferView": 0, "mimeType": "image/png"}],
            "samplers": [{}],
            "animations": [{"channels": [], "samplers": []}],
            "skins": [{"joints": [0]}],
            "cameras": [{"type": "perspective"}],
            "extensionsUsed": ["KHR_materials_unlit"],
        }
        binary = bytes(range(48))
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source.glb"
            output = root / "analysis.glb"
            _write_glb(source, document, binary)
            source_hash = hashlib.sha256(source.read_bytes()).hexdigest()

            report = sanitize_glb_for_analysis(source, output)
            sanitized, sanitized_binary = _read_glb(output)

            self.assertEqual(source_hash, hashlib.sha256(source.read_bytes()).hexdigest())
            self.assertEqual(sanitized_binary, binary)
            primitive = sanitized["meshes"][0]["primitives"][0]
            self.assertEqual(primitive["attributes"], {"POSITION": 0})
            self.assertEqual(primitive["indices"], 5)
            self.assertNotIn("targets", primitive)
            self.assertNotIn("material", primitive)
            self.assertNotIn("weights", sanitized["meshes"][0])
            self.assertNotIn("skin", sanitized["nodes"][0])
            self.assertNotIn("weights", sanitized["nodes"][0])
            for key in ("materials", "textures", "images", "samplers", "animations", "skins", "cameras"):
                self.assertNotIn(key, sanitized)
            self.assertTrue(sanitized["asset"]["extras"]["clouvaAnalysisSanitized"])
            self.assertTrue(sanitized["asset"]["extras"]["clouvaSourceUnmodified"])
            self.assertEqual(report["attributesRemoved"], 4)
            self.assertEqual(report["morphTargetsRemoved"], 1)
            self.assertEqual(report["imagesRemoved"], 1)

    def test_rejects_overwriting_or_invalid_input(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "invalid.glb"
            source.write_bytes(b"not-a-glb")
            with self.assertRaises(GlbSanitizationError):
                sanitize_glb_for_analysis(source, source)
            with self.assertRaises(GlbSanitizationError):
                sanitize_glb_for_analysis(source, source.with_name("output.glb"))


if __name__ == "__main__":
    unittest.main()
