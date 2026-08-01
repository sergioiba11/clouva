"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";
import { CloverIcon } from "@/components/clover-icon";
import { DiamondIcon } from "@/components/diamond-icon";

// Both currencies are backend-only so far -- no store to spend either one
// in yet -- but the balance itself has to be visible somewhere for either
// to feel real, so it lives in the header for every logged-in user.
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
        // Silent -- a wallet chip failing to load shouldn't block the header.
      }
    })();
    return () => { cancelled = true; };
  }, [loading, user]);

  if (loading || !user || !balances) return null;

  return (
    <div className="flex items-center gap-2.5 rounded-full border border-[var(--line)] bg-white/[0.03] px-3 py-1.5 text-xs font-medium">
      <span className="flex items-center gap-1" title="Flows">
        <CloverIcon className="text-[#8f7cff]" size={14} />
        {balances.flows}
      </span>
      <span className="h-3 w-px bg-[var(--line)]" />
      <span className="flex items-center gap-1" title="Diamante">
        <DiamondIcon className="text-cyan-300" size={14} />
        {balances.diamonds}
      </span>
    </div>
  );
}
