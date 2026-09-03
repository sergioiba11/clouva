"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Crosshair, Loader2, Paperclip, Send, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { supabase } from "@/lib/supabase";
import type { PendingToolActionView } from "@/lib/clouva-ai/tool-confirmation";
import { trebolContextualGreeting } from "@/lib/clouva-ai/page-context";
import { useClouvaAIAssistant } from "./ClouvaAIAssistantProvider";
import { ClouvaAIVoiceControls } from "./ClouvaAIVoiceControls";

const ORCHESTRATOR_ENDPOINT = "/api/clouva-ai/chat";
const ALLOWED_ATTACHMENT_MIME = /^(?:image\/(?:png|jpe?g|webp|gif)|audio\/(?:wav|x-wav|mpeg|mp4|ogg|webm)|application\/pdf|application\/json|text\/[a-z0-9.+-]+)$/i;

type Message = { role: "user" | "assistant"; content: string; createdAt?: string };
type MessageRow = {
  role: "user" | "assistant";
  content: string;
  created_at: string;
  metadata?: Record<string, unknown> | null;
};
type Attachment = {
  name: string;
  mimeType: string;
  size: number;
  dataBase64: string;
  kind: "image" | "audio" | "file";
};
type DoneFrame = {
  conversationId?: string;
  pendingAction?: PendingToolActionView | null;
  pendingMemoryProposal?: unknown;
};

function fileKind(mimeType: string): Attachment["kind"] {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("audio/")) return "audio";
  return "file";
}

function isPendingMetadata(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return (value as Record<string, unknown>).status === "pending";
}

function rowHasPendingReview(row: MessageRow): boolean {
  return isPendingMetadata(row.metadata?.pendingAction) || isPendingMetadata(row.metadata?.memoryProposal);
}

