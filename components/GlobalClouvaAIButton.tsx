"use client";

import { usePathname } from "next/navigation";
import { Sparkles } from "lucide-react";
import { useClouvaAIAssistant } from "@/components/clouva-ai/ClouvaAIAssistantProvider";

export function GlobalClouvaAIButton() {
  const pathname = usePathname();
  const { isOpen, setOpen } = useClouvaAIAssistant();

  if (pathname === "/clouva-ai") return null;

  return (
    <button
      data-trebol-ui
      type="button"
      aria-label={isOpen ? "Cerrar Trébol" : "Abrir Trébol"}
      aria-expanded={isOpen}
      title="Trébol · CLOUVA AI"
      onClick={() => setOpen(!isOpen)}
      className="fixed bottom-4 left-4 z-[151] flex items-center gap-2 rounded-full border border-violet-300/20 bg-zinc-950/90 p-1.5 pr-3 text-white shadow-2xl backdrop-blur-xl transition hover:border-violet-300/40 hover:bg-violet-950/90"
    >
      <span className="grid h-9 w-9 place-items-center rounded-full bg-violet-500/20 text-violet-200">
        <Sparkles className="h-5 w-5" />
      </span>
      <span className="leading-tight">
        <b className="block text-[10px] font-semibold">TRÉBOL</b>
        <small className="block text-[9px] text-white/50">CLOUVA AI</small>
      </span>
    </button>
  );
}
