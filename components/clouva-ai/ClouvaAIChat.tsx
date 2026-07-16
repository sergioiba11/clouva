"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";

type Message = { role: "user" | "assistant"; content: string };
type GeminiPayload = { reply?: string; model?: string; error?: string };
type StoredMessage = Message & { metadata?: Record<string, unknown> | null };

const WELCOME =
  "Soy CLOUVA AI. Este chat usa Gemini y guarda la conversación en Supabase. Por ahora funciona como asistente estable; después volveremos a sumar lectura y cambios de GitHub de forma separada.";

function deduplicate(messages: StoredMessage[]) {
  return messages.filter((message, index) => {
    if (index === 0) return true;
    const previous = messages[index - 1];
    return previous.role !== message.role || previous.content !== message.content;
  });
}

export function ClouvaAIChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeModel, setActiveModel] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void loadLatestConversation();
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function getSession() {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw new Error("Iniciá sesión en CLOUVA.");
    return data.session;
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

      const { data, error: messagesError } = await supabase
        .from("ai_messages")
        .select("role,content,metadata,created_at")
        .eq("conversation_id", conversation.id)
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: true });

      if (messagesError) throw messagesError;
      const restored = deduplicate((data ?? []) as StoredMessage[]);
      setConversationId(conversation.id);
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

    if (error || !data) {
      throw new Error(error?.message ?? "No se pudo crear la conversación.");
    }

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

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    const message = input.trim();
    if (!message || loading) return;

    const previousMessages = messages;
    setInput("");
    setError(null);
    setLoading(true);
    setMessages((current) => [...current, { role: "user", content: message }]);

    try {
      const session = await getSession();

      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 35_000);
      const response = await fetch("/api/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          history: previousMessages.slice(-8),
        }),
        signal: controller.signal,
        cache: "no-store",
      }).finally(() => window.clearTimeout(timeout));

      const payload = (await response.json().catch(() => ({}))) as GeminiPayload;
      if (!response.ok) throw new Error(payload.error ?? "Gemini no respondió.");
      if (!payload.reply) throw new Error("Gemini respondió sin contenido.");

      const activeConversationId = await ensureConversation(session.user.id, message);
      await saveMessage(activeConversationId, session.user.id, "user", message, {
        provider: "gemini",
      });
      await saveMessage(
        activeConversationId,
        session.user.id,
        "assistant",
        payload.reply,
        {
          provider: "gemini",
          model: payload.model ?? null,
        },
      );

      setActiveModel(payload.model ?? null);
      setMessages((current) => [
        ...current,
        { role: "assistant", content: payload.reply! },
      ]);
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

  function newConversation() {
    setConversationId(null);
    setMessages([{ role: "assistant", content: WELCOME }]);
    setError(null);
    setActiveModel(null);
  }

  return (
    <main className="min-h-screen bg-black text-white">
      <section className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-4 py-5 sm:px-6">
        <header className="mb-4 flex items-center justify-between gap-4 border-b border-violet-500/20 pb-4">
          <div>
            <p className="text-xs uppercase tracking-[0.32em] text-violet-300">Asistente CLOUVA</p>
            <h1 className="text-2xl font-semibold">CLOUVA AI</h1>
            <p className="mt-1 text-sm text-white/55">
              Chat Gemini estable con historial guardado en Supabase.
            </p>
            {activeModel && (
              <p className="mt-1 font-mono text-xs text-violet-300">Modelo activo: {activeModel}</p>
            )}
          </div>

          <button
            type="button"
            onClick={newConversation}
            disabled={loadingHistory || loading}
            className="rounded-full border border-white/15 px-4 py-2 text-sm text-white/75 transition hover:border-violet-400/60 hover:text-white disabled:opacity-40"
          >
            Nueva conversación
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto rounded-3xl border border-white/10 bg-white/[0.025] p-4 shadow-2xl shadow-violet-950/20 sm:p-6">
          {loadingHistory ? (
            <article className="flex items-center gap-3 rounded-2xl border border-violet-400/20 bg-violet-500/10 px-4 py-3 text-sm text-violet-100">
              <Loader2 className="h-4 w-4 animate-spin" /> Recuperando conversación…
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
              <Loader2 className="h-4 w-4 animate-spin" /> Gemini está respondiendo…
            </article>
          )}

          <div ref={endRef} />
        </div>

        <form onSubmit={sendMessage} className="mt-4 pb-20 sm:pb-4">
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
              rows={3}
              placeholder="Escribile a CLOUVA AI…"
              className="w-full resize-none bg-transparent px-2 py-2 text-sm outline-none placeholder:text-white/30"
            />

            <div className="flex items-center justify-between gap-3">
              <p className="px-2 text-xs text-white/35">Enter para enviar · Shift + Enter para salto de línea</p>
              <button
                type="submit"
                disabled={loadingHistory || loading || !input.trim()}
                className="rounded-full bg-violet-600 px-5 py-2 text-sm font-medium transition hover:bg-violet-500 disabled:opacity-40"
              >
                {loading ? "Esperando…" : "Enviar"}
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
