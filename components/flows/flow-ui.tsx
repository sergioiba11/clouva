"use client";

import Image from "next/image";
import type { ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { FlowLogo } from "@/components/flows/flow-logo";

const CLOUVA_LOGO = "/assets/clouva/brand/logo-official-light.png";

export function FlowCoin({ compact = false, className = "" }: { compact?: boolean; className?: string }) {
  const size = compact ? 54 : 176;

  return (
    <div
      className={`relative shrink-0 place-items-center ${compact ? "!grid h-[60px] w-[60px] rounded-full border border-violet-300/20 bg-violet-400/[0.055] shadow-[inset_0_0_22px_rgba(124,58,237,0.08)]" : "grid h-[188px] w-[188px] sm:h-[210px] sm:w-[210px]"} ${className}`}
    >
      <div className={`pointer-events-none absolute rounded-full bg-violet-500/10 blur-2xl ${compact ? "inset-[8%]" : "inset-[12%] blur-3xl"}`} />
      <FlowLogo size={size} priority={!compact} className="relative z-10" />
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
    <section className="relative min-h-[210px] overflow-hidden rounded-[28px] border border-violet-300/12 bg-[#090815] shadow-[0_24px_80px_rgba(0,0,0,0.3)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_82%_12%,rgba(139,92,246,0.17),transparent_28%),radial-gradient(circle_at_58%_115%,rgba(34,211,238,0.08),transparent_42%),linear-gradient(115deg,rgba(11,9,25,0.98),rgba(5,5,11,0.96)_58%,rgba(10,7,21,0.98))]" />
      <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-violet-300/20 to-transparent" />

      <div className="relative z-10 flex min-h-[210px] items-center justify-between gap-6 px-5 py-7 sm:px-7 md:px-9">
        <div className="min-w-0 max-w-2xl">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/38">
            <Image
              src={CLOUVA_LOGO}
              alt="CLOUVA"
              width={24}
              height={24}
              className="h-6 w-6 object-contain opacity-90"
              priority
            />
            <span>Mi Flow / FLOWS</span>
          </div>

          <h1 className="mt-4 text-[38px] font-semibold leading-none tracking-[-0.045em] text-white sm:text-5xl lg:text-[54px]">
            MIS FLOWS
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-white/48 sm:text-[15px]">
            Tus activos CLOUVA, respaldo y movimientos.
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

        <div className="hidden shrink-0 items-center gap-5 lg:flex">
          <a
            href="#cargar-flow"
            className="inline-flex min-h-12 items-center justify-center rounded-[15px] border border-violet-200/20 bg-gradient-to-r from-violet-600 via-indigo-500 to-cyan-500 px-5 text-sm font-semibold text-white shadow-[0_12px_34px_rgba(124,58,237,0.22)] transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/80"
          >
            + Cargar FLOW
          </a>
          <div className="hidden 2xl:block">
            <FlowCoin />
          </div>
        </div>

        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-xl border border-white/[0.08] bg-black/25 text-white/45 transition hover:border-violet-300/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/80 disabled:opacity-40 sm:right-5 sm:top-5 lg:right-5 lg:top-auto lg:bottom-5"
          aria-label="Actualizar FLOWS"
        >
          <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
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
  const isFlowBalance = label.trim().toUpperCase() === "FLOW DISPONIBLE";
  const tones = {
    violet: "border-violet-300/14 bg-violet-400/[0.045] text-violet-200",
    cyan: "border-cyan-300/12 bg-cyan-300/[0.035] text-cyan-200",
    emerald: "border-emerald-300/12 bg-emerald-300/[0.035] text-emerald-200",
    neutral: "border-white/[0.075] bg-white/[0.025] text-white/65",
  };

  return (
    <article
      className={`relative min-h-[118px] overflow-hidden rounded-[22px] border p-4 sm:p-5 ${tones[tone]} ${
        isFlowBalance
          ? "border-violet-300/28 bg-violet-400/[0.07] shadow-[inset_0_0_34px_rgba(124,58,237,0.055),0_12px_34px_rgba(76,29,149,0.08)]"
          : ""
      }`}
    >
      {isFlowBalance ? (
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_88%_18%,rgba(139,92,246,0.13),transparent_34%)]" />
      ) : null}
      <div className="relative flex items-start justify-between gap-4">
        <div>
          <p className={`text-[10px] font-semibold uppercase tracking-[0.17em] ${isFlowBalance ? "text-violet-200/80" : "text-white/38"}`}>
            {label}
          </p>
          <strong className={`mt-2 block font-semibold tracking-[-0.035em] text-white ${isFlowBalance ? "text-[26px]" : "text-2xl"}`}>
            {value}
          </strong>
        </div>
        {isFlowBalance ? (
          <span className="relative grid h-12 w-12 shrink-0 place-items-center rounded-full border border-violet-300/16 bg-black/20">
            <FlowLogo size={42} priority />
          </span>
        ) : (
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[14px] border border-current/15 bg-current/[0.06]">
            {icon}
          </span>
        )}
      </div>
      <p className={`relative mt-2 text-[11px] leading-4 ${isFlowBalance ? "text-violet-100/48" : "text-white/32"}`}>
        {detail}
      </p>
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
  const purchasePanel = title === "Cargar FLOW";
  const assetsPanel = title === "Tus FLOWS";
  const headerAction = action ?? (purchasePanel ? <FlowLogo size={36} priority /> : null);

  return (
    <section
      id={purchasePanel ? "cargar-flow" : undefined}
      className={`relative overflow-hidden rounded-[26px] border bg-[#0a0912]/92 ${
        purchasePanel
          ? "order-first scroll-mt-24 border-violet-300/12 shadow-[0_18px_55px_rgba(28,15,55,0.16)] xl:order-none"
          : assetsPanel
            ? "border-violet-300/10 shadow-[0_18px_55px_rgba(0,0,0,0.16)]"
            : "border-white/[0.075]"
      } ${className}`}
    >
      {purchasePanel ? (
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_94%_4%,rgba(139,92,246,0.11),transparent_28%)]" />
      ) : null}
      <header
        className={`relative flex min-h-[70px] items-center justify-between gap-4 border-b px-5 py-4 sm:px-6 ${
          assetsPanel ? "border-violet-300/[0.075] bg-violet-400/[0.018]" : "border-white/[0.06]"
        }`}
      >
        <div>
          {eyebrow ? (
            <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-violet-300/60">{eyebrow}</p>
          ) : null}
          <h2 className={`mt-1 font-semibold tracking-[-0.02em] text-white/90 ${assetsPanel ? "text-xl" : "text-lg"}`}>
            {title}
          </h2>
        </div>
        {headerAction ? (
          <div className={purchasePanel ? "grid h-11 w-11 place-items-center rounded-full border border-violet-300/14 bg-black/20" : ""}>
            {headerAction}
          </div>
        ) : null}
      </header>
      <div className="relative">{children}</div>
    </section>
  );
}
