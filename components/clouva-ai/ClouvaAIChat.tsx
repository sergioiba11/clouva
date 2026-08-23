"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Code2,
  Copy,
  FileCode2,
  FolderGit2,
  GitBranch,
  History,
  Loader2,
  MessageCircle,
  PanelLeft,
  PanelRight,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  WandSparkles,
  X,
} from "lucide-react";
import { GeminiModelSelector } from "@/components/clouva-ai/GeminiModelSelector";
import {
  CLOUVA_AI_WELCOME,
  useClouvaAIConversation,
  type ClouvaAIProjectAccessState,
} from "@/components/clouva-ai/useClouvaAIConversation";
import styles from "./ClouvaAIChat.module.css";

const MASCOT_SRC = "/assets/clouva-ai/trebol-mascot.png";
const INITIAL_VISIBLE_MESSAGES = 12;
const QUICK_PROMPTS = [
  { icon: Code2, label: "Revisar código", prompt: "Revisá el estado del proyecto y decime cuál es la mejora técnica más importante para hacer ahora." },
  { icon: WandSparkles, label: "Mejorar una pantalla", prompt: "Quiero mejorar una pantalla de CLOUVA. Ayudame a definir el cambio y qué archivos tenemos que revisar." },
  { icon: ShieldCheck, label: "Buscar riesgos", prompt: "Auditá el proyecto y priorizá riesgos de seguridad, permisos y datos." },
];

function previewSelection(content: string) {
  if (!content.includes("Web Preview") || !content.includes("Selector:")) return null;
  const values: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return {
    request: values.Pedido || "Cambio solicitado desde Web Preview",
    element: values.Elemento || "Elemento seleccionado",
    selector: values.Selector || "Sin selector",
    route: values.Ruta || "/",
  };
}

