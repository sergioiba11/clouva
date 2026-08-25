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
  canSelectTrebolElement,
  describeTrebolElement,
} from "@/lib/clouva-ai/visual-selection";

type Registration = { scope: string; id: string; data: Record<string, unknown> };

type ClouvaAIAssistantValue = {
  isOpen: boolean;
  setOpen: (open: boolean) => void;
  conversationId: string | null;
  setConversationId: (id: string | null) => void;
  pendingAction: PendingToolActionView | null;
  setPendingAction: (action: PendingToolActionView | null) => void;
  toolDecisionNotice: { id: number; message: string } | null;
  notifyToolDecision: (message: string) => void;
  context: TrebolRuntimeContext;
  contextPatch: TrebolContextPatch;
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

export function ClouvaAIAssistantProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const params = useParams();
  const { user } = useAuth();
  const { currentPlayer } = useCurrentPlayer();
  const avatar = useActiveAvatarStore((state) => state.avatar);
  const [isOpen, setOpen] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingToolActionView | null>(null);
  const [toolDecisionNotice, setToolDecisionNotice] = useState<{ id: number; message: string } | null>(null);
  const toolDecisionSequence = useRef(0);
  const [registrations, setRegistrations] = useState<Record<string, Registration>>({});
  const [selectedElement, setSelectedElement] = useState<TrebolSelectedElement>();
  const [selectingElement, setSelectingElement] = useState(false);
  const previousContextRef = useRef<TrebolRuntimeContext | null>(null);

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
      if (event.key === "Escape") setSelectingElement(false);
    };
    document.addEventListener("click", onPointer, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("click", onPointer, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [selectingElement]);

  const context = useMemo(() => {
    const scopes: Record<string, Record<string, unknown>> = {};
    for (const registration of Object.values(registrations)) {
      const existing = scopes[registration.scope] ?? {};
      scopes[registration.scope] = { ...existing, [registration.id]: registration.data };
    }
    const safeParams = paramsRecord(params);
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
  }, [avatar.id, currentPlayer?.id, params, pathname, registrations, selectedElement, user]);

  const contextPatch = useMemo(
    () => diffTrebolRuntimeContext(previousContextRef.current, context),
    [context],
  );
  useEffect(() => {
    previousContextRef.current = context;
  }, [context]);

  const value = useMemo<ClouvaAIAssistantValue>(() => ({
    isOpen,
    setOpen,
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
    selectingElement,
    startElementSelection: () => setSelectingElement(true),
    stopElementSelection: () => setSelectingElement(false),
    clearSelection: () => setSelectedElement(undefined),
    registerContext,
  }), [context, contextPatch, conversationId, isOpen, pendingAction, registerContext, selectingElement, toolDecisionNotice]);

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
