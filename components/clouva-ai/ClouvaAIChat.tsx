"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

type Message = {
  role: "user" | "assistant";
  content: string;
};

type ChatPayload = {
  message?: string;
  conversationId?: string;
  error?: string;
};

type GitHubStatusPayload = {
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

const wait = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function isTemporaryGeminiError(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("high demand") ||
    normalized.includes("temporarily") ||
    normalized.includes("unavailable") ||
    normalized.includes("overloaded") ||
    normalized.includes("429") ||
    normalized.includes("503") ||
    normalized.includes("tardó demasiado")
  );
}

export function ClouvaAIChat() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content:
        "Soy CLOUVA AI. Uso la memoria del proyecto y el contexto de esta pantalla para ayudarte a resolver problemas y construir nuevas funciones sin empezar de cero.",
    },
  ]);
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem("clouva.ai.conversation.v1");
    if (saved) setConversationId(saved);
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, retrying]);

  async function getGitHubContext(accessToken: string) {
    try {
      const response = await fetch("/api/clouva-ai/github", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        cache: "no-store",
      });

      const payload = (await response.json().catch(() => ({}))) as GitHubStatusPayload;

      if (!response.ok || !payload.status?.connected) {
        return {
          connected: false,
          error: payload.error ?? "No se pudo comprobar GitHub.",
        };
      }

      return {
        connected: true,
        repository: payload.status.repository,
        branch: payload.status.branch,
        private: payload.status.private,
        url: payload.status.url,
        pushedAt: payload.status.pushedAt,
      };
    } catch (caught) {
      return {
        connected: false,
        error: caught instanceof Error ? caught.message : "Error al consultar GitHub.",
      };
    }
  }

  async function requestChat(message: string, accessToken: string) {
    const github = await getGitHubContext(accessToken);

    const requestBody = JSON.stringify({
      message,
      conversationId,
      projectKey: "clouva",
      screenContext: {
        page: window.location.pathname,
        url: window.location.href,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        capturedAt: new Date().toISOString(),
        github,
        capabilities: {
          githubStatus: true,
          githubRead: true,
          githubWrite: true,
          githubWriteRequiresConfirmation: true,
          railwayDeploysFromMainAutomatically: true,
        },
      },
    });

    let lastError = "No se pudo consultar CLOUVA AI.";

    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (attempt > 0) {
        setRetrying(true);
        await wait(attempt === 1 ? 1500 : 3500);
      }

      const response = await fetch("/api/clouva-ai/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: requestBody,
      });

      const payload = (await response.json().catch(() => ({}))) as ChatPayload;

      if (response.ok && payload.message) {
        setRetrying(false);
        return payload;
      }

      lastError = payload.error ?? `CLOUVA AI respondió con error ${response.status}.`;
      const retryable =
        response.status === 429 ||
        response.status >= 500 ||
        isTemporaryGeminiError(lastError);

      if (!retryable) break;
    }

    setRetrying(false);
    throw new Error(lastError);
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    const message = input.trim();
    if (!message || loading) return;

    setInput("");
    setError(null);
    setLoading(true);
    setMessages((current) => [...current, { role: "user", content: message }]);

    try {
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      if (!accessToken) {
        throw new Error("Iniciá sesión en CLOUVA para usar la memoria del proyecto.");
      }

      const payload = await requestChat(message, accessToken);

      if (payload.conversationId) {
        setConversationId(payload.conversationId);
        window.localStorage.setItem(
          "clouva.ai.conversation.v1",
          payload.conversationId,
        );
      }

      setMessages((current) => [
        ...current,
        { role: "assistant", content: payload.message! },
      ]);
    } catch (caught) {
      const rawMessage =
        caught instanceof Error ? caught.message : "Error inesperado.";
      const friendlyMessage = isTemporaryGeminiError(rawMessage)
        ? "Gemini está con mucha demanda en este momento. CLOUVA AI reintentó automáticamente, pero todavía no respondió. Esperá unos segundos y tocá Enviar otra vez."
        : rawMessage;

      setError(friendlyMessage);
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: `No pude completar la consulta. ${friendlyMessage}`,
        },
      ]);
    } finally {
      setRetrying(false);
      setLoading(false);
    }
  }

  function newConversation() {
    setConversationId(null);
    window.localStorage.removeItem("clouva.ai.conversation.v1");
    setMessages([
      {
        role: "assistant",
        content:
          "Nueva conversación iniciada. La memoria permanente de CLOUVA sigue disponible.",
      },
    ]);
    setError(null);
  }

  return (
    <main className="min-h-screen bg-black text-white">
      <section className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-4 py-5 sm:px-6">
        <header className="mb-4 flex items-center justify-between gap-4 border-b border-violet-500/20 pb-4">
          <div>
            <p className="text-xs uppercase tracking-[0.32em] text-violet-300">
              Centro de comando
            </p>
            <h1 className="text-2xl font-semibold">CLOUVA AI</h1>
            <p className="mt-1 text-sm text-white/55">
              Chat, memoria del proyecto y contexto operativo.
            </p>
          </div>
          <button
            type="button"
            onClick={newConversation}
            className="rounded-full border border-white/15 px-4 py-2 text-sm text-white/75 transition hover:border-violet-400/60 hover:text-white"
          >
            Nueva conversación
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto rounded-3xl border border-white/10 bg-white/[0.025] p-4 shadow-2xl shadow-violet-950/20 sm:p-6">
          {messages.map((message, index) => (
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
          ))}
          {loading && (
            <article className="max-w-[88%] rounded-2xl border border-violet-400/20 bg-violet-500/10 px-4 py-3 text-sm text-violet-100">
              {retrying
                ? "Gemini está ocupado. Reintentando automáticamente…"
                : "Analizando el proyecto y comprobando servicios…"}
            </article>
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
              placeholder="Decime qué querés revisar, construir o resolver…"
              className="w-full resize-none bg-transparent px-2 py-2 text-sm text-white outline-none placeholder:text-white/30"
            />
            <div className="flex items-center justify-between gap-3">
              <p className="px-2 text-xs text-white/35">
                Enter para enviar · Shift + Enter para nueva línea
              </p>
              <button
                type="submit"
                disabled={loading || !input.trim()}
                className="rounded-full bg-violet-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {retrying ? "Reintentando…" : "Enviar"}
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