function InlineCode({ text }: { text: string }) {
  const pieces = text.split(/(`[^`]+`)/g);
  return (
    <>
      {pieces.map((piece, index) =>
        piece.startsWith("`") && piece.endsWith("`") ? (
          <code key={index} className={styles.inlineCode}>{piece.slice(1, -1)}</code>
        ) : (
          <span key={index}>{piece}</span>
        ),
      )}
    </>
  );
}

function RichMessage({ content }: { content: string }) {
  const blocks = content.split(/(```[\s\S]*?```)/g).filter(Boolean);
  return (
    <div className={styles.richMessage}>
      {blocks.map((block, blockIndex) => {
        if (block.startsWith("```") && block.endsWith("```")) {
          const raw = block.slice(3, -3);
          const newline = raw.indexOf("\n");
          const language = newline > -1 ? raw.slice(0, newline).trim() : "";
          const code = newline > -1 ? raw.slice(newline + 1) : raw;
          return (
            <div key={blockIndex} className={styles.codeBlock}>
              {language && <span>{language}</span>}
              <pre>{code}</pre>
            </div>
          );
        }

        return block.split("\n").map((line, lineIndex) => {
          const trimmed = line.trim();
          if (!trimmed) return <span key={`${blockIndex}-${lineIndex}`} className={styles.messageSpacer} />;
          if (trimmed.startsWith("### ")) return <h4 key={`${blockIndex}-${lineIndex}`}><InlineCode text={trimmed.slice(4)} /></h4>;
          if (trimmed.startsWith("## ")) return <h3 key={`${blockIndex}-${lineIndex}`}><InlineCode text={trimmed.slice(3)} /></h3>;
          if (/^[-*] /.test(trimmed)) return <p key={`${blockIndex}-${lineIndex}`} className={styles.listLine}>• <InlineCode text={trimmed.slice(2)} /></p>;
          return <p key={`${blockIndex}-${lineIndex}`}><InlineCode text={line} /></p>;
        });
      })}
    </div>
  );
}

function PreviewSelectionCard({ content }: { content: string }) {
  const selection = previewSelection(content);
  if (!selection) return <RichMessage content={content} />;
  return (
    <div className={styles.previewCard}>
      <div className={styles.previewCardHeader}>
        <span><Sparkles className="h-3.5 w-3.5" /> Web Preview</span>
        <code>{selection.route}</code>
      </div>
      <strong>{selection.request}</strong>
      <dl>
        <div><dt>Elemento</dt><dd>{selection.element}</dd></div>
        <div><dt>Selector</dt><dd>{selection.selector}</dd></div>
      </dl>
    </div>
  );
}

function Mascot({ size = 42, priority = false }: { size?: number; priority?: boolean }) {
  return (
    <Image
      src={MASCOT_SRC}
      alt="Trébol, la mascota de CLOUVA AI"
      width={size}
      height={size}
      priority={priority}
      className={styles.mascotImage}
    />
  );
}

function StatusIcon({ state }: { state: ClouvaAIProjectAccessState }) {
  if (state === "connected") return <CheckCircle2 className="h-3.5 w-3.5" />;
  if (state === "checking") return <Loader2 className="h-3.5 w-3.5 animate-spin" />;
  return <AlertTriangle className="h-3.5 w-3.5" />;
}

export function ClouvaAIChat() {
  const {
    messages,
    conversations,
    conversationId,
    input,
    setInput,
    mode,
    changeMode,
    projectAccess,
    accessText,
    projectReport,
    loadingHistory,
    loading,
    applying,
    error,
    clearError,
    reportError,
    activeModel,
    pendingAction,
    dismissPendingAction,
    refreshProjectAccess,
    openConversation,
    sendMessage,
    applyChange,
    newConversation,
  } = useClouvaAIConversation();
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_MESSAGES);
  const [copiedMessageIndex, setCopiedMessageIndex] = useState<number | null>(null);
  const [showConversations, setShowConversations] = useState(false);
  const [showProject, setShowProject] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  const messageOffset = Math.max(messages.length - visibleCount, 0);
  const visibleMessages = messages.slice(messageOffset);
  const hiddenMessageCount = messageOffset;

  useEffect(() => {
    const container = chatScrollRef.current;
    if (!container) return;
    const frame = window.requestAnimationFrame(() => {
      container.scrollTo({ top: container.scrollHeight, behavior: loadingHistory ? "auto" : "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages.length, loading, pendingAction, loadingHistory]);

  async function copyMessage(content: string, index: number) {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(content);
      else {
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
      reportError("No se pudo copiar este mensaje.");
    }
  }

  function showOlderMessages() {
    const container = chatScrollRef.current;
    const previousHeight = container?.scrollHeight ?? 0;
    setVisibleCount((current) => current + INITIAL_VISIBLE_MESSAGES);
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      if (container) container.scrollTop += container.scrollHeight - previousHeight;
    }));
  }

  function startNewConversation() {
    newConversation();
    setVisibleCount(INITIAL_VISIBLE_MESSAGES);
    setShowConversations(false);
  }

  async function selectConversation(id: string) {
    await openConversation(id);
    setVisibleCount(INITIAL_VISIBLE_MESSAGES);
    setShowConversations(false);
  }

  const isWelcome = !loadingHistory && visibleMessages.length === 1 && visibleMessages[0]?.role === "assistant" && visibleMessages[0].content === CLOUVA_AI_WELCOME;

  return (
    <section className={styles.shell}>
      <div className={styles.auroraOne} />
      <div className={styles.auroraTwo} />
      <div className={styles.gridTexture} />

      <div className={styles.workspace}>
        <aside className={`${styles.sidebar} ${showConversations ? styles.drawerOpen : ""}`}>
          <div className={styles.brand}>
            <div className={styles.brandMascot}><Mascot size={48} priority /></div>
            <div><strong>CLOUVA</strong><span>AI Studio</span></div>
          </div>

          <button type="button" className={styles.newChatButton} onClick={startNewConversation} disabled={loading || applying}>
            <Plus className="h-4 w-4" /> Nueva conversación
          </button>

          <div className={styles.sidebarTitle}><span><History className="h-3.5 w-3.5" /> Recientes</span><small>{conversations.length}</small></div>
          <nav className={styles.conversationList} aria-label="Conversaciones recientes">
            {conversations.length ? conversations.map((conversation) => (
              <button
                type="button"
                key={conversation.id}
                onClick={() => void selectConversation(conversation.id)}
                className={conversation.id === conversationId ? styles.conversationActive : ""}
              >
                <MessageCircle className="h-3.5 w-3.5" />
                <span>{conversation.title || "Conversación sin título"}</span>
              </button>
            )) : <p className={styles.emptyHistory}>Tus conversaciones van a aparecer acá.</p>}
          </nav>

          <div className={styles.sidebarFooter}>
            <span className={styles.onlineDot} />
            <div><strong>Trébol está online</strong><small>Listo para crear con vos</small></div>
          </div>
        </aside>

        <div className={styles.mainColumn}>
          <header className={styles.topbar}>
            <button type="button" className={styles.mobilePanelButton} onClick={() => setShowConversations(true)} aria-label="Abrir conversaciones">
              <PanelLeft className="h-4 w-4" />
            </button>
            <div className={styles.chatIdentity}>
              <div className={styles.topbarMascot}><Mascot size={40} /></div>
              <div><h1>Trébol</h1><p>CLOUVA AI <span>•</span> {activeModel ? activeModel.replace("gemini-", "Gemini ") : "Asistente creativo"}</p></div>
            </div>
            <div className={styles.topbarActions}>
              <div className={styles.modelWrapper}><GeminiModelSelector /></div>
              <button type="button" className={styles.iconButton} onClick={startNewConversation} disabled={loading || applying} aria-label="Nueva conversación"><Plus className="h-4 w-4" /></button>
              <button type="button" className={styles.mobilePanelButton} onClick={() => setShowProject(true)} aria-label="Abrir contexto del proyecto"><PanelRight className="h-4 w-4" /></button>
            </div>
          </header>

          <div className={styles.modebar}>
            <div className={styles.modeSwitch}>
              <button type="button" onClick={() => changeMode("chat")} disabled={loading || applying} className={mode === "chat" ? styles.modeActive : ""}><MessageCircle className="h-3.5 w-3.5" /> Chat</button>
              <button type="button" onClick={() => changeMode("project")} disabled={loading || applying} className={mode === "project" ? styles.modeActive : ""}><GitBranch className="h-3.5 w-3.5" /> Proyecto</button>
            </div>
            <div className={`${styles.accessPill} ${styles[projectAccess.state]}`} title={projectAccess.message || accessText}>
              <StatusIcon state={projectAccess.state} /><span>{accessText}</span>
            </div>
          </div>

          <div ref={chatScrollRef} className={styles.messages}>
            {loadingHistory ? (
              <div className={styles.centerLoader}><Mascot size={72} /><span><Loader2 className="h-4 w-4 animate-spin" /> Recuperando tu conversación…</span></div>
            ) : isWelcome ? (
              <section className={styles.welcome}>
                <div className={styles.welcomeGlow}><Mascot size={164} /></div>
                <p className={styles.eyebrow}><Sparkles className="h-3.5 w-3.5" /> CLOUVA AI</p>
                <h2>¿Qué hacemos hoy?</h2>
                <p>Investigá tu proyecto, convertí una idea en un plan o prepará la próxima mejora con Trébol.</p>
                <div className={styles.quickPrompts}>
                  {QUICK_PROMPTS.map(({ icon: Icon, label, prompt }) => (
                    <button type="button" key={label} onClick={() => setInput(prompt)}><Icon className="h-4 w-4" /><span>{label}</span></button>
                  ))}
                </div>
              </section>
            ) : (
              <>
                {hiddenMessageCount > 0 && <button type="button" onClick={showOlderMessages} className={styles.olderButton}>Mostrar {Math.min(INITIAL_VISIBLE_MESSAGES, hiddenMessageCount)} mensajes anteriores</button>}
                {visibleMessages.map((message, index) => {
                  const globalIndex = messageOffset + index;
                  const copied = copiedMessageIndex === globalIndex;
                  return (
                    <article key={`${message.role}-${globalIndex}`} className={`${styles.messageRow} ${message.role === "user" ? styles.userRow : styles.assistantRow}`}>
                      {message.role === "assistant" && <div className={styles.assistantAvatar}><Mascot size={38} /></div>}
                      <div className={styles.messageBubble}>
                        <div className={styles.messageMeta}>{message.role === "assistant" ? "Trébol" : "Vos"}</div>
                        {message.role === "user" ? <PreviewSelectionCard content={message.content} /> : <RichMessage content={message.content} />}
                        <button type="button" onClick={() => void copyMessage(message.content, globalIndex)} className={styles.copyButton} aria-label="Copiar mensaje">
                          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}{copied ? "Copiado" : "Copiar"}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </>
            )}

            {loading && <article className={`${styles.messageRow} ${styles.assistantRow}`}><div className={styles.assistantAvatar}><Mascot size={38} /></div><div className={`${styles.messageBubble} ${styles.thinking}`}><span><Loader2 className="h-4 w-4 animate-spin" /> {mode === "project" ? "Trébol está leyendo el repositorio…" : "Trébol está pensando…"}</span><i /><i /><i /></div></article>}

            {pendingAction && (
              <section className={styles.changeCard}>
                <div className={styles.changeIcon}><FileCode2 className="h-5 w-5" /></div>
                <div className={styles.changeBody}>
                  <p>Cambio listo para revisar</p><h2>{pendingAction.path}</h2><span>{pendingAction.summary}</span><code>{pendingAction.message}</code>
                  <div><button type="button" onClick={applyChange} disabled={applying || projectAccess.state !== "connected"}>{applying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{applying ? "Aplicando…" : "Aplicar cambio"}</button><button type="button" onClick={dismissPendingAction} disabled={applying}><X className="h-4 w-4" /> Cancelar</button></div>
                </div>
              </section>
            )}
          </div>

          <form onSubmit={sendMessage} className={styles.composerArea}>
            {error && <div className={styles.errorBanner}><AlertTriangle className="h-4 w-4" /><span>{error}</span><button type="button" onClick={clearError} aria-label="Cerrar error"><X className="h-3.5 w-3.5" /></button></div>}
            <div className={styles.composer}>
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }}
                rows={2}
                placeholder={mode === "project" ? "Pedile a Trébol que investigue o mejore tu proyecto…" : "Escribile a Trébol…"}
              />
              <div className={styles.composerBottom}>
                <span>{mode === "project" ? <><FolderGit2 className="h-3.5 w-3.5" /> Trabajando con GitHub real</> : <><Sparkles className="h-3.5 w-3.5" /> Pensamiento creativo</>}</span>
                <button type="submit" disabled={loadingHistory || loading || applying || !input.trim()} aria-label="Enviar mensaje"><Send className="h-4 w-4" /></button>
              </div>
            </div>
            <p className={styles.disclaimer}>Trébol puede equivocarse. Revisá siempre los cambios antes de aplicarlos.</p>
          </form>
        </div>

        <aside className={`${styles.projectPanel} ${showProject ? styles.drawerOpen : ""}`}>
          <div className={styles.projectHeading}><span>Contexto del proyecto</span><button type="button" onClick={() => setShowProject(false)} className={styles.closeDrawer} aria-label="Cerrar panel"><X className="h-4 w-4" /></button></div>
          <section className={styles.repositoryCard}>
            <div><span className={`${styles.repoStatus} ${styles[projectAccess.state]}`}><StatusIcon state={projectAccess.state} /></span><div><strong>{projectAccess.repository || "Repositorio CLOUVA"}</strong><small>{projectAccess.branch ? `rama ${projectAccess.branch}` : "Conexión del proyecto"}</small></div></div>
            {projectAccess.state !== "connected" && <button type="button" onClick={() => void refreshProjectAccess()} disabled={projectAccess.state === "checking"}><RefreshCw className="h-3.5 w-3.5" /> Reintentar</button>}
          </section>

          <section className={styles.contextCard}>
            <div className={styles.contextCardTitle}><span><FolderGit2 className="h-4 w-4" /> Última investigación</span>{projectReport && <small>{projectReport.scope === "broad" ? "Auditoría" : projectReport.scope === "explicit" ? "Archivos" : "Estado"}</small>}</div>
            {projectReport ? <>
              <p>{projectReport.filesReviewed.length ? `${projectReport.filesReviewed.length} archivos revisados` : "Estado del repositorio verificado"}</p>
              {!!projectReport.coverageAreas.length && <div className={styles.tags}>{projectReport.coverageAreas.slice(0, 5).map((area) => <span key={area}>{area}</span>)}</div>}
              {!!projectReport.filesReviewed.length && <ul>{projectReport.filesReviewed.slice(0, 6).map((file) => <li key={file}><FileCode2 className="h-3 w-3" /><span>{file}</span></li>)}</ul>}
            </> : <div className={styles.emptyContext}><Sparkles className="h-5 w-5" /><p>Usá el modo Proyecto y la evidencia de la próxima consulta aparecerá acá.</p></div>}
          </section>

          <section className={styles.safetyCard}><ShieldCheck className="h-4 w-4" /><div><strong>Revisión segura</strong><p>Trébol investiga primero. Ningún archivo cambia sin tu confirmación.</p></div></section>
        </aside>
      </div>

      {(showConversations || showProject) && (
        <button
          type="button"
          className={styles.drawerBackdrop}
          onClick={() => { setShowConversations(false); setShowProject(false); }}
          aria-label="Cerrar panel"
        />
      )}
    </section>
  );
}
