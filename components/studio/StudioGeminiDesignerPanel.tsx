"use client";

import { Sparkles } from "lucide-react";
import { ClouvaAIQuickChat } from "@/components/clouva-ai/ClouvaAIQuickChat";
import { GeminiModelSelector } from "@/components/clouva-ai/GeminiModelSelector";

const STUDIO_DESIGNER_MODEL = "gemini-3.1-pro-preview";

export function StudioGeminiDesignerPanel({
  studioId,
  studioName,
}: {
  studioId: string;
  studioName: string;
}) {
  return (
    <aside
      className="flex h-full min-h-0 flex-col overflow-hidden border-l border-violet-300/15 bg-[#08070d]/98 shadow-2xl backdrop-blur-xl"
      data-clouva-component="StudioGeminiDesignerPanel"
      data-clouva-studio-id={studioId}
      data-trebol-ui
    >
      <div className="shrink-0 border-b border-white/10 p-3">
        <div className="mb-3 flex items-start gap-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-violet-400/20 bg-violet-500/10 text-violet-200">
            <Sparkles className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-300/70">CLOUVA AI · Studio Designer</p>
            <p className="truncate text-sm font-semibold text-white">{studioName}</p>
            <p className="mt-0.5 text-[11px] leading-4 text-white/40">Diseña sobre la propuesta real del Studio. El publicado no se modifica hasta confirmar Publicar.</p>
          </div>
        </div>
        <GeminiModelSelector preferredModel={STUDIO_DESIGNER_MODEL} />
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <ClouvaAIQuickChat studioId={studioId} />
      </div>
    </aside>
  );
}
