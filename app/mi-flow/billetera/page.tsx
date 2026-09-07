"use client";

import { Building2, CircleDollarSign, Crown, History, Loader2, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { DiamondIcon } from "@/components/diamond-icon";
import { FlowAppShell } from "@/components/flows/flow-app-shell";
import { FlowMetricCard, FlowPanel } from "@/components/flows/flow-ui";
import { PlayerFlowWallet } from "@/components/wallet/PlayerFlowWallet";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type CreditEntry = {
  id: string;
  transaction_type: string;
  amount: number;
  balance_after: number;
  source: string | null;
  created_at: string;
};

type MoneySummary = {
  currency: string;
  generatedMinor: number;
  pendingMinor: number;
  availableMinor: number;
  withdrawnMinor: number;
  refundedMinor?: number;
};

type MoneyEntry = {
  id: string;
  currency: string;
  net_amount_minor: number;
  status: string;
  source_type: string;
  created_at: string;
};

type FlowAssetPreview = {
  id: string;
  flow_number: number;
  status: string;
  available: boolean;
};

type SpaceMoney = {
  id: string;
  name: string;
  slug: string;
  type: string;
  role: string;
  summary: MoneySummary[];
  activity: MoneyEntry[];
  adminHref: string;
  moneyRelation: "separate" | "personal_breakdown";
};

type SummaryPayload = {
  player: { id: string; display_name: string; slug: string } | null;
  plan: { isVip: boolean; canAdministerSpaces: boolean };
  wallets: { flows: number; diamonds: number };
  walletActivity: { flows: CreditEntry[]; diamonds: CreditEntry[] };
  money: {
    personal: MoneySummary[];
    personalActivity: MoneyEntry[];
    managed: MoneySummary[];
    managedActivity: MoneyEntry[];
  };
  spaces: SpaceMoney[];
};

type AssetsPayload = { assets?: unknown };

function moneyMinor(value: number, currency: string) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value / 100);
}