export function ClouvaAIQuickChat({ studioId = null }: { studioId?: string | null }) {
  const {
    context,
    pageContext,
    viewerContext,
    conversationId: sharedConversationId,
    setConversationId: setSharedConversationId,
    setPendingAction,
    selectingElement,
    startElementSelection,
    stopElementSelection,
    clearSelection,
  } = useClouvaAIAssistant();
  const [conversationId, setConversationId] = useState<string | null>(sharedConversationId);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [pendingReview, setPendingReview] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void loadConversation();
    // The shared id is intentionally part of this dependency: opening the full
    // assistant and returning to quick chat must keep the same conversation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharedConversationId, studioId]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const node = scrollRef.current;
      if (node) node.scrollTo({ top: node.scrollHeight, behavior: loadingHistory ? "auto" : "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [loading, loadingHistory, messages.length]);

  async function getSession() {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw new Error("Iniciá sesión en CLOUVA.");
    return data.session;
  }

  async function resolveConversationId(userId: string): Promise<string | null> {
    if (sharedConversationId) {
      let preferred = supabase
        .from("ai_conversations")
        .select("id,studio_id")
        .eq("project_key", "clouva")
        .eq("user_id", userId)
        .eq("id", sharedConversationId);
      preferred = studioId ? preferred.eq("studio_id", studioId) : preferred.is("studio_id", null);
      const result = await preferred.maybeSingle();
      if (result.error) throw result.error;
      if (result.data?.id) return result.data.id;
    }

    let latest = supabase
      .from("ai_conversations")
      .select("id,studio_id")
      .eq("project_key", "clouva")
      .eq("user_id", userId);
    latest = studioId ? latest.eq("studio_id", studioId) : latest.is("studio_id", null);
    const result = await latest.order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (result.error) throw result.error;
    return result.data?.id ?? null;
  }

  async function loadConversation() {
    setLoadingHistory(true);
    setError(null);
    setPendingReview(false);
    try {
      const session = await getSession();
      const id = await resolveConversationId(session.user.id);
      setConversationId(id);
      setSharedConversationId(id);
      if (!id) {
        setMessages([{ role: "assistant", content: trebolContextualGreeting(pageContext, viewerContext) }]);
        return;
      }
      const { data, error: messageError } = await supabase
        .from("ai_messages")
        .select("role,content,created_at,metadata")
        .eq("conversation_id", id)
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: false })
        .limit(24);
      if (messageError) throw messageError;
      const rows = (data ?? []) as MessageRow[];
      setPendingReview(rows.some(rowHasPendingReview));
      const restored = rows
        .slice()
        .reverse()
        .map((item) => ({ role: item.role, content: item.content, createdAt: item.created_at }));
      setMessages(restored.length ? restored : [{ role: "assistant", content: trebolContextualGreeting(pageContext, viewerContext) }]);
    } catch (cause) {
      setMessages([{ role: "assistant", content: trebolContextualGreeting(pageContext, viewerContext) }]);
      setError(cause instanceof Error ? cause.message : "No se pudo cargar la conversación.");
    } finally {
      setLoadingHistory(false);
    }
  }

  async function chooseAttachment(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (file.size > 5 * 1024 * 1024) {
      setError("El archivo supera el máximo de 5 MB.");
      return;
    }
    const mimeType = file.type.trim().toLowerCase();
    if (!ALLOWED_ATTACHMENT_MIME.test(mimeType)) {
      setError("Ese tipo de archivo no está soportado en el chat rápido.");
      return;
    }
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("No se pudo leer el archivo."));
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.readAsDataURL(file);
      });
      const comma = dataUrl.indexOf(",");
      if (comma < 0) throw new Error("El archivo no se pudo preparar.");
      setAttachment({
        name: file.name.slice(0, 180),
        mimeType,
        size: file.size,
        dataBase64: dataUrl.slice(comma + 1),
        kind: fileKind(mimeType),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo preparar el archivo.");
    }
  }

  async function performSend(message: string) {
    if (!message || loading || pendingReview) return;
    setLoading(true);
    setError(null);
    const sentAttachment = attachment;
    setAttachment(null);
    setMessages((current) => [...current, { role: "user", content: message, createdAt: new Date().toISOString() }]);
    let accumulated = "";
    let placeholderAdded = false;

    try {
      const session = await getSession();
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 45_000);
      const response = await fetch(ORCHESTRATOR_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          action: "message",
          message,
          conversationId,
          studioId,
          mode: "chat",
          screenContext: {
            ...context,
            page: window.location.pathname,
            url: window.location.href,
            capturedAt: new Date().toISOString(),
          },
          attachments: sentAttachment ? [sentAttachment] : [],
        }),
        signal: controller.signal,
        cache: "no-store",
      }).finally(() => window.clearTimeout(timeout));

      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error ?? "CLOUVA AI no respondió.");
      }
      if (!response.body) throw new Error("CLOUVA AI no devolvió una respuesta.");

      setMessages((current) => [...current, { role: "assistant", content: "" }]);
      placeholderAdded = true;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let doneFrame: DoneFrame | null = null;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let frame: ({ type?: string; text?: string; error?: string } & Record<string, unknown>);
          try {
            frame = JSON.parse(line);
          } catch {
            continue;
          }
          if (frame.type === "chunk" && typeof frame.text === "string") {
            accumulated += frame.text;
            const snapshot = accumulated;
            setMessages((current) => {
              const next = current.slice();
              next[next.length - 1] = { role: "assistant", content: snapshot };
              return next;
            });
          } else if (frame.type === "done") {
            doneFrame = frame as unknown as DoneFrame;
          } else if (frame.type === "error") {
            throw new Error(typeof frame.error === "string" ? frame.error : "CLOUVA AI no respondió.");
          }
        }
      }

      if (!accumulated) throw new Error("CLOUVA AI respondió sin contenido.");
      if (doneFrame?.conversationId) {
        setConversationId(doneFrame.conversationId);
        setSharedConversationId(doneFrame.conversationId);
      }
      if (doneFrame?.pendingAction) setPendingAction(doneFrame.pendingAction);
      if (doneFrame?.pendingAction || doneFrame?.pendingMemoryProposal) setPendingReview(true);
    } catch (cause) {
      const messageText = cause instanceof Error && cause.name === "AbortError"
        ? "La consulta tardó demasiado. Probá nuevamente."
        : cause instanceof Error
          ? cause.message
          : "No se pudo responder.";
      setError(messageText);
      setMessages((current) => {
        if (placeholderAdded) {
          const next = current.slice();
          next[next.length - 1] = { role: "assistant", content: `No pude responder: ${messageText}` };
          return next;
        }
        return [...current, { role: "assistant", content: `No pude responder: ${messageText}` }];
      });
    } finally {
      setLoading(false);
    }
  }

  function send(event: FormEvent) {
    event.preventDefault();
    const message = input.trim();
    if (!message || loading || pendingReview) return;
    setInput("");
    void performSend(message);
  }

  const selectedLabel = context.ui.selectedElement?.ariaLabel
    || context.ui.selectedElement?.text
    || context.ui.selectedElement?.componentHint;

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-trebol-ui>
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-2.5 overflow-y-auto overscroll-contain px-4 py-3">
        {loadingHistory ? (
          <div className="flex items-center gap-2 py-3 text-xs text-white/45"><Loader2 className="h-4 w-4 animate-spin" /> Recuperando conversación…</div>
        ) : messages.map((message, index) => (
          <article
            key={`${message.role}-${index}`}
            className={message.role === "user"
              ? "ml-auto max-w-[88%] rounded-2xl rounded-br-md bg-violet-600 px-3.5 py-2.5 text-sm leading-5 text-white"
              : "max-w-[94%] rounded-2xl rounded-bl-md bg-white/[0.045] px-3.5 py-2.5 text-sm leading-5 text-white/85"}
          >
            {message.role === "assistant" ? (
              <div className="space-y-2 [&_a]:text-violet-300 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
              </div>
            ) : <p className="whitespace-pre-wrap break-words">{message.content}</p>}
          </article>
        ))}
        {loading ? (
          <div className="flex items-center gap-2 px-1 py-2 text-xs text-violet-200/75"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Trébol está respondiendo…</div>
        ) : null}
        {pendingReview ? (
          <div className="rounded-2xl border border-violet-300/15 bg-violet-500/[0.07] px-3 py-2.5 text-xs leading-5 text-violet-100/80">
            Hay una revisión pendiente. Abrí CLOUVA AI completo para revisar la acción o la memoria antes de seguir.
          </div>
        ) : null}
      </div>

      <div className="shrink-0 border-t border-white/10 bg-black/20 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2.5">
        {selectedLabel ? (
          <div className="mb-2 flex items-center gap-2 rounded-full border border-violet-300/15 bg-violet-500/[0.08] px-3 py-1.5 text-[11px] text-violet-100/80">
            <Crosshair className="h-3 w-3 shrink-0" />
            <span className="min-w-0 flex-1 truncate">Señalado: {selectedLabel}</span>
            <button type="button" onClick={clearSelection} aria-label="Quitar selección" className="rounded-full p-0.5 hover:bg-white/10"><X className="h-3 w-3" /></button>
          </div>
        ) : null}
        {attachment ? (
          <div className="mb-2 flex items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-[11px] text-white/60">
            <Paperclip className="h-3 w-3 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{attachment.name}</span>
            <button type="button" onClick={() => setAttachment(null)} aria-label="Quitar archivo" className="rounded-full p-0.5 hover:bg-white/10"><X className="h-3 w-3" /></button>
          </div>
        ) : null}
        <form onSubmit={send} className="flex items-end gap-1.5 rounded-[22px] border border-white/10 bg-white/[0.035] p-1.5 transition focus-within:border-violet-300/30">
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            accept="image/png,image/jpeg,image/webp,image/gif,audio/*,application/pdf,application/json,text/plain"
            onChange={(event) => {
              void chooseAttachment(event.target.files?.[0]);
              event.currentTarget.value = "";
            }}
          />
          <button type="button" onClick={() => fileRef.current?.click()} aria-label="Adjuntar archivo" className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-white/50 transition hover:bg-white/10 hover:text-white">
            <Paperclip className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={selectingElement ? stopElementSelection : startElementSelection}
            aria-label={selectingElement ? "Cancelar selección" : "Señalar algo en pantalla"}
            className={`grid h-9 w-9 shrink-0 place-items-center rounded-full transition ${selectingElement ? "bg-violet-500/20 text-violet-200" : "text-white/50 hover:bg-white/10 hover:text-white"}`}
          >
            <Crosshair className="h-4 w-4" />
          </button>
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            disabled={loadingHistory || pendingReview}
            rows={1}
            placeholder={pendingReview ? "Revisá la acción en Abrir completo…" : "Escribile a Trébol…"}
            className="max-h-28 min-h-9 flex-1 resize-none bg-transparent px-1 py-2 text-sm leading-5 text-white outline-none placeholder:text-white/30"
          />
          <ClouvaAIVoiceControls compact />
          <button
            type="submit"
            disabled={loadingHistory || loading || pendingReview || !input.trim()}
            aria-label="Enviar mensaje"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-violet-500 text-white transition hover:bg-violet-400 disabled:opacity-30"
          >
            <Send className="h-4 w-4" />
          </button>
        </form>
        {error ? <p className="mt-2 px-2 text-[11px] text-rose-200/85">{error}</p> : null}
      </div>
    </div>
  );
}
