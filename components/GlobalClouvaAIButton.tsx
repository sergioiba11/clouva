"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sparkles } from "lucide-react";

export function GlobalClouvaAIButton() {
  const pathname = usePathname();

  if (pathname === "/clouva-ai") return null;

  return (
    <Link
      href="/clouva-ai"
      aria-label="Abrir CLOUVA AI"
      title="Abrir CLOUVA AI"
      className="fixed bottom-4 left-4 z-[101] flex h-12 w-12 items-center justify-center rounded-full border border-violet-400/30 bg-violet-600 text-white shadow-[0_12px_40px_rgba(109,40,217,0.45)] transition hover:scale-105 hover:bg-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-300/70"
    >
      <Sparkles className="h-6 w-6" />
    </Link>
  );
}
