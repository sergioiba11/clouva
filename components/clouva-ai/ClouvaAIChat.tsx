"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Check, GitCommit, Loader2, X } from "lucide-react";
import { supabase } from "@/lib/supabase";

type Message = { role: "user" | "assistant"; content: string };
type PendingAction = {
  type: "write_file";
  path: string;
  content: string;
  message: string;
  summary: string;
};
type AgentPayload = {
  message?: string;
  pendingAction?: PendingAction | null;
  error?: string;
};

type StoredMessage = Message & {
  metadata?: { pendingAction?: PendingAction | null } | null;
};

const WELCOME =
  "Soy CLOUVA AI. Puedo leer el repositorio real, revisar archivos y preparar cambios. Antes de escribir código siempre te voy a pedir confirmación.";

export function ClouvaAIChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void loadLatestConversation();
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, pendingAction]);

  async function getSession() {
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    if (!session) throw new Error("Iniciá sesión en CLOUVA para usar el agente del repositorio.");
    return session;
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
        return;
      }

      const { data: storedMessages, error: messagesError } = await supabase
        .from("ai_messages")
        .select("role,content,metadata,created_at")
        .eq("conversation_id", conversation.id)
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: true });

      if (messagesError) throw messagesError;

      const restored = (storedMessages ?? []) as StoredMessage[];
      setConversationId(conversation.id);
      setMessages(
        restored.length
          ? restored.map(({ role, content }) => ({ role, content }))
          : [{ role: "assistant", content: WELCOME }],
      );

      const lastPending = [...restored]
        .reverse()
        .find((item) => item.role === "assistant" && item.metadata?.pendingAction)
        ?.metadata?.pendingAction;
      setPendingAction(lastPending ?? null);
    } catch (caught) {
      setMessages([{ role: "assistant", content: WELCOME }]);
      setError(caught instanceof Error ? caught.message : "No se pudo cargar el historial.");
    } finally {
      setLoadingHistory(false);
    }
  }

  async function ensureConversation(userId: string, firstMessage: string) {
    if (conversationId) return conversationId;

    const { data, error: createError } = await supabase
      .from("ai_conversations")
      .insert({
        user_id: userId,
        project_key: "clouva",
        title: firstMessage.slice(0, 72),
      })
      .select("id")
      .single();

    if (createError || !data) {
      throw new Error(createError?.message ?? "No se pudo crear la conversación.");
    }

    setConversationId(data.id);
    return data.id as string;
  }

  async function saveMessage(args: {
    conversationId: string;
    userId: string;
    role: "user" | "assistant";
    content: string;
    metadata?: Record<string, unknown>;
  }) {
    const { error: insertError } = await supabase.from("ai_messages").insert({
      conversation_id: args.conversationId,
      user_id: args.userId,
      role: args.role,
      content: args.content,
      metadata: args.metadata ?? {},
    });

    if (insertError) throw new Error(insertError.message);
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    const message = input.trim();
    if (!message || loading || applying) return;

    setInput("");
    setError(null);
    setPendingAction(null);
    setLoading(true);
    setMessages((current) => [...current, { role: "user", content: message }]);

    try {
      const session = await getSession();
      const activeConversationId = await ensureConversation(session.user.id, message);

      await saveMessage({
        conversationId: activeConversationId,
        userId: session.user.id,
        role: "user",
        content: message,
        metadata: {
          screenContext: {
            page: window.location.pathname,
            url: window.location.href,
            capturedAt: new Date().toISOString(),
          },
        },
      });

      const response = await fetch("/api/clouva-ai/agent", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          message,
          history: messages.slice(-12),
          screenContext: {
            page: window.location.pathname,
            url: window.location.href,
            viewport: { width: window.innerWidth, height: window.innerHeight },
            capturedAt: new Date().toISOString(),
          },
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as AgentPayload;
      if (!response.ok) throw new Error(payload.error ?? "No se pudo consultar CLOUVA AI.");
      if (!payload.message) throw new Error("CLOUVA AI no devolvió una respuesta.");

      await saveMessage({
        conversationId: activeConversationId,
        userId: session.user.id,
        role: "assistant",
        content: payload.message,
        metadata: {
          provider: "gemini",
          pendingAction: payload.pendingAction ?? null,
        },
      });

      setMessages((current) => [
        ...current,
        { role: "assistant", content: payload.message! },
      ]);
      setPendingAction(payload.pendingAction ?? null);
    } catch (caught) {
      const failure = caught instanceof Error ? caught.message : "Error inesperado.";
      setError(failure);
      setMessages((current) => [
        ...current,
        { role: "assistant", content: `No pude completar la consulta: ${failure}` },
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

      const text = `Cambio aplicado en \`${payload.result?.path ?? pendingAction.path}\`. Commit \`${payload.result?.commitSha?.slice(0, 7) ?? "creado"}\` sobre \`${payload.result?.branch ?? "main"}\`. Railway debería iniciar el deploy automático.`;

      if (conversationId) {
        await saveMessage({
          conversationId,
          userId: session.user.id,
          role: "assistant",
          content: text,
          metadata: { commit: payload.result ?? {}, pendingAction: null },
        });
      }

      setMessages((current) => [...current, { role: "assistant", content: text }]);
      setPendingAction(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo aplicar el cambio.");
    } finally {
      setApplying(false);
    }
  }

  function newConversation() {
    setConversationId(null);
    setMessages([
      {
        role: "assistant",
        content: "Nueva conversación. La conversación anterior quedó guardada en Supabase.",
      },
    ]);
    setPendingAction(null);
    setError(null);
  }

  return (
    <main className="min-h-screen bg-black text-white">
      <section className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-4 py-5 sm:px-6">
        <header className="mb-4 flex items-center justify-between gap-4 border-b border-violet-500/20 pb-4">
          <div>
            <p className="text-xs uppercase tracking-[0.32em] text-violet-300">Centro de comando</p>
            <h1 className="text-2xl font-semibold">CLOUVA AI</h1>
            <p className="mt-1 text-sm text-white/55">GitHub real, memoria y chats guardados en Supabase.</p>
          </div>
          <button
            type="button"
            onClick={newConversation}
            disabled={loadingHistory || loading || applying}
            className="rounded-full border border-white/15 px-4 py-2 text-sm text-white/75 transition hover:border-violet-400/60 hover:text-white disabled:opacity-40"
          >
            Nueva conversación
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto rounded-3xl border border-white/10 bg-white/[0.025] p-4 shadow-2xl shadow-violet-950/20 sm:p-6">
          {loadingHistory ? (
            <article className="flex items-center gap-3 rounded-2xl border border-violet-400/20 bg-violet-500/10 px-4 py-3 text-sm text-violet-100">
              <Loader2 className="h-4 w-4 animate-spin" />
              Recuperando la última conversación desde Supabase…
            </article>
          ) : (
            messages.map((message, index) => (
              <article
                key={`${message.role}-${index}`}
                className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-6 ${
                  message.role === "user"
                    ? "ml-auto bg-violet-600 text-white"
                    : "border border-white/10 bg-white/[0.055] text-white/85"
                }`}
              >
                {message.content}
              </article>
            ))
          )}

          {loading && (
            <article className="flex max-w-[88%] items-center gap-3 rounded-2xl border border-violet-400/20 bg-violet-500/10 px-4 py-3 text-sm text-violet-100">
              <Loader2 className="h-4 w-4 animate-spin" />
              Leyendo el repositorio y analizando el cambio…
            </article>
          )}

          {pendingAction && (
            <section className="rounded-3xl border border-violet-400/30 bg-violet-500/10 p-4">
              <div className="flex items-start gap-3">
                <GitCommit className="mt-1 h-5 w-5 shrink-0 text-violet-300" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-violet-300">Cambio preparado</p>
                  <h2 className="mt-1 break-all font-semibold">{pendingAction.path}</h2>
                  <p className="mt-2 text-sm leading-6 text-white/70">{pendingAction.summary}</p>
                  <p className="mt-2 text-xs text-white/40">Commit: {pendingAction.message}</p>
                </div>
              </div>
              <div className="mt-4 flex gap-3">
                <button
                  type="button"
                  onClick={applyChange}
                  disabled={applying}
                  className="flex flex-1 items-center justify-center gap-2 rounded-full bg-violet-600 px-4 py-3 text-sm font-semibold transition hover:bg-violet-500 disabled:opacity-50"
                >
                  {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  {applying ? "Aplicando…" : "Aplicar cambio"}
                </button>
                <button
                  type="button"
                  onClick={() => setPendingAction(null)}
                  disabled={applying}
                  className="flex items-center justify-center gap-2 rounded-full border border-white/15 px-4 py-3 text-sm text-white/70"
                >
                  <X className="h-4 w-4" />
                  Cancelar
                </button>
              </div>
            </section>
          )}

          <div ref={endRef} />
        </div>

        <form onSubmit={sendMessage} className="mt-4 pb-20 sm:pb-4">
          <div className="rounded-3xl border border-white/10 bg-zinc-950 p-3 focus-within:border-violet-400/50">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              rows={3}
              placeholder="Pedime que revise un bug o implemente una función…"
              className="w-full resize-none bg-transparent px-2 py-2 text-sm text-white outline-none placeholder:text-white/30"
            />
            <div className="flex items-center justify-between gap-3">
              <p className="px-2 text-xs text-white/35">Enter para enviar · Shift + Enter para nueva línea</p>
              <button
                type="submit"
                disabled={loadingHistory || loading || applying || !input.trim()}
                className="rounded-full bg-violet-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Enviar
              </button>
            </div>
          </div>
          {error && (
            <div className="mt-3 rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {error}
            </div>
          )}
        </form>
      </section>
    </main>
  );
}
