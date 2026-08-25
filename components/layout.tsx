"use client";

import Link from "next/link";
import { useAuth } from "@/components/auth-provider";
import { AccountMenu } from "@/components/account/AccountMenu";
import { ThemeToggle } from "@/components/theme-toggle";
import { CloverIcon } from "@/components/clover-icon";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { WalletBalanceChip } from "@/components/wallet/WalletBalanceChip";

export function MainNav() {
  const { user, loading } = useAuth();

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--line)] bg-[var(--card)]/80 backdrop-blur-2xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 md:px-8">
        <Link href="/" className="flex items-center gap-2 text-sm font-semibold tracking-[0.3em]">
          <CloverIcon className="text-[#8f7cff]" size={18} />
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
