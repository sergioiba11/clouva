"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  Clock3,
  Code2,
  ExternalLink,
  GitBranch,
  Loader2,
  MessageCircle,
  Plus,
  Send,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { useClouvaAIAssistant } from "@/components/clouva-ai/ClouvaAIAssistantProvider";
import { useClouvaAIConversation } from "@/components/clouva-ai/useClouvaAIConversation";
import { resolveAccountDisplayName } from "@/lib/identity-names";
import styles from "./ClouvaAICompactPanel.module.css";

const MASCOT_SRC = "/assets/clouva-ai/trebol-mascot.png";
const QUICK_ACTIONS = [
  { icon: Sparkles, label: "Crear un proyecto", prompt: "Quiero crear un proyecto nuevo en CLOUVA. Ayudame a definirlo y convertirlo en próximos pasos claros." },
  { icon: UserRound, label: "Mejorar mi avatar", prompt: "Quiero mejorar mi avatar de CLOUVA. Guiame con ideas concretas para que represente mejor mi identidad." },
  { icon: MessageCircle, label: "Ayudarme con música", prompt: "Quiero trabajar mi música dentro de CLOUVA. Ayudame a ordenar la idea y decidir el próximo paso." },
];

export function ClouvaAICompactPanel() {
  const { user, profile } = useAuth();
  const { closeAssistant, starterPrompt, consumeStarterPrompt } = useClouvaAIAssistant();
  const {
    messages,
    conversations,
    conversationId,
    input,
    setInput,
    mode,
    changeMode,
    loadingHistory,
    loading,
    applying,
    error,
    clearError,
    pendingAction,
    dismissPendingAction,
    openConversation,
    sendMessage,
    applyChange,
    newConversation,
  } = useClouvaAIConversation();
  const [showHistory, setShowHistory] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const displayName = resolveAccountDisplayName({ profile, user });

  useEffect(() => {
    if (!starterPrompt) return;
    const prompt = consumeStarterPrompt();
    if (prompt) setInput(prompt);
    window.requestAnimationFrame(() => composerRef.current?.focus());
  }, [consumeStarterPrompt, setInput, starterPrompt]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const frame = window.requestAnimationFrame(() => container.scrollTo({ top: container.scrollHeight, behavior: loadingHistory ? "auto" : "smooth" }));
    return () => window.cancelAnimationFrame(frame);
  }, [loading, loadingHistory, messages.length, pendingAction]);

  const isFresh = !loadingHistory && messages.length <= 1;

  function chooseAction(prompt: string) {
    setInput(prompt);
    composerRef.current?.focus();
  }

  return (
    <>
      <button type="button" className={styles.mobileBackdrop} onClick={closeAssistant} aria-label="Cerrar CLOUVA AI" />
      <section className={styles.panel} role="dialog" aria-modal="false" aria-label="CLOUVA AI, Trébol">
        <header className={styles.header}>
          <div className={styles.mascotWrap}>
            <Image src={MASCOT_SRC} alt="Trébol" width={58} height={58} priority />
            <i aria-label="En línea" />
          </div>
          <div className={styles.identity}>
            <span>CLOUVA AI</span>
            <strong>Trébol</strong>
            <small>Lista para ayudarte</small>
          </div>
          <div className={styles.headerActions}>
            <button type="button" onClick={() => setShowHistory((value) => !value)} aria-label="Ver conversaciones" aria-expanded={showHistory}><Clock3 size={16} /></button>
            <Link href="/clouva-ai" onClick={closeAssistant} aria-label="Abrir CLOUVA AI completo"><ExternalLink size={15} /></Link>
            <button type="button" onClick={closeAssistant} aria-label="Cerrar CLOUVA AI"><X size={17} /></button>
          </div>
        </header>

        {showHistory ? (
          <section className={styles.history}>
            <header><button type="button" onClick={() => setShowHistory(false)}><ChevronLeft size={15} /> Volver</button><strong>Conversaciones</strong></header>
            <button type="button" className={styles.newChat} onClick={() => { newConversation(); setShowHistory(false); }} disabled={loading || applying}><Plus size={15} /> Nueva conversación</button>
            <div>
              {conversations.length ? conversations.map((conversation) => (
                <button
                  type="button"
                  key={conversation.id}
                  className={conversation.id === conversationId ? styles.activeConversation : ""}
                  onClick={() => { void openConversation(conversation.id); setShowHistory(false); }}
                >
                  <MessageCircle size={14} /><span>{conversation.title || "Conversación sin título"}</span>
                </button>
              )) : <p>Tus próximas conversaciones van a aparecer acá.</p>}
            </div>
          </section>
        ) : (
          <>
            <div className={styles.modebar}>
              <button type="button" className={mode === "chat" ? styles.modeActive : ""} onClick={() => changeMode("chat")} disabled={loading || applying}><MessageCircle size={13} /> Chat</button>
              <button type="button" className={mode === "project" ? styles.modeActive : ""} onClick={() => changeMode("project")} disabled={loading || applying}><GitBranch size={13} /> Proyecto</button>
              <span>{mode === "project" ? "Repositorio real" : "Asistente creativo"}</span>
            </div>

            <div ref={scrollRef} className={styles.messages} aria-live="polite">
              {loadingHistory ? (
                <div className={styles.loadingState}><Image src={MASCOT_SRC} alt="" width={72} height={72} /><span><Loader2 size={15} className={styles.spin} /> Preparando una conversación nueva…</span></div>
              ) : isFresh ? (
                <section className={styles.welcome}>
                  <span className={styles.eyebrow}><Sparkles size={13} /> TRÉBOL ESTÁ CON VOS</span>
                  <h2>Hola, {displayName}.</h2>
                  <p>¿Qué querés crear o mejorar hoy?</p>
                  <div className={styles.quickActions}>
                    {QUICK_ACTIONS.map(({ icon: Icon, label, prompt }) => (
                      <button type="button" key={label} onClick={() => chooseAction(prompt)}><Icon size={16} /><span>{label}</span></button>
                    ))}
                  </div>
                </section>
              ) : messages.slice(-8).map((message, index) => (
                <article key={`${message.role}-${index}`} className={message.role === "user" ? styles.userMessage : styles.aiMessage}>
                  {message.role === "assistant" ? <Image src={MASCOT_SRC} alt="" width={30} height={30} /> : null}
                  <div><small>{message.role === "assistant" ? "Trébol" : "Vos"}</small><p>{message.content}</p></div>
                </article>
              ))}

              {loading ? <div className={styles.thinking}><Image src={MASCOT_SRC} alt="" width={30} height={30} /><span><Loader2 size={14} className={styles.spin} /> Trébol está pensando…</span></div> : null}

              {pendingAction ? (
                <section className={styles.pendingAction}>
                  <span><Code2 size={16} /></span><div><small>Cambio listo para revisar</small><strong>{pendingAction.path}</strong><p>{pendingAction.summary}</p><div><button type="button" onClick={applyChange} disabled={applying}>{applying ? <Loader2 size={14} className={styles.spin} /> : <Check size={14} />} Aplicar</button><button type="button" onClick={dismissPendingAction} disabled={applying}>Cancelar</button></div></div>
                </section>
              ) : null}
            </div>

            <form className={styles.composerArea} onSubmit={sendMessage}>
              {error ? <div className={styles.error}><AlertTriangle size={14} /><span>{error}</span><button type="button" onClick={clearError}><X size={13} /></button></div> : null}
              <div className={styles.composer}>
                <textarea
                  ref={composerRef}
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }}
                  rows={2}
                  placeholder={mode === "project" ? "Pedile que investigue tu proyecto…" : "Escribile a Trébol…"}
                  aria-label="Mensaje para Trébol"
                />
                <button type="submit" disabled={loadingHistory || loading || applying || !input.trim()} aria-label="Enviar"><Send size={17} /></button>
              </div>
              <small className={styles.hint}>Enter para enviar · Shift + Enter para nueva línea</small>
            </form>
          </>
        )}
      </section>
    </>
  );
}
