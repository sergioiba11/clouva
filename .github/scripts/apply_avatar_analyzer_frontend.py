from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    source = target.read_text(encoding="utf-8")
    if old not in source:
        raise RuntimeError(f"missing replacement anchor in {path}: {old[:140]!r}")
    target.write_text(source.replace(old, new, 1), encoding="utf-8")


def replace_regex(path: str, pattern: str, replacement: str) -> None:
    target = ROOT / path
    source = target.read_text(encoding="utf-8")
    updated, count = re.subn(pattern, replacement, source, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"regex replacement count={count} in {path}: {pattern}")
    target.write_text(updated, encoding="utf-8")


component_path = "components/library/AvatarAnalyzerPreview.tsx"

replace_once(
    component_path,
    '  rigReadinessGates?: string[];\n',
    '  rigReadinessGates?: string[];\n  recommendedNextAction?: string | Record<string, unknown>;\n',
)

replace_once(
    component_path,
    '''type JobStatus = {\n  status: "pending" | "done" | "error";\n  runId?: string;\n  summary?: AnalysisSummary;\n  detail?: string;\n};\n''',
    '''type JobStatus = {\n  status: "pending" | "done" | "error";\n  runId?: string;\n  summary?: AnalysisSummary;\n  detail?: string;\n};\n\ntype AnalysisProcessState = "idle" | "starting" | "running" | "summary_ready" | "ready" | "failed";\ntype DetailState = "idle" | "loading" | "ready" | "retrying" | "temporarily_unavailable" | "failed";\ntype AssetState = "idle" | "loading" | "ready" | "failed";\n\ntype ApiErrorPayload = {\n  error?: string;\n  code?: string;\n  retryable?: boolean;\n};\n\nconst DETAIL_RETRYABLE_STATUSES = new Set([429, 502, 503]);\nconst DETAIL_MAX_ATTEMPTS = 5;\n\nfunction wait(ms: number) {\n  return new Promise((resolve) => window.setTimeout(resolve, ms));\n}\n\nasync function readApiError(response: Response): Promise<ApiErrorPayload> {\n  const data = await response.json().catch(() => null) as ApiErrorPayload | null;\n  return data || {\n    error: `No se pudo consultar el diagnóstico (${response.status}).`,\n    code: "ANALYZER_HTTP_ERROR",\n    retryable: DETAIL_RETRYABLE_STATUSES.has(response.status),\n  };\n}\n\nfunction processStateLabel(state: AnalysisProcessState) {\n  return {\n    idle: "Sin iniciar",\n    starting: "Iniciando",\n    running: "Analizando",\n    summary_ready: "Resultado persistido",\n    ready: "Completado",\n    failed: "Falló",\n  }[state];\n}\n\nfunction detailStateLabel(state: DetailState) {\n  return {\n    idle: "Sin solicitar",\n    loading: "Cargando",\n    ready: "Recuperado",\n    retrying: "Reintentando",\n    temporarily_unavailable: "Temporalmente no disponible",\n    failed: "Falló",\n  }[state];\n}\n\nfunction assetStateLabel(state: AssetState) {\n  return { idle: "Sin solicitar", loading: "Cargando", ready: "Recuperado", failed: "Falló" }[state];\n}\n''',
)

replace_once(
    component_path,
    '''  const { user, session, loading: authLoading } = useAuth();\n  const [analyzing, setAnalyzing] = useState(false);\n  const [restoringLatest, setRestoringLatest] = useState(false);\n  const [loadingDetail, setLoadingDetail] = useState(false);\n  const [previewUrl, setPreviewUrl] = useState<string | null>(null);\n  const [summary, setSummary] = useState<AnalysisSummary | null>(null);\n  const [detail, setDetail] = useState<AnalysisDetail | null>(null);\n  const [error, setError] = useState<string | null>(null);\n  const [cameraOrbit, setCameraOrbit] = useState(CAMERA_PRESETS[0].orbit);\n''',
    '''  const { user, session, loading: authLoading } = useAuth();\n  const [analysisProcessState, setAnalysisProcessState] = useState<AnalysisProcessState>("idle");\n  const [detailState, setDetailState] = useState<DetailState>("idle");\n  const [assetState, setAssetState] = useState<AssetState>("idle");\n  const [restoringLatest, setRestoringLatest] = useState(false);\n  const [previewUrl, setPreviewUrl] = useState<string | null>(null);\n  const [summary, setSummary] = useState<AnalysisSummary | null>(null);\n  const [detail, setDetail] = useState<AnalysisDetail | null>(null);\n  const [transportError, setTransportError] = useState<string | null>(null);\n  const [workerErrorMessage, setWorkerErrorMessage] = useState<string | null>(null);\n  const [persistenceNotice, setPersistenceNotice] = useState<string | null>(null);\n  const [detailRetryCount, setDetailRetryCount] = useState(0);\n  const [cameraOrbit, setCameraOrbit] = useState(CAMERA_PRESETS[0].orbit);\n''',
)

