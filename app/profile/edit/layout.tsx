import Link from "next/link";
import { ArrowLeft, Network, UserRoundCog } from "lucide-react";
import type { ReactNode } from "react";

export default function ProfileEditorLayout({ children }: { children: ReactNode }) {
  return (
    <div className="profile-editor-shell min-h-screen bg-[#05040a]">
      <div className="sticky top-0 z-50 border-b border-white/10 bg-[#05040a]/95 px-4 py-3 text-white backdrop-blur-xl sm:px-6">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2">
          <Link
            href="/matrix"
            className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-3 py-2 text-sm font-medium text-white/80 transition hover:border-violet-400/40 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            Volver a La Matrix
          </Link>
          <nav className="flex gap-2">
            <Link href="/profile/edit" className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.025] px-3 py-2 text-xs font-semibold text-white/65 transition hover:border-violet-400/40 hover:text-white"><UserRoundCog className="h-4 w-4" /> Editor del Player</Link>
            <Link href="/profile/edit/identity" className="inline-flex items-center gap-2 rounded-xl border border-violet-400/25 bg-violet-500/10 px-3 py-2 text-xs font-semibold text-violet-200 transition hover:border-violet-400/50"><Network className="h-4 w-4" /> Identidad SEO / AEO</Link>
          </nav>
        </div>
      </div>

      <style>{`.profile-editor-shell > main > header { top: 61px !important; }`}</style>
      {children}
    </div>
  );
}
