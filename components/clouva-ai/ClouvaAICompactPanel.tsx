"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { useClouvaAIAssistant } from "./ClouvaAIAssistantProvider";
import { ClouvaAIQuickChat } from "./ClouvaAIQuickChat";

export function ClouvaAICompactPanel() {
  const { user } = useAuth();
  const { isOpen, setOpen, context, pageContext, viewerContext } = useClouvaAIAssistant();
  if (!isOpen) return null;

  const studioId = context.active.studioId ?? null;
  const fullChatHref = studioId ? `/studio-dashboard/${studioId}?tab=clouva-ai` : "/clouva-ai";
  const playerName = viewerContext.player?.displayName;
  const contextLine = [pageContext.title, playerName ? `Player ${playerName}` : null].filter(Boolean).join(" · ");

  return (
    <aside
      data-trebol-ui
      role="dialog"
      aria-label="Chat rápido de Trébol"
      className="fixed left-1/2 z-[150] flex w-[calc(100vw-1.5rem)] max-w-[30rem] -translate-x-1/2 flex-col overflow-hidden rounded-[28px] border border-white/10 bg-[#08070b]/95 text-white shadow-[0_30px_90px_rgba(0,0,0,.65)] backdrop-blur-2xl"
      style={{
        bottom: "calc(5.75rem + env(safe-area-inset-bottom))",
        height: "min(35rem, calc(100dvh - 7.25rem - env(safe-area-inset-bottom)))",
      }}
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold tracking-[0.16em] text-violet-200">TRÉBOL · CLOUVA AI</p>
          <p className="mt-0.5 truncate text-[11px] text-white/45">{contextLine || "Contexto activo"}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {user ? (
            <Link
              href={fullChatHref}
              onClick={() => setOpen(false)}
              className="rounded-full px-2.5 py-1.5 text-[11px] font-medium text-violet-200 transition hover:bg-white/10"
            >
              Abrir completo
            </Link>
          ) : null}
          <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar Trébol" className="rounded-full p-2 text-white/65 transition hover:bg-white/10 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      {user ? (
        <ClouvaAIQuickChat studioId={studioId} />
      ) : (
        <div className="grid flex-1 place-items-center p-5">
          <Link href="/login" onClick={() => setOpen(false)} className="rounded-2xl bg-violet-500 px-4 py-3 text-center text-sm font-semibold text-white">Iniciar sesión para conversar</Link>
        </div>
      )}
    </aside>
  );
}
