"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { FlowCoinIcon } from "@/components/flow-coin-icon";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";
import { flowLabel, type FlowRegion } from "@/lib/flows";

type FlowBalancePayload = {
  balance: number;
  usdValue: number;
  unitUsd: 1;
  currency: "USD";
  region: FlowRegion;
  location: string | null;
  updatedAt: string | null;
};

type GlobalFlowBalanceProps = {
  variant?: "global" | "inline" | "header";
};

const REFRESH_MS = 60_000;
const HEADER_VALUE_ROTATION_MS = 2_800;
const HOME_MOBILE_QUERY = "(max-width: 820px)";
const FLOW_UI_FONT = 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

function initialMobileViewport(): boolean | null {
  if (typeof window === "undefined") return null;
  return window.matchMedia(HOME_MOBILE_QUERY).matches;
}

function isCommerceWorkspacePath(pathname: string) {
  return /^\/businesses\/[^/]+\/?$/.test(pathname)
    || /^\/studio-dashboard\/[^/]+\/commerce(?:\/|$)/.test(pathname)
    || /^\/mi-spot\/[^/]+\/commerce(?:\/|$)/.test(pathname);
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      className="h-3.5 w-3.5 shrink-0 transition-transform duration-200"
      style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path d="m5.5 7.5 4.5 4.5 4.5-4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function GlobalFlowBalance({ variant = "global" }: GlobalFlowBalanceProps = {}) {
  const pathname = usePathname();
  const { user, loading: authLoading } = useAuth();
  const [data, setData] = useState<FlowBalancePayload | null>(null);
  const [isMobileViewport, setIsMobileViewport] = useState<boolean | null>(initialMobileViewport);
  const [headerOpen, setHeaderOpen] = useState(false);
  const [headerValue, setHeaderValue] = useState<"flow" | "usd">("flow");
  const headerRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    if (!user) {
      setData(null);
      return;
    }

    try {
      const response = await authenticatedFetch("/api/flows/balance", { cache: "no-store" });
      setData(await readApiJson<FlowBalancePayload>(response));
    } catch (error) {
      console.error("No se pudo actualizar el saldo global de FLOWS", error);
    }
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setData(null);
      return;
    }

    void load();
    const interval = window.setInterval(() => void load(), REFRESH_MS);
    const handleRefresh = () => void load();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void load();
    };

    window.addEventListener("focus", handleRefresh);
    window.addEventListener("clouva:flows-changed", handleRefresh);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", handleRefresh);
      window.removeEventListener("clouva:flows-changed", handleRefresh);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [authLoading, load, user]);

  useEffect(() => {
    const media = window.matchMedia(HOME_MOBILE_QUERY);
    const sync = () => setIsMobileViewport(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (variant !== "header" || headerOpen) return;
    const interval = window.setInterval(() => {
      setHeaderValue((current) => current === "flow" ? "usd" : "flow");
    }, HEADER_VALUE_ROTATION_MS);
    return () => window.clearInterval(interval);
  }, [headerOpen, variant]);

  useEffect(() => {
    if (variant !== "header" || !headerOpen) return;
    const handlePointer = (event: PointerEvent) => {
      if (headerRef.current && !headerRef.current.contains(event.target as Node)) setHeaderOpen(false);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setHeaderOpen(false);
    };
    document.addEventListener("pointerdown", handlePointer);
    window.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("pointerdown", handlePointer);
      window.removeEventListener("keydown", handleKey);
    };
  }, [headerOpen, variant]);

  if (authLoading || !user || !data) return null;

  // Some surfaces own their FLOW balance inside a real top bar. Suppress the
  // floating copy there so the wallet never appears twice or overlaps controls.
  if (variant === "global") {
    if (pathname.startsWith("/admin")) return null;
    if (pathname.startsWith("/agenda")) return null;
    if (pathname === "/" && isMobileViewport !== false) return null;
    if (isCommerceWorkspacePath(pathname)) return null;
  }

  const label = flowLabel(data.balance);
  const region = data.region;

  if (variant === "header") {
    return (
      <div ref={headerRef} className="relative shrink-0" style={{ fontFamily: FLOW_UI_FONT }}>
        <button
          type="button"
          onClick={() => {
            setHeaderOpen((current) => !current);
            setHeaderValue("flow");
          }}
          aria-haspopup="menu"
          aria-expanded={headerOpen}
          aria-label={`${data.balance} ${label}. US$ ${data.usdValue}. Abrir detalle de Mi Flow.`}
          className="group flex h-[40px] w-[132px] items-center gap-2 rounded-[14px] border px-1.5 pr-2 text-left text-white transition sm:w-[146px]"
          style={{
            borderColor: headerOpen ? `${region.glow}88` : "rgba(255,255,255,.08)",
            background: headerOpen ? "rgba(124,58,237,.10)" : "rgba(255,255,255,.025)",
            boxShadow: headerOpen ? `0 0 24px ${region.glowSoft}, inset 0 1px rgba(255,255,255,.035)` : "inset 0 1px rgba(255,255,255,.025)",
          }}
        >
          <FlowCoinIcon
            size={30}
            glow={region.glow}
            edge={region.edge}
            imageUrl={region.assetUrl}
            fallbackImageUrl={region.assetFallbackUrl}
            title={`FLOWS · ${region.label}`}
          />

          <span className="relative min-w-0 flex-1 overflow-hidden" style={{ height: 18 }}>
            <span
              className="absolute inset-0 flex items-center whitespace-nowrap text-[11px] font-semibold tabular-nums transition-all duration-500 sm:text-[12px]"
              style={{
                opacity: headerValue === "flow" ? 1 : 0,
                transform: headerValue === "flow" ? "translateY(0)" : "translateY(-8px)",
              }}
            >
              {data.balance} {label}
            </span>
            <span
              className="absolute inset-0 flex items-center whitespace-nowrap text-[11px] font-semibold tabular-nums transition-all duration-500 sm:text-[12px]"
              style={{
                opacity: headerValue === "usd" ? 1 : 0,
                transform: headerValue === "usd" ? "translateY(0)" : "translateY(8px)",
              }}
            >
              US$ {data.usdValue}
            </span>
          </span>

          <span className="text-violet-200/65"><Chevron open={headerOpen} /></span>
        </button>

        {headerOpen ? (
          <div
            role="menu"
            className="absolute right-0 top-[calc(100%+10px)] z-[100] w-[286px] overflow-hidden rounded-[20px] border p-3 text-white sm:w-[310px]"
            style={{
              background: "linear-gradient(180deg, #100a1f 0%, #090612 52%, #06040d 100%)",
              borderColor: `${region.glow}55`,
              boxShadow: `0 28px 80px rgba(0,0,0,.62), 0 0 34px ${region.glowSoft}`,
              isolation: "isolate",
            }}
          >
            <div className="flex items-center gap-3 px-1 pb-3 pt-1">
              <span className="h-px flex-1 bg-white/[0.07]" />
              <span className="text-[8px] font-bold uppercase tracking-[0.22em] text-white/32">Precios del mismo valor</span>
              <span className="h-px flex-1 bg-white/[0.07]" />
            </div>

            <div className="grid gap-2">
              <div className="flex min-h-[62px] items-center gap-3 rounded-[15px] border border-white/[0.07] bg-white/[0.025] px-3">
                <FlowCoinIcon
                  size={44}
                  glow={region.glow}
                  edge={region.edge}
                  imageUrl={region.assetUrl}
                  fallbackImageUrl={region.assetFallbackUrl}
                  title={`FLOWS · ${region.label}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-[8px] font-bold uppercase tracking-[0.16em] text-white/28">FLOW regional</div>
                  <div className="mt-1 text-[15px] font-semibold tabular-nums">{data.balance} {label}</div>
                </div>
              </div>

              <div className="flex min-h-[62px] items-center gap-3 rounded-[15px] border border-white/[0.07] bg-white/[0.025] px-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-violet-300/22 bg-[radial-gradient(circle_at_35%_30%,rgba(255,255,255,.14),rgba(124,58,237,.14)_48%,rgba(5,5,13,.9)_100%)] text-[11px] font-black tracking-[-0.04em] text-white shadow-[0_0_18px_rgba(124,58,237,.16)]">
                  US$
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[8px] font-bold uppercase tracking-[0.16em] text-white/28">Referencia USD</div>
                  <div className="mt-1 text-[15px] font-semibold tabular-nums">US$ {data.usdValue}</div>
                </div>
              </div>
            </div>

            <Link
              href="/mi-flow/billetera?asset=flows"
              role="menuitem"
              onClick={() => setHeaderOpen(false)}
              className="mt-3 flex h-[48px] items-center justify-between rounded-[15px] border border-violet-300/30 bg-violet-500/[0.10] px-4 text-[12px] font-semibold text-violet-50 transition hover:border-violet-300/50 hover:bg-violet-500/[0.16]"
            >
              <span>Ver mi Flow</span>
              <span aria-hidden="true" className="text-lg leading-none text-violet-200/70">›</span>
            </Link>

            <div className="px-2 pb-0.5 pt-2.5 text-[8px] leading-4 text-white/24">
              1 FLOW = US$ 1 de referencia. La moneda local se sumará cuando su conversión y asset estén disponibles.
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  if (variant === "inline") {
    return (
      <Link
        href="/mi-flow/billetera?asset=flows"
        aria-label={`${data.balance} ${label}. 1 FLOW equivale a 1 dólar estadounidense.`}
        title={`1 FLOW = US$ 1 · ${region.label}`}
        className="group flex min-w-0 items-center gap-2.5 rounded-2xl border border-white/[0.07] bg-white/[0.025] px-2.5 py-2 text-white transition hover:bg-white/[0.045]"
        style={{
          display: "flex",
          alignItems: "center",
          minWidth: 0,
          textDecoration: "none",
          fontFamily: FLOW_UI_FONT,
          boxShadow: `inset 0 1px rgba(255,255,255,.025), 0 0 22px ${region.glowSoft}`,
        }}
      >
        <FlowCoinIcon
          size={31}
          glow={region.glow}
          edge={region.edge}
          imageUrl={region.assetUrl}
          fallbackImageUrl={region.assetFallbackUrl}
          title={`FLOWS · ${region.label}`}
        />
        <span className="min-w-0 leading-none">
          <span className="flex items-baseline gap-1.5 whitespace-nowrap">
            <strong className="text-sm font-semibold tabular-nums">{data.balance}</strong>
            <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-white/65">{label}</span>
          </span>
          <span className="mt-1 block truncate text-[8px] font-medium text-white/35">
            US$ {data.usdValue} · <span style={{ color: region.glow }}>{region.label}</span>
          </span>
        </span>
      </Link>
    );
  }

  return (
    <Link
      href="/mi-flow/billetera?asset=flows"
      aria-label={`${data.balance} ${label}. 1 FLOW equivale a 1 dólar estadounidense.`}
      title={`1 FLOW = US$ 1 · ${region.label}`}
      className="group fixed right-3 z-[80] flex min-h-12 items-center gap-2.5 rounded-2xl border bg-[#09080d]/92 px-2.5 py-2 text-white shadow-2xl backdrop-blur-xl transition hover:-translate-y-0.5 hover:bg-[#0d0b12]/96 md:right-5 md:gap-3 md:px-3"
      style={{
        display: "flex",
        alignItems: "center",
        textDecoration: "none",
        fontFamily: FLOW_UI_FONT,
        top: "calc(env(safe-area-inset-top, 0px) + 10px)",
        borderColor: `${region.glow}55`,
        boxShadow: `0 10px 34px rgba(0,0,0,.42), 0 0 24px ${region.glowSoft}`,
      }}
    >
      <FlowCoinIcon
        size={34}
        glow={region.glow}
        edge={region.edge}
        imageUrl={region.assetUrl}
        fallbackImageUrl={region.assetFallbackUrl}
        title={`FLOWS · ${region.label}`}
      />
      <span className="min-w-0 leading-none">
        <span className="flex items-baseline gap-1.5 whitespace-nowrap">
          <strong className="text-[15px] font-semibold tabular-nums md:text-base">{data.balance}</strong>
          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/72">{label}</span>
        </span>
        <span className="mt-1 flex items-center gap-1.5 whitespace-nowrap text-[9px] font-medium text-white/42 md:text-[10px]">
          <span>US$ {data.usdValue}</span>
          <span aria-hidden="true">·</span>
          <span className="hidden max-w-[120px] truncate sm:inline" style={{ color: region.glow }}>{region.label}</span>
        </span>
      </span>
    </Link>
  );
}

declare global {
  interface WindowEventMap {
    "clouva:flows-changed": Event;
  }
}