replace_once(
    component_path,
    '''  const [cameraTargetValue, setCameraTargetValue] = useState("0m 0m 0m");\n  const [selectedName, setSelectedName] = useState("");\n''',
    '''  const [cameraTargetValue, setCameraTargetValue] = useState("0m 0m 0m");\n  const [activeCamera, setActiveCamera] = useState(CAMERA_PRESETS[0].label);\n  const [selectedName, setSelectedName] = useState("");\n''',
)

replace_once(
    component_path,
    '''  const modelViewerRef = useRef<ModelViewerElement | null>(null);\n\n  const landmarks = useMemo(\n''',
    '''  const modelViewerRef = useRef<ModelViewerElement | null>(null);\n  const cameraButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});\n  const analyzing = analysisProcessState === "starting" || analysisProcessState === "running";\n  const loadingDetail = detailState === "loading" || detailState === "retrying";\n\n  const landmarks = useMemo(\n''',
)

replace_regex(
    component_path,
    r'  const viewerState = useMemo\(\(\) => \{.*?\n  \}, \[effectiveSummary, error\]\);',
    '''  const viewerState = useMemo(() => {\n    if (!effectiveSummary && analysisProcessState === "failed") {\n      return { label: "ERROR DEL WORKER", className: styles.badgeError };\n    }\n    if (analysisProcessState === "starting" || analysisProcessState === "running") {\n      return { label: "ANALIZANDO", className: styles.badgeNotice };\n    }\n    if (!effectiveSummary) return { label: "SIN ANALIZAR", className: styles.badgeEmpty };\n    if (detailState === "temporarily_unavailable") {\n      return { label: "DETALLE TEMPORALMENTE NO DISPONIBLE", className: styles.badgeNotice };\n    }\n    if (effectiveSummary.rigReadinessApproved && ["valid", "valid_with_warnings"].includes(effectiveSummary.status)) {\n      return { label: "ANÁLISIS APROBADO", className: styles.badgeApproved };\n    }\n    if (effectiveSummary.status === "needs_review") {\n      return { label: "NECESITA REVISIÓN", className: styles.badgePartial };\n    }\n    return { label: "ANÁLISIS PARCIAL", className: styles.badgePartial };\n  }, [analysisProcessState, detailState, effectiveSummary]);''',
)

replace_once(
    component_path,
    '''  const applyPreset = (preset: CameraPreset) => {\n    applyCamera(preset.orbit, cameraTarget(landmarks, preset.targetLandmarks, fallbackCenter));\n  };\n''',
    '''  const applyPreset = (preset: CameraPreset) => {\n    setActiveCamera(preset.label);\n    applyCamera(preset.orbit, cameraTarget(landmarks, preset.targetLandmarks, fallbackCenter));\n    window.setTimeout(() => {\n      cameraButtonRefs.current[preset.label]?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });\n    }, 0);\n  };\n''',
)

