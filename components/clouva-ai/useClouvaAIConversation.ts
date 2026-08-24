"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import {
  CLOUVA_AI_MODE_STORAGE_KEY,
  DEFAULT_CLOUVA_AI_MODE,
  endpointForClouvaAIMode,
  normalizeClouvaAIMode,
  projectAccessLabel,
  type ClouvaAIMode,
} from "@/lib/clouva-ai/project-access";
import {
  buildImageGenerationRequest,
  type ImageGenerationIntent,
} from "@/lib/clouva-ai/image-generation-intent";
import {
  CLOUVA_AI_START_VOICE_EVENT,
  routeClouvaIntent,
} from "@/lib/clouva-ai/engine-router";
import type { VideoGenerationIntent } from "@/lib/clouva-ai/video-generation-intent";
import {
  buildRetryImageRequest,
  CLOUVA_AI_RETRY_IMAGE_EVENT,
  imageGenerationErrorCopy,
  shouldAutoRetryImageGeneration,
  type RetryableImageRequest,
} from "@/lib/clouva-ai/image-generation-retry";
import { createImageJob, createVideoJob, waitForMediaJob } from "@/lib/media-generation-client";
import {
  estimateVideoCostUsd,
  type ImageAspectRatio,
  type ImageQuality,
  type VideoAspectRatio,
  type VideoDuration,
  type VideoQuality,
} from "@/lib/media-generation-config";
import type { MediaJob, MediaStatus } from "@/components/media-creator/types";
import { supabase } from "@/lib/supabase";

export type ClouvaAIMediaAttachment = {
  requestId: string;
  jobId: string | null;
  type: "image" | "video";
  status: "preparing" | MediaStatus;
  prompt: string;
  aspectRatio: ImageAspectRatio | VideoAspectRatio;
  quality: ImageQuality | VideoQuality;
  durationSeconds?: VideoDuration | null;
  estimatedCostUsd?: number | null;
  outputUrl: string | null;
  error: string | null;
  technicalError?: string | null;
  referenceUrl?: string | null;
  referenceStoragePath?: string | null;
  autoRetryCount?: number;
};

export type ClouvaAIMessage = {
  role: "user" | "assistant";
  content: string;
  mediaJob?: ClouvaAIMediaAttachment;
};

export type ClouvaAIPendingAction = {
  type: "write_file";
  path: string;
  content: string;
  message: string;
  summary: string;
};

type ApiPayload = {
  reply?: string;
  message?: string;
  model?: string;
  pendingAction?: ClouvaAIPendingAction | null;
  analysisScope?: "status" | "explicit" | "broad";
  coverageAreas?: string[];
  filesReviewed?: string[];
  error?: string;
};

type StoredMessage = {
  role: "user" | "assistant";
  content: string;
  metadata?: Record<string, unknown> | null;
};

export type ClouvaAIConversationSummary = { id: string; title: string | null; created_at: string };
export type ClouvaAIProjectReport = {
  scope: "status" | "explicit" | "broad";
  coverageAreas: string[];
  filesReviewed: string[];
};
export type ClouvaAIProjectAccessState = "checking" | "connected" | "unavailable" | "signed_out";
export type ClouvaAIProjectAccess = {
  state: ClouvaAIProjectAccessState;
  repository: string | null;
  branch: string | null;
  message: string | null;
  checkedAt: number | null;
};
type ProjectStatusPayload = {
  ok?: boolean;
  status?: { connected?: boolean; repository?: string; branch?: string };
  error?: string;
};

type ClouvaAIImageGenerationRequest = ImageGenerationIntent & {
  referenceUrl?: string | null;
  referenceStoragePath?: string | null;
};

type ClouvaAIVideoGenerationRequest = VideoGenerationIntent & {
  referenceUrl?: string | null;
  referenceStoragePath?: string | null;
};

export const CLOUVA_AI_WELCOME =
  "Soy Trébol — CLOUVA AI. Proyecto queda listo para investigar el repositorio real mientras tu sesión autorizada siga activa.";

const INITIAL_PROJECT_ACCESS: ClouvaAIProjectAccess = {
  state: "checking",
  repository: null,
  branch: null,
  message: null,
  checkedAt: null,
};

