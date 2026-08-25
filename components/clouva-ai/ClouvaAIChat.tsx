"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  GitBranch,
  History,
  Loader2,
  MessageCircle,
  RefreshCw,
  Square,
  X,
} from "lucide-react";
import {
  CLOUVA_AI_MODE_STORAGE_KEY,
  DEFAULT_CLOUVA_AI_MODE,
  normalizeClouvaAIMode,
  projectAccessLabel,
  type ClouvaAIMode,
} from "@/lib/clouva-ai/project-access";
import { supabase } from "@/lib/supabase";
import { useClouvaAIAssistant } from "./ClouvaAIAssistantProvider";
import { ClouvaAIVoiceControls } from "./ClouvaAIVoiceControls";

// Every send — either mode — now goes through the one canonical Orchestrator.
// /api/gemini and /api/clouva-ai/agent are legacy (kept working, not called
// from here anymore); this component doesn't write ai_conversations/
// ai_messages itself either — the Orchestrator is the single server-side
// writer, see app/api/clouva-ai/chat/route.ts.
const ORCHESTRATOR_ENDPOINT = "/api/clouva-ai/chat";

// Task 6: this component is now reusable — a bare <ClouvaAIChat /> (as used
// on /clouva-ai today) is the personal, unscoped chat exactly as before.
// Passing studioId turns it into a Studio-scoped conversation: mode is
// pinned to "chat" (GitHub "Proyecto" mode is an unrelated admin/repo tool,
// not a Studio concept), the header shows the Studio as context instead of
// the active model, and every conversation list/lookup filters by
// studio_id instead of the personal (null) scope. CLOUVA stays the one
// identity either way — this never becomes a second, Studio-branded app.
interface ClouvaAIChatProps {
  studioId?: string | null;
  studioSlug?: string | null;
  studioName?: string | null;
  compact?: boolean;
}

type Message = { role: "user" | "assistant"; content: string; createdAt?: string };
type MessageRow = {
  id: string;
  role: "user" | "assistant";
  content: string;
  metadata?: Record<string, unknown> | null;
  created_at: string;
};
type PendingAction = {
  id: string;
  messageId: string;
  functionName: string;
  target: string;
  tool: string;
  risk: "write" | "destructive" | "sensitive";
  title: string;
  summary: string;
  confirmation: "review" | "explicit";
  preview: {
    kind: "diff" | "parameters";
    detail: string;
    diff?: string;
    truncated?: boolean;
  };
  status: "pending";
  requestedAt: string;
};
type PendingMemoryProposal = {
  id: string;
  messageId: string;
  status: "pending";
  scope: "user" | "studio";
  studioId: string | null;
  conversationId: string;
  sourceMessageId: string;
  memoryType: "decision" | "fact" | "procedure" | "incident" | "solution" | "preference" | "architecture" | "goal";
  title: string;
  content: string;
  importance: number;
  reason: string;
  proposedBy: "gemini";
  proposedAt: string;
};
type ApiPayload = {
  message?: string;
  conversationId?: string;
  model?: string;
  pendingAction?: PendingAction | null;
  pendingMemoryProposal?: PendingMemoryProposal | null;
  error?: string;
};
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
type ConversationSummary = { id: string; title: string | null; updatedAt: string };
type ConversationState = {
  messages: Message[];
  pendingAction: PendingAction | null;
  pendingMemoryProposal: PendingMemoryProposal | null;
};

const WELCOME =
  "Soy Trébol — CLOUVA AI. Proyecto queda listo para investigar el repositorio real mientras tu sesión autorizada siga activa.";
const STUDIO_WELCOME = (name: string) =>
  `Soy Trébol — CLOUVA AI. Estoy viendo el contexto de "${name}": miembros, Players y su estado real. Contame qué necesitás.`;
const INITIAL_VISIBLE_MESSAGES = 12;
const INITIAL_PROJECT_ACCESS: ProjectAccess = {
  state: "checking",
  repository: null,
  branch: null,
  message: null,
  checkedAt: null,
};
const MEMORY_TYPE_LABEL: Record<PendingMemoryProposal["memoryType"], string> = {
  decision: "Decisión",
  fact: "Hecho",
  procedure: "Procedimiento",
  incident: "Incidente",
  solution: "Solución",
  preference: "Preferencia",
  architecture: "Arquitectura",
  goal: "Objetivo",
};

function deduplicate(messages: MessageRow[]) {
  return messages.filter((message, index) => {
    if (index === 0) return true;
    const previous = messages[index - 1];
    return previous.role !== message.role || previous.content !== message.content;
  });
}

