import Link from "next/link";
import type { ReactNode } from "react";
import { Bell, Search, Sparkles } from "lucide-react";
import { CloverIcon } from "@/components/clover-icon";

export type PublicNavLink = { label: string; href: string; disabled?: boolean };

export function PublicShell({
  brand,
  brandHref = "/matrix",
  navLinks = [],
  accent = "#8f7cff",
  children,
}: {
  brand: string;
  brandHref?: string;
  navLinks?: PublicNavLink[];
  accent?: string;
  children: ReactNode;
}) {
  return (
    <div
      className="min-h-screen bg-[#07060b] text-white"
      style={{ ["--public-accent" as string]: accent }}
    >
      <header className="sticky top-0 z-20 border-b border-white/10 bg-[#07060b]/90 backdrop-blur-xl">
        <div className="mx-auto flex min-h-16 max-w-7xl items-center gap-5 px-4 py-3 sm:px-6">
          <Link href={brandHref} className="flex shrink-0 items-center gap-2 text-base font-semibold tracking-wide">
            <span className="grid h-8 w-8 place-items-center rounded-xl border border-violet-400/35 bg-violet-500/10 text-violet-300">
              <CloverIcon size={18} />
            </span>
            <span>{brand}</span>
          </Link>

          {navLinks.length > 0 ? (
            <nav className="mx-auto hidden items-center gap-2 rounded-full border border-white/10 bg-white/[0.025] p-1 text-xs text-white/65 md:flex">
              {navLinks.map((link) => link.disabled ? (
                <span key={link.href} className="cursor-not-allowed rounded-full px-4 py-2 text-white/25" title="Próximamente">
                  {link.label} <small className="ml-1 text-[8px] uppercase tracking-wider">Próximamente</small>
                </span>
              ) : (
                <Link key={link.href} href={link.href} className="rounded-full px-4 py-2 transition hover:bg-violet-500/10 hover:text-white">
                  {link.label}
                </Link>
              ))}
            </nav>
          ) : null}

          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <button type="button" aria-label="Buscar" className="grid h-9 w-9 place-items-center rounded-full text-white/55 transition hover:bg-white/5 hover:text-white">
              <Search size={17} />
            </button>
            <button type="button" aria-label="Notificaciones" className="hidden h-9 w-9 place-items-center rounded-full text-white/55 transition hover:bg-white/5 hover:text-white sm:grid">
              <Bell size={17} />
            </button>
            <Link href="/matrix" className="hidden items-center gap-2 rounded-full border border-violet-400/30 bg-violet-500/10 px-4 py-2 text-xs font-semibold text-violet-200 transition hover:bg-violet-500/20 sm:flex">
              <Sparkles size={14} />
              Explorar La Matrix
            </Link>
          </div>
        </div>

        {navLinks.length > 0 ? (
          <nav className="flex gap-1 overflow-x-auto border-t border-white/[0.06] px-3 py-2 text-[11px] text-white/60 md:hidden">
            {navLinks.map((link) => link.disabled ? (
              <span key={link.href} className="shrink-0 cursor-not-allowed rounded-full px-3 py-1.5 text-white/25">{link.label} · Próximamente</span>
            ) : (
              <Link key={link.href} href={link.href} className="shrink-0 rounded-full px-3 py-1.5 hover:bg-white/5 hover:text-white">{link.label}</Link>
            ))}
          </nav>
        ) : null}
      </header>

      <main>{children}</main>
      <footer className="border-t border-white/10 px-4 py-8 text-center text-xs text-white/40 sm:px-6">
        {brand} · CLOUVA
      </footer>
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="text-sm text-white/45">{children}</p>;
}

export function AvatarPlaceholder({ label, className = "" }: { label: string; className?: string }) {
  const initial = label.trim().charAt(0).toUpperCase() || "?";
  return (
    <div
      className={`flex items-center justify-center bg-gradient-to-br from-[color:var(--public-accent)]/30 to-black/60 font-semibold text-white/70 ${className}`}
    >
      {initial}
    </div>
  );
}
