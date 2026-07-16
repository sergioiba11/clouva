"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

type Message = {
  role: "user" | "assistant";
  content: string;
};

export function ClouvaAIChat() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: "Soy CLOUVA AI. Puedo usar la memoria del proyecto y el contexto de esta pantalla para ayudarte a desarrollar sin empezar de cero cada vez.",
    },
  ]);
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem("clouva.ai.conversation.v1");
    if (saved) setConversationId(saved);
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

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
      if (!accessToken) throw new Error("Iniciá sesión en CLOUVA para usar la memoria del proyecto.");

      const response = await fetch("/api/clouva-ai/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          message,
          conversationId,
          projectKey: "clouva",
          screenContext: {
            page: window.location.pathname,
            url: window.location.href,
            viewport: { width: window.innerWidth, height: window.innerHeight },
            capturedAt: new Date().toISOString(),
          },
        }),
      });

      const payload = await response.json() as { message?: string; conversationId?: string; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "No se pudo consultar CLOUVA AI.");
      if (!payload.message) throw new Error("CLOUVA AI no devolvió una respuesta.");

      if (payload.conversationId) {
        setConversationId(payload.conversationId);
        window.localStorage.setItem("clouva.ai.conversation.v1", payload.conversationId);
      }
      setMessages((current) => [...current, { role: "assistant", content: payload.message! }]);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Error inesperado.";
      setError(message);
      setMessages((current) => [...current, { role: "assistant", content: `No pude completar la consulta: ${message}` }]);
    } finally {
      setLoading(false);
    }
  }

  function newConversation() {
    setConversationId(null);
    window.localStorage.removeItem("clouva.ai.conversation.v1");
    setMessages([
      {
        role: "assistant",
        content: "Nueva conversación iniciada. La memoria permanente de CLOUVA sigue disponible.",
      },
    ]);
    setError(null);
  }

  return (
    <main className="min-h-screen bg-black text-white">
      <section className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-4 py-5 sm:px-6">
        <header className="mb-4 flex items-center justify-between gap-4 border-b border-violet-500/20 pb-4">
          <div>
            <p className="text-xs uppercase tracking-[0.32em] text-violet-300">Centro de comando</p>
            <h1 className="text-2xl font-semibold">CLOUVA AI</h1>
            <p className="mt-1 text-sm text-white/55">Chat, memoria del proyecto y contexto operativo.</p>
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
              className={`max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-6 whitespace-pre-wrap ${
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
              Analizando el proyecto…
            </article>
          )}
          <div ref={endRef} />
        </div>

        <form onSubmit={sendMessage} className="mt-4">
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
              <p className="px-2 text-xs text-white/35">Enter para enviar · Shift + Enter para nueva línea</p>
              <button
                type="submit"
                disabled={loading || !input.trim()}
                className="rounded-full bg-violet-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Enviar
              </button>
            </div>
          </div>
          {error && <p className="mt-2 px-2 text-sm text-red-300">{error}</p>}
        </form>
      </section>
    </main>
  );
}