function restoredMediaAttachment(metadata?: Record<string, unknown> | null) {
  const candidate = metadata?.mediaJob;
  if (!candidate || typeof candidate !== "object") return undefined;
  const media = candidate as Partial<ClouvaAIMediaAttachment>;
  if ((media.type !== "image" && media.type !== "video") || typeof media.requestId !== "string" || typeof media.prompt !== "string") return undefined;
  return media as ClouvaAIMediaAttachment;
}

function deduplicate(messages: StoredMessage[]) {
  return messages.filter((message, index) => {
    if (index === 0) return true;
    const previous = messages[index - 1];
    const currentMedia = restoredMediaAttachment(message.metadata)?.requestId;
    const previousMedia = restoredMediaAttachment(previous.metadata)?.requestId;
    return previous.role !== message.role || previous.content !== message.content || previousMedia !== currentMedia;
  });
}

function imageAttachmentFromJob(
  requestId: string,
  job: MediaJob,
  request: ClouvaAIImageGenerationRequest,
  autoRetryCount = 0,
): ClouvaAIMediaAttachment {
  const errorCopy = job.error ? imageGenerationErrorCopy(job.error) : null;
  return {
    requestId,
    jobId: job.id,
    type: "image",
    status: job.status,
    prompt: job.prompt,
    aspectRatio: job.aspectRatio as ImageAspectRatio,
    quality: job.quality as ImageQuality,
    outputUrl: job.outputUrl,
    error: errorCopy?.message ?? null,
    technicalError: errorCopy?.detail ?? null,
    referenceUrl: job.referenceUrl ?? request.referenceUrl ?? null,
    referenceStoragePath: request.referenceStoragePath ?? null,
    autoRetryCount,
  };
}

function pendingImageAttachment(requestId: string, request: ClouvaAIImageGenerationRequest, autoRetryCount = 0): ClouvaAIMediaAttachment {
  return {
    requestId,
    jobId: null,
    type: "image",
    status: "preparing",
    prompt: request.prompt,
    aspectRatio: request.aspectRatio,
    quality: request.quality,
    outputUrl: null,
    error: null,
    technicalError: null,
    referenceUrl: request.referenceUrl ?? null,
    referenceStoragePath: request.referenceStoragePath ?? null,
    autoRetryCount,
  };
}

function failedImageAttachment(
  base: ClouvaAIMediaAttachment,
  failure: string,
  autoRetryCount: number,
): ClouvaAIMediaAttachment {
  const copy = imageGenerationErrorCopy(failure);
  return {
    ...base,
    status: "failed",
    error: copy.message,
    technicalError: copy.detail,
    autoRetryCount,
  };
}

function videoAttachmentFromJob(
  requestId: string,
  job: MediaJob,
  request: ClouvaAIVideoGenerationRequest,
): ClouvaAIMediaAttachment {
  return {
    requestId,
    jobId: job.id,
    type: "video",
    status: job.status,
    prompt: job.prompt,
    aspectRatio: job.aspectRatio as VideoAspectRatio,
    quality: job.quality as VideoQuality,
    durationSeconds: (job.durationSeconds ?? request.durationSeconds) as VideoDuration,
    estimatedCostUsd: job.estimatedCostUsd ?? estimateVideoCostUsd(request.quality, request.durationSeconds),
    outputUrl: job.outputUrl,
    error: job.error ?? null,
    technicalError: job.error ?? null,
    referenceUrl: job.referenceUrl ?? request.referenceUrl ?? null,
    referenceStoragePath: request.referenceStoragePath ?? null,
  };
}

function pendingVideoAttachment(requestId: string, request: ClouvaAIVideoGenerationRequest): ClouvaAIMediaAttachment {
  return {
    requestId,
    jobId: null,
    type: "video",
    status: "preparing",
    prompt: request.prompt,
    aspectRatio: request.aspectRatio,
    quality: request.quality,
    durationSeconds: request.durationSeconds,
    estimatedCostUsd: estimateVideoCostUsd(request.quality, request.durationSeconds),
    outputUrl: null,
    error: null,
    technicalError: null,
    referenceUrl: request.referenceUrl ?? null,
    referenceStoragePath: request.referenceStoragePath ?? null,
  };
}

function failedVideoAttachment(base: ClouvaAIMediaAttachment, failure: string): ClouvaAIMediaAttachment {
  return { ...base, status: "failed", error: failure, technicalError: failure };
}

function isTerminalFailure(status: ClouvaAIMediaAttachment["status"]) {
  return status === "failed" || status === "storage_failed" || status === "cancelled";
}