new_flow = r'''  const loadAsset = async (runId: string, accessToken: string) => {
    setAssetState("loading");
    try {
      const assetResponse = await fetch(
        `/api/avatar/analyze/result/${runId}/asset/diagnostic_landmarks.glb`,
        { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" },
      );
      if (!assetResponse.ok) throw new Error("El análisis terminó, pero no se pudo abrir su GLB diagnóstico.");
      const blob = await assetResponse.blob();
      if (blob.size < 1024) throw new Error("El diagnóstico llegó vacío.");
      const nextUrl = URL.createObjectURL(blob);
      setPreviewUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return nextUrl;
      });
      setAssetState("ready");
      return true;
    } catch (cause) {
      setAssetState("failed");
      setTransportError(cause instanceof Error ? cause.message : "No se pudo recuperar el GLB diagnóstico.");
      return false;
    }
  };

  const loadDetail = async (runId: string, accessToken: string, manualRetry = false) => {
    setDetailState(manualRetry ? "retrying" : "loading");
    setPersistenceNotice(null);
    setDetailRetryCount(0);
    for (let attempt = 0; attempt < DETAIL_MAX_ATTEMPTS; attempt += 1) {
      try {
        const response = await fetch(`/api/avatar/analyze/result/${runId}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: "no-store",
        });
        if (response.ok) {
          const data = await response.json().catch(() => null) as AnalysisDetail | null;
          if (!data?.analysis || !data.summary) throw new Error("El diagnóstico llegó incompleto.");
          setDetail(data);
          setSummary(data.summary);
          setDetailState("ready");
          setTransportError(null);
          setPersistenceNotice(null);
          const firstBlocking = Object.keys(data.rejectedLandmarks || {})[0];
          if (firstBlocking) selectLandmark(firstBlocking, data.analysis.landmarks || {}, false);
          return true;
        }
        const apiError = await readApiError(response);
        const retryable = apiError.retryable || DETAIL_RETRYABLE_STATUSES.has(response.status);
        if (!retryable) {
          setDetailState("failed");
          setTransportError(apiError.error || "No se pudo leer el reporte anatómico.");
          return false;
        }
        setDetailState("retrying");
        setDetailRetryCount(attempt + 1);
        setPersistenceNotice(apiError.error || "El diagnóstico todavía se está guardando.");
        const retryAfter = Number(response.headers.get("retry-after"));
        const baseDelay = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : Math.min(8000, 700 * (2 ** attempt));
        await wait(baseDelay + Math.round(Math.random() * 350));
      } catch (cause) {
        if (attempt === DETAIL_MAX_ATTEMPTS - 1) {
          setDetailState("temporarily_unavailable");
          setTransportError(cause instanceof Error ? cause.message : "No se pudo recuperar el detalle.");
          return false;
        }
        setDetailState("retrying");
        setDetailRetryCount(attempt + 1);
        await wait(Math.min(8000, 700 * (2 ** attempt)) + Math.round(Math.random() * 350));
      }
    }
    setDetailState("temporarily_unavailable");
    setPersistenceNotice("El análisis está completo, pero el detalle continúa temporalmente inaccesible.");
    return false;
  };

  const runJob = async (jobId: string, startedAt: number = Date.now()) => {
    if (!session?.access_token) return;
    saveActiveJob({ jobId, startedAt });
    setAnalysisProcessState("running");
    setWorkerErrorMessage(null);
    let terminal = false;
    try {
      const job = await pollAnalysisJob(jobId, session.access_token);
      if (job.status === "error" || !job.runId) {
        terminal = true;
        setAnalysisProcessState("failed");
        setWorkerErrorMessage(job.detail || "El Worker no pudo completar el análisis.");
        return;
      }
      terminal = true;
      setSummary(job.summary ?? null);
      setAnalysisProcessState("summary_ready");
      setCameraOrbit(CAMERA_PRESETS[0].orbit);
      setCameraTargetValue(targetValue(fallbackCenter));
      const [assetReady, detailReady] = await Promise.all([
        loadAsset(job.runId, session.access_token),
        loadDetail(job.runId, session.access_token),
      ]);
      if (job.summary || assetReady || detailReady) {
        setAnalysisProcessState("ready");
      } else {
        setAnalysisProcessState("failed");
        setWorkerErrorMessage("El proceso terminó sin un resultado utilizable.");
      }
    } finally {
      if (terminal) saveActiveJob(null);
    }
  };

  const analyze = async () => {
    if (!session?.access_token) return;
    setAnalysisProcessState("starting");
    setDetailState("idle");
    setAssetState("idle");
    setTransportError(null);
    setWorkerErrorMessage(null);
    setPersistenceNotice(null);
    setSummary(null);
    setDetail(null);
    setSelectedName("");
    setCorrectionMessage(null);
    setVisualCorrectionMode(false);
    try {
      const kickoff = await fetch("/api/avatar/analyze", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: "no-store",
      });
      const kickoffData = await kickoff.json().catch(() => ({})) as {
        jobId?: string;
        pendingPersisted?: boolean;
        error?: string;
      };
      if (!kickoff.ok || !kickoffData.jobId) {
        throw new Error(kickoffData.error || `No se pudo iniciar el análisis (${kickoff.status}).`);
      }
      if (kickoffData.pendingPersisted === false) {
        setPersistenceNotice("El job quedó guardado en este dispositivo, pero Supabase no confirmó todavía la recuperación entre dispositivos.");
      }
      await runJob(kickoffData.jobId);
    } catch (cause) {
      console.error("Avatar Analyzer UI failed", cause);
      setAnalysisProcessState("failed");
      setWorkerErrorMessage(cause instanceof Error ? cause.message : "No se pudo analizar el avatar.");
    }
  };

  const resumeAttemptedRef = useRef(false);
  useEffect(() => {
    if (resumeAttemptedRef.current) return;
    if (authLoading || !session?.access_token) return;
    resumeAttemptedRef.current = true;
    const pending = loadActiveJob();
    if (!pending) return;
    if (Date.now() - pending.startedAt >= JOB_POLL_TIMEOUT_MS) return;
    void runJob(pending.jobId, pending.startedAt).catch((cause) => {
      console.error("Avatar Analyzer resume failed", cause);
      setAnalysisProcessState("failed");
      setWorkerErrorMessage(cause instanceof Error ? cause.message : "No se pudo retomar el análisis anterior.");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, session?.access_token]);

  const restoreLatest = async () => {
    if (!session?.access_token) return;
    setRestoringLatest(true);
    setTransportError(null);
    setWorkerErrorMessage(null);
    try {
      const authorization = { Authorization: `Bearer ${session.access_token}` };
      const latestResponse = await fetch("/api/avatar/analyze/latest", {
        headers: authorization,
        cache: "no-store",
      });
      const latest = await latestResponse.json() as {
        available?: boolean;
        pending?: boolean;
        runId?: string;
        jobId?: string;
        startedAt?: string;
        pendingStatus?: string;
        pendingError?: string;
        error?: string;
      };
      if (!latestResponse.ok) throw new Error(latest.error || "No se pudo buscar el último análisis.");
      if (latest.pending && latest.jobId) {
        if (latest.pendingStatus === "error") {
          setAnalysisProcessState("failed");
          setWorkerErrorMessage(latest.pendingError || "El último job terminó con error.");
          return;
        }
        const startedAt = latest.startedAt ? Date.parse(latest.startedAt) : Date.now();
        setPersistenceNotice("Se recuperó un análisis pendiente desde Supabase.");
        await runJob(latest.jobId, Number.isFinite(startedAt) ? startedAt : Date.now());
        return;
      }
      if (!latest.available || !latest.runId) {
        throw new Error("Este avatar todavía no tiene un análisis V4.1 guardado.");
      }
      setAnalysisProcessState("summary_ready");
      const [assetReady, detailReady] = await Promise.all([
        loadAsset(latest.runId, session.access_token),
        loadDetail(latest.runId, session.access_token),
      ]);
      setAnalysisProcessState(assetReady || detailReady ? "ready" : "failed");
    } catch (cause) {
      setAnalysisProcessState("failed");
      setWorkerErrorMessage(cause instanceof Error ? cause.message : "No se pudo abrir el último análisis.");
    } finally {
      setRestoringLatest(false);
    }
  };

  const retryDetail = () => {
    if (!effectiveSummary?.runId || !session?.access_token) return;
    void loadDetail(effectiveSummary.runId, session.access_token, true);
  };

'''

