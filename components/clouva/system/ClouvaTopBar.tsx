"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { AccountMenu } from "@/components/account/AccountMenu";
import { ClouvaGlobalSearch } from "@/components/clouva/ClouvaGlobalSearch";
import { OfficialClouvaMark } from "@/components/clouva/OfficialClouvaMark";
import { GlobalFlowBalance } from "@/components/GlobalFlowBalance";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { WalletBalanceChip } from "@/components/wallet/WalletBalanceChip";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";
import type { FlowRegion } from "@/lib/flows";

const REGION_REFRESH_MS = 60_000;

type FlowRegionPayload = {
  region: FlowRegion;
};

function systemRegionLabel(region: FlowRegion | null) {
  if (!region) return "CLOUVA";
  if (region.key === "latam" || region.key === "argentina" || region.key === "patagonia") return "LATAM";
  if (region.key === "north-america") return "NORTEAMÉRICA";
  if (region.key === "asia-pacific") return "ASIA";
  if (region.key === "global") return "GLOBAL";
  return region.label.toUpperCase();
}

function TopBarRegionLabel() {
  const { user } = useAuth();
  const [region, setRegion] = useState<FlowRegion | null>(null);

  const load = useCallback(async () => {
    if (!user) {
      setRegion(null);
      return;
    }

    try {
      const response = await authenticatedFetch("/api/flows/balance", { cache: "no-store" });
      const payload = await readApiJson<FlowRegionPayload>(response);
      setRegion(payload.region ?? null);
    } catch {
      // The FLOW chip owns the balance error state. Region metadata simply
      // falls back to CLOUVA instead of inventing a geographic region.
      setRegion(null);
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    void load();
    const interval = window.setInterval(() => void load(), REGION_REFRESH_MS);
    const refresh = () => void load();
    window.addEventListener("clouva:flows-changed", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("clouva:flows-changed", refresh);
    };
  }, [load, user]);

  return (
    <span
      className="hidden h-[34px] shrink-0 items-center border-x border-white/[0.06] px-3 text-[9px] font-bold uppercase tracking-[0.22em] text-violet-200/75 lg:flex"
      title={region ? `Región CLOUVA · ${region.label}` : "Región CLOUVA"}
      data-clouva-topbar-region={region?.key ?? "unknown"}
    >
      {systemRegionLabel(region)}
    </span>
  );
}

/**
 * The single canonical authenticated CLOUVA system bar.
 *
 * Keep contextual navigation in each surface/sidebar. This bar owns only
 * global identity, discovery, economy, region, notifications and account.
 */
export function ClouvaTopBar() {
  const { user, loading } = useAuth();

  return (
    <header
      className="sticky top-0 z-50 w-full border-b text-white"
      style={{
        background: "rgba(8,7,19,.94)",
        borderBottomColor: "rgba(255,255,255,.06)",
        backdropFilter: "blur(22px)",
        WebkitBackdropFilter: "blur(22px)",
      }}
      data-clouva-system-topbar="official"
    >
      <div className="mx-auto flex h-16 w-full max-w-[1800px] items-center gap-2 px-2 sm:gap-3 sm:px-4 md:gap-4 md:px-6 lg:px-8">
        <Link
          href="/"
          aria-label="CLOUVA · Inicio"
          className="flex w-fit shrink-0 items-center gap-2.5 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/70"
        >
          <span className="grid h-8 w-8 shrink-0 place-items-center">
            <OfficialClouvaMark tone="light" width={30} height={30} alt="CLOUVA" />
          </span>
          <strong className="hidden text-[14px] font-extrabold tracking-[0.13em] text-white sm:block">CLOUVA</strong>
        </Link>

        <div className="min-w-[44px] flex-1 sm:min-w-[160px] md:ml-2 lg:mx-auto lg:max-w-[620px]">
          <ClouvaGlobalSearch />
        </div>

        <div className="ml-auto flex min-w-0 shrink-0 items-center justify-end gap-1 sm:gap-2">
          {!loading && user ? <GlobalFlowBalance variant="header" /> : null}
          {!loading && user ? <TopBarRegionLabel /> : null}

          {!loading && user ? (
            <div className="hidden md:block">
              <WalletBalanceChip showFlows={false} showDiamonds />
            </div>
          ) : null}

          {!loading && user ? <NotificationBell /> : null}

          <AccountMenu variant="home" triggerClassName="max-w-[168px]" />
        </div>
      </div>
    </header>
  );
}
