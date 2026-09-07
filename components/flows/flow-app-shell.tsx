"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import {
  Bot,
  Boxes,
  Home,
  Menu,
  ShoppingBag,
  Sparkles,
  UserRound,
  WalletCards,
  X,
} from "lucide-react";
import { CLOUVA_NAVIGATION } from "@/lib/navigation/clouva-navigation";

const CLOUVA_LOGO = "/assets/clouva/brand/logo-official-light.png";

type NavItem = {
  label: string;
  href: string;
  icon: ComponentType<{ size?: number; className?: string }>;
};

const NAV_ITEMS: NavItem[] = [
  { label: "Inicio", href: CLOUVA_NAVIGATION.HOME.href, icon: Home },
  { label: "Player", href: CLOUVA_NAVIGATION.PLAYER.href, icon: UserRound },
  { label: "Mi Flow", href: CLOUVA_NAVIGATION.MI_FLOW.href, icon: WalletCards },
  { label: "Creator", href: CLOUVA_NAVIGATION.CREATE.href, icon: Sparkles },
  { label: "Market", href: CLOUVA_NAVIGATION.MARKET.href, icon: ShoppingBag },
  { label: "Mi Spot", href: CLOUVA_NAVIGATION.MI_SPOT.href, icon: Boxes },
  { label: "CLOUVA AI", href: "/clouva-ai", icon: Bot },
];

function isActivePath(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function OfficialLogo({ size = 46, priority = false }: { size?: number; priority?: boolean }) {
  return (
    <Image
      src={CLOUVA_LOGO}
      alt="CLOUVA"
      width={size}
      height={size}
      className="shrink-0 object-contain"
      style={{ width: size, height: size }}
      priority={priority}
    />
  );
}

function NavigationLinks({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label="Navegación CLOUVA" className="space-y-1.5">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const active = isActivePath(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={`group flex min-h-11 items-center gap-3 rounded-2xl border px-3.5 py-2.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/80 ${
              active
                ? "border-violet-400/30 bg-gradient-to-r from-violet-600/24 to-violet-400/[0.07] text-white shadow-[inset_0_0_30px_rgba(124,58,237,0.08),0_0_24px_rgba(124,58,237,0.08)]"
                : "border-transparent text-white/55 hover:border-white/[0.06] hover:bg-white/[0.035] hover:text-white"
            }`}
          >
            <span
              className={`grid h-8 w-8 place-items-center rounded-xl transition ${
                active ? "bg-violet-400/15 text-violet-200" : "bg-white/[0.035] text-white/45 group-hover:text-white/75"
              }`}
            >
              <Icon size={16} />
            </span>
            <span>{item.label}</span>
            {item.href === CLOUVA_NAVIGATION.MI_FLOW.href ? (
              <span className="ml-auto rounded-full border border-violet-300/15 bg-violet-300/[0.06] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-violet-200/80">
                FLOWS
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

export function FlowAppShell({
  children,
  headerEyebrow = "Mi Flow / FLOWS",
  headerTitle = "MIS FLOWS",
}: {
  children: ReactNode;
  headerEyebrow?: string;
  headerTitle?: string;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [mobileOpen]);

  return (
    <div className="min-h-screen overflow-x-clip bg-[#05050b] text-white">
      <aside className="fixed bottom-0 left-0 top-16 z-40 hidden w-[248px] border-r border-white/[0.07] bg-[#070711]/96 px-4 py-5 backdrop-blur-2xl lg:flex lg:flex-col">
        <Link
          href="/"
          aria-label="CLOUVA Inicio"
          className="flex w-fit items-center rounded-2xl px-2 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/80"
        >
          <OfficialLogo size={58} priority />
        </Link>

        <div className="mt-8">
          <NavigationLinks pathname={pathname} />
        </div>

        <div className="mt-auto px-2 pb-2">
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.025] p-3.5">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-300/75">
              <OfficialLogo size={20} />
              Ecosistema CLOUVA
            </div>
            <p className="mt-2 text-[11px] leading-5 text-white/35">
              Tu identidad, tus activos y tus espacios conectados por un mismo flow.
            </p>
          </div>
          <p className="mt-3 px-1 text-[9px] uppercase tracking-[0.24em] text-white/20">Vida de flows</p>
        </div>
      </aside>

      <div className="min-h-screen lg:pl-[248px]">
        <div className="flex min-h-[58px] items-center gap-3 border-b border-white/[0.07] bg-[#06060d]/70 px-4 backdrop-blur-xl sm:px-6 lg:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/[0.08] bg-white/[0.035] text-white/70 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/80"
            aria-label="Abrir navegación de Mi Flow"
            aria-expanded={mobileOpen}
          >
            <Menu size={18} />
          </button>
          <div className="min-w-0">
            <p className="truncate text-[9px] font-semibold uppercase tracking-[0.22em] text-white/30">{headerEyebrow}</p>
            <p className="truncate text-sm font-semibold text-white/85">{headerTitle}</p>
          </div>
        </div>

        <div className="mx-auto w-full max-w-[1320px]">{children}</div>
      </div>

      {mobileOpen ? (
        <div className="fixed inset-0 z-[80] lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
            aria-label="Cerrar navegación"
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Navegación CLOUVA"
            className="absolute inset-y-0 left-0 flex w-[86vw] max-w-[320px] flex-col border-r border-violet-300/10 bg-[#070711] p-4 shadow-[30px_0_80px_rgba(0,0,0,0.45)]"
          >
            <div className="flex items-center justify-between gap-4 px-1 py-1">
              <Link
                href="/"
                onClick={() => setMobileOpen(false)}
                aria-label="CLOUVA Inicio"
                className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/80"
              >
                <OfficialLogo size={54} />
              </Link>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="grid h-10 w-10 place-items-center rounded-xl border border-white/[0.08] text-white/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/80"
                aria-label="Cerrar navegación"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-7 overflow-y-auto">
              <NavigationLinks pathname={pathname} onNavigate={() => setMobileOpen(false)} />
            </div>

            <div className="mt-auto border-t border-white/[0.06] px-2 pt-4">
              <p className="text-[10px] uppercase tracking-[0.22em] text-white/25">CLOUVA · Vida de flows</p>
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
