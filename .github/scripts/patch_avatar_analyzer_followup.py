from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    source = target.read_text(encoding="utf-8")
    if old not in source:
        raise RuntimeError(f"missing replacement anchor in {path}: {old[:140]!r}")
    target.write_text(source.replace(old, new, 1), encoding="utf-8")


replace_once(
    "app/api/avatar/analyze/_shared.ts",
    '''      requestedRigProfile: String(args.summary.requestedRigProfile ?? "BODY_BASIC"),\n      updatedAt: new Date().toISOString(),\n''',
    '''      requestedRigProfile: String(args.summary.requestedRigProfile ?? "BODY_BASIC"),\n      summary: args.summary,\n      updatedAt: new Date().toISOString(),\n''',
)

replace_once(
    "app/api/avatar/analyze/latest/route.ts",
    '''        requestedRigProfile: stored.requestedRigProfile,\n        updatedAt: stored.updatedAt,\n''',
    '''        requestedRigProfile: stored.requestedRigProfile,\n        summary: asRecord(stored.summary) || {\n          status: String(stored.status ?? "needs_review"),\n          runId: safeAnalyzerRunId(stored.runId),\n          analyzerVersion: stored.analyzerVersion,\n          sourceSha256: stored.sourceSha256,\n          requestedRigProfile: stored.requestedRigProfile,\n          warningCount: 0,\n          rigModified: false,\n        },\n        updatedAt: stored.updatedAt,\n''',
)

replace_once(
    "components/library/AvatarAnalyzerPreview.tsx",
    '''function statusLabel(value?: string) {\n''',
    '''function recommendedActionLabel(value?: string | Record<string, unknown>) {\n  if (typeof value === "string" && value.trim()) return value.trim();\n  if (!value || typeof value !== "object") return "";\n  for (const key of ["message", "action", "operation", "label", "reason"]) {\n    const candidate = value[key];\n    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();\n  }\n  return "";\n}\n\nfunction statusLabel(value?: string) {\n''',
)

replace_once(
    "components/library/AvatarAnalyzerPreview.tsx",
    '''        pendingError?: string;\n        error?: string;\n''',
    '''        pendingError?: string;\n        summary?: AnalysisSummary;\n        error?: string;\n''',
)

replace_once(
    "components/library/AvatarAnalyzerPreview.tsx",
    '''      setAnalysisProcessState("summary_ready");\n      const [assetReady, detailReady] = await Promise.all([\n''',
    '''      setSummary(latest.summary ?? null);\n      setAnalysisProcessState("summary_ready");\n      const [assetReady, detailReady] = await Promise.all([\n''',
)

replace_once(
    "components/library/AvatarAnalyzerPreview.tsx",
    '''              La cobertura geométrica puede ser alta aunque el detector visual no reconozca una región en sus vistas.\n''',
    '''              La cobertura geométrica puede ser alta aunque el detector visual no reconozca una región en sus vistas.\n              0/7 vistas significa que el detector no reconoció esa región en ninguna de las siete cámaras renderizadas.\n''',
)

replace_once(
    "components/library/AvatarAnalyzerPreview.tsx",
    '''                {(effectiveSummary.rigReadinessGates || []).length\n                  ? ` Bloqueos: ${(effectiveSummary.rigReadinessGates || []).map(readableName).join(", ")}.`\n                  : ""}\n''',
    '''                {(effectiveSummary.rigReadinessGates || []).length\n                  ? ` Bloqueos: ${(effectiveSummary.rigReadinessGates || []).map(readableName).join(", ")}.`\n                  : ""}\n                {recommendedActionLabel(effectiveSummary.recommendedNextAction)\n                  ? ` Próxima acción: ${recommendedActionLabel(effectiveSummary.recommendedNextAction)}.`\n                  : ""}\n''',
)

replace_once(
    "worker/garment-rig/app_v18.py",
    '''    except (json.JSONDecodeError, FileNotFoundError, OSError) as exc:\n        _result_still_persisting(run_id)\n        raise exc\n''',
    '''    except (json.JSONDecodeError, FileNotFoundError, OSError):\n        _result_still_persisting(run_id)\n''',
)

replace_once(
    "worker/garment-rig/test_avatar_analyzer_v4_persistence.py",
    '''import app_v18\n''',
    '''try:\n    import app_v18\nexcept ModuleNotFoundError:  # Docker promotes app_v18.py to app.py.\n    import app as app_v18\n''',
)

with (ROOT / "tests-avatar-analyzer-v4.mjs").open("a", encoding="utf-8") as handle:
    handle.write('''\n\ntest("restored Analyzer results retain their compact summary and next action", () => {\n  const shared = read("./app/api/avatar/analyze/_shared.ts");\n  const latest = read("./app/api/avatar/analyze/latest/route.ts");\n  const preview = read("./components/library/AvatarAnalyzerPreview.tsx");\n  assert.match(shared, /summary: args\.summary/);\n  assert.match(latest, /summary: asRecord\(stored\.summary\)/);\n  assert.match(preview, /setSummary\(latest\.summary/);\n  assert.match(preview, /Próxima acción/);\n  assert.match(preview, /0\/7 vistas significa/);\n});\n''')

print("Avatar Analyzer recovery follow-up applied")