function when(value: string) {
  return new Date(value).toLocaleString("es-AR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function spaceTypeLabel(type: string) {
  return (
    {
      studio: "Estudio",
      business: "Negocio",
      spot: "Spot",
      club: "Club",
      brand: "Marca",
      other: "Espacio",
    } as Record<string, string>
  )[type] || "Espacio";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function safeFlowAssets(value: unknown): FlowAssetPreview[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((row) => {
    if (!isRecord(row) || typeof row.id !== "string") return [];

    const flowNumber = Number(row.flow_number);
    if (!Number.isFinite(flowNumber)) return [];

    const status = typeof row.status === "string" ? row.status : "unknown";
    const operation = isRecord(row.operation) ? row.operation : null;
    const allocation = isRecord(row.backingAllocation) ? row.backingAllocation : null;
    const reserveAccount = allocation && isRecord(allocation.reserveAccount) ? allocation.reserveAccount : null;

    const activeBacking = Boolean(
      allocation?.status === "active" &&
        reserveAccount?.accountRole === "reserve" &&
        reserveAccount?.isActive === true &&
        reserveAccount?.authorizedForFlow === true &&
        reserveAccount?.status === "active",
    );

    const available = Boolean(
      status !== "reversed" &&
        status !== "legacy_unverified" &&
        activeBacking &&
        operation?.backing_status === "verified" &&
        operation?.status === "confirmed",
    );

    return [{ id: row.id, flow_number: flowNumber, status, available }];
  });
}

export default function MiFlowWalletPage() {
  const { user, profile, loading: authLoading } = useAuth();
  const [data, setData] = useState<SummaryPayload | null>(null);
  const [flowAssets, setFlowAssets] = useState<FlowAssetPreview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const response = await authenticatedFetch("/api/mi-flow/summary");
      setData(await readApiJson<SummaryPayload>(response));
      try {
        const assetsResponse = await authenticatedFetch("/api/flows/assets");
        const assetsPayload = await readApiJson<AssetsPayload>(assetsResponse);
        setFlowAssets(safeFlowAssets(assetsPayload.assets));
      } catch {
        setFlowAssets([]);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo cargar la billetera.");
      setFlowAssets([]);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLoading(false);
      return;
    }
    void load();
  }, [authLoading, load, user]);

  useEffect(() => {
    if (!data || typeof window === "undefined") return;
    const asset = new URLSearchParams(window.location.search).get("asset");
    const target = asset === "flows" ? "flows" : asset === "diamonds" ? "diamonds" : null;
    if (!target) return;
    requestAnimationFrame(() => document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, [data]);

  const activity = useMemo(() => data?.money.personalActivity ?? [], [data]);
  const availableFlowCount = useMemo(() => flowAssets.filter((asset) => asset.available).length, [flowAssets]);

  const playerIdentity = data?.player
    ? {
        ...data.player,
        username: profile?.username ?? null,
        profile_image_url: profile?.avatar_url ?? null,
      }
    : profile
      ? {
          id: profile.id,
          display_name: profile.display_name || profile.full_name || profile.username || "Mi Player",
          slug: profile.username || profile.id,
          username: profile.username ?? null,
          profile_image_url: profile.avatar_url ?? null,
        }
      : null;

  return (
    <FlowAppShell headerEyebrow="Mi Flow / Billetera" headerTitle="MI BILLETERA">
      <main className="px-4 py-5 sm:px-6 sm:py-7 lg:px-8 xl:px-10 xl:py-8">
        <div className="mx-auto max-w-[1240px] space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-300/55">Player / Mi Flow</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-white/92">Tu billetera personal CLOUVA</h1>
              <p className="mt-1 text-sm text-white/36">FLOW, dinero, Diamantes y cuentas del Player en una sola vista.</p>
            </div>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-black/15 px-3 py-2 text-xs text-white/45 transition hover:border-violet-300/20 hover:text-white disabled:opacity-40"
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
              Actualizar
            </button>
          </div>

          {error ? (
            <p className="rounded-2xl border border-rose-300/15 bg-rose-300/[0.06] p-4 text-sm text-rose-200">{error}</p>
          ) : null}

          {loading ? (
            <div className="grid min-h-64 place-items-center rounded-[28px] border border-violet-300/12 bg-[#090815] text-sm text-white/40">
              <span className="inline-flex items-center gap-2"><Loader2 size={16} className="animate-spin" />Cargando tu billetera…</span>
            </div>
          ) : null}

          {!loading && data ? (
            <>
              <section id="flows" className="scroll-mt-24">
                <PlayerFlowWallet
                  player={playerIdentity}
                  balance={data.wallets.flows}
                  assetCount={flowAssets.length}
                  availableCount={availableFlowCount}
                />
              </section>

              <section className="pt-3">
                <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-300/55">Resto de tu billetera</p>
                    <h2 className="mt-1 text-2xl font-semibold tracking-[-0.03em]">Dinero, Diamantes y espacios</h2>
                  </div>
                  <p className="max-w-xl text-xs leading-5 text-white/30">Estos saldos permanecen separados de FLOW y de los ledgers de tus espacios.</p>
                </div>
              </section>

              <FlowPanel eyebrow="Dinero del Player" title="Saldo personal">
                {data.money.personal.length ? (
                  <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-4">
                    {data.money.personal.flatMap((summary) => [
                      <FlowMetricCard key={`${summary.currency}-generated`} icon={<CircleDollarSign size={17} />} label={`${summary.currency} generado`} value={moneyMinor(summary.generatedMinor, summary.currency)} detail="Total generado en el ledger monetario." tone="violet" />,
                      <FlowMetricCard key={`${summary.currency}-pending`} icon={<History size={17} />} label="Pendiente" value={moneyMinor(summary.pendingMinor, summary.currency)} detail="Importe todavía no disponible." tone="neutral" />,
                      <FlowMetricCard key={`${summary.currency}-available`} icon={<CircleDollarSign size={17} />} label="Disponible" value={moneyMinor(summary.availableMinor, summary.currency)} detail="Dinero personal disponible." tone="emerald" />,
                      <FlowMetricCard key={`${summary.currency}-withdrawn`} icon={<CircleDollarSign size={17} />} label="Retirado" value={moneyMinor(summary.withdrawnMinor, summary.currency)} detail="Importe retirado desde el ledger." tone="neutral" />,
                    ])}
                  </div>
                ) : (
                  <div className="px-5 py-8 text-sm text-white/35 sm:px-6">Todavía no tenés movimientos de dinero personal.</div>
                )}
              </FlowPanel>

              <FlowPanel
                eyebrow="Crédito premium"
                title="Diamantes"
                action={<span className="inline-flex items-center gap-2 text-2xl font-semibold text-white"><DiamondIcon className="text-cyan-300" size={20} />{data.wallets.diamonds}</span>}
                className="scroll-mt-24"
              >
                <div id="diamonds" className="scroll-mt-24 px-5 pb-4 sm:px-6">
                  <CreditRows rows={data.walletActivity.diamonds} />
                </div>
              </FlowPanel>

              <FlowPanel eyebrow="Dinero del Player" title="Movimientos de mi dinero">
                {activity.length ? (
                  <div className="divide-y divide-white/[0.06]">
                    {activity.slice(0, 20).map((row) => (
                      <div key={row.id} className="flex items-center justify-between gap-4 px-5 py-4 text-sm sm:px-6">
                        <div>
                          <p className="capitalize text-white/75">{row.source_type.replaceAll("_", " ")}</p>
                          <p className="mt-1 text-xs text-white/30">{when(row.created_at)} · {row.status}</p>
                        </div>
                        <strong className="text-white/80">{moneyMinor(row.net_amount_minor, row.currency)}</strong>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="px-5 py-8 text-sm text-white/35 sm:px-6">Todavía no hay movimientos acreditados.</p>
                )}
              </FlowPanel>

              <section>
                <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-300/55">Espacios</p>
                    <h2 className="mt-1 text-2xl font-semibold tracking-[-0.03em]">Cuentas que administrás</h2>
                  </div>
                  <Link href="/mi-spot" className="text-xs font-semibold text-violet-300 hover:text-violet-200">Ver mis espacios →</Link>
                </div>

                {!data.plan.canAdministerSpaces ? (
                  <div className="flex flex-col gap-4 rounded-[26px] border border-white/[0.075] bg-[#0a0912]/92 p-6 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="flex items-center gap-2 font-semibold"><Crown size={17} className="text-amber-300" />Administración con CLOUVA VIP</p>
                      <p className="mt-2 max-w-xl text-sm leading-6 text-white/45">Tu Player puede usar CLOUVA gratis. Para crear o administrar Estudios, Negocios, Spots, Clubes o Marcas necesitás VIP.</p>
                    </div>
                    <Link href="/vip" className="shrink-0 rounded-[15px] border border-violet-200/20 bg-violet-600 px-4 py-2.5 text-center text-sm font-semibold">Ver VIP</Link>
                  </div>
                ) : data.spaces.length ? (
                  <div className="grid gap-4 md:grid-cols-2">{data.spaces.map((space) => <SpaceMoneyCard key={space.id} space={space} />)}</div>
                ) : (
                  <div className="rounded-[26px] border border-white/[0.075] bg-[#0a0912]/92 p-6 text-sm text-white/40">No tenés espacios con acceso financiero todavía.</div>
                )}
              </section>
            </>
          ) : null}
        </div>
      </main>
    </FlowAppShell>
  );
}

function CreditRows({ rows }: { rows: CreditEntry[] }) {
  return (
    <div className="divide-y divide-white/[0.06]">
      {rows.length ? rows.slice(0, 5).map((row) => (
        <div key={row.id} className="flex items-center justify-between py-3 text-sm">
          <div>
            <p className="text-white/72">{row.source || row.transaction_type}</p>
            <p className="mt-0.5 text-xs text-white/30">{when(row.created_at)}</p>
          </div>
          <div className="text-right">
            <b className="text-white/80">{row.amount >= 0 ? "+" : ""}{row.amount}</b>
            <p className="text-xs text-white/30">saldo {row.balance_after}</p>
          </div>
        </div>
      )) : <p className="py-5 text-sm text-white/35">Sin movimientos todavía.</p>}
    </div>
  );
}

function SpaceMoneyCard({ space }: { space: SpaceMoney }) {
  return (
    <article className="rounded-[26px] border border-white/[0.075] bg-[#0a0912]/92 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[14px] border border-violet-300/15 bg-violet-300/[0.05] text-violet-300"><Building2 size={18} /></span>
          <div>
            <p className="font-semibold">{space.name}</p>
            <p className="mt-0.5 text-xs text-white/35">{spaceTypeLabel(space.type)} · {space.role}</p>
          </div>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-[10px] ${space.moneyRelation === "separate" ? "border-emerald-300/15 bg-emerald-300/[0.06] text-emerald-200" : "border-violet-300/15 bg-violet-300/[0.06] text-violet-200"}`}>
          {space.moneyRelation === "separate" ? "Cuenta separada" : "Incluido en mi Player"}
        </span>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {space.summary.length ? space.summary.flatMap((summary) => [
          <div key={`${space.id}-${summary.currency}-available`} className="rounded-xl border border-white/[0.05] bg-white/[0.025] p-3">
            <p className="text-[10px] uppercase tracking-wider text-white/30">{summary.currency} disponible</p>
            <b className="mt-1 block">{moneyMinor(summary.availableMinor, summary.currency)}</b>
          </div>,
          <div key={`${space.id}-${summary.currency}-pending`} className="rounded-xl border border-white/[0.05] bg-white/[0.025] p-3">
            <p className="text-[10px] uppercase tracking-wider text-white/30">Pendiente</p>
            <b className="mt-1 block">{moneyMinor(summary.pendingMinor, summary.currency)}</b>
          </div>,
        ]) : (
          <div className="rounded-xl border border-white/[0.05] bg-white/[0.025] p-3 text-xs text-white/35 sm:col-span-2">Sin movimientos todavía.</div>
        )}
      </div>

      <p className="mt-3 text-[11px] leading-5 text-white/35">
        {space.moneyRelation === "separate" ? "Este saldo no forma parte de tu dinero personal." : "Este bloque es un desglose del dinero de tu Player; no se suma una segunda vez."}
      </p>
      <Link href={space.adminHref} className="mt-4 inline-flex rounded-xl border border-white/[0.08] px-3.5 py-2 text-xs font-semibold text-white/65 transition hover:border-violet-400/25 hover:text-white">Administrar espacio</Link>
    </article>
  );
}