replace_regex(
    component_path,
    r'  const loadDetail = async \(runId: string, accessToken: string\) => \{.*?\n  const pickSurfacePoint',
    new_flow + '  const pickSurfacePoint',
)

replace_once(
    component_path,
    '''            {CAMERA_PRESETS.map((preset) => (\n              <button type="button" key={preset.label} onClick={() => applyPreset(preset)}>\n                {preset.icon === "face" ? <Eye /> : preset.icon === "hand" ? <Hand /> : null}\n                {preset.label}\n              </button>\n            ))}\n''',
    '''            {CAMERA_PRESETS.map((preset) => (\n              <button\n                type="button"\n                key={preset.label}\n                ref={(node) => { cameraButtonRefs.current[preset.label] = node; }}\n                className={activeCamera === preset.label ? styles.cameraActive : undefined}\n                aria-pressed={activeCamera === preset.label}\n                onClick={() => applyPreset(preset)}\n              >\n                {preset.icon === "face" ? <Eye /> : preset.icon === "hand" ? <Hand /> : null}\n                {preset.label}\n              </button>\n            ))}\n''',
)

replace_once(
    component_path,
    '''          <div className={styles.summary}>\n            <div><span>Resultado</span><strong>{statusLabel(effectiveSummary.status)}</strong></div>\n            <div><span>Confianza del cuerpo base</span><strong>{percent(effectiveSummary.bodyBaseConfidence ?? effectiveSummary.humanoidConfidence)}</strong></div>\n            <div className={effectiveSummary.rigReadinessApproved ? styles.metricApproved : styles.metricBlocked}>\n              <span>Preparación para rig</span><strong>{percent(effectiveSummary.rigReadinessScore)}</strong>\n            </div>\n            <div><span>Puntos verificados</span><strong>{verified}</strong></div>\n            <div><span>Sin evidencia visual</span><strong>{effectiveSummary.noVisualEvidenceCount ?? 0}</strong></div>\n            <div><span>Faltan vistas</span><strong>{effectiveSummary.insufficientViewsCount ?? 0}</strong></div>\n            <div><span>Errores técnicos</span><strong>{effectiveSummary.technicalMismatchCount ?? 0}</strong></div>\n            <div><span>Topología inválida</span><strong>{effectiveSummary.topologyInvalidCount ?? 0}</strong></div>\n            <div><span>Articulaciones internas</span><strong>{effectiveSummary.internalJointCount ?? 0}</strong></div>\n          </div>\n''',
    '''          <div className={styles.primarySummary}>\n            <div><span>Resultado anatómico</span><strong>{statusLabel(effectiveSummary.status)}</strong></div>\n            <div><span>Confianza del cuerpo base</span><strong>{percent(effectiveSummary.bodyBaseConfidence ?? effectiveSummary.humanoidConfidence)}</strong></div>\n            <div className={effectiveSummary.rigReadinessApproved ? styles.metricApproved : styles.metricBlocked}>\n              <span>Preparación para rig</span><strong>{percent(effectiveSummary.rigReadinessScore)}</strong>\n            </div>\n            <div><span>Puntos verificados</span><strong>{verified} puntos</strong></div>\n          </div>\n          <details className={styles.technicalDetails}>\n            <summary>VER DIAGNÓSTICO TÉCNICO</summary>\n            <div className={styles.technicalGrid}>\n              <div><span>Landmarks sin evidencia visual</span><strong>{effectiveSummary.noVisualEvidenceCount ?? 0} landmarks</strong></div>\n              <div><span>Landmarks con vistas insuficientes</span><strong>{effectiveSummary.insufficientViewsCount ?? 0} landmarks</strong></div>\n              <div><span>Incompatibilidades visuales/técnicas</span><strong>{effectiveSummary.technicalMismatchCount ?? 0} landmarks</strong></div>\n              <div><span>Landmarks con topología inválida</span><strong>{effectiveSummary.topologyInvalidCount ?? 0} landmarks</strong></div>\n              <div><span>Articulaciones internas calculadas</span><strong>{effectiveSummary.internalJointCount ?? 0} articulaciones</strong></div>\n            </div>\n            <p className={styles.metricExplanation}>\n              La confianza corporal mide el cuerpo base. La preparación para rig aplica además los gates bloqueantes.\n              La cobertura geométrica puede ser alta aunque el detector visual no reconozca una región en sus vistas.\n            </p>\n          </details>\n''',
)

