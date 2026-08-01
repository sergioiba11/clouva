"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { getLandmarkType } from "./view-model";
import type {
  AnalysisDetail,
  AnalysisSummary,
  AssignedAvatarInfo,
  JobStatus,
  LandmarkRecord,
  LatestAnalysisInfo,
} from "./types";

export type AnalysisProcessState = "idle" | "starting" | "running" | "summary_ready" | "ready" | "failed";
export type DetailState = "idle" | "loading" | "ready" | "retrying" | "temporarily_unavailable" | "failed";
export type AssetState = "idle" | "loading" | "ready" | "failed";

export function workerStateLabel(state: AnalysisProcessState) {
  if (state === "failed") return "Error";
  if (state === "starting" || state === "running") return "Ocupado";
  return "Disponible";
}

export function processStateLabel(state: AnalysisProcessState) {
  return {
    idle: "Sin iniciar",
    starting: "Iniciando",
    running: "Analizando",
    summary_ready: "Resultado persistido",
    ready: "Completado",
    failed: "Falló",
  }[state];
}

export function detailStateLabel(state: DetailState) {
  return {
    idle: "Sin solicitar",
    loading: "Cargando",
    ready: "Recuperado",
    retrying: "Reintentando",
    temporarily_unavailable: "Temporalmente no disponible",
    failed: "Falló",
  }[state];
}

export function assetStateLabel(state: AssetState) {
  return { idle: "Sin solicitar", loading: "Cargando", ready: "Recuperado", failed: "Falló" }[state];
}

type ApiErrorPayload = { error?: string; code?: string; retryable?: boolean };

const DETAIL_RETRYABLE_STATUSES = new Set([429, 502, 503]);
const DETAIL_MAX_ATTEMPTS = 5;
const JOB_POLL_INTERVAL_MS = 4000;
const JOB_POLL_TIMEOUT_MS = 20 * 60 * 1000;
const ACTIVE_JOB_KEY = "clouva.avatarAnalyzer.activeJob.v1";

type PersistedJob = { jobId: string; startedAt: number };

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function saveActiveJob(job: PersistedJob | null) {
  if (typeof window === "undefined") return;
  if (job) window.localStorage.setItem(ACTIVE_JOB_KEY, JSON.stringify(job));
  else window.localStorage.removeItem(ACTIVE_JOB_KEY);
}

function loadActiveJob(): PersistedJob | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(ACTIVE_JOB_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedJob>;
    if (!parsed.jobId || !parsed.startedAt) return null;
    return { jobId: parsed.jobId, startedAt: parsed.startedAt };
  } catch {
    return null;
  }
}

async function readApiError(response: Response): Promise<ApiErrorPayload> {
  const data = await response.json().catch(() => null) as ApiErrorPayload | null;
  return data || {
    error: `No se pudo consultar el diagnóstico (${response.status}).`,
    code: "ANALYZER_HTTP_ERROR",
    retryable: DETAIL_RETRYABLE_STATUSES.has(response.status),
  };
}

/** Fase real del pipeline (avatar_analyzer_jobs.phase), traducida a texto
 * honesto -- nunca una barra de progreso animada e independiente del job. */
export function jobPhaseLabel(phase: string | null): string | null {
  switch (phase) {
    case "provisioning":
    case "queued":
    case "starting":
      return "Preparando el motor de análisis (~1 min)…";
    case "blender":
    case "body":
      return "Fase 1/3 · Analizando el cuerpo completo";
    case "body_completed":
      return "Cuerpo listo · preparando el análisis de la cara";
    case "face":
      return "Fase 2/3 · Analizando la cara";
    case "face_completed":
      return "Cara lista · preparando el análisis de las manos";
    case "hands":
      return "Fase 3/3 · Analizando las manos";
    case "persisting":
      return "Guardando el resultado final…";
    default:
      return null;
  }
}

