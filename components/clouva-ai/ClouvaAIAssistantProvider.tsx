"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useParams, usePathname } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { useCurrentPlayer } from "@/components/current-player-provider";
import {
  buildTrebolRuntimeContext,
  diffTrebolRuntimeContext,
} from "@/lib/clouva-ai/agent/context-builder";
import type {
  TrebolContextPatch,
  TrebolRuntimeContext,
  TrebolSelectedElement,
} from "@/lib/clouva-ai/agent/types";
import type { PendingToolActionView } from "@/lib/clouva-ai/tool-confirmation";
import { useActiveAvatarStore } from "@/lib/avatar-engine/active-avatar-store";
import {
  collectVisibleTrebolElements,
  resolveClouvaPageContext,
  type ClouvaPageContext,
  type ClouvaPageContextRegistration,
  type ClouvaViewerContext,
} from "@/lib/clouva-ai/page-context";
import {
  canSelectTrebolElement,
  describeTrebolElement,
} from "@/lib/clouva-ai/visual-selection";

type Registration = { scope: string; id: string; data: Record<string, unknown> };

type ClouvaAIAssistantValue = {
  isOpen: boolean;
  open: boolean;
  setOpen: (open: boolean) => void;
  starterPrompt: string | null;
  openAssistant: (prompt?: string) => void;
  closeAssistant: () => void;
  toggleAssistant: () => void;
  consumeStarterPrompt: () => string | null;
  conversationId: string | null;
  setConversationId: (id: string | null) => void;
  pendingAction: PendingToolActionView | null;
  setPendingAction: (action: PendingToolActionView | null) => void;
  toolDecisionNotice: { id: number; message: string } | null;
  notifyToolDecision: (message: string) => void;
  context: TrebolRuntimeContext;
  contextPatch: TrebolContextPatch;
  pageContext: ClouvaPageContext;
  viewerContext: ClouvaViewerContext;
  selectingElement: boolean;
  startElementSelection: () => void;
  stopElementSelection: () => void;
  clearSelection: () => void;
  registerContext: (registration: Registration) => () => void;
};

const ClouvaAIAssistantContext = createContext<ClouvaAIAssistantValue | null>(null);

function paramsRecord(value: ReturnType<typeof useParams>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, Array.isArray(item) ? item.join("/") : String(item)]),
  );
}

