"use client";

import Link from "next/link";
import { useAuth } from "@/components/auth-provider";
import { AccountMenu } from "@/components/account/AccountMenu";
import { OfficialClouvaMark } from "@/components/clouva/OfficialClouvaMark";
import { GlobalFlowBalance } from "@/components/GlobalFlowBalance";
import { ThemeToggle } from "@/components/theme-toggle";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { WalletBalanceChip } from "@/components/wallet/WalletBalanceChip";

export function MainNav() {
  const { user, loading } = useAuth();

  return (
    <header className="sticky top-0 z-50 border-b border-white/[0.06] bg-[#080713]/92 text-white backdrop-blur-[22px]">
      <div className="mx-auto grid h-16 w-full max-w-[1600px] grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 sm:px-5 md:px-6 lg:grid-cols-[minmax(190px,1fr)_minmax(80px,1fr)_auto] lg:px-8">
        <Link
          href="/"
          aria-label="CLOUVA LATAM · Inicio"
          className="flex min-w-0 w-fit items-center gap-2.5 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/70"
        >
          <span className="grid h-8 w-8 shrink-0 place-items-center">
            <OfficialClouvaMark tone="light" width={30} height={30} alt="CLOUVA" />
          </span>
          <span className="grid min-w-0 leading-none">
            <strong className="truncate text-[14px] font-extrabold tracking-[0.13em] text-white">CLOUVA</strong>
            <small className="mt-1 text-[7px] font-semibold uppercase tracking-[0.32em] text-violet-300/62">LATAM</small>
          </span>
        </Link>

        <div className="hidden min-w-0 lg:block" aria-hidden="true" />

        <div className="flex min-w-0 items-center justify-end gap-1.5 sm:gap-2">
          <div className="hidden md:block">
            <ThemeToggle />
          </div>

          {!loading && user ? <GlobalFlowBalance variant="header" /> : null}

          {!loading && user ? (
            <div className="hidden sm:block">
              <WalletBalanceChip showFlows={false} showDiamonds />
            </div>
          ) : null}

          {!loading && user ? (
            <div className="hidden sm:block">
              <NotificationBell />
            </div>
          ) : null}

          <AccountMenu triggerClassName="max-w-[164px]" />

          <Link
            href="/checkout"
            className="hidden h-[38px] items-center rounded-full border border-violet-300/14 bg-violet-400/[0.07] px-3 text-[10px] font-semibold tracking-[0.02em] text-violet-100/86 transition hover:border-violet-300/24 hover:bg-violet-400/[0.12] lg:inline-flex"
          >
            Drop
          </Link>
        </div>
      </div>
    </header>
  );
}

export function MainFooter() {
  return <footer className="mx-auto max-w-7xl px-4 py-10 text-xs uppercase tracking-[0.18em] text-[var(--muted)] md:px-8">CLOUVA · Vida de flows</footer>;
}
