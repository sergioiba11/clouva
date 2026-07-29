import Link from "next/link";
import type { ReactNode } from "react";

// Deliberately separate from components/layout.tsx's MainNav/MainFooter --
// per the Players/Estudios spec, public profile pages must never look like
// the CLOUVA app dashboard (no app menu, no CLOUVA-as-product branding).
// Each public entity gets its own nav items via `navLinks`.

export type PublicNavLink = { label: string; href: string };

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
      <header className="sticky top-0 z-20 border-b border-white/10 bg-[#07060b]/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <Link href={brandHref} className="text-lg font-semibold tracking-wide">
            {brand}
          </Link>
          {navLinks.length > 0 ? (
            <nav className="hidden gap-6 text-sm text-white/70 sm:flex">
              {navLinks.map((link) => (
                <Link key={link.href} href={link.href} className="transition hover:text-white">
                  {link.label}
                </Link>
              ))}
            </nav>
          ) : null}
        </div>
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
