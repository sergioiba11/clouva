"""CLOUVA Avatar Analyzer V4.2.1 execution wrapper.

The persisted GLB is the exact sanitized source topology, not a GLTF round-trip
of the canonical scene. Incremental runs deterministically reapply the stored
canonical matrix before restoring vertex labels, so object/vertex indices remain
compatible with the persistent segmentation contract.
"""
from __future__ import annotations

import json
from pathlib import Path
import shutil
import time

from mathutils import Matrix

import avatar_analyzer_v42 as base
from multiview_renderer_v43 import render_multiview_v42

_ORIGINAL_BASE_ANALYSIS = base._base_analysis
_ORIGINAL_WRITE_JSON = base._write_json
_FINAL_WRITE_MS = 0.0


def _matrix(values):
    return Matrix(tuple(tuple(float(value) for value in row) for row in values))


def _apply_cached_canonical_transform(meshes, orientation: dict):
    canonical_values = orientation.get("canonicalMatrix")
    if not isinstance(canonical_values, list) or len(canonical_values) != 4:
        raise RuntimeError("Persistent canonical matrix is missing or invalid")
    canonical = _matrix(canonical_values)
    transformed = []
    for obj in meshes:
        if obj.data.users > 1:
            obj.data = obj.data.copy()
        transform = canonical @ obj.matrix_world
        obj.data.transform(transform, shape_keys=True)
        obj.matrix_world = Matrix.Identity(4)
        if float(transform.to_3x3().determinant()) < 0.0 and hasattr(obj.data, "flip_normals"):
            obj.data.flip_normals()
        obj.data.update()
        transformed.append(obj.name)
    return {
        "version": "clouva-cached-canonical-transform-v4.2.1",
        "objectCount": len(transformed),
        "objects": transformed,
        "reusedStoredMatrix": True,
        "orientationInferenceRepeated": False,
    }


def _base_analysis_exact_topology(input_path: Path, output_dir: Path):
    context = _ORIGINAL_BASE_ANALYSIS(input_path, output_dir)
    artifacts = base._base_artifacts(output_dir)
    # Replace the GLTF round-trip with the exact sanitized input. The cached
    # canonical matrix will be reapplied after import on incremental runs.
    shutil.copy2(input_path, artifacts["canonical_glb"])
    manifest = base._read_json(artifacts["base_manifest"], {}) or {}
    manifest.update({
        "cachedGlbMode": "exact_sanitized_source_topology",
        "cachedGlbCanonicalized": False,
        "canonicalTransformReappliedFromManifest": True,
        "topologyRoundTripAvoided": True,
        "cacheCompatibilityVersion": "clouva-base-cache-v4.2.1",
    })
    base._write_json(artifacts["base_manifest"], manifest)
    context["analysis"].setdefault("modules", {}).setdefault("base_geometry", {}).update(manifest)
    context["analysis"]["baseCache"] = {
        "mode": "exact_sanitized_source_topology",
        "canonicalTransformReapplied": True,
        "topologyRoundTripAvoided": True,
    }
    return context


def _load_cached_base_exact(input_path: Path, base_dir: Path, previous_analysis_path: Path):
    metrics = base._initial_metrics()
    started = time.perf_counter()
    meshes = base.autorig_v16.import_original_fresh(input_path)
    base.prepare_analysis_meshes(meshes)
    metrics["importMs"] = base._duration(started)

    orientation = base._read_json(base_dir / "canonical_orientation.json", {}) or {}
    started = time.perf_counter()
    transform_report = _apply_cached_canonical_transform(meshes, orientation)
    metrics["canonicalizationMs"] = base._duration(started)

    vectors = base._vectors(base._read_json(base_dir / "body_vectors.json", {}))
    classifications = base._read_json(base_dir / "mesh_classifications.json", {})
    segmentation_payload = base._read_json(base_dir / "segmentation_labels.json", {})
    segmentation = base._restore_segmentation(meshes, segmentation_payload)

    started = time.perf_counter()
    anatomy_bvh = base.build_anatomy_bvh(meshes, segmentation, classifications)
    metrics["bvhBuildMs"] = base._duration(started)
    analysis = base._read_json(previous_analysis_path, {})
    if not analysis:
        raise RuntimeError("Previous V4.2 analysis is required for incremental execution")
    analysis.setdefault("diagnostics", {})["cachedCanonicalTransform"] = transform_report
    return {
        "meshes": meshes,
        "body_report": (analysis.get("diagnostics") or {}).get("body") or {},
        "body_vectors": vectors,
        "classifications": classifications,
        "segmentation": segmentation,
        "anatomy_bvh": anatomy_bvh,
        "analysis": analysis,
        "metrics": metrics,
        "base_dir": base_dir,
    }


