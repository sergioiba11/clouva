"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  GitBranch,
  Loader2,
  MessageCircle,
  RefreshCw,
  X,
} from "lucide-react";
import {
  CLOUVA_AI_MODE_STORAGE_KEY,
  DEFAULT_CLOUVA_AI_MODE,
  endpointForClouvaAIMode,
  normalizeClouvaAIMode,
  projectAccessLabel,
  type ClouvaAIMode,
} from "@/lib/clouva-ai/project-access";
import { supabase } from "@/lib/supabase";

type Message = { role: "user" | "assistant"; content: string };
type PendingAction = {
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
  pendingAction?: PendingAction | null;
  error?: string;
};
type StoredMessage = Message & { metadata?: Record<string, unknown> | null };
type ProjectAccessState = "checking" | "connected" | "unavailable" | "signed_out";
type ProjectAccess = {
  state: ProjectAccessState;
  repository: string | null;
  branch: string | null;
  message: string | null;
  checkedAt: number | null;
};
type ProjectStatusPayload = {
  ok?: boolean;
  status?: {
    connected?: boolean;
    repository?: string;
    branch?: string;
    private?: boolean;
    url?: string;
    pushedAt?: string;
  };
  error?: string;
};

const WELCOME =
  "Soy Trébol — CLOUVA AI. Proyecto queda listo para investigar el repositorio real mientras tu sesión autorizada siga activa.";
const INITIAL_VISIBLE_MESSAGES = 12;
const INITIAL_PROJECT_ACCESS: ProjectAccess = {
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

function SelectableMessage({ content }: { content: string }) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [content]);

  return (
    <textarea
      ref={textareaRef}
      value={content}
      readOnly
      rows={1}
      aria-label="Contenido del mensaje"
      className="block w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-sm leading-6 text-inherit outline-none"
      style={{ font: "inherit", lineHeight: "inherit" }}
    />
  );
}