async function pollAnalysisJob(
  jobId: string,
  accessToken: string,
  shouldStop: () => boolean,
  onUpdate?: (job: JobStatus) => void,
): Promise<JobStatus> {
  const deadline = Date.now() + JOB_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (shouldStop()) return { status: "cancelled" };
    let response: Response;
    try {
      response = await fetch(`/api/avatar/analyze/job/${jobId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
    } catch (cause) {
      console.warn("Avatar Analyzer poll: sin red, reintentando", cause);
      await wait(JOB_POLL_INTERVAL_MS);
      continue;
    }
    const data = await response.json().catch(() => null) as (JobStatus & { error?: string }) | null;
    if (!data) {
      await wait(JOB_POLL_INTERVAL_MS);
      continue;
    }
    if (!response.ok) throw new Error(data.error || `No se pudo consultar el estado del análisis (${response.status}).`);
    if (data.status === "done" || data.status === "error" || data.status === "cancelled") return data;
    onUpdate?.(data);
    if (shouldStop()) return { status: "cancelled" };
    await wait(JOB_POLL_INTERVAL_MS);
  }
  throw new Error("El análisis está tardando demasiado y se canceló la espera en este dispositivo. Si el celular se bloqueó, esperá un momento y probá \"ABRIR ÚLTIMO ANÁLISIS\".");
}

async function requestJobCancellation(jobId: string, accessToken: string) {
  try {
    const response = await fetch(`/api/avatar/analyze/job/${jobId}/cancel`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!response.ok) {
      const data = await response.json().catch(() => null) as { error?: string } | null;
      console.error("Avatar Analyzer cancel failed", data?.error || response.status);
    }
  } catch (cause) {
    console.error("Avatar Analyzer cancel request failed", cause);
  }
}

/** Payload de corrección: nunca envía surface_click y
 * proposed_internal_position con el mismo valor. Un landmark de superficie
 * omite proposed_internal_position (el Worker ya deja el joint interno sin
 * tocar cuando ese campo falta -- ver app_v18.py:927-928). Un landmark de
 * articulación interna sí lo completa, porque es el único campo que el
 * Worker usa para reposicionarlo. */
export function buildCorrectionPayload(record: LandmarkRecord | undefined, point: number[]) {
  const isInternalJoint = getLandmarkType(record) === "internal_joint";
  return {
    surface_click: point,
    ...(isInternalJoint ? { proposed_internal_position: point } : {}),
  };
}

export function useAvatarAnalyzer() {
  const { user, session, loading: authLoading } = useAuth();
  const [analysisProcessState, setAnalysisProcessState] = useState<AnalysisProcessState>("idle");
  const [detailState, setDetailState] = useState<DetailState>("idle");
  const [assetState, setAssetState] = useState<AssetState>("idle");
  const [restoringLatest, setRestoringLatest] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const activeJobIdRef = useRef<string | null>(null);
  const cancelRequestedRef = useRef(false);
  const [jobPhase, setJobPhase] = useState<string | null>(null);
  const loadedPartialPhaseRef = useRef<string | null>(null);
  const assetLoadSeqRef = useRef(0);
  const detailLoadSeqRef = useRef(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [summary, setSummary] = useState<AnalysisSummary | null>(null);
  const [detail, setDetail] = useState<AnalysisDetail | null>(null);
  const [transportError, setTransportError] = useState<string | null>(null);
  const [workerErrorMessage, setWorkerErrorMessage] = useState<string | null>(null);
  const [persistenceNotice, setPersistenceNotice] = useState<string | null>(null);
  const [detailRetryCount, setDetailRetryCount] = useState(0);
  const [selectedName, setSelectedName] = useState("");
  const [correction, setCorrection] = useState<[string, string, string]>(["", "", ""]);
  const [savingCorrection, setSavingCorrection] = useState(false);
  const [correctionMessage, setCorrectionMessage] = useState<string | null>(null);
  const [manuallyApproved, setManuallyApproved] = useState(false);
  const [approving, setApproving] = useState(false);
  const [approveMessage, setApproveMessage] = useState<string | null>(null);
  const [assignedAvatar, setAssignedAvatar] = useState<AssignedAvatarInfo | null>(null);
  const [assignedAvatarState, setAssignedAvatarState] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const [lastAnalysisInfo, setLastAnalysisInfo] = useState<LatestAnalysisInfo | null>(null);

  const analyzing = analysisProcessState === "starting" || analysisProcessState === "running";
  const loadingDetail = detailState === "loading" || detailState === "retrying";

  const landmarks = useMemo(() => detail?.analysis.landmarks || {}, [detail]);
  const rejectedEntries = useMemo(() => Object.entries(detail?.rejectedLandmarks || {}), [detail]);
  const acceptedEntries = useMemo(() => Object.entries(detail?.acceptedLandmarks || {}), [detail]);
  const selectedRecord = landmarks[selectedName];
  const effectiveSummary = detail?.summary || summary;
  const coverage = detail?.analysis.detectionCoverage || effectiveSummary?.detectionCoverage || {};
  const subsystems = Object.entries(detail?.analysis.bodySubsystems || {});
  const warnings = detail?.analysis.warnings || [];

  useEffect(() => {
    setManuallyApproved(Boolean((detail?.summary as unknown as { manuallyApproved?: boolean })?.manuallyApproved));
  }, [detail]);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const selectLandmark = (name: string) => {
    setSelectedName(name);
    const record = landmarks[name];
    const position = record?.surfaceDisplayPosition || record?.displayPosition || record?.internalJointPosition || record?.position;
    setCorrection(Array.isArray(position) && position.length === 3
      ? position.map((value) => String(value)) as [string, string, string]
      : ["", "", ""]);
    setCorrectionMessage(null);
  };

  const loadAsset = async (runId: string, accessToken: string) => {
    const seq = ++assetLoadSeqRef.current;
    setAssetState("loading");
    try {
      const assetResponse = await fetch(
        `/api/avatar/analyze/result/${runId}/asset/diagnostic_surface.glb`,
        { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" },
      );
      if (assetLoadSeqRef.current !== seq) return false;
      if (!assetResponse.ok) throw new Error("El análisis terminó, pero no se pudo abrir su GLB diagnóstico.");
      const blob = await assetResponse.blob();
      if (assetLoadSeqRef.current !== seq) return false;
      if (blob.size < 1024) throw new Error("El diagnóstico llegó vacío.");
      const nextUrl = URL.createObjectURL(blob);
      setPreviewUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return nextUrl;
      });
      setAssetState("ready");
      return true;
    } catch (cause) {
      if (assetLoadSeqRef.current !== seq) return false;
      setAssetState("failed");
      setTransportError(cause instanceof Error ? cause.message : "No se pudo recuperar el GLB diagnóstico.");
      return false;
    }
  };

  const loadDetail = async (runId: string, accessToken: string, manualRetry = false) => {
    const seq = ++detailLoadSeqRef.current;
    setDetailState(manualRetry ? "retrying" : "loading");
    setPersistenceNotice(null);
    setDetailRetryCount(0);
    for (let attempt = 0; attempt < DETAIL_MAX_ATTEMPTS; attempt += 1) {
      try {
        const response = await fetch(`/api/avatar/analyze/result/${runId}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: "no-store",
        });
        if (detailLoadSeqRef.current !== seq) return false;
        if (response.ok) {
          const data = await response.json().catch(() => null) as AnalysisDetail | null;
          if (detailLoadSeqRef.current !== seq) return false;
          if (!data?.analysis || !data.summary) throw new Error("El diagnóstico llegó incompleto.");
          setDetail(data);
          setSummary(data.summary);
          setDetailState("ready");
          setTransportError(null);
          setPersistenceNotice(null);
          return true;
        }
        const apiError = await readApiError(response);
        const retryable = apiError.retryable || DETAIL_RETRYABLE_STATUSES.has(response.status);
        if (detailLoadSeqRef.current !== seq) return false;
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
        if (detailLoadSeqRef.current !== seq) return false;
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
    if (detailLoadSeqRef.current !== seq) return false;
    setDetailState("temporarily_unavailable");
    setPersistenceNotice("El análisis está completo, pero el detalle continúa temporalmente inaccesible.");
    return false;
  };

  const runJob = async (jobId: string, startedAt: number = Date.now()) => {
    if (!session?.access_token) return;
    const accessToken = session.access_token;
    activeJobIdRef.current = jobId;
    saveActiveJob({ jobId, startedAt });
    setAnalysisProcessState("running");
    setWorkerErrorMessage(null);
    setJobPhase(null);
    loadedPartialPhaseRef.current = null;
    let terminal = false;
    try {
      if (cancelRequestedRef.current) {
        terminal = true;
        setAnalysisProcessState("idle");
        void requestJobCancellation(jobId, accessToken);
        return;
      }
      const job = await pollAnalysisJob(jobId, accessToken, () => cancelRequestedRef.current, (update) => {
        if (activeJobIdRef.current !== jobId) return;
        setJobPhase(update.phase ?? null);
        const partialPhase = update.phase === "body_completed" || update.phase === "face"
          ? "body"
          : update.phase === "face_completed" || update.phase === "hands"
            ? "face"
            : null;
        if (partialPhase && update.runId && loadedPartialPhaseRef.current !== partialPhase) {
          loadedPartialPhaseRef.current = partialPhase;
          if (update.summary) setSummary(update.summary);
          void loadAsset(update.runId, accessToken);
          void loadDetail(update.runId, accessToken);
        }
      });
      if (activeJobIdRef.current !== jobId) return;
      setJobPhase(null);
      if (job.status === "cancelled") {
        terminal = true;
        setAnalysisProcessState("idle");
        setWorkerErrorMessage(null);
        return;
      }
      if (job.status === "error" || !job.runId) {
        terminal = true;
        setAnalysisProcessState("failed");
        setWorkerErrorMessage(job.detail || "El Worker no pudo completar el análisis.");
        return;
      }
      terminal = true;
      setSummary(job.summary ?? null);
      setAnalysisProcessState("summary_ready");
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
      if (activeJobIdRef.current === jobId) activeJobIdRef.current = null;
    }
  };

  const cancelAnalysis = () => {
    if (cancelRequestedRef.current) return;
    cancelRequestedRef.current = true;
    setCancelling(true);
    setAnalysisProcessState("idle");
    setWorkerErrorMessage(null);
    setPersistenceNotice(null);
    setJobPhase(null);
    saveActiveJob(null);
    const jobId = activeJobIdRef.current;
    const accessToken = session?.access_token;
    if (jobId && accessToken) {
      void requestJobCancellation(jobId, accessToken).finally(() => setCancelling(false));
    } else {
      setCancelling(false);
    }
  };

  const analyze = async (requestedRigProfile = "FULL_BODY_HANDS_FACE") => {
    if (!session?.access_token) return;
    cancelRequestedRef.current = false;
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
    setManuallyApproved(false);
    setApproveMessage(null);
    try {
      const kickoff = await fetch("/api/avatar/analyze", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ requested_rig_profile: requestedRigProfile }),
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

  const identityLoadedRef = useRef(false);
  useEffect(() => {
    if (identityLoadedRef.current) return;
    if (authLoading || !session?.access_token) return;
    identityLoadedRef.current = true;
    setAssignedAvatarState("loading");
    fetch("/api/avatar/analyze/latest", {
      headers: { Authorization: `Bearer ${session.access_token}` },
      cache: "no-store",
    })
      .then((response) => response.json())
      .then((data: LatestAnalysisInfo) => {
        setAssignedAvatar(data.avatar ?? null);
        setLastAnalysisInfo(data);
        setAssignedAvatarState("ready");
      })
      .catch((cause) => {
        console.error("Avatar Analyzer identity fetch failed", cause);
        setAssignedAvatarState("failed");
      });
  }, [authLoading, session?.access_token]);

  const resumeAttemptedRef = useRef(false);
  useEffect(() => {
    if (resumeAttemptedRef.current) return;
    if (authLoading || !session?.access_token) return;
    resumeAttemptedRef.current = true;
    const pending = loadActiveJob();
    if (!pending) return;
    if (Date.now() - pending.startedAt >= JOB_POLL_TIMEOUT_MS) return;
    cancelRequestedRef.current = false;
    void runJob(pending.jobId, pending.startedAt).catch((cause) => {
      console.error("Avatar Analyzer resume failed", cause);
      setAnalysisProcessState("failed");
      setWorkerErrorMessage(cause instanceof Error ? cause.message : "No se pudo retomar el análisis anterior.");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, session?.access_token]);

  const restoreLatest = async () => {
    if (!session?.access_token) return;
    cancelRequestedRef.current = false;
    setRestoringLatest(true);
    setTransportError(null);
    setWorkerErrorMessage(null);
    try {
      const authorization = { Authorization: `Bearer ${session.access_token}` };
      const latestResponse = await fetch("/api/avatar/analyze/latest", {
        headers: authorization,
        cache: "no-store",
      });
      const latest = await latestResponse.json() as LatestAnalysisInfo;
      if (!latestResponse.ok) throw new Error(latest.error || "No se pudo buscar el último análisis.");
      setAssignedAvatar(latest.avatar ?? null);
      setLastAnalysisInfo(latest);
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
      setSummary(latest.summary ?? null);
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

  const saveCorrection = async (point?: number[]) => {
    if (!effectiveSummary?.runId || !session?.access_token || !selectedName) return;
    const parsed = point ?? correction.map(Number);
    if (parsed.some((value) => !Number.isFinite(value))) {
      setCorrectionMessage("Ingresá tres coordenadas numéricas válidas o seleccioná el punto sobre el avatar.");
      return;
    }
    setSavingCorrection(true);
    setCorrectionMessage(null);
    try {
      const positional = buildCorrectionPayload(selectedRecord, parsed);
      const response = await fetch(
        `/api/avatar/analyze/result/${effectiveSummary.runId}/corrections`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            requested_rig_profile: "BODY_BASIC",
            corrections: [{
              name: selectedName,
              ...positional,
              approved: true,
              note: "Corrección manual desde Biblioteca CLOUVA",
            }],
          }),
        },
      );
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "No se pudo guardar la corrección.");
      setCorrectionMessage("Corrección guardada por separado. El análisis automático original no fue modificado.");
    } catch (cause) {
      setCorrectionMessage(cause instanceof Error ? cause.message : "No se pudo guardar la corrección.");
    } finally {
      setSavingCorrection(false);
    }
  };

  /** Confirmación manual: se persiste en la columna `summary` (jsonb) que ya
   * existe en avatar_analyzer_jobs -- no se crea ninguna tabla ni columna
   * nueva. Ver app/api/avatar/analyze/result/[runId]/approve/route.ts */
  const approveAnalysis = async () => {
    if (!effectiveSummary?.runId || !session?.access_token) return;
    setApproving(true);
    setApproveMessage(null);
    try {
      const response = await fetch(`/api/avatar/analyze/result/${effectiveSummary.runId}/approve`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: "no-store",
      });
      const data = await response.json() as { error?: string; manuallyApproved?: boolean };
      if (!response.ok) throw new Error(data.error || "No se pudo registrar la confirmación.");
      setManuallyApproved(Boolean(data.manuallyApproved));
      setApproveMessage("Confirmación registrada. El análisis queda listo para el siguiente paso.");
    } catch (cause) {
      setApproveMessage(cause instanceof Error ? cause.message : "No se pudo registrar la confirmación.");
    } finally {
      setApproving(false);
    }
  };

  return {
    user,
    session,
    authLoading,
    analysisProcessState,
    detailState,
    assetState,
    analyzing,
    loadingDetail,
    restoringLatest,
    cancelling,
    jobPhase,
    previewUrl,
    summary,
    detail,
    effectiveSummary,
    transportError,
    workerErrorMessage,
    persistenceNotice,
    detailRetryCount,
    landmarks,
    rejectedEntries,
    acceptedEntries,
    coverage,
    subsystems,
    warnings,
    selectedName,
    selectedRecord,
    correction,
    setCorrection,
    savingCorrection,
    correctionMessage,
    assignedAvatar,
    assignedAvatarState,
    lastAnalysisInfo,
    manuallyApproved,
    approving,
    approveMessage,
    selectLandmark,
    analyze,
    cancelAnalysis,
    restoreLatest,
    retryDetail,
    saveCorrection,
    approveAnalysis,
  };
}

export type UseAvatarAnalyzer = ReturnType<typeof useAvatarAnalyzer>;