def _coverage(manifest: dict, detector_output: dict, module: str, projected_count: int):
    def belongs(view: dict):
        if module == "face":
            return view.get("region") == "face"
        if module == "left_hand":
            return view.get("region") == "hand" and view.get("side") == "left"
        if module == "right_hand":
            return view.get("region") == "hand" and view.get("side") == "right"
        return view.get("region") == "body"

    views = [item for item in manifest.get("views") or [] if belongs(item)]
    names = {str(item.get("name") or "") for item in views}
    detected = [
        item for item in detector_output.get("views") or []
        if str(item.get("name") or "") in names
    ]
    successful = [item for item in detected if item.get("candidates")]
    return {
        "renderedViews": len(views),
        "detectorSuccessfulViews": len(successful),
        "projectedSuccessfulViews": min(len(successful), projected_count) if projected_count else 0,
        "candidateCount": sum(len(item.get("candidates") or []) for item in detected),
        "projectedCandidates": int(projected_count),
        "visualCoverage": min(1.0, len(successful) / max(len(views), 1)),
        "geometricCoverage": 1.0 if projected_count else 0.0,
    }


def _execute_plan_with_scoped_coverage(context: dict, plan: dict, output_dir: Path):
    module_results, manifest, detector_output, detector_process = base._execute_plan_original(
        context, plan, output_dir,
    )
    coverage = dict(context["analysis"].get("detectionCoverage") or {})
    for module, key in (
        ("face", "face"),
        ("left_hand", "leftHand"),
        ("right_hand", "rightHand"),
    ):
        result = module_results.get(module)
        if result is None:
            continue
        coverage[key] = _coverage(
            manifest,
            detector_output,
            module,
            len(result.get("projectedCandidates") or []),
        )
    context["analysis"]["detectionCoverage"] = coverage
    return module_results, manifest, detector_output, detector_process


def _timed_write_json(path: Path, payload):
    global _FINAL_WRITE_MS
    started = time.perf_counter()
    _ORIGINAL_WRITE_JSON(path, payload)
    if Path(path).name in {"avatar_analysis.json", "diagnostic_report.json"}:
        _FINAL_WRITE_MS += (time.perf_counter() - started) * 1000.0


def _finalize_with_observed_persistence(*args, **kwargs):
    global _FINAL_WRITE_MS
    _FINAL_WRITE_MS = 0.0
    analysis, report = base._finalize_original(*args, **kwargs)
    observed = round(_FINAL_WRITE_MS, 3)
    metrics = analysis.setdefault("metrics", {})
    metrics["persistenceMs"] = observed
    metrics["persistenceMeasurementScope"] = "avatar_analysis_and_diagnostic_report_atomic_writes"
    numeric_total = sum(
        float(value)
        for key, value in metrics.items()
        if key.endswith("Ms") and key != "totalMs" and isinstance(value, (int, float))
    )
    metrics["totalMs"] = round(numeric_total, 3)
    report["metrics"] = metrics
    report["persistenceMeasurementScope"] = metrics["persistenceMeasurementScope"]
    output_dir = Path(args[-1] if args else kwargs["output_dir"])
    _ORIGINAL_WRITE_JSON(output_dir / "avatar_analysis.json", analysis)
    _ORIGINAL_WRITE_JSON(output_dir / "diagnostic_report.json", report)
    return analysis, report


# Install the compatibility layer into the imported V4.2 module. Its public main
# and phase logic remain untouched.
base._base_analysis = _base_analysis_exact_topology
base._load_cached_base = _load_cached_base_exact
base.render_multiview_v42 = render_multiview_v42
base._execute_plan_original = base._execute_plan
base._execute_plan = _execute_plan_with_scoped_coverage
base._write_json = _timed_write_json
base._finalize_original = base._finalize
base._finalize = _finalize_with_observed_persistence


if __name__ == "__main__":
    base.main()
