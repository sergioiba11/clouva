"use client";

import Link from "next/link";
import { useAuth } from "@/components/auth-provider";
import { AccountMenu } from "@/components/account/AccountMenu";
import { OfficialClouvaMark } from "@/components/clouva/OfficialClouvaMark";
import { ClouvaGlobalSearch } from "@/components/clouva/ClouvaGlobalSearch";
import { GlobalFlowBalance } from "@/components/GlobalFlowBalance";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { WalletBalanceChip } from "@/components/wallet/WalletBalanceChip";

export function MainNav() {
  const { user, loading } = useAuth();

  return (
    <header
      className="sticky top-0 z-50 border-b text-white"
      style={{
        background: "rgba(8,7,19,.94)",
        borderBottomColor: "rgba(255,255,255,.06)",
        backdropFilter: "blur(22px)",
        WebkitBackdropFilter: "blur(22px)",
      }}
    >
      <div className="mx-auto flex h-16 w-full max-w-[1600px] items-center gap-3 px-3 sm:px-4 md:gap-4 md:px-6 lg:px-8">
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

        <div className="hidden min-w-[180px] flex-1 sm:block md:ml-2 lg:mx-auto lg:max-w-[620px]">
          <ClouvaGlobalSearch />
        </div>

        <div className="ml-auto flex min-w-0 shrink-0 items-center justify-end gap-1.5 sm:gap-2">
          {!loading && user ? <GlobalFlowBalance variant="header" /> : null}

          {!loading && user ? (
            <span className="hidden px-1 text-[9px] font-bold uppercase tracking-[0.30em] text-violet-300/72 md:inline-flex">
              LATAM
            </span>
          ) : null}

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

          <AccountMenu triggerClassName="max-w-[168px]" />
        </div>
      </div>
    </header>
  );
}

export function MainFooter() {
  return <footer className="mx-auto max-w-7xl px-4 py-10 text-xs uppercase tracking-[0.18em] text-[var(--muted)] md:px-8">CLOUVA · Vida de flows</footer>;
}
