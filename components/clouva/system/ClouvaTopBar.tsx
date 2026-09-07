"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { AccountMenu } from "@/components/account/AccountMenu";
import { useCurrentPlayer } from "@/components/current-player-provider";
import { ClouvaGlobalSearch } from "@/components/clouva/ClouvaGlobalSearch";
import { OfficialClouvaMark } from "@/components/clouva/OfficialClouvaMark";
import { GlobalFlowBalance } from "@/components/GlobalFlowBalance";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { WalletBalanceChip } from "@/components/wallet/WalletBalanceChip";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";
import type { FlowRegion } from "@/lib/flows";
import { resolveHomeDisplayName } from "@/lib/identity-names";
import { getPlayerDestination } from "@/lib/navigation/clouva-navigation";
import { VISUAL_ASSETS } from "@/lib/visual-assets";

const REGION_REFRESH_MS = 60_000;
const PLAYER_ORBITS_ASSET = VISUAL_ASSETS["home-mobile-player-orbits-01"];

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

function DesktopTopBarPlayerIdentity() {
  const { user, profile } = useAuth();
  const { currentPlayer } = useCurrentPlayer();

  const displayName = resolveHomeDisplayName({ currentPlayer, profile, user });
  const username = currentPlayer?.username
    ? `@${currentPlayer.username.replace(/^@/, "")}`
    : profile?.username
      ? `@${profile.username.replace(/^@/, "")}`
      : "Tu Player";
  const playerImage = currentPlayer?.profile_image_url
    || currentPlayer?.logo_url
    || profile?.avatar_url
    || user?.user_metadata?.avatar_url
    || null;
  const playerHref = getPlayerDestination(currentPlayer);
  const playerInitial = displayName.trim().charAt(0).toUpperCase() || "C";

  return (
    <Link
      href={playerHref}
      aria-label={`Abrir Player de ${displayName}`}
      className="w-[188px] shrink-0 items-center gap-2.5 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/70"
      data-clouva-desktop-player-brand
    >
      <span className="relative grid h-11 w-11 shrink-0 place-items-center">
        <span className="absolute inset-[7px] rounded-full bg-violet-500/20 blur-[8px]" aria-hidden="true" />
        <img
          src={PLAYER_ORBITS_ASSET}
          alt=""
          aria-hidden="true"
          draggable={false}
          className="pointer-events-none absolute left-1/2 top-1/2 h-[58px] w-[58px] max-w-none -translate-x-1/2 -translate-y-1/2 select-none object-contain drop-shadow-[0_0_8px_rgba(184,71,255,0.55)]"
        />
        <span className="relative z-[1] grid h-[34px] w-[34px] place-items-center overflow-hidden rounded-full border border-white/20 bg-[#100a17] shadow-[0_0_14px_rgba(142,61,236,0.3)]">
          {playerImage ? (
            <img src={String(playerImage)} alt="" className="h-full w-full object-cover" />
          ) : (
            <b className="text-[12px] font-extrabold text-white">{playerInitial}</b>
          )}
        </span>
      </span>

      <span className="min-w-0 leading-none">
        <strong className="block truncate text-[11px] font-extrabold text-white">{displayName}</strong>
        <small className="mt-1 block truncate text-[9px] font-medium text-violet-200/60">{username}</small>
      </span>
    </Link>
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
    <>
      <style>{`
        /* Home Desktop previously reserved its own 64px header row. The old
           JSX is gone; this negative sibling margin lets the canonical root
           bar occupy that exact row without changing Home's responsive grid. */
        [data-clouva-system-topbar="official"]:has(+ main > nav[aria-label="Navegación móvil"]) {
          margin-bottom: -64px;
        }

        /* Mobile Home keeps its header only inside CLOUVA Lab preview. In the
           real authenticated app the root system bar is the only visible one. */
        [data-ui-page="mobile-home"][data-ui-preview="false"] > [data-clouva-block="header"] {
          display: none !important;
        }

        /* The existing mobile top-left identity stays exactly as it is. The
           Player/orbit identity only replaces the generic CLOUVA brand on the
           desktop side of the same 820px Home breakpoint. */
        [data-clouva-desktop-player-brand] {
          display: none;
        }

        @media (min-width: 821px) {
          [data-clouva-mobile-brand] {
            display: none !important;
          }

          [data-clouva-desktop-player-brand] {
            display: flex;
          }

          /* The desktop Home Player float has moved into the system bar, so it
             must not remain duplicated inside the hero. This selector is scoped
             to that exact Home hero and does not touch MobileHomeDashboard. */
          [data-visual-asset="home-hero-studio-clean"] > [aria-label^="Player "] {
            display: none !important;
          }
        }
      `}</style>
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
            data-clouva-mobile-brand
          >
            <span className="grid h-8 w-8 shrink-0 place-items-center">
              <OfficialClouvaMark tone="light" width={30} height={30} alt="CLOUVA" />
            </span>
            <strong className="hidden text-[14px] font-extrabold tracking-[0.13em] text-white sm:block">CLOUVA</strong>
          </Link>

          <DesktopTopBarPlayerIdentity />

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
    </>
  );
}
