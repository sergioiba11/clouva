"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { FlowLogo } from "@/components/flows/flow-logo";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";
import { DiamondIcon } from "@/components/diamond-icon";

type WalletBalanceChipProps = {
  showFlows?: boolean;
  showDiamonds?: boolean;
};

export function WalletBalanceChip({
  showFlows = true,
  showDiamonds = true,
}: WalletBalanceChipProps = {}) {
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

  if (loading || !user || !balances || (!showFlows && !showDiamonds)) return null;

  return (
    <div className="flex h-[38px] items-center gap-1 rounded-full border border-white/[0.07] bg-white/[0.025] p-1 text-xs font-medium text-white backdrop-blur-xl">
      {showFlows ? (
        <Link
          href="/mi-flow/billetera?asset=flows"
          className="flex h-7 items-center gap-1.5 rounded-full px-2 transition hover:bg-white/[0.06]"
          title="Abrir tu billetera Mi Flow"
        >
          <FlowLogo size={16} glow={false} />
          <span className="whitespace-nowrap tabular-nums">{balances.flows} FLOWS</span>
        </Link>
      ) : null}

      {showFlows && showDiamonds ? <span className="h-3 w-px bg-white/[0.08]" /> : null}

      {showDiamonds ? (
        <Link
          href="/mi-flow/billetera?asset=diamonds"
          className="flex h-7 items-center gap-1.5 rounded-full px-2 transition hover:bg-white/[0.06]"
          title="Abrir Diamantes en tu billetera"
          aria-label={`${balances.diamonds} Diamantes`}
        >
          <DiamondIcon className="text-cyan-300" size={14} />
          <span className="tabular-nums">{balances.diamonds}</span>
        </Link>
      ) : null}
    </div>
  );
}