replace_once(
    component_path,
    '''                <strong>{compactCoverage(record)}</strong>\n                <small>\n                  Visual {percent(record?.visualCoverage)} · Geométrica {percent(record?.geometricCoverage)}\n                </small>\n''',
    '''                <strong>{compactCoverage(record)}</strong>\n                <small>\n                  Detectadas {record?.detectorSuccessfulViews ?? 0}/{record?.renderedViews ?? 0} · Proyectadas {record?.projectedSuccessfulViews ?? 0}\n                </small>\n                <small>Visual {percent(record?.visualCoverage)} · Geométrica {percent(record?.geometricCoverage)}</small>\n''',
)

replace_once(
    component_path,
    '''      {loadingDetail ? (\n        <div className={styles.processing}><Loader2 className={styles.spin} /><p>Cargando cobertura, estados y motivos exactos…</p></div>\n      ) : null}\n''',
    '''      {loadingDetail ? (\n        <div className={styles.processing}><Loader2 className={styles.spin} /><p>Cargando cobertura, estados y motivos exactos… Reintentos: {detailRetryCount}</p></div>\n      ) : null}\n\n      {detailState === "temporarily_unavailable" ? (\n        <div className={styles.detailNotice}>\n          <div><strong>DETALLE TEMPORALMENTE NO DISPONIBLE</strong><span>El resultado anatómico y el GLB se conservan. No hace falta volver a ejecutar Blender.</span></div>\n          <button type="button" onClick={retryDetail}>REINTENTAR CARGA DEL DETALLE</button>\n        </div>\n      ) : null}\n\n      {analysisProcessState !== "idle" || effectiveSummary ? (\n        <section className={styles.systemHealth} aria-label="Salud del sistema del Analyzer">\n          <div><span>Worker</span><strong>{analysisProcessState === "failed" ? "Error" : "Disponible"}</strong></div>\n          <div><span>Proceso</span><strong>{processStateLabel(analysisProcessState)}</strong></div>\n          <div><span>Resultado persistido</span><strong>{effectiveSummary ? "Sí" : analysisProcessState === "running" ? "En proceso" : "No"}</strong></div>\n          <div><span>Detalle</span><strong>{detailStateLabel(detailState)}</strong></div>\n          <div><span>GLB diagnóstico</span><strong>{assetStateLabel(assetState)}</strong></div>\n          <div><span>Reintentos</span><strong>{detailRetryCount}</strong></div>\n        </section>\n      ) : null}\n''',
)

