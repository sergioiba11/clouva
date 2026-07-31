"use client";

import { usePathname } from "next/navigation";
import { Sparkles } from "lucide-react";

export function GlobalClouvaAIButton() {
  const pathname = usePathname();

  if (pathname === "/clouva-ai") return null;

  return (
    <div
      aria-label="CLOUVA AI próximamente"
      title="CLOUVA AI · Próximamente"
      className="fixed bottom-4 left-4 z-[101] hidden items-center gap-2 rounded-full border border-white/10 bg-zinc-900/90 p-1.5 pr-3 text-white/35 shadow-2xl backdrop-blur-xl grayscale sm:flex"
    >
      <span className="grid h-9 w-9 place-items-center rounded-full bg-white/[0.05]">
        <Sparkles className="h-5 w-5" />
      </span>
      <span className="hidden leading-tight sm:block">
        <b className="block text-[10px] font-semibold">CLOUVA AI</b>
        <small className="block text-[9px]">Próximamente</small>
      </span>
    </div>
  );
}
