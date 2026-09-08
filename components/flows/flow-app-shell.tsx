"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Menu, X } from "lucide-react";
import {
  ClouvaDesktopSidebar,
  isClouvaSidebarItemActive,
  useClouvaSidebarNavigation,
  type ClouvaSidebarItem,
} from "@/components/clouva/ClouvaDesktopSidebar";
import sidebarStyles from "@/components/clouva/ClouvaDesktopSidebar.module.css";

const CLOUVA_LOGO = "/assets/clouva/brand/logo-official-light.png";

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

function MobileNavigationGroup({
  pathname,
  items,
  onNavigate,
}: {
  pathname: string;
  items: ClouvaSidebarItem[];
  onNavigate: () => void;
}) {
  return (
    <nav aria-label="Navegación CLOUVA" className="space-y-1.5">
      {items.map((item) => {
        const Icon = item.icon;
        const active = isClouvaSidebarItemActive(pathname, item);
        return (
          <Link
            key={`${item.key}:${item.href}`}
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
          </Link>
        );
      })}
    </nav>
  );
}

function MobileNavigation({ pathname, onNavigate }: { pathname: string; onNavigate: () => void }) {
  const { primaryNavigation, workspaceNavigation } = useClouvaSidebarNavigation();

  return (
    <div className="space-y-5">
      <MobileNavigationGroup pathname={pathname} items={primaryNavigation} onNavigate={onNavigate} />
      <section className="border-t border-white/[0.06] pt-4">
        <p className="mb-2 px-3 text-[9px] font-semibold uppercase tracking-[0.18em] text-violet-200/45">TU ESPACIO</p>
        <MobileNavigationGroup pathname={pathname} items={workspaceNavigation} onNavigate={onNavigate} />
      </section>
    </div>
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
  const pathname = usePathname() || "/";
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
      <ClouvaDesktopSidebar fixed />

      <div className={sidebarStyles.contentOffset}>
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
              <MobileNavigation pathname={pathname} onNavigate={() => setMobileOpen(false)} />
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
