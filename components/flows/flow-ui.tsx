"use client";

import type { ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { ClouvaLogoMark } from "@/components/brand/clouva-logo";

export function FlowCoin({ compact = false, className = "" }: { compact?: boolean; className?: string }) {
  return (
    <div
      className={`relative grid shrink-0 place-items-center rounded-full ${
        compact ? "h-[72px] w-[72px]" : "h-[170px] w-[170px] sm:h-[210px] sm:w-[210px]"
      } ${className}`}
      aria-hidden="true"
    >
      <div className="absolute inset-[-14%] rounded-full bg-violet-500/15 blur-3xl" />
      <div className="absolute inset-[3%] rounded-full border border-violet-200/20 bg-[radial-gradient(circle_at_33%_26%,rgba(196,181,253,0.3),transparent_19%),linear-gradient(145deg,#2b1747_0%,#0c0b18_42%,#05050b_72%,#271247_100%)] shadow-[inset_0_0_38px_rgba(196,181,253,0.12),0_0_45px_rgba(124,58,237,0.22)]" />
      <div className="absolute inset-[11%] rounded-full border border-violet-300/30 bg-[linear-gradient(145deg,rgba(167,139,250,0.18),rgba(6,6,13,0.65)_52%,rgba(76,29,149,0.22))] shadow-[inset_0_0_22px_rgba(255,255,255,0.06)]" />
      <div className="absolute inset-[20%] rounded-full border border-white/10 bg-black/35" />
      <div className="relative text-violet-100 drop-shadow-[0_0_14px_rgba(196,181,253,0.65)]">
        <ClouvaLogoMark size={compact ? 28 : 72} />
      </div>
    </div>
  );
}

export function FlowHero({
  flowUsdValue,
  loading,
  onRefresh,
  pendingCount = 0,
}: {
  flowUsdValue: number;
  loading: boolean;
  onRefresh: () => void;
  pendingCount?: number;
}) {
  return (
    <section className="relative min-h-[250px] overflow-hidden rounded-[30px] border border-violet-300/12 bg-[#090815] shadow-[0_24px_80px_rgba(0,0,0,0.32)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_76%_30%,rgba(139,92,246,0.26),transparent_26%),radial-gradient(circle_at_55%_110%,rgba(76,29,149,0.22),transparent_44%),linear-gradient(115deg,rgba(11,9,25,0.98),rgba(5,5,11,0.94)_58%,rgba(10,7,21,0.98))]" />
      <div className="pointer-events-none absolute inset-y-0 right-[18%] w-px bg-gradient-to-b from-transparent via-violet-200/20 to-transparent" />
      <div className="pointer-events-none absolute -bottom-16 right-[-8%] h-48 w-[56%] rotate-[-5deg] rounded-[50%] border-t border-violet-300/20 bg-violet-500/[0.04] blur-[1px]" />
      <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-violet-300/20 to-transparent" />

      <div className="relative z-10 flex min-h-[250px] items-center justify-between gap-5 px-5 py-7 sm:px-7 md:px-9">
        <div className="max-w-2xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-violet-300/15 bg-violet-300/[0.06] px-3 py-1.5 text-[9px] font-semibold uppercase tracking-[0.22em] text-violet-200/80">
            <ClouvaLogoMark size={13} />
            Mi Flow · Activos CLOUVA
          </div>
          <h1 className="mt-5 text-[38px] font-semibold leading-none tracking-[-0.045em] text-white sm:text-5xl lg:text-[58px]">
            MIS FLOWS
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-white/48 sm:text-[15px]">
            Tu valor dentro del universo CLOUVA.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-2.5">
            <span className="rounded-full border border-white/[0.08] bg-black/20 px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-white/45">
              1 FLOW = US$ {flowUsdValue.toFixed(2)}
            </span>
            {pendingCount > 0 ? (
              <span className="rounded-full border border-amber-300/15 bg-amber-300/[0.06] px-3 py-1.5 text-[10px] font-medium text-amber-100/75">
                {pendingCount} {pendingCount === 1 ? "operación en proceso" : "operaciones en proceso"}
              </span>
            ) : null}
          </div>
        </div>

        <div className="hidden shrink-0 pr-2 sm:block">
          <FlowCoin />
        </div>

        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-xl border border-white/[0.08] bg-black/25 text-white/50 transition hover:border-violet-300/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/80 disabled:opacity-40 sm:right-5 sm:top-5"
          aria-label="Actualizar FLOWS"
        >
          <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
        </button>
      </div>
    </section>
  );
}

export function FlowMetricCard({
  icon,
  label,
  value,
  detail,
  tone = "violet",
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
  tone?: "violet" | "cyan" | "emerald" | "neutral";
}) {
  const tones = {
    violet: "border-violet-300/14 bg-violet-400/[0.045] text-violet-200",
    cyan: "border-cyan-300/12 bg-cyan-300/[0.035] text-cyan-200",
    emerald: "border-emerald-300/12 bg-emerald-300/[0.035] text-emerald-200",
    neutral: "border-white/[0.075] bg-white/[0.025] text-white/65",
  };

  return (
    <article className={`min-h-[118px] rounded-[22px] border p-4 sm:p-5 ${tones[tone]}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.17em] text-white/38">{label}</p>
          <strong className="mt-2 block text-2xl font-semibold tracking-[-0.03em] text-white">{value}</strong>
        </div>
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[14px] border border-current/15 bg-current/[0.06]">
          {icon}
        </span>
      </div>
      <p className="mt-2 text-[11px] leading-4 text-white/32">{detail}</p>
    </article>
  );
}

function statusTone(label: string) {
  const normalized = label.toUpperCase();
  if (normalized.includes("FLOW DISPONIBLE") || normalized.includes("CONFIRMADO") || normalized === "DISPONIBLE") {
    return "border-emerald-300/20 bg-emerald-300/[0.07] text-emerald-100";
  }
  if (
    normalized.includes("RECHAZADO") ||
    normalized.includes("CANCELADO") ||
    normalized.includes("REVERT") ||
    normalized.includes("REEMBOLS")
  ) {
    return "border-rose-300/20 bg-rose-300/[0.07] text-rose-100";
  }
  if (
    normalized.includes("PENDIENTE") ||
    normalized.includes("PENDING") ||
    normalized.includes("RESPALDO") ||
    normalized.includes("MOVIENDO") ||
    normalized.includes("ESPERANDO")
  ) {
    return "border-amber-300/20 bg-amber-300/[0.07] text-amber-100";
  }
  return "border-violet-300/18 bg-violet-300/[0.06] text-violet-100";
}

export function FlowStatusBadge({ label }: { label: string }) {
  return (
    <span
      className={`inline-flex min-h-7 items-center rounded-full border px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.1em] ${statusTone(
        label,
      )}`}
    >
      {label}
    </span>
  );
}

export function FlowPanel({
  eyebrow,
  title,
  action,
  children,
  className = "",
}: {
  eyebrow?: string;
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`overflow-hidden rounded-[26px] border border-white/[0.075] bg-[#0a0912]/92 ${className}`}>
      <header className="flex min-h-[70px] items-center justify-between gap-4 border-b border-white/[0.06] px-5 py-4 sm:px-6">
        <div>
          {eyebrow ? (
            <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-violet-300/60">{eyebrow}</p>
          ) : null}
          <h2 className="mt-1 text-lg font-semibold tracking-[-0.02em] text-white/90">{title}</h2>
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}