export function ClouvaAIChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<ClouvaAIMode>(DEFAULT_CLOUVA_AI_MODE);
  const [projectAccess, setProjectAccess] = useState<ProjectAccess>(INITIAL_PROJECT_ACCESS);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeModel, setActiveModel] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_MESSAGES);
  const [copiedMessageIndex, setCopiedMessageIndex] = useState<number | null>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const projectCheckIdRef = useRef(0);

  const messageOffset = Math.max(messages.length - visibleCount, 0);
  const visibleMessages = messages.slice(messageOffset);
  const hiddenMessageCount = messageOffset;
  const accessText = projectAccessLabel(projectAccess);

  useEffect(() => {
    const storedMode = normalizeClouvaAIMode(
      window.localStorage.getItem(CLOUVA_AI_MODE_STORAGE_KEY),
    );
    setMode(storedMode);
    void loadLatestConversation();
    void refreshProjectAccess();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
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
  }, []);

  useEffect(() => {
    const container = chatScrollRef.current;
    if (!container) return;

    const frame = window.requestAnimationFrame(() => {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: loadingHistory ? "auto" : "smooth",
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [messages.length, loading, pendingAction, loadingHistory]);

  async function getSession() {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw new Error("Iniciá sesión en CLOUVA.");
    return data.session;
  }

  async function refreshProjectAccess(accessToken?: string): Promise<boolean> {
    const checkId = ++projectCheckIdRef.current;
    setProjectAccess((current) => ({
      ...current,
      state: "checking",
      message: null,
    }));

    try {
      let token = accessToken;
      if (!token) {
        const { data } = await supabase.auth.getSession();
        token = data.session?.access_token;
      }

      if (!token) {
        if (projectCheckIdRef.current === checkId) {
          setProjectAccess({
            state: "signed_out",
            repository: null,
            branch: null,
            message: "Iniciá sesión para activar Proyecto",
            checkedAt: Date.now(),
          });
        }
        return false;
      }

      const response = await fetch("/api/clouva-ai/github", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => ({}))) as ProjectStatusPayload;

      if (!response.ok || !payload.status?.connected) {
        throw new Error(payload.error || "GitHub no confirmó el acceso al repositorio.");
      }

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
      const message =
        caught instanceof Error ? caught.message : "No se pudo verificar el acceso a GitHub.";
      if (projectCheckIdRef.current === checkId) {
        setProjectAccess({
          state: "unavailable",
          repository: null,
          branch: null,
          message,
          checkedAt: Date.now(),
        });
      }
      return false;
    }
  }

  function changeMode(nextMode: ClouvaAIMode) {
    setMode(nextMode);
    window.localStorage.setItem(CLOUVA_AI_MODE_STORAGE_KEY, nextMode);
    setError(null);

    if (nextMode === "project" && projectAccess.state !== "connected") {
      void refreshProjectAccess();
    }
  }

  async function loadLatestConversation() {
    setLoadingHistory(true);
    setError(null);

    try {
      const session = await getSession();
      const { data: conversation, error: conversationError } = await supabase
        .from("ai_conversations")
        .select("id")
        .eq("user_id", session.user.id)
        .eq("project_key", "clouva")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (conversationError) throw conversationError;
      if (!conversation) {
        setMessages([{ role: "assistant", content: WELCOME }]);
        setVisibleCount(INITIAL_VISIBLE_MESSAGES);
        return;
      }

      const { data, error: messagesError } = await supabase
        .from("ai_messages")
        .select("role,content,metadata,created_at")
        .eq("conversation_id", conversation.id)
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: true });

      if (messagesError) throw messagesError;
      const restored = deduplicate((data ?? []) as StoredMessage[]);
      setConversationId(conversation.id);
      setVisibleCount(INITIAL_VISIBLE_MESSAGES);
      setMessages(
        restored.length
          ? restored.map(({ role, content }) => ({ role, content }))
          : [{ role: "assistant", content: WELCOME }],
      );
    } catch (caught) {
      setMessages([{ role: "assistant", content: WELCOME }]);
      setError(caught instanceof Error ? caught.message : "No se pudo cargar el historial.");
    } finally {
      setLoadingHistory(false);
    }
  }

  async function ensureConversation(userId: string, title: string) {
    if (conversationId) return conversationId;

    const { data, error } = await supabase
      .from("ai_conversations")
      .insert({
        user_id: userId,
        project_key: "clouva",
        title: title.slice(0, 72),
      })
      .select("id")
      .single();

    if (error || !data) throw new Error(error?.message ?? "No se pudo crear la conversación.");
    setConversationId(data.id);
    return data.id as string;
  }

  async function saveMessage(
    id: string,
    userId: string,
    role: "user" | "assistant",
    content: string,
    metadata: Record<string, unknown> = {},
  ) {
    const { error } = await supabase.from("ai_messages").insert({
      conversation_id: id,
      user_id: userId,
      role,
      content,
      metadata,
    });
    if (error) throw new Error(error.message);
  }

  async function copyMessage(content: string, index: number) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(content);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = content;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        textarea.remove();
      }
      setCopiedMessageIndex(index);
      window.setTimeout(() => setCopiedMessageIndex(null), 1600);
    } catch {
      setError("No se pudo copiar este mensaje.");
    }
  }

  function showOlderMessages() {
    const container = chatScrollRef.current;
    const previousHeight = container?.scrollHeight ?? 0;

    setVisibleCount((current) => current + INITIAL_VISIBLE_MESSAGES);

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (!container) return;
        container.scrollTop += container.scrollHeight - previousHeight;
      });
    });
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
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
        if (!connected) {
          throw new Error(
            "Proyecto no pudo acceder a GitHub. Revisá la sesión o la conexión y reintentá.",
          );
        }
      }

      const endpoint = endpointForClouvaAIMode(mode);
      const controller = new AbortController();
      const timeout = window.setTimeout(
        () => controller.abort(),
        mode === "project" ? 60_000 : 38_000,
      );

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(mode === "project" ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          message,
          history: previousMessages.slice(-8),
          ...(mode === "project"
            ? {
                screenContext: {
                  page: window.location.pathname,
                  url: window.location.href,
                  capturedAt: new Date().toISOString(),
                  repository: projectAccess.repository || "sergioiba11/clouva",
                  branch: projectAccess.branch || "main",
                },
              }
            : {}),
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
      setMessages((current) => [...current, { role: "assistant", content: answer }]);
    } catch (caught) {
      const failure =
        caught instanceof Error && caught.name === "AbortError"
          ? "La consulta superó el tiempo máximo. Probá nuevamente."
          : caught instanceof Error
            ? caught.message
            : "Error inesperado.";

      setError(failure);
      setMessages((current) => [
        ...current,
        { role: "assistant", content: `No pude responder: ${failure}` },
      ]);
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
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          action: "write",
          path: pendingAction.path,
          content: pendingAction.content,
          message: pendingAction.message,
          confirm: true,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        result?: { commitSha?: string; path?: string; branch?: string };
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error ?? "No se pudo aplicar el cambio.");

      const text = `Cambio aplicado en \`${payload.result?.path ?? pendingAction.path}\`. Commit \`${payload.result?.commitSha?.slice(0, 7) ?? "creado"}\` sobre \`${payload.result?.branch ?? "main"}\`.`;
      if (conversationId) {
        await saveMessage(conversationId, session.user.id, "assistant", text, {
          provider: "github",
          commit: payload.result ?? {},
        });
      }
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
    setMessages([{ role: "assistant", content: WELCOME }]);
    setVisibleCount(INITIAL_VISIBLE_MESSAGES);
    setError(null);
    setActiveModel(null);
    setPendingAction(null);
  }

  return (
    <section className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 text-white sm:px-6">
      <header className="mb-3 flex shrink-0 items-center justify-between gap-3 border-b border-violet-500/20 pb-3">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.28em] text-violet-300">Asistente CLOUVA</p>
          <h1 className="text-xl font-semibold">Trébol — CLOUVA AI</h1>
          <p className="mt-0.5 truncate text-xs text-white/50">
            {activeModel ? `Modelo activo: ${activeModel}` : "Proyecto con acceso GitHub persistente"}
          </p>
        </div>

        <button
          type="button"
          onClick={newConversation}
          disabled={loadingHistory || loading || applying}
          className="shrink-0 rounded-full border border-white/15 px-3 py-2 text-xs text-white/75 transition hover:border-violet-400/60 hover:text-white disabled:opacity-40"
        >
          Nueva
        </button>
      </header>

      <div className="mb-2 grid shrink-0 grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-zinc-950 p-1">
        <button
          type="button"
          onClick={() => changeMode("chat")}
          disabled={loading || applying}
          className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm transition ${
            mode === "chat" ? "bg-violet-600 text-white" : "text-white/55 hover:text-white"
          }`}
        >
          <MessageCircle className="h-4 w-4" /> Chat
        </button>
        <button
          type="button"
          onClick={() => changeMode("project")}
          disabled={loading || applying}
          className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm transition ${
            mode === "project" ? "bg-violet-600 text-white" : "text-white/55 hover:text-white"
          }`}
        >
          <GitBranch className="h-4 w-4" /> Proyecto
        </button>
      </div>

      <div
        className={`mb-3 flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-xs ${
          projectAccess.state === "connected"
            ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-200"
            : projectAccess.state === "checking"
              ? "border-violet-400/20 bg-violet-500/10 text-violet-200"
              : "border-amber-400/25 bg-amber-500/10 text-amber-100"
        }`}
      >
        {projectAccess.state === "connected" ? (
          <CheckCircle2 className="h-4 w-4 shrink-0" />
        ) : projectAccess.state === "checking" ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
        ) : (
          <AlertTriangle className="h-4 w-4 shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate">{accessText}</span>
        {(projectAccess.state === "unavailable" || projectAccess.state === "signed_out") && (
          <button
            type="button"
            onClick={() => void refreshProjectAccess()}
            disabled={loading || applying}
            className="inline-flex shrink-0 items-center gap-1 rounded-full border border-current/20 px-2 py-1 font-medium disabled:opacity-40"
          >
            <RefreshCw className="h-3 w-3" /> Reintentar
          </button>
        )}
      </div>

      <div
        ref={chatScrollRef}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain rounded-3xl border border-white/10 bg-white/[0.025] p-3 shadow-2xl shadow-violet-950/20 sm:p-5"
      >
        {loadingHistory ? (
          <article className="flex items-center gap-3 rounded-2xl border border-violet-400/20 bg-violet-500/10 px-4 py-3 text-sm text-violet-100">
            <Loader2 className="h-4 w-4 animate-spin" /> Recuperando conversación…
          </article>
        ) : (
          <>
            {hiddenMessageCount > 0 && (
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={showOlderMessages}
                  className="rounded-full border border-white/10 bg-black/50 px-4 py-2 text-xs text-white/60 transition hover:border-violet-400/40 hover:text-white"
                >
                  Mostrar {Math.min(INITIAL_VISIBLE_MESSAGES, hiddenMessageCount)} mensajes anteriores
                </button>
              </div>
            )}

            {visibleMessages.map((message, index) => {
              const globalIndex = messageOffset + index;
              const copied = copiedMessageIndex === globalIndex;

              return (
                <article
                  key={`${message.role}-${globalIndex}`}
                  className={`group relative max-w-[94%] rounded-2xl px-4 pb-3 pt-4 text-sm leading-6 ${
                    message.role === "user"
                      ? "ml-auto bg-violet-600 text-white"
                      : "border border-white/10 bg-white/[0.055] text-white/85"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => void copyMessage(message.content, globalIndex)}
                    className={`absolute right-2 top-2 flex items-center gap-1 rounded-full px-2 py-1 text-[10px] transition ${
                      message.role === "user"
                        ? "bg-black/20 text-white/70 hover:bg-black/30"
                        : "bg-black/35 text-white/55 hover:text-white"
                    }`}
                    aria-label="Copiar este mensaje"
                  >
                    {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    {copied ? "Copiado" : "Copiar"}
                  </button>

                  <div className="pr-14">
                    <SelectableMessage content={message.content} />
                  </div>
                </article>
              );
            })}
          </>
        )}

        {loading && (
          <article className="flex max-w-[94%] items-center gap-3 rounded-2xl border border-violet-400/20 bg-violet-500/10 px-4 py-3 text-sm text-violet-100">
            <Loader2 className="h-4 w-4 animate-spin" />
            {mode === "project" ? "Leyendo el repositorio…" : "Gemini está respondiendo…"}
          </article>
        )}

        {pendingAction && (
          <section className="rounded-3xl border border-violet-400/30 bg-violet-500/10 p-4">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-violet-300">Cambio preparado</p>
            <h2 className="mt-2 break-all font-semibold">{pendingAction.path}</h2>
            <p className="mt-2 text-sm leading-6 text-white/70">{pendingAction.summary}</p>
            <p className="mt-2 text-xs text-white/40">Commit: {pendingAction.message}</p>
            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={applyChange}
                disabled={applying || projectAccess.state !== "connected"}
                className="flex flex-1 items-center justify-center gap-2 rounded-full bg-violet-600 px-4 py-3 text-sm font-semibold disabled:opacity-50"
              >
                {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {applying ? "Aplicando…" : "Aplicar cambio"}
              </button>
              <button
                type="button"
                onClick={() => setPendingAction(null)}
                disabled={applying}
                className="flex items-center gap-2 rounded-full border border-white/15 px-4 py-3 text-sm"
              >
                <X className="h-4 w-4" /> Cancelar
              </button>
            </div>
          </section>
        )}
      </div>

      <form onSubmit={sendMessage} className="mt-3 shrink-0">
        <div className="rounded-3xl border border-white/10 bg-zinc-950 p-3 transition focus-within:border-violet-400/50">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            rows={2}
            placeholder={
              mode === "project"
                ? "Pedile que investigue archivos reales del proyecto…"
                : "Escribile a Trébol…"
            }
            className="w-full resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-white/30"
          />

          <div className="flex items-center justify-between gap-3">
            <p className="px-2 text-[11px] text-white/35">
              {mode === "project"
                ? projectAccess.state === "connected"
                  ? "Proyecto usa GitHub real"
                  : "Proyecto verificará GitHub antes de responder"
                : "Chat usa la visión de CLOUVA"}
            </p>
            <button
              type="submit"
              disabled={loadingHistory || loading || applying || !input.trim()}
              className="rounded-full bg-violet-600 px-5 py-2 text-sm font-medium transition hover:bg-violet-500 disabled:opacity-40"
            >
              {loading ? "Esperando…" : "Enviar"}
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-2 rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-2.5 text-sm text-red-200">
            {error}
          </div>
        )}
      </form>
    </section>
  );
}
