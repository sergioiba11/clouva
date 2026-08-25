"use client";

import Link from "next/link";
import { Crosshair, X } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { useClouvaAIAssistant } from "./ClouvaAIAssistantProvider";
import { ClouvaAIChat } from "./ClouvaAIChat";

export function ClouvaAICompactPanel() {
  const { user } = useAuth();
  const {
    isOpen,
    setOpen,
    context,
    selectingElement,
    startElementSelection,
    stopElementSelection,
    clearSelection,
  } = useClouvaAIAssistant();
  if (!isOpen) return null;
  const studioId = context.active.studioId ?? null;
  const fullChatHref = studioId ? `/studio-dashboard/${studioId}?tab=clouva-ai` : "/clouva-ai";

  return (
    <aside
      data-trebol-ui
      aria-label="Panel compacto de Trébol"
      className="fixed bottom-20 left-4 z-[150] flex h-[min(46rem,calc(100dvh-7rem))] w-[min(29rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-3xl border border-violet-300/20 bg-zinc-950/95 text-white shadow-2xl backdrop-blur-2xl"
    >
      <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div>
          <p className="text-xs font-semibold tracking-[0.18em] text-violet-200">TRÉBOL</p>
          <p className="text-[11px] text-white/45">CLOUVA AI · contexto activo</p>
        </div>
        <div className="flex items-center gap-1">
          {user ? <Link href={fullChatHref} onClick={() => setOpen(false)} className="rounded-full px-2.5 py-1.5 text-[11px] text-violet-200 hover:bg-white/10">Abrir completo</Link> : null}
          <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar Trébol" className="rounded-full p-2 hover:bg-white/10"><X className="h-4 w-4" /></button>
        </div>
      </header>

      <div className="shrink-0 space-y-2 border-b border-white/10 p-3">
        <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-3 text-xs text-white/60">
          <p className="font-medium text-white/85">{context.navigation.pathname || "CLOUVA"}</p>
          <p className="mt-1">
            {context.active.playerId ? "Player activo" : "Sin Player activo"}
            {context.active.avatarId ? " · Avatar activo" : ""}
          </p>
          {context.ui.selectedElement ? (
            <p className="mt-2 truncate text-violet-200">Selección: {context.ui.selectedElement.selector}</p>
          ) : null}
        </div>

        <button
          type="button"
          onClick={selectingElement ? stopElementSelection : startElementSelection}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 px-4 py-3 text-sm hover:border-violet-300/30 hover:bg-violet-400/10"
        >
          <Crosshair className="h-4 w-4" />
          {selectingElement ? "Cancelar selección" : "Señalar algo en pantalla"}
        </button>
        {context.ui.selectedElement ? (
          <button type="button" onClick={clearSelection} className="w-full text-xs text-white/45 hover:text-white/70">
            Quitar selección
          </button>
        ) : null}
      </div>

      {user ? (
        <ClouvaAIChat studioId={studioId} compact />
      ) : (
        <div className="grid flex-1 place-items-center p-5">
          <Link href="/login" onClick={() => setOpen(false)} className="rounded-2xl bg-violet-500 px-4 py-3 text-center text-sm font-semibold text-white">Iniciar sesión para conversar</Link>
        </div>
      )}
    </aside>
  );
}