export function useClouvaAIConversation() {
  const [messages, setMessages] = useState<ClouvaAIMessage[]>([]);
  const [conversations, setConversations] = useState<ClouvaAIConversationSummary[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<ClouvaAIMode>(DEFAULT_CLOUVA_AI_MODE);
  const [projectAccess, setProjectAccess] = useState<ClouvaAIProjectAccess>(INITIAL_PROJECT_ACCESS);
  const [projectReport, setProjectReport] = useState<ClouvaAIProjectReport | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [loading, setLoading] = useState(false);
  const [mediaGenerating, setMediaGenerating] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeModel, setActiveModel] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<ClouvaAIPendingAction | null>(null);
  const projectCheckIdRef = useRef(0);
  const retryHandlerRef = useRef<(request: RetryableImageRequest) => void>(() => undefined);

  useEffect(() => {
    const storedMode = normalizeClouvaAIMode(window.localStorage.getItem(CLOUVA_AI_MODE_STORAGE_KEY));
    setMode(storedMode);
    void loadConversationHistory();
    void refreshProjectAccess();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        setProjectAccess({
          state: "signed_out",
          repository: null,
          branch: null,
          message: "Iniciá sesión para activar Proyecto",
          checkedAt: Date.now(),
        });
        return;
      }
      void refreshProjectAccess(session.access_token);
    });

    return () => subscription.unsubscribe();
    // The controller owns the canonical initial load and auth subscription.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<RetryableImageRequest>).detail;
      if (!detail || typeof detail.prompt !== "string" || !detail.prompt.trim()) return;
      retryHandlerRef.current(buildRetryImageRequest(detail));
    };
    window.addEventListener(CLOUVA_AI_RETRY_IMAGE_EVENT, handler);
    return () => window.removeEventListener(CLOUVA_AI_RETRY_IMAGE_EVENT, handler);
  }, []);

  async function getSession() {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw new Error("Iniciá sesión en CLOUVA.");
    return data.session;
  }

  async function refreshProjectAccess(accessToken?: string): Promise<boolean> {
    const checkId = ++projectCheckIdRef.current;
    setProjectAccess((current) => ({ ...current, state: "checking", message: null }));

    try {
      let token = accessToken;
      if (!token) {
        const { data } = await supabase.auth.getSession();
        token = data.session?.access_token;
      }
      if (!token) {
        if (projectCheckIdRef.current === checkId) {
          setProjectAccess({ state: "signed_out", repository: null, branch: null, message: "Iniciá sesión para activar Proyecto", checkedAt: Date.now() });
        }
        return false;
      }

      const response = await fetch("/api/clouva-ai/github", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => ({}))) as ProjectStatusPayload;
      if (!response.ok || !payload.status?.connected) throw new Error(payload.error || "GitHub no confirmó el acceso al repositorio.");

      if (projectCheckIdRef.current === checkId) {
        setProjectAccess({
          state: "connected",
          repository: payload.status.repository || "sergioiba11/clouva",
          branch: payload.status.branch || "main",
          message: null,
          checkedAt: Date.now(),
        });
      }
      return true;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "No se pudo verificar el acceso a GitHub.";
      if (projectCheckIdRef.current === checkId) {
        setProjectAccess({ state: "unavailable", repository: null, branch: null, message, checkedAt: Date.now() });
      }
      return false;
    }
  }

  function changeMode(nextMode: ClouvaAIMode) {
    setMode(nextMode);
    window.localStorage.setItem(CLOUVA_AI_MODE_STORAGE_KEY, nextMode);
    setError(null);
    if (nextMode === "project" && projectAccess.state !== "connected") void refreshProjectAccess();
  }

  async function loadMessages(id: string) {
    const { data, error: messagesError } = await supabase
      .from("ai_messages")
      .select("role,content,metadata,created_at")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true });
    if (messagesError) throw messagesError;
    const restored = deduplicate((data ?? []) as StoredMessage[]);
    setConversationId(id);
    setMessages(restored.length ? restored.map(({ role, content, metadata }) => ({ role, content, mediaJob: restoredMediaAttachment(metadata) })) : [{ role: "assistant", content: CLOUVA_AI_WELCOME }]);
  }

  async function loadConversationHistory() {
    setLoadingHistory(true);
    setError(null);
    try {
      await getSession();
      const { data, error: conversationError } = await supabase
        .from("ai_conversations")
        .select("id,title,created_at")
        .eq("project_key", "clouva")
        .order("created_at", { ascending: false })
        .limit(24);
      if (conversationError) throw conversationError;
      const recent = (data ?? []) as ClouvaAIConversationSummary[];
      setConversations(recent);
      const activeConversationId = conversationId && recent.some((item) => item.id === conversationId)
        ? conversationId
        : null;
      if (activeConversationId) {
        await loadMessages(activeConversationId);
      } else {
        setConversationId(null);
        setMessages([{ role: "assistant", content: CLOUVA_AI_WELCOME }]);
      }
    } catch (caught) {
      setConversationId(null);
      setMessages([{ role: "assistant", content: CLOUVA_AI_WELCOME }]);
      setError(caught instanceof Error ? caught.message : "No se pudo cargar el historial.");
    } finally {
      setLoadingHistory(false);
    }
  }

  async function openConversation(id: string) {
    if (id === conversationId || loading || applying || mediaGenerating) return;
    setLoadingHistory(true);
    setError(null);
    setPendingAction(null);
    setProjectReport(null);
    try {
      await getSession();
      await loadMessages(id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo abrir la conversación.");
    } finally {
      setLoadingHistory(false);
    }
  }

  async function ensureConversation(userId: string, title: string) {
    if (conversationId) return conversationId;
    const { data, error: insertError } = await supabase
      .from("ai_conversations")
      .insert({ user_id: userId, project_key: "clouva", title: title.slice(0, 72) })
      .select("id,title,created_at")
      .single();
    if (insertError || !data) throw new Error(insertError?.message ?? "No se pudo crear la conversación.");
    const created = data as ClouvaAIConversationSummary;
    setConversationId(created.id);
    setConversations((current) => [created, ...current.filter((item) => item.id !== created.id)]);
    return created.id;
  }

  async function saveMessage(id: string, userId: string, role: "user" | "assistant", content: string, metadata: Record<string, unknown> = {}) {
    const { error: insertError } = await supabase.from("ai_messages").insert({ conversation_id: id, user_id: userId, role, content, metadata });
    if (insertError) throw new Error(insertError.message);
  }

  function replaceMediaAttachment(requestId: string, mediaJob: ClouvaAIMediaAttachment) {
    setMessages((current) => current.map((message) => message.mediaJob?.requestId === requestId ? { ...message, mediaJob } : message));
  }

  async function executeImageGeneration(
    requestId: string,
    request: ClouvaAIImageGenerationRequest,
    baseMedia: ClouvaAIMediaAttachment,
  ) {
    let autoRetryCount = 0;

    while (true) {
      try {
        const created = await createImageJob({
          prompt: request.prompt,
          aspectRatio: request.aspectRatio,
          quality: request.quality,
          referenceUrl: request.referenceUrl ?? null,
          referenceStoragePath: request.referenceStoragePath ?? null,
        });
        let job = created.job;
        replaceMediaAttachment(requestId, imageAttachmentFromJob(requestId, job, request, autoRetryCount));

        job = await waitForMediaJob(job, {
          onUpdate: (updated) => replaceMediaAttachment(requestId, imageAttachmentFromJob(requestId, updated, request, autoRetryCount)),
        });

        if (isTerminalFailure(job.status) && shouldAutoRetryImageGeneration(job.error, autoRetryCount)) {
          autoRetryCount += 1;
          replaceMediaAttachment(requestId, pendingImageAttachment(requestId, request, autoRetryCount));
          continue;
        }

        return imageAttachmentFromJob(requestId, job, request, autoRetryCount);
      } catch (caught) {
        const failure = caught instanceof Error ? caught.message : "No se pudo generar la imagen.";
        if (shouldAutoRetryImageGeneration(failure, autoRetryCount)) {
          autoRetryCount += 1;
          replaceMediaAttachment(requestId, pendingImageAttachment(requestId, request, autoRetryCount));
          continue;
        }
        return failedImageAttachment(baseMedia, failure, autoRetryCount);
      }
    }
  }

  async function runImageGeneration(message: string, request: ClouvaAIImageGenerationRequest) {
    if (loading || applying || mediaGenerating) return;
    const cleanMessage = message.trim();
    if (!cleanMessage) {
      setError("Escribí primero lo que querés crear.");
      return;
    }

    const requestId = crypto.randomUUID();
    const assistantText = "Listo. Voy a crear una imagen con este concepto.";
    const pendingMedia = pendingImageAttachment(requestId, request);

    setInput("");
    setError(null);
    setPendingAction(null);
    setMediaGenerating(true);
    setMessages((current) => [
      ...current,
      { role: "user", content: cleanMessage },
      { role: "assistant", content: assistantText, mediaJob: pendingMedia },
    ]);

    let activeConversationId: string | null = null;
    let userId: string | null = null;
    try {
      const session = await getSession();
      userId = session.user.id;
      activeConversationId = await ensureConversation(session.user.id, cleanMessage);
      await saveMessage(activeConversationId, session.user.id, "user", cleanMessage, {
        provider: "clouva-media",
        mode: "chat",
        action: "generate_image",
      });

      const finalMedia = await executeImageGeneration(requestId, request, pendingMedia);
      replaceMediaAttachment(requestId, finalMedia);
      await saveMessage(activeConversationId, session.user.id, "assistant", assistantText, {
        provider: "clouva-media",
        mode: "chat",
        action: "generate_image",
        mediaJob: finalMedia,
      });

      if (isTerminalFailure(finalMedia.status)) {
        setError(finalMedia.error || "La generación no pudo completarse.");
      }
    } catch (caught) {
      const failure = caught instanceof Error ? caught.message : "No se pudo generar la imagen.";
      const failedMedia = failedImageAttachment(pendingMedia, failure, pendingMedia.autoRetryCount ?? 0);
      replaceMediaAttachment(requestId, failedMedia);
      setError(failedMedia.error);
      if (activeConversationId && userId) {
        try {
          await saveMessage(activeConversationId, userId, "assistant", assistantText, {
            provider: "clouva-media",
            mode: "chat",
            action: "generate_image",
            mediaJob: failedMedia,
          });
        } catch {
          // The live chat still keeps the failed card even if persistence is unavailable.
        }
      }
    } finally {
      setMediaGenerating(false);
    }
  }

  async function runVideoGeneration(message: string, request: ClouvaAIVideoGenerationRequest) {
    if (loading || applying || mediaGenerating) return;
    const cleanMessage = message.trim();
    if (!cleanMessage) {
      setError("Escribí primero lo que querés crear.");
      return;
    }

    const estimatedCostUsd = estimateVideoCostUsd(request.quality, request.durationSeconds);
    const confirmed = window.confirm(
      `Generar este video de ${request.durationSeconds} s con Veo tiene un costo estimado de USD ${estimatedCostUsd.toFixed(2)}. ¿Querés continuar?`,
    );
    if (!confirmed) return;

    const requestId = crypto.randomUUID();
    const assistantText = "Listo. Voy a crear el video con Veo y te lo devuelvo acá mismo.";
    const pendingMedia = pendingVideoAttachment(requestId, request);

    setInput("");
    setError(null);
    setPendingAction(null);
    setMediaGenerating(true);
    setMessages((current) => [
      ...current,
      { role: "user", content: cleanMessage },
      { role: "assistant", content: assistantText, mediaJob: pendingMedia },
    ]);

    let activeConversationId: string | null = null;
    let userId: string | null = null;
    try {
      const session = await getSession();
      userId = session.user.id;
      activeConversationId = await ensureConversation(session.user.id, cleanMessage);
      await saveMessage(activeConversationId, session.user.id, "user", cleanMessage, {
        provider: "clouva-media",
        mode: "chat",
        action: "generate_video",
        estimatedCostUsd,
      });

      const created = await createVideoJob({
        prompt: request.prompt,
        aspectRatio: request.aspectRatio,
        quality: request.quality,
        durationSeconds: request.durationSeconds,
        referenceUrl: request.referenceUrl ?? null,
        referenceStoragePath: request.referenceStoragePath ?? null,
        confirmedCostUsd: estimatedCostUsd,
      });
      let job = created.job;
      replaceMediaAttachment(requestId, videoAttachmentFromJob(requestId, job, request));
      job = await waitForMediaJob(job, {
        intervalMs: 5_000,
        timeoutMs: 12 * 60_000,
        onUpdate: (updated) => replaceMediaAttachment(requestId, videoAttachmentFromJob(requestId, updated, request)),
      });

      const finalMedia = videoAttachmentFromJob(requestId, job, request);
      replaceMediaAttachment(requestId, finalMedia);
      await saveMessage(activeConversationId, session.user.id, "assistant", assistantText, {
        provider: "clouva-media",
        mode: "chat",
        action: "generate_video",
        mediaJob: finalMedia,
      });
      if (isTerminalFailure(finalMedia.status)) setError(finalMedia.error || "El video no pudo completarse.");
    } catch (caught) {
      const failure = caught instanceof Error ? caught.message : "No se pudo generar el video.";
      const failedMedia = failedVideoAttachment(pendingMedia, failure);
      replaceMediaAttachment(requestId, failedMedia);
      setError(failure);
      if (activeConversationId && userId) {
        try {
          await saveMessage(activeConversationId, userId, "assistant", assistantText, {
            provider: "clouva-media",
            mode: "chat",
            action: "generate_video",
            mediaJob: failedMedia,
          });
        } catch {
          // Keep the live failed card even if persistence is unavailable.
        }
      }
    } finally {
      setMediaGenerating(false);
    }
  }

  async function retryImageGeneration(request: RetryableImageRequest) {
    if (loading || applying || mediaGenerating) return;
    const normalized = buildRetryImageRequest(request) as ClouvaAIImageGenerationRequest;
    const requestId = crypto.randomUUID();
    const assistantText = "Reintentando la generación con el mismo concepto.";
    const pendingMedia = pendingImageAttachment(requestId, normalized);

    setError(null);
    setPendingAction(null);
    setMediaGenerating(true);
    setMessages((current) => [...current, { role: "assistant", content: assistantText, mediaJob: pendingMedia }]);

    try {
      const session = await getSession();
      const activeConversationId = await ensureConversation(session.user.id, normalized.prompt);
      const finalMedia = await executeImageGeneration(requestId, normalized, pendingMedia);
      replaceMediaAttachment(requestId, finalMedia);
      await saveMessage(activeConversationId, session.user.id, "assistant", assistantText, {
        provider: "clouva-media",
        mode: "chat",
        action: "retry_image",
        mediaJob: finalMedia,
      });

      if (isTerminalFailure(finalMedia.status)) {
        setError(finalMedia.error || "La generación no pudo completarse.");
      }
    } catch (caught) {
      const failure = caught instanceof Error ? caught.message : "No se pudo reintentar la imagen.";
      const failedMedia = failedImageAttachment(pendingMedia, failure, pendingMedia.autoRetryCount ?? 0);
      replaceMediaAttachment(requestId, failedMedia);
      setError(failedMedia.error);
    } finally {
      setMediaGenerating(false);
    }
  }

  retryHandlerRef.current = (request) => {
    void retryImageGeneration(request);
  };

  async function generateImageFromInput() {
    const message = input.trim();
    if (!message) {
      setError("Escribí primero lo que querés crear.");
      return;
    }
    await runImageGeneration(message, buildImageGenerationRequest(message));
  }

  async function sendMessage(event?: FormEvent) {
    event?.preventDefault();
    const message = input.trim();
    if (!message || loading || applying || mediaGenerating) return;

    if (mode === "chat") {
      const intent = routeClouvaIntent(message);
      console.info("AI_INTENT_DETECTED", { engine: intent.engine, action: intent.action, confidence: intent.confidence });
      if (intent.engine === "image") {
        console.info("AI_ENGINE_SELECTED", { engine: "image" });
        await runImageGeneration(message, intent.payload);
        return;
      }
      if (intent.engine === "video") {
        console.info("AI_ENGINE_SELECTED", { engine: "video" });
        await runVideoGeneration(message, intent.payload);
        return;
      }
      if (intent.engine === "voice") {
        console.info("AI_ENGINE_SELECTED", { engine: "voice" });
        setInput("");
        window.dispatchEvent(new Event(CLOUVA_AI_START_VOICE_EVENT));
        return;
      }
      console.info("AI_ENGINE_SELECTED", { engine: "text" });
    }

    const previousMessages = messages;
    setInput("");
    setError(null);
    setPendingAction(null);
    setLoading(true);
    setMessages((current) => [...current, { role: "user", content: message }]);

    try {
      const session = await getSession();
      if (mode === "project" && projectAccess.state !== "connected") {
        const connected = await refreshProjectAccess(session.access_token);
        if (!connected) throw new Error("Proyecto no pudo acceder a GitHub. Revisá la sesión o la conexión y reintentá.");
      }

      const endpoint = endpointForClouvaAIMode(mode);
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), mode === "project" ? 60_000 : 38_000);
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(mode === "project" ? { Authorization: `Bearer ${session.access_token}` } : {}) },
        body: JSON.stringify({
          message,
          history: previousMessages.slice(-8).map(({ role, content }) => ({ role, content })),
          ...(mode === "project" ? { screenContext: {
            page: window.location.pathname,
            url: window.location.href,
            capturedAt: new Date().toISOString(),
            repository: projectAccess.repository || "sergioiba11/clouva",
            branch: projectAccess.branch || "main",
          } } : {}),
        }),
        signal: controller.signal,
        cache: "no-store",
      }).finally(() => window.clearTimeout(timeout));

      const payload = (await response.json().catch(() => ({}))) as ApiPayload;
      if (!response.ok) throw new Error(payload.error ?? "CLOUVA AI no respondió.");
      const answer = mode === "project" ? payload.message : payload.reply;
      if (!answer) throw new Error("CLOUVA AI respondió sin contenido.");

      const activeConversationId = await ensureConversation(session.user.id, message);
      await saveMessage(activeConversationId, session.user.id, "user", message, {
        provider: "gemini",
        mode,
        repository: mode === "project" ? projectAccess.repository : null,
        branch: mode === "project" ? projectAccess.branch : null,
      });
      await saveMessage(activeConversationId, session.user.id, "assistant", answer, {
        provider: "gemini",
        mode,
        model: payload.model ?? null,
        pendingAction: payload.pendingAction ?? null,
      });

      setActiveModel(payload.model ?? null);
      setPendingAction(payload.pendingAction ?? null);
      if (mode === "project" && payload.analysisScope) {
        setProjectReport({ scope: payload.analysisScope, coverageAreas: payload.coverageAreas ?? [], filesReviewed: payload.filesReviewed ?? [] });
      }
      setMessages((current) => [...current, { role: "assistant", content: answer }]);
    } catch (caught) {
      const failure = caught instanceof Error && caught.name === "AbortError"
        ? "La consulta superó el tiempo máximo. Probá nuevamente."
        : caught instanceof Error ? caught.message : "Error inesperado.";
      setError(failure);
      setMessages((current) => [...current, { role: "assistant", content: `No pude responder: ${failure}` }]);
    } finally {
      setLoading(false);
    }
  }

  async function applyChange() {
    if (!pendingAction || applying || mediaGenerating) return;
    setApplying(true);
    setError(null);
    try {
      const session = await getSession();
      if (projectAccess.state !== "connected") {
        const connected = await refreshProjectAccess(session.access_token);
        if (!connected) throw new Error("GitHub requiere reconexión antes de aplicar cambios.");
      }
      const response = await fetch("/api/clouva-ai/github", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ action: "write", path: pendingAction.path, content: pendingAction.content, message: pendingAction.message, confirm: true }),
      });
      const payload = (await response.json().catch(() => ({}))) as { result?: { commitSha?: string; path?: string; branch?: string }; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "No se pudo aplicar el cambio.");

      const text = `Cambio aplicado en \`${payload.result?.path ?? pendingAction.path}\`. Commit \`${payload.result?.commitSha?.slice(0, 7) ?? "creado"}\` sobre \`${payload.result?.branch ?? "main"}\`.`;
      if (conversationId) await saveMessage(conversationId, session.user.id, "assistant", text, { provider: "github", commit: payload.result ?? {} });
      setMessages((current) => [...current, { role: "assistant", content: text }]);
      setPendingAction(null);
      void refreshProjectAccess(session.access_token);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo aplicar el cambio.");
    } finally {
      setApplying(false);
    }
  }

  function newConversation() {
    if (mediaGenerating) return;
    setConversationId(null);
    setMessages([{ role: "assistant", content: CLOUVA_AI_WELCOME }]);
    setInput("");
    setError(null);
    setActiveModel(null);
    setPendingAction(null);
    setProjectReport(null);
  }

  return {
    messages,
    conversations,
    conversationId,
    input,
    setInput,
    mode,
    changeMode,
    projectAccess,
    accessText: projectAccessLabel(projectAccess),
    projectReport,
    loadingHistory,
    loading,
    mediaGenerating,
    applying,
    error,
    clearError: () => setError(null),
    reportError: (message: string) => setError(message),
    activeModel,
    pendingAction,
    dismissPendingAction: () => setPendingAction(null),
    refreshProjectAccess,
    loadConversationHistory,
    openConversation,
    sendMessage,
    generateImageFromInput,
    applyChange,
    newConversation,
  };
}
