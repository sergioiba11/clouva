"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";
import { CloverIcon } from "@/components/clover-icon";
import { DiamondIcon } from "@/components/diamond-icon";

export function WalletBalanceChip() {
  const { user, loading } = useAuth();
  const [balances, setBalances] = useState<{ flows: number; diamonds: number } | null>(null);

  useEffect(() => {
    if (loading || !user) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await authenticatedFetch("/api/wallet/balances");
        const payload = await readApiJson<{ flows: number; diamonds: number }>(response);
        if (!cancelled) setBalances(payload);
      } catch {
        // A wallet chip failing to load must never block navigation.
      }
    })();
    return () => { cancelled = true; };
  }, [loading, user]);

  if (loading || !user || !balances) return null;

  return (
    <div className="flex items-center gap-1 rounded-full border border-[var(--line)] bg-white/[0.03] p-1 text-xs font-medium">
      <Link href="/mi-flow?asset=flows" className="flex items-center gap-1 rounded-full px-2 py-1 transition hover:bg-white/[0.06]" title="Abrir FLOWS en MI FLOW">
        <CloverIcon className="text-[#8f7cff]" size={14} />
        {balances.flows}
      </Link>
      <span className="h-3 w-px bg-[var(--line)]" />
      <Link href="/mi-flow?asset=diamonds" className="flex items-center gap-1 rounded-full px-2 py-1 transition hover:bg-white/[0.06]" title="Abrir Diamantes en MI FLOW">
        <DiamondIcon className="text-cyan-300" size={14} />
        {balances.diamonds}
      </Link>
    </div>
  );
}
