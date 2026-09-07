"use client";

import Link from "next/link";
import { useAuth } from "@/components/auth-provider";
import { AccountMenu } from "@/components/account/AccountMenu";
import { OfficialClouvaMark } from "@/components/clouva/OfficialClouvaMark";
import { ThemeToggle } from "@/components/theme-toggle";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { WalletBalanceChip } from "@/components/wallet/WalletBalanceChip";

export function MainNav() {
  const { user, loading } = useAuth();

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--line)] bg-[var(--card)]/80 backdrop-blur-2xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 md:px-8">
        <Link href="/" className="flex items-center gap-2.5 text-sm font-semibold tracking-[0.3em]">
          <span className="grid h-8 w-8 shrink-0 place-items-center">
            <OfficialClouvaMark tone="light" width={32} height={32} alt="CLOUVA" />
          </span>
          <span className="font-stencil text-base tracking-[0.15em]">CLOUVA</span>
        </Link>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          {!loading && user ? <WalletBalanceChip /> : null}
          {!loading && user ? <NotificationBell /> : null}
          <AccountMenu />
          <Link href="/checkout" className="rounded-full bg-[#8f7cff] px-3 py-1 text-xs text-black">Drop</Link>
        </div>
      </div>
    </header>
  );
}

export function MainFooter() {
  return <footer className="mx-auto max-w-7xl px-4 py-10 text-xs uppercase tracking-[0.18em] text-[var(--muted)] md:px-8">CLOUVA · Vida de flows</footer>;
}
