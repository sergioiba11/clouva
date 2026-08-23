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
import { supabase } from "@/lib/supabase";

export type ClouvaAIMessage = { role: "user" | "assistant"; content: string };
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
type StoredMessage = ClouvaAIMessage & { metadata?: Record<string, unknown> | null };
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

export const CLOUVA_AI_WELCOME =
  "Soy Trébol — CLOUVA AI. Proyecto queda listo para investigar el repositorio real mientras tu sesión autorizada siga activa.";

const INITIAL_PROJECT_ACCESS: ClouvaAIProjectAccess = {
  state: "checking",
  repository: null,
  branch: null,
  message: null,
  checkedAt: null,
};

function deduplicate(messages: StoredMessage[]) {
  return messages.filter((message, index) => {
    if (index === 0) return true;
    const previous = messages[index - 1];
    return previous.role !== message.role || previous.content !== message.content;
  });
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
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeModel, setActiveModel] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<ClouvaAIPendingAction | null>(null);
  const projectCheckIdRef = useRef(0);

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
    setMessages(restored.length ? restored.map(({ role, content }) => ({ role, content })) : [{ role: "assistant", content: CLOUVA_AI_WELCOME }]);
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
      setConversationId(null);
      setMessages([{ role: "assistant", content: CLOUVA_AI_WELCOME }]);
    } catch (caught) {
      setConversationId(null);
      setMessages([{ role: "assistant", content: CLOUVA_AI_WELCOME }]);
      setError(caught instanceof Error ? caught.message : "No se pudo cargar el historial.");
    } finally {
      setLoadingHistory(false);
    }
  }

  async function openConversation(id: string) {
    if (id === conversationId || loading || applying) return;
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

  async function sendMessage(event?: FormEvent) {
    event?.preventDefault();
    const message = input.trim();
    if (!message || loading || applying) return;

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
          history: previousMessages.slice(-8),
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
    if (!pendingAction || applying) return;
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
    applyChange,
    newConversation,
  };
}