function pendingActionFromRows(rows: MessageRow[]): PendingAction | null {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const value = rows[index].metadata?.pendingAction;
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const action = value as Record<string, unknown>;
    const preview = action.preview;
    if (
      action.status !== "pending" ||
      typeof action.id !== "string" ||
      typeof action.functionName !== "string" ||
      typeof action.target !== "string" ||
      typeof action.tool !== "string" ||
      !["write", "destructive", "sensitive"].includes(String(action.risk)) ||
      typeof action.title !== "string" ||
      typeof action.summary !== "string" ||
      !["review", "explicit"].includes(String(action.confirmation)) ||
      !preview ||
      typeof preview !== "object" ||
      Array.isArray(preview) ||
      typeof action.requestedAt !== "string"
    ) {
      continue;
    }

    return {
      id: action.id,
      messageId: rows[index].id,
      functionName: action.functionName,
      target: action.target,
      tool: action.tool,
      risk: action.risk as PendingAction["risk"],
      title: action.title,
      summary: action.summary,
      confirmation: action.confirmation as PendingAction["confirmation"],
      preview: preview as PendingAction["preview"],
      status: "pending",
      requestedAt: action.requestedAt,
    };
  }
  return null;
}

function pendingMemoryProposalFromRows(rows: MessageRow[]): PendingMemoryProposal | null {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const value = rows[index].metadata?.memoryProposal;
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const proposal = value as Record<string, unknown>;
    if (
      proposal.status !== "pending"
      || typeof proposal.id !== "string"
      || !["user", "studio"].includes(String(proposal.scope))
      || !(proposal.studioId === null || typeof proposal.studioId === "string")
      || typeof proposal.conversationId !== "string"
      || typeof proposal.sourceMessageId !== "string"
      || !["decision", "fact", "procedure", "incident", "solution", "preference", "architecture", "goal"].includes(String(proposal.memoryType))
      || typeof proposal.title !== "string"
      || typeof proposal.content !== "string"
      || typeof proposal.importance !== "number"
      || typeof proposal.reason !== "string"
      || proposal.proposedBy !== "gemini"
      || typeof proposal.proposedAt !== "string"
    ) {
      continue;
    }
    return {
      id: proposal.id,
      messageId: rows[index].id,
      status: "pending",
      scope: proposal.scope as PendingMemoryProposal["scope"],
      studioId: proposal.studioId as string | null,
      conversationId: proposal.conversationId,
      sourceMessageId: proposal.sourceMessageId,
      memoryType: proposal.memoryType as PendingMemoryProposal["memoryType"],
      title: proposal.title,
      content: proposal.content,
      importance: proposal.importance,
      reason: proposal.reason,
      proposedBy: "gemini",
      proposedAt: proposal.proposedAt,
    };
  }
  return null;
}

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function formatDateTime(iso: string) {
  try {
    return new Date(iso).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

/** One fenced code block: its own header (language + copy), independent from
 * the per-message "Copiar" button so a long answer's snippet is copyable on
 * its own without grabbing the surrounding prose. */
function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = code;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        textarea.remove();
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // Best-effort — the block stays readable/selectable either way.
    }
  }

  return (
    <div className="my-2 overflow-hidden rounded-xl border border-white/10 bg-black/60">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-1.5">
        <span className="text-[10px] uppercase tracking-wider text-white/40">{language || "código"}</span>
        <button
          type="button"
          onClick={() => void copy()}
          className="flex items-center gap-1 text-[10px] text-white/50 transition hover:text-white"
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copiado" : "Copiar"}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-xs leading-5">
        <code>{code}</code>
      </pre>
    </div>
  );
}

// `pre` (not `code`) is the reliable block-vs-inline signal in react-markdown
// v9+ — fenced code is always `<pre><code>…</code></pre>`, inline code never
// has a `<pre>` ancestor, so overriding `pre` sidesteps guessing from
// className (which fenced blocks without a language tag simply don't have).
const markdownComponents: Components = {
  pre({ children }) {
    const child = Array.isArray(children) ? children[0] : children;
    const codeProps =
      child && typeof child === "object" && "props" in child
        ? (child.props as { className?: string; children?: unknown })
        : undefined;
    const className = codeProps?.className ?? "";
    const match = /language-(\w+)/.exec(className);
    const raw = codeProps?.children;
    const code = (Array.isArray(raw) ? raw.join("") : typeof raw === "string" ? raw : "").replace(/\n$/, "");
    return <CodeBlock language={match?.[1] ?? ""} code={code} />;
  },
  code({ children, className }) {
    return (
      <code className={`rounded bg-black/30 px-1 py-0.5 font-mono text-[0.85em] ${className ?? ""}`}>{children}</code>
    );
  },
  a({ href, children }) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-violet-300 underline decoration-violet-400/40 underline-offset-2 hover:text-violet-200"
      >
        {children}
      </a>
    );
  },
};

