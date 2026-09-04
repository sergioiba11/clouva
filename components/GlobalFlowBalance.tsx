"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
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

export function GlobalFlowBalance({ variant = "global" }: GlobalFlowBalanceProps = {}) {
  const pathname = usePathname();
  const { user, loading: authLoading } = useAuth();
  const [data, setData] = useState<FlowBalancePayload | null>(null);

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

  if (authLoading || !user || !data) return null;

  const label = flowLabel(data.balance);
  const region = data.region;

  if (variant === "header") {
    return (
      <Link
        href="/mi-flow/billetera?asset=flows"
        aria-label={`${data.balance} ${label}. 1 FLOW equivale a 1 dólar estadounidense.`}
        title="Abrir Mi Flow"
        className="group flex h-[38px] min-w-0 items-center gap-1.5 rounded-full border border-white/[0.07] bg-white/[0.025] px-1.5 pr-2 text-white backdrop-blur-xl transition hover:bg-white/[0.05]"
      >
        <FlowCoinIcon size={26} glow={region.glow} edge={region.edge} imageUrl={region.assetUrl} title={`FLOWS · ${region.label}`} />
        <span className="min-w-0 leading-none">
          <span className="flex items-baseline gap-1 whitespace-nowrap">
            <strong className="text-[11px] font-semibold tabular-nums">{data.balance}</strong>
            <span className="text-[7px] font-bold uppercase tracking-[0.11em] text-white/58">{label}</span>
          </span>
          <span className="mt-1 block whitespace-nowrap text-[7px] font-medium text-white/34">
            US$ {data.usdValue}
          </span>
        </span>
      </Link>
    );
  }

  if (variant === "inline") {
    return (
      <Link
        href="/mi-flow/billetera?asset=flows"
        aria-label={`${data.balance} ${label}. 1 FLOW equivale a 1 dólar estadounidense.`}
        title={`1 FLOW = US$ 1 · ${region.label}`}
        className="group flex min-w-0 items-center gap-2.5 rounded-2xl border border-white/[0.07] bg-white/[0.025] px-2.5 py-2 text-white transition hover:bg-white/[0.045]"
        style={{ boxShadow: `inset 0 1px rgba(255,255,255,.025), 0 0 22px ${region.glowSoft}` }}
      >
        <FlowCoinIcon size={31} glow={region.glow} edge={region.edge} imageUrl={region.assetUrl} title={`FLOWS · ${region.label}`} />
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

  const rootMobileVisibility = pathname === "/" ? "hidden md:flex" : "flex";

  return (
    <Link
      href="/mi-flow/billetera?asset=flows"
      aria-label={`${data.balance} ${label}. 1 FLOW equivale a 1 dólar estadounidense.`}
      title={`1 FLOW = US$ 1 · ${region.label}`}
      className={`group fixed right-3 z-[80] ${rootMobileVisibility} min-h-12 items-center gap-2.5 rounded-2xl border bg-[#09080d]/92 px-2.5 py-2 text-white shadow-2xl backdrop-blur-xl transition hover:-translate-y-0.5 hover:bg-[#0d0b12]/96 md:right-5 md:gap-3 md:px-3`}
      style={{
        top: "calc(env(safe-area-inset-top, 0px) + 10px)",
        borderColor: `${region.glow}55`,
        boxShadow: `0 10px 34px rgba(0,0,0,.42), 0 0 24px ${region.glowSoft}`,
      }}
    >
      <FlowCoinIcon size={34} glow={region.glow} edge={region.edge} imageUrl={region.assetUrl} title={`FLOWS · ${region.label}`} />
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