function registeredValue(
  registrations: Record<string, Registration>,
  key: string,
): string | undefined {
  for (const registration of Object.values(registrations)) {
    const value = registration.data[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function viewerExperience(args: {
  onboardingStatus?: string | null;
  role?: string | null;
  hasPlayer: boolean;
}): ClouvaViewerContext["experience"] {
  const status = args.onboardingStatus?.trim().toLowerCase() ?? "";
  if (!status || status === "pending" || status === "new") return args.hasPlayer ? "onboarding" : "new";
  if (!["completed", "complete", "done", "ready", "skipped"].includes(status)) return "onboarding";
  if (args.role === "admin" || args.role === "empleado") return "advanced";
  return "existing";
}

export function ClouvaAIAssistantProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const params = useParams();
  const { user, profile, role } = useAuth();
  const { currentPlayer } = useCurrentPlayer();
  const avatar = useActiveAvatarStore((state) => state.avatar);
  const [isOpen, setOpen] = useState(false);
  const [starterPrompt, setStarterPrompt] = useState<string | null>(null);
  const starterPromptRef = useRef<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingToolActionView | null>(null);
  const [toolDecisionNotice, setToolDecisionNotice] = useState<{ id: number; message: string } | null>(null);
  const toolDecisionSequence = useRef(0);
  const [registrations, setRegistrations] = useState<Record<string, Registration>>({});
  const [selectedElement, setSelectedElement] = useState<TrebolSelectedElement>();
  const [selectingElement, setSelectingElement] = useState(false);
  const [visibleElements, setVisibleElements] = useState(() => collectVisibleTrebolElements());
  const previousContextRef = useRef<TrebolRuntimeContext | null>(null);

  const openAssistant = useCallback((prompt?: string) => {
    const normalizedPrompt = prompt?.trim();
    if (normalizedPrompt) {
      starterPromptRef.current = normalizedPrompt;
      setStarterPrompt(normalizedPrompt);
    }
    setOpen(true);
  }, []);
  const closeAssistant = useCallback(() => setOpen(false), []);
  const toggleAssistant = useCallback(() => setOpen((current) => !current), []);
  const consumeStarterPrompt = useCallback(() => {
    const prompt = starterPromptRef.current;
    starterPromptRef.current = null;
    setStarterPrompt(null);
    return prompt;
  }, []);

  const registerContext = useCallback((registration: Registration) => {
    const key = `${registration.scope}:${registration.id}`;
    setRegistrations((current) => ({ ...current, [key]: registration }));
    return () => {
      setRegistrations((current) => {
        if (!current[key]) return current;
        const next = { ...current };
        delete next[key];
        return next;
      });
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const sync = () => {
      if (!cancelled) setVisibleElements(collectVisibleTrebolElements());
    };
    sync();
    const timers = [180, 650].map((delay) => window.setTimeout(sync, delay));
    return () => {
      cancelled = true;
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [isOpen, pathname]);

  useEffect(() => {
    if (!selectingElement) return;

    const onPointer = (event: MouseEvent) => {
      if (!canSelectTrebolElement(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      setSelectedElement(describeTrebolElement(event.target));
      setSelectingElement(false);
      setOpen(true);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectingElement(false);
        setOpen(true);
      }
    };
    document.addEventListener("click", onPointer, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("click", onPointer, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [selectingElement]);

  const registeredScopes = useMemo(() => {
    const scopes: Record<string, Record<string, unknown>> = {};
    for (const registration of Object.values(registrations)) {
      const existing = scopes[registration.scope] ?? {};
      scopes[registration.scope] = { ...existing, [registration.id]: registration.data };
    }
    return scopes;
  }, [registrations]);

  const pageContext = useMemo(
    () => resolveClouvaPageContext({
      pathname,
      playerSlug: currentPlayer?.slug,
      registered: registeredScopes.page,
      visibleElements,
    }),
    [currentPlayer?.slug, pathname, registeredScopes.page, visibleElements],
  );

  const viewerContext = useMemo<ClouvaViewerContext>(() => {
    const connectedServices: string[] = [];
    if (profile?.spotify_url || currentPlayer?.spotify_profile_url) connectedServices.push("spotify");
    if (currentPlayer?.youtube_channel_url) connectedServices.push("youtube");
    return {
      role,
      onboardingStatus: profile?.onboarding_status ?? undefined,
      experience: viewerExperience({
        onboardingStatus: profile?.onboarding_status,
        role,
        hasPlayer: Boolean(currentPlayer),
      }),
      displayName: profile?.display_name ?? profile?.full_name ?? undefined,
      player: currentPlayer
        ? { id: currentPlayer.id, slug: currentPlayer.slug, displayName: currentPlayer.display_name }
        : undefined,
      connectedServices,
    };
  }, [currentPlayer, profile, role]);

  const context = useMemo(() => {
    const safeParams = paramsRecord(params);
    const scopes = {
      ...registeredScopes,
      page: { ...(registeredScopes.page ?? {}), runtime: pageContext },
      viewer: { ...(registeredScopes.viewer ?? {}), runtime: viewerContext },
    };
    return buildTrebolRuntimeContext({
      navigation: {
        route: pathname,
        pathname,
        params: safeParams,
        url: typeof window === "undefined" ? pathname : window.location.href,
      },
      active: {
        playerId: currentPlayer?.id,
        avatarId: avatar.id,
        studioId: safeParams.studioId ?? registeredValue(registrations, "studioId"),
        productId: registeredValue(registrations, "productId"),
        assetId: registeredValue(registrations, "assetId"),
        creatorProjectId: registeredValue(registrations, "creatorProjectId"),
      },
      ui: { selectedElement },
      runtime: { errors: [], warnings: [], activeJobIds: [] },
      project: {},
      scopes,
      user: user ? { id: user.id } : undefined,
    });
  }, [avatar.id, currentPlayer?.id, params, pathname, pageContext, registeredScopes, registrations, selectedElement, user, viewerContext]);

  const contextPatch = useMemo(
    () => diffTrebolRuntimeContext(previousContextRef.current, context),
    [context],
  );
  useEffect(() => {
    previousContextRef.current = context;
  }, [context]);

  const value = useMemo<ClouvaAIAssistantValue>(() => ({
    isOpen,
    open: isOpen,
    setOpen,
    starterPrompt,
    openAssistant,
    closeAssistant,
    toggleAssistant,
    consumeStarterPrompt,
    conversationId,
    setConversationId,
    pendingAction,
    setPendingAction,
    toolDecisionNotice,
    notifyToolDecision: (message) => {
      toolDecisionSequence.current += 1;
      setToolDecisionNotice({ id: toolDecisionSequence.current, message: message.trim().slice(0, 1_000) });
    },
    context,
    contextPatch,
    pageContext,
    viewerContext,
    selectingElement,
    startElementSelection: () => {
      setOpen(false);
      setSelectingElement(true);
    },
    stopElementSelection: () => {
      setSelectingElement(false);
      setOpen(true);
    },
    clearSelection: () => setSelectedElement(undefined),
    registerContext,
  }), [closeAssistant, consumeStarterPrompt, context, contextPatch, conversationId, isOpen, openAssistant, pageContext, pendingAction, registerContext, selectingElement, starterPrompt, toggleAssistant, toolDecisionNotice, viewerContext]);

  return (
    <ClouvaAIAssistantContext.Provider value={value}>
      {children}
      {selectingElement ? (
        <div
          data-trebol-ui
          className="pointer-events-none fixed inset-x-0 top-3 z-[200] mx-auto w-fit rounded-full border border-violet-300/30 bg-zinc-950/95 px-4 py-2 text-xs text-violet-100 shadow-2xl"
        >
          Elegí un elemento de la pantalla · Esc para cancelar
        </div>
      ) : null}
    </ClouvaAIAssistantContext.Provider>
  );
}

export function useClouvaAIAssistant() {
  const context = useContext(ClouvaAIAssistantContext);
  if (!context) throw new Error("useClouvaAIAssistant debe usarse dentro de ClouvaAIAssistantProvider.");
  return context;
}

export function useClouvaAIConversation() {
  const { conversationId, setConversationId } = useClouvaAIAssistant();
  return { conversationId, setConversationId };
}

export function useTrebolContextRegistration(registration: Registration) {
  const { registerContext } = useClouvaAIAssistant();
  const fingerprint = JSON.stringify(registration.data);
  const latest = useRef(registration);
  latest.current = registration;

  useEffect(() => registerContext(latest.current), [fingerprint, registerContext, registration.id, registration.scope]);
}

export function useClouvaPageContext(registration: ClouvaPageContextRegistration) {
  const { registerContext } = useClouvaAIAssistant();
  const fingerprint = JSON.stringify(registration);
  const latest = useRef(registration);
  latest.current = registration;

  useEffect(
    () => registerContext({
      scope: "page",
      id: latest.current.id,
      data: latest.current as unknown as Record<string, unknown>,
    }),
    [fingerprint, registerContext, registration.id],
  );
}