replace_once(
    component_path,
    '''      {error ? <p className={styles.error}><TriangleAlert /> {error}</p> : null}\n''',
    '''      {persistenceNotice ? <p className={styles.notice}><Loader2 className={loadingDetail ? styles.spin : undefined} /> {persistenceNotice}</p> : null}\n      {transportError ? <p className={styles.transportError}><TriangleAlert /> {transportError}</p> : null}\n      {workerErrorMessage ? <p className={styles.error}><TriangleAlert /> {workerErrorMessage}</p> : null}\n''',
)

css_path = ROOT / "components/library/avatar-analyzer-preview.module.css"
css = css_path.read_text(encoding="utf-8")
css += r'''

/* Avatar Analyzer V4.1 hardening: independent process, detail and asset states. */
.card { overflow-x: hidden; }
.badgeNotice { border-color: rgba(91, 180, 255, .45); color: #b9ddff; }
.cameraBar {
  scroll-snap-type: x proximity;
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.cameraBar::-webkit-scrollbar { display: none; }
.cameraBar button { min-height: 44px; scroll-snap-align: center; }
.cameraBar .cameraActive {
  border-color: rgba(204, 160, 255, .78);
  background: rgba(137, 66, 235, .3);
  color: #fff;
  box-shadow: inset 0 0 0 1px rgba(210, 177, 255, .16);
}
.primarySummary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 9px;
  margin: 14px 0 9px;
}
.primarySummary > div,
.technicalGrid > div,
.systemHealth > div {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
  padding: 12px;
  border: 1px solid rgba(170, 111, 255, .17);
  border-radius: 14px;
  background: rgba(255, 255, 255, .035);
}
.primarySummary span,
.technicalGrid span,
.systemHealth span { color: #938a9f; font-size: 10px; }
.primarySummary strong,
.technicalGrid strong,
.systemHealth strong { color: #f5edff; font-size: 12px; overflow-wrap: anywhere; }
.primarySummary .metricApproved { border-color: rgba(71, 221, 144, .28); background: rgba(23, 106, 69, .12); }
.primarySummary .metricBlocked { border-color: rgba(255, 93, 115, .25); background: rgba(116, 18, 35, .13); }
.technicalDetails {
  margin-bottom: 13px;
  border: 1px solid rgba(170, 111, 255, .14);
  border-radius: 14px;
  background: rgba(4, 3, 8, .28);
}
.technicalDetails summary {
  min-height: 44px;
  padding: 13px;
  color: #cdb4ec;
  font-size: 10px;
  font-weight: 900;
  letter-spacing: .06em;
  cursor: pointer;
}
.technicalGrid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  padding: 0 11px 11px;
}
.metricExplanation { margin: 0; padding: 0 12px 13px; color: #8d8199; font-size: 10px; line-height: 1.55; }
.systemHealth {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin: 12px 0;
}
.systemHealth > div { padding: 10px; border-radius: 11px; }
.detailNotice {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 12px 0;
  padding: 12px;
  border: 1px solid rgba(91, 180, 255, .28);
  border-radius: 13px;
  background: rgba(25, 83, 126, .15);
}
.detailNotice > div { display: flex; min-width: 0; flex-direction: column; gap: 4px; }
.detailNotice strong { color: #cfe9ff; font-size: 11px; }
.detailNotice span { color: #9bbbd2; font-size: 10px; line-height: 1.45; }
.detailNotice button {
  min-height: 42px;
  padding: 8px 11px;
  border: 1px solid rgba(128, 199, 255, .34);
  border-radius: 10px;
  background: rgba(45, 122, 181, .18);
  color: #e5f4ff;
  font-size: 9px;
  font-weight: 900;
}
.notice,
.transportError {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 12px 0 0;
  padding: 11px 12px;
  border-radius: 13px;
  font-size: 11px;
  line-height: 1.5;
}
.notice { border: 1px solid rgba(91, 180, 255, .23); background: rgba(25, 83, 126, .14); color: #b9ddff; }
.transportError { border: 1px solid rgba(255, 181, 80, .24); background: rgba(112, 68, 13, .17); color: #ffd29a; }
.notice svg,
.transportError svg { width: 16px; height: 16px; flex: 0 0 auto; }

@media (max-width: 820px) {
  .primarySummary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .technicalGrid,
  .systemHealth { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .detailNotice { align-items: stretch; flex-direction: column; }
  .detailNotice button { width: 100%; }
}

@media (max-width: 480px) {
  .card { padding-bottom: calc(max(20px, env(safe-area-inset-bottom)) + 92px); }
  .cameraBar { margin-right: -12px; padding-right: 18px; }
  .primarySummary { grid-template-columns: 1fr 1fr; }
  .technicalGrid,
  .systemHealth { grid-template-columns: 1fr 1fr; }
  .primarySummary > div { min-height: 66px; padding: 9px; }
}
'''
css_path.write_text(css, encoding="utf-8")

with (ROOT / "tests-avatar-analyzer-v4.mjs").open("a", encoding="utf-8") as handle:
    handle.write(r'''

test("Avatar Analyzer frontend separates process, detail and asset failures", () => {
  const preview = read("./components/library/AvatarAnalyzerPreview.tsx");
  const styles = read("./components/library/avatar-analyzer-preview.module.css");
  assert.match(preview, /type AnalysisProcessState/);
  assert.match(preview, /type DetailState/);
  assert.match(preview, /type AssetState/);
  assert.match(preview, /Promise\.all\(\[/);
  assert.match(preview, /DETAIL_MAX_ATTEMPTS/);
  assert.match(preview, /REINTENTAR CARGA DEL DETALLE/);
  assert.match(preview, /Incompatibilidades visuales\/técnicas/);
  assert.match(preview, /Resultado persistido/);
  assert.doesNotMatch(preview, /if \(error\) return \{ label: "ERROR TÉCNICO"/);
  assert.match(styles, /scroll-snap-type/);
  assert.match(styles, /cameraActive/);
  assert.match(styles, /safe-area-inset-bottom/);
});
''')

print("Avatar Analyzer frontend hardening applied")