function MarkdownMessage({ content }: { content: string }) {
  return (
    <div className="space-y-2 text-sm leading-6 [&_li]:leading-6 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:leading-6 [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:pl-5">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

export function ClouvaAIChat({ studioId = null, studioSlug = null, studioName = null, compact = false }: ClouvaAIChatProps = {}) {
  const {
    context: assistantContext,
    conversationId: sharedConversationId,
    setConversationId: setSharedConversationId,
    setPendingAction: setSharedPendingAction,
    notifyToolDecision,
    starterPrompt,
    consumeStarterPrompt,
  } = useClouvaAIAssistant();
  const isStudioScoped = Boolean(studioId);
  const welcomeMessage = isStudioScoped && studioName ? STUDIO_WELCOME(studioName) : WELCOME;

  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [loadingConversations, setLoadingConversations] = useState(false);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<ClouvaAIMode>(DEFAULT_CLOUVA_AI_MODE);
  const [projectAccess, setProjectAccess] = useState<ProjectAccess>(INITIAL_PROJECT_ACCESS);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFailedMessage, setLastFailedMessage] = useState<string | null>(null);
  const [activeModel, setActiveModel] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [pendingMemoryProposal, setPendingMemoryProposal] = useState<PendingMemoryProposal | null>(null);
  const [explicitConfirmation, setExplicitConfirmation] = useState(false);
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_MESSAGES);
  const [copiedMessageIndex, setCopiedMessageIndex] = useState<number | null>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const projectCheckIdRef = useRef(0);
  const activeControllerRef = useRef<AbortController | null>(null);
  const stopRequestedRef = useRef(false);

  useEffect(() => {
    if (!starterPrompt) return;
    const prompt = consumeStarterPrompt();
    if (prompt) setInput(prompt);
  }, [consumeStarterPrompt, starterPrompt]);

  const messageOffset = Math.max(messages.length - visibleCount, 0);
  const visibleMessages = messages.slice(messageOffset);
  const hiddenMessageCount = messageOffset;
  const accessText = projectAccessLabel(projectAccess);
  const contextLabel = isStudioScoped ? studioName || studioSlug || "Estudio" : null;

  function updateConversationId(id: string | null) {
    setConversationId(id);
    setSharedConversationId(id);
  }

  function updatePendingAction(action: PendingAction | null) {
    setPendingAction(action);
    setSharedPendingAction(action);
  }

  // Re-runs whenever the caller swaps studioId (e.g. a Studio dashboard
  // navigating between Studios without unmounting this component) — not
  // just on first mount, so the component genuinely re-scopes itself
  // instead of only working correctly the first time it's rendered.
  useEffect(() => {
    const storedMode = isStudioScoped
      ? "chat"
      : normalizeClouvaAIMode(window.localStorage.getItem(CLOUVA_AI_MODE_STORAGE_KEY));
    setMode(storedMode);
    setConversations([]);
    setShowHistory(false);
    setLastFailedMessage(null);
    void loadLatestConversation();
    if (!isStudioScoped) void refreshProjectAccess();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        if (!isStudioScoped) {
          setProjectAccess({
            state: "signed_out",
            repository: null,
            branch: null,
            message: "Iniciá sesión para activar Proyecto",
            checkedAt: Date.now(),
          });
        }
        return;
      }
      if (!isStudioScoped) void refreshProjectAccess(session.access_token);
    });

    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studioId]);

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
  }, [messages.length, loading, pendingAction, pendingMemoryProposal, loadingHistory]);

  useEffect(() => {
    setExplicitConfirmation(false);
  }, [pendingAction?.id]);

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
    if (isStudioScoped) return; // "Proyecto" (GitHub repo) mode isn't a Studio concept.
    setMode(nextMode);
    window.localStorage.setItem(CLOUVA_AI_MODE_STORAGE_KEY, nextMode);
    setError(null);

    if (nextMode === "project" && projectAccess.state !== "connected") {
      void refreshProjectAccess();
    }
  }

  /** studio_id-aware filter shared by the "latest conversation" and the
   * "conversation list" queries — `.is(null)` for personal chat, `.eq(id)`
   * for a Studio, so neither ever leaks into the other's history. */
  function scopedConversationsQuery() {
    const base = supabase.from("ai_conversations").select("id,title,updated_at").eq("project_key", "clouva");
    return studioId ? base.eq("studio_id", studioId) : base.is("studio_id", null);
  }

  async function fetchMessages(id: string, userId: string): Promise<ConversationState> {
    const { data, error: messagesError } = await supabase
      .from("ai_messages")
      .select("id,role,content,metadata,created_at")
      .eq("conversation_id", id)
      .eq("user_id", userId)
      .order("created_at", { ascending: true });

    if (messagesError) throw messagesError;
    const rows = (data ?? []) as MessageRow[];
    const restored = deduplicate(rows);
    return {
      messages: restored.length
        ? restored.map(({ role, content, created_at }) => ({ role, content, createdAt: created_at }))
        : [{ role: "assistant", content: welcomeMessage }],
      pendingAction: pendingActionFromRows(rows),
      pendingMemoryProposal: pendingMemoryProposalFromRows(rows),
    };
  }

  async function loadLatestConversation() {
    setLoadingHistory(true);
    setError(null);

    try {
      const session = await getSession();
      let conversation: { id: string; title: string | null; updated_at: string } | null = null;

      // A Live session or the compact panel may already have selected the
      // conversation. Reuse it only if RLS and this exact personal/Studio
      // scope confirm it; otherwise fall back to the newest scoped chat.
      if (sharedConversationId) {
        const preferred = await scopedConversationsQuery()
          .eq("user_id", session.user.id)
          .eq("id", sharedConversationId)
          .maybeSingle();
        if (preferred.error) throw preferred.error;
        conversation = preferred.data;
      }

      if (!conversation) {
        const latest = await scopedConversationsQuery()
          .eq("user_id", session.user.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (latest.error) throw latest.error;
        conversation = latest.data;
      }

      if (!conversation) {
        updateConversationId(null);
        setMessages([{ role: "assistant", content: welcomeMessage }]);
        updatePendingAction(null);
        setPendingMemoryProposal(null);
        setVisibleCount(INITIAL_VISIBLE_MESSAGES);
        return;
      }

      const restored = await fetchMessages(conversation.id, session.user.id);
      updateConversationId(conversation.id);
      setVisibleCount(INITIAL_VISIBLE_MESSAGES);
      setMessages(restored.messages);
      updatePendingAction(restored.pendingAction);
      setPendingMemoryProposal(restored.pendingMemoryProposal);
    } catch (caught) {
      setMessages([{ role: "assistant", content: welcomeMessage }]);
      updatePendingAction(null);
      setPendingMemoryProposal(null);
      setError(caught instanceof Error ? caught.message : "No se pudo cargar el historial.");
    } finally {
      setLoadingHistory(false);
    }
  }

  async function loadConversationList() {
    setLoadingConversations(true);
    try {
      const session = await getSession();
      const { data, error: listError } = await scopedConversationsQuery()
        .eq("user_id", session.user.id)
        .order("updated_at", { ascending: false })
        .limit(25);

      if (listError) throw listError;
      setConversations((data ?? []).map((row) => ({ id: row.id, title: row.title, updatedAt: row.updated_at })));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo cargar el historial de conversaciones.");
    } finally {
      setLoadingConversations(false);
    }
  }

  function toggleHistory() {
    setShowHistory((current) => {
      const next = !current;
      if (next) void loadConversationList();
      return next;
    });
  }

  async function openConversation(id: string) {
    if (id === conversationId) {
      setShowHistory(false);
      return;
    }
    setShowHistory(false);
    setLoadingHistory(true);
    setError(null);
    updatePendingAction(null);
    setPendingMemoryProposal(null);
    try {
      const session = await getSession();
      const restored = await fetchMessages(id, session.user.id);
      updateConversationId(id);
      setVisibleCount(INITIAL_VISIBLE_MESSAGES);
      setMessages(restored.messages);
      updatePendingAction(restored.pendingAction);
      setPendingMemoryProposal(restored.pendingMemoryProposal);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo abrir esa conversación.");
    } finally {
      setLoadingHistory(false);
    }
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

  function stopGeneration() {
    if (!loading) return;
    stopRequestedRef.current = true;
    activeControllerRef.current?.abort();
  }

  function retryLastMessage() {
    if (!lastFailedMessage || loading || applying || pendingAction || pendingMemoryProposal) return;
    const message = lastFailedMessage;
    setLastFailedMessage(null);
    setError(null);
    // The failed user bubble + its "No pude responder" bubble are the last
    // two entries (performSend always appends them as a pair) — drop them
    // so the retry re-appends a clean pair instead of stacking duplicates.
    setMessages((current) => current.slice(0, -2));
    void performSend(message);
  }

  async function performSend(message: string) {
    if (!message || loading || applying) return;
    if (pendingAction || pendingMemoryProposal) {
      setError(
        pendingAction
          ? "Confirmá o cancelá la acción pendiente antes de enviar otro mensaje."
          : "Aprobá o rechazá la propuesta de memoria antes de enviar otro mensaje.",
      );
      return;
    }

    setError(null);
    setLoading(true);
    stopRequestedRef.current = false;
    setMessages((current) => [...current, { role: "user", content: message, createdAt: new Date().toISOString() }]);
    let placeholderAdded = false;
    let accumulated = "";

    try {
      const session = await getSession();
      if (mode === "project" && projectAccess.state !== "connected") {
        // GitHub status remains useful UI context, but it no longer blocks
        // the whole tool router: a valid request may only need Workspace.
        void refreshProjectAccess(session.access_token);
      }

      const controller = new AbortController();
      activeControllerRef.current = controller;
      const timeout = window.setTimeout(
        () => controller.abort(),
        mode === "project" || isStudioScoped ? 60_000 : 38_000,
      );

      // The Orchestrator does its own persistence (both messages,
      // conversation resolution/creation, memory, events) server-side under
      // this same user's session — this component never writes to Supabase
      // itself and never sends history from the client; the Orchestrator
      // reads it back from the conversation it just resolved.
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
          mode,
          screenContext: {
            ...assistantContext,
            page: window.location.pathname,
            url: window.location.href,
            capturedAt: new Date().toISOString(),
            ...(mode === "project"
              ? { repository: projectAccess.repository || "sergioiba11/clouva", branch: projectAccess.branch || "main" }
              : {}),
          },
        }),
        signal: controller.signal,
        cache: "no-store",
      }).finally(() => window.clearTimeout(timeout));

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as ApiPayload;
        throw new Error(payload.error ?? "CLOUVA AI no respondió.");
      }
      if (!response.body) throw new Error("CLOUVA AI no devolvió una respuesta streameable.");

      // One NDJSON frame per line — {type:"chunk"} grows the answer as it
      // arrives, {type:"done"} carries the turn's metadata, {type:"error"}
      // can show up even on a 200 (the failure happened after headers were
      // already sent). Append a live bubble now and grow it in place.
      type DoneFrame = {
        conversationId?: string;
        model?: string;
        pendingAction?: PendingAction | null;
        pendingMemoryProposal?: PendingMemoryProposal | null;
      };
      let streamError: string | null = null;
      let doneFrame: DoneFrame | null = null;
      setMessages((current) => [...current, { role: "assistant", content: "" }]);
      placeholderAdded = true;

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          let frame: { type?: string; text?: string; error?: string } & Record<string, unknown>;
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
          } else if (frame.type === "error" && typeof frame.error === "string") {
            streamError = frame.error;
          }
        }
      }

      if (streamError) throw new Error(streamError);
      if (!accumulated) throw new Error("CLOUVA AI respondió sin contenido.");

      if (doneFrame?.conversationId) updateConversationId(doneFrame.conversationId);
      setActiveModel(doneFrame?.model ?? null);
      updatePendingAction(doneFrame?.pendingAction ?? null);
      setPendingMemoryProposal(doneFrame?.pendingMemoryProposal ?? null);
      setMessages((current) => {
        const next = current.slice();
        const last = next[next.length - 1];
        if (last?.role === "assistant") next[next.length - 1] = { ...last, createdAt: new Date().toISOString() };
        return next;
      });
      // Refresh the history panel's list in the background — a brand-new
      // conversation or a title/updated_at change should show up next time
      // it's opened without the user needing to manually reload it.
      if (showHistory) void loadConversationList();
    } catch (caught) {
      const aborted = caught instanceof Error && caught.name === "AbortError";

      if (aborted && stopRequestedRef.current) {
        // Manual stop: this only stops the client from waiting on the
        // fetch — Next's route handler keeps running server-side and may
        // still finish generating and persist the full answer. Known,
        // deliberate limitation (true cancellation needs the server to
        // observe client disconnect, not wired yet) — surfaced here rather
        // than implied as solved.
        setMessages((current) => {
          const finalText = accumulated
            ? `${accumulated}\n\n*Generación detenida — CLOUVA AI puede seguir procesando en segundo plano y guardar la respuesta completa igual.*`
            : "*Generación detenida antes de recibir texto.*";
          if (!placeholderAdded) return [...current, { role: "assistant", content: finalText, createdAt: new Date().toISOString() }];
          const next = current.slice();
          next[next.length - 1] = { role: "assistant", content: finalText, createdAt: new Date().toISOString() };
          return next;
        });
      } else {
        const failure = aborted
          ? "La consulta superó el tiempo máximo. Probá nuevamente."
          : caught instanceof Error
            ? caught.message
            : "Error inesperado.";

        setError(failure);
        setLastFailedMessage(message);
        setMessages((current) => {
          // A partial/empty streamed bubble is already in the list once the
          // request got as far as opening the stream — replace it instead of
          // leaving a dangling empty message plus a second error one.
          if (placeholderAdded) {
            const next = current.slice();
            next[next.length - 1] = { role: "assistant", content: `No pude responder: ${failure}` };
            return next;
          }
          return [...current, { role: "assistant", content: `No pude responder: ${failure}` }];
        });
      }
    } finally {
      setLoading(false);
      activeControllerRef.current = null;
    }
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    const message = input.trim();
    if (!message || loading || applying || pendingAction || pendingMemoryProposal) return;
    setInput("");
    void performSend(message);
  }

  async function applyChange() {
    if (!pendingAction || applying) return;
    if (pendingAction.confirmation === "explicit" && !explicitConfirmation) {
      setError("Aceptá explícitamente el impacto antes de confirmar esta acción de alto riesgo.");
      return;
    }
    setApplying(true);
    setError(null);

    try {
      const session = await getSession();
      const response = await fetch(ORCHESTRATOR_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          action: "confirm_tool",
          conversationId,
          pendingMessageId: pendingAction.messageId,
          pendingActionId: pendingAction.id,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        message?: string;
        pendingAction?: null;
        error?: string;
      };
      if (!response.ok) {
        if (payload.pendingAction === null || response.status === 404 || response.status === 409) updatePendingAction(null);
        throw new Error(payload.error ?? "No se pudo aplicar el cambio.");
      }

      const text = payload.message ?? `Acción ejecutada: ${pendingAction.title}.`;
      setMessages((current) => [...current, { role: "assistant", content: text, createdAt: new Date().toISOString() }]);
      notifyToolDecision(text);
      updatePendingAction(null);
      if (pendingAction.target === "github") void refreshProjectAccess(session.access_token);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo aplicar el cambio.");
    } finally {
      setApplying(false);
    }
  }

  async function cancelChange() {
    if (!pendingAction || applying) return;
    setApplying(true);
    setError(null);

    try {
      const session = await getSession();
      const response = await fetch(ORCHESTRATOR_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          action: "cancel_tool",
          conversationId,
          pendingMessageId: pendingAction.messageId,
          pendingActionId: pendingAction.id,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!response.ok) {
        if (response.status === 404 || response.status === 409) updatePendingAction(null);
        throw new Error(payload.error ?? "No se pudo cancelar la acción.");
      }

      const text = payload.message ?? `Acción cancelada: ${pendingAction.title}.`;
      setMessages((current) => [...current, { role: "assistant", content: text, createdAt: new Date().toISOString() }]);
      notifyToolDecision(text);
      updatePendingAction(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo cancelar la acción.");
    } finally {
      setApplying(false);
    }
  }

  async function decideMemory(approve: boolean) {
    if (!pendingMemoryProposal || applying) return;
    setApplying(true);
    setError(null);

    try {
      const session = await getSession();
      const response = await fetch(ORCHESTRATOR_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          action: approve ? "approve_memory" : "reject_memory",
          conversationId,
          memoryMessageId: pendingMemoryProposal.messageId,
          memoryProposalId: pendingMemoryProposal.id,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        message?: string;
        pendingMemoryProposal?: null;
        error?: string;
      };
      if (!response.ok) {
        if (payload.pendingMemoryProposal === null || response.status === 404 || response.status === 409) {
          setPendingMemoryProposal(null);
        }
        throw new Error(payload.error ?? "No se pudo resolver la propuesta de memoria.");
      }

      const text = payload.message ?? (approve ? "Memoria aprobada." : "Propuesta de memoria rechazada.");
      setMessages((current) => [...current, { role: "assistant", content: text, createdAt: new Date().toISOString() }]);
      setPendingMemoryProposal(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo resolver la propuesta de memoria.");
    } finally {
      setApplying(false);
    }
  }

  function newConversation() {
    updateConversationId(null);
    setMessages([{ role: "assistant", content: welcomeMessage }]);
    setVisibleCount(INITIAL_VISIBLE_MESSAGES);
    setError(null);
    setLastFailedMessage(null);
    setActiveModel(null);
    updatePendingAction(null);
    setPendingMemoryProposal(null);
    setShowHistory(false);
  }

  return (
    <section className={`mx-auto flex min-h-0 w-full flex-1 flex-col text-white ${compact ? "px-3 pb-3 pt-2" : "max-w-5xl px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-6"}`}>
      <header className="mb-3 flex shrink-0 items-center justify-between gap-3 border-b border-violet-500/20 pb-3">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.28em] text-violet-300">Asistente CLOUVA</p>
          <h1 className="text-xl font-semibold">Trébol — CLOUVA AI</h1>
          {contextLabel ? (
            <Link
              href={`/studio-dashboard/${studioId}`}
              className="mt-0.5 block truncate text-xs text-violet-300/80 transition hover:text-violet-200"
            >
              Contexto: {contextLabel}
            </Link>
          ) : (
            <p className="mt-0.5 truncate text-xs text-white/50">
              {activeModel ? `Modelo activo: ${activeModel}` : "Proyecto con acceso GitHub persistente"}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={toggleHistory}
            disabled={loadingHistory || loading || applying}
            aria-label="Ver conversaciones anteriores"
            className={`rounded-full border px-3 py-2 text-xs transition disabled:opacity-40 ${
              showHistory
                ? "border-violet-400/60 bg-violet-500/15 text-white"
                : "border-white/15 text-white/75 hover:border-violet-400/60 hover:text-white"
            }`}
          >
            <History className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={newConversation}
            disabled={loadingHistory || loading || applying}
            className="rounded-full border border-white/15 px-3 py-2 text-xs text-white/75 transition hover:border-violet-400/60 hover:text-white disabled:opacity-40"
          >
            Nueva
          </button>
        </div>
      </header>

      {showHistory && (
        <div className="relative z-10 mb-2 shrink-0">
          <div className="max-h-[50vh] w-full overflow-y-auto rounded-2xl border border-white/10 bg-zinc-950 p-2 shadow-xl shadow-black/40">
            {loadingConversations ? (
              <p className="flex items-center gap-2 px-3 py-2 text-xs text-white/40">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando conversaciones…
              </p>
            ) : conversations.length === 0 ? (
              <p className="px-3 py-2 text-xs text-white/40">Todavía no hay conversaciones guardadas acá.</p>
            ) : (
              conversations.map((conv) => (
                <button
                  key={conv.id}
                  type="button"
                  onClick={() => void openConversation(conv.id)}
                  className={`block w-full rounded-xl px-3 py-2 text-left transition ${
                    conv.id === conversationId ? "bg-violet-600/25 text-white" : "text-white/70 hover:bg-white/5"
                  }`}
                >
                  <span className="block truncate text-xs font-medium">{conv.title || "Conversación sin título"}</span>
                  <span className="block text-[10px] text-white/35">{formatDateTime(conv.updatedAt)}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {!isStudioScoped && (
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
      )}

      {!isStudioScoped && (
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
      )}

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
                    {message.role === "assistant" ? (
                      <MarkdownMessage content={message.content} />
                    ) : (
                      <p className="whitespace-pre-wrap break-words text-sm leading-6">{message.content}</p>
                    )}
                  </div>

                  {message.createdAt && (
                    <p
                      className={`mt-1.5 text-[10px] ${
                        message.role === "user" ? "text-white/60" : "text-white/30"
                      }`}
                    >
                      {formatTime(message.createdAt)}
                    </p>
                  )}
                </article>
              );
            })}
          </>
        )}

        {loading && (
          <article className="flex max-w-[94%] items-center justify-between gap-3 rounded-2xl border border-violet-400/20 bg-violet-500/10 px-4 py-3 text-sm text-violet-100">
            <span className="flex min-w-0 items-center gap-3">
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
              <span className="truncate">{mode === "project" ? "Leyendo el repositorio…" : "Gemini está respondiendo…"}</span>
            </span>
            <button
              type="button"
              onClick={stopGeneration}
              className="flex shrink-0 items-center gap-1 rounded-full border border-violet-300/30 px-2.5 py-1.5 text-[11px] font-medium text-violet-100 transition hover:bg-violet-500/20"
            >
              <Square className="h-3 w-3" /> Detener
            </button>
          </article>
        )}

        {pendingAction && (
          <section
            className={`rounded-3xl border p-4 ${
              pendingAction.confirmation === "explicit"
                ? "border-amber-400/40 bg-amber-500/10"
                : "border-violet-400/30 bg-violet-500/10"
            }`}
          >
            <p className={`text-xs font-bold uppercase tracking-[0.2em] ${pendingAction.confirmation === "explicit" ? "text-amber-300" : "text-violet-300"}`}>
              {pendingAction.confirmation === "explicit" ? "Confirmación reforzada" : "Revisión requerida"}
            </p>
            <h2 className="mt-2 break-all font-semibold">{pendingAction.title}</h2>
            <p className="mt-2 text-sm leading-6 text-white/70">{pendingAction.summary}</p>
            <p className="mt-2 text-xs text-white/40">
              {pendingAction.target} · {pendingAction.tool} · riesgo {pendingAction.risk}
            </p>

            <div className="mt-3 overflow-hidden rounded-2xl border border-white/10 bg-black/50">
              <div className="border-b border-white/10 px-3 py-2 text-xs text-white/55">{pendingAction.preview.detail}</div>
              {pendingAction.preview.diff ? (
                <pre className="max-h-80 overflow-auto whitespace-pre p-3 text-[11px] leading-5 text-white/75">
                  <code>{pendingAction.preview.diff}</code>
                </pre>
              ) : (
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap p-3 text-[11px] leading-5 text-white/75">
                  <code>{pendingAction.preview.detail}</code>
                </pre>
              )}
            </div>
            {pendingAction.preview.truncated && (
              <p className="mt-2 text-xs text-amber-200/75">La vista previa fue acotada; revisá con especial cuidado antes de confirmar.</p>
            )}

            {pendingAction.confirmation === "explicit" && (
              <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-2xl border border-amber-300/20 bg-black/25 p-3 text-sm text-amber-100">
                <input
                  type="checkbox"
                  checked={explicitConfirmation}
                  onChange={(event) => setExplicitConfirmation(event.target.checked)}
                  disabled={applying}
                  className="mt-0.5 h-4 w-4 accent-amber-400"
                />
                <span>Entiendo que esta acción es destructiva o sensible y quiero ejecutarla igualmente.</span>
              </label>
            )}

            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={applyChange}
                disabled={applying || (pendingAction.confirmation === "explicit" && !explicitConfirmation)}
                className="flex flex-1 items-center justify-center gap-2 rounded-full bg-violet-600 px-4 py-3 text-sm font-semibold disabled:opacity-50"
              >
                {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {applying ? "Procesando…" : "Confirmar y ejecutar"}
              </button>
              <button
                type="button"
                onClick={cancelChange}
                disabled={applying}
                className="flex items-center gap-2 rounded-full border border-white/15 px-4 py-3 text-sm"
              >
                <X className="h-4 w-4" /> Cancelar
              </button>
            </div>
          </section>
        )}

        {pendingMemoryProposal && (
          <section className="rounded-3xl border border-cyan-400/30 bg-cyan-500/10 p-4">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-300">Propuesta de memoria</p>
            <h2 className="mt-2 font-semibold">{pendingMemoryProposal.title}</h2>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-white/75">{pendingMemoryProposal.content}</p>
            <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-white/55">
              <span className="rounded-full border border-white/10 px-2.5 py-1">
                {MEMORY_TYPE_LABEL[pendingMemoryProposal.memoryType]}
              </span>
              <span className="rounded-full border border-white/10 px-2.5 py-1">
                Scope: {pendingMemoryProposal.scope === "studio" ? "Studio" : "personal"}
              </span>
              <span className="rounded-full border border-white/10 px-2.5 py-1">
                Importancia: {pendingMemoryProposal.importance}/5
              </span>
            </div>
            {pendingMemoryProposal.reason ? (
              <p className="mt-3 text-xs leading-5 text-white/45">Motivo de la propuesta: {pendingMemoryProposal.reason}</p>
            ) : null}
            <p className="mt-3 rounded-2xl border border-cyan-300/15 bg-black/25 p-3 text-xs leading-5 text-cyan-100/80">
              Todavía no está guardada ni forma parte del contexto. Sólo se promoverá a memoria real si la aprobás.
            </p>
            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={() => void decideMemory(true)}
                disabled={applying}
                className="flex flex-1 items-center justify-center gap-2 rounded-full bg-cyan-500 px-4 py-3 text-sm font-semibold text-black disabled:opacity-50"
              >
                {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {applying ? "Procesando…" : "Aprobar memoria"}
              </button>
              <button
                type="button"
                onClick={() => void decideMemory(false)}
                disabled={applying}
                className="flex items-center gap-2 rounded-full border border-white/15 px-4 py-3 text-sm"
              >
                <X className="h-4 w-4" /> Rechazar
              </button>
            </div>
          </section>
        )}
      </div>

      <div data-trebol-ui className="mt-3 shrink-0">
        <ClouvaAIVoiceControls />
      </div>

      <form onSubmit={sendMessage} className="mt-3 shrink-0">
        <div className="rounded-3xl border border-white/10 bg-zinc-950 p-3 transition focus-within:border-violet-400/50">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            disabled={Boolean(pendingAction || pendingMemoryProposal)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            rows={2}
            placeholder={
              pendingAction
                ? "Resolvé la acción pendiente para continuar…"
                : pendingMemoryProposal
                  ? "Revisá la propuesta de memoria para continuar…"
                : mode === "project"
                ? "Pedile que investigue archivos reales del proyecto…"
                : isStudioScoped
                  ? `Escribile a Trébol sobre ${contextLabel}…`
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
                : isStudioScoped
                  ? "Chat usa el contexto real del Estudio"
                  : "Chat usa la visión de CLOUVA"}
            </p>
            <button
              type="submit"
              disabled={loadingHistory || loading || applying || Boolean(pendingAction || pendingMemoryProposal) || !input.trim()}
              className="rounded-full bg-violet-600 px-5 py-2 text-sm font-medium transition hover:bg-violet-500 disabled:opacity-40"
            >
              {loading ? "Esperando…" : "Enviar"}
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-2 flex items-center justify-between gap-3 rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-2.5 text-sm text-red-200">
            <span className="min-w-0 flex-1">{error}</span>
            {lastFailedMessage && (
              <button
                type="button"
                onClick={() => retryLastMessage()}
                disabled={loading || applying}
                className="inline-flex shrink-0 items-center gap-1 rounded-full border border-red-300/30 px-3 py-1.5 text-xs font-medium text-red-100 transition hover:bg-red-500/20 disabled:opacity-40"
              >
                <RefreshCw className="h-3 w-3" /> Reintentar
              </button>
            )}
          </div>
        )}
      </form>
    </section>
  );
}
