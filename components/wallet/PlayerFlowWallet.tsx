"use client";

import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Loader2,
  Plus,
  QrCode,
  ScanLine,
  Search,
  Send,
  WalletCards,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { MyQrCard } from "@/components/account/MyQrCard";
import { ClouvaLogoMark } from "@/components/brand/clouva-logo";
import { UniversalQrPayment } from "@/components/flows/UniversalQrPayment";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type FlowActivity = {
  id: string;
  transaction_type: string;
  amount: number;
  balance_after: number;
  source: string | null;
  created_at: string;
};

type PlayerIdentity = {
  id: string;
  display_name: string;
  slug: string;
  username?: string | null;
  profile_image_url?: string | null;
} | null;

type Recipient = {
  playerId: string;
  slug: string;
  username: string | null;
  displayName: string;
  profileImageUrl: string | null;
  publicToken: string;
  paymentHref: string;
};

type WalletMode = "pay" | "send" | "receive" | null;

function when(value: string) {
  return new Date(value).toLocaleString("es-AR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function flowNumber(value: number) {
  return new Intl.NumberFormat("es-AR", { maximumFractionDigits: 6 }).format(Number(value) || 0);
}

function movementLabel(row: FlowActivity) {
  const source = row.source?.trim();
  if (source) return source;
  return row.transaction_type.replaceAll("_", " ");
}

function avatarLabel(player: PlayerIdentity) {
  const name = player?.display_name?.trim() || "CLOUVA";
  return name.slice(0, 1).toUpperCase();
}

export function PlayerFlowWallet({
  player,
  balance,
  activity,
  isAdmin,
  onFlowChanged,
}: {
  player: PlayerIdentity;
  balance: number;
  activity: FlowActivity[];
  isAdmin: boolean;
  onFlowChanged?: () => void;
}) {
  const [mode, setMode] = useState<WalletMode>(null);
  const [recipientQuery, setRecipientQuery] = useState("");
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [recipientBusy, setRecipientBusy] = useState(false);
  const [recipientError, setRecipientError] = useState<string | null>(null);

  function syncModeUrl(nextMode: WalletMode) {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("asset", "flows");
    if (nextMode === "pay") url.searchParams.set("action", "pay-qr");
    else url.searchParams.delete("action");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }

  function openMode(nextMode: Exclude<WalletMode, null>) {
    setMode(nextMode);
    syncModeUrl(nextMode);
  }

  function close() {
    setMode(null);
    setRecipientQuery("");
    setRecipients([]);
    setRecipientError(null);
    syncModeUrl(null);
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("asset") === "flows" && params.get("action") === "pay-qr") setMode("pay");
  }, []);

  async function searchRecipients() {
    const query = recipientQuery.trim();
    if (query.length < 2) {
      setRecipients([]);
      setRecipientError("Escribí al menos 2 caracteres.");
      return;
    }
    setRecipientBusy(true);
    setRecipientError(null);
    try {
      const response = await authenticatedFetch(`/api/flows/recipients?q=${encodeURIComponent(query)}`);
      const payload = await readApiJson<{ recipients: Recipient[] }>(response);
      setRecipients(payload.recipients ?? []);
      if (!payload.recipients?.length) setRecipientError("No encontré un Player público con QR FLOW activo.");
    } catch (cause) {
      setRecipientError(cause instanceof Error ? cause.message : "No se pudieron buscar Players.");
    } finally {
      setRecipientBusy(false);
    }
  }

  const recent = activity.slice(0, 6);

  return (
    <>
      <section className="overflow-hidden rounded-[32px] border border-violet-300/15 bg-[radial-gradient(circle_at_82%_18%,rgba(124,58,237,.18),transparent_34%),radial-gradient(circle_at_15%_0%,rgba(34,211,238,.08),transparent_28%),#0a0810] shadow-[0_28px_90px_rgba(0,0,0,.35)]">
        <div className="grid gap-0 lg:grid-cols-[minmax(0,1.4fr)_minmax(310px,.6fr)]">
          <div className="p-5 sm:p-7 lg:p-9">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                {player?.profile_image_url ? (
                  <img
                    src={player.profile_image_url}
                    alt=""
                    className="h-12 w-12 shrink-0 rounded-2xl border border-white/10 object-cover sm:h-14 sm:w-14"
                  />
                ) : (
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-violet-300/20 bg-violet-500/10 text-lg font-bold text-violet-100 sm:h-14 sm:w-14">
                    {avatarLabel(player)}
                  </span>
                )}
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-300/65">MI FLOW</p>
                  <h1 className="truncate text-xl font-semibold text-white sm:text-2xl">{player?.display_name || "Mi Player"}</h1>
                  {player?.username ? <p className="mt-0.5 truncate text-xs text-white/35">@{player.username.replace(/^@/, "")}</p> : null}
                </div>
              </div>
              {isAdmin ? (
                <Link
                  href="/mi-flow/billetera/flows"
                  className="rounded-xl border border-violet-300/15 bg-violet-300/[0.05] px-3 py-2 text-xs font-semibold text-violet-200 transition hover:border-violet-300/30"
                >
                  Vista avanzada
                </Link>
              ) : null}
            </div>

            <div className="mt-8 sm:mt-10">
              <div className="flex items-center gap-3 text-violet-200">
                <span className="grid h-11 w-11 place-items-center rounded-2xl border border-violet-300/20 bg-violet-500/10 shadow-[0_0_28px_rgba(124,58,237,.16)]">
                  <ClouvaLogoMark size={25} label="FLOW" />
                </span>
                <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/35">FLOW disponible</span>
              </div>
              <div className="mt-3 flex flex-wrap items-end gap-x-3 gap-y-1">
                <strong className="text-5xl font-semibold tracking-[-0.05em] text-white sm:text-6xl">{flowNumber(balance)}</strong>
                <span className="pb-1.5 text-lg font-semibold text-violet-200">FLOW</span>
              </div>
              <p className="mt-2 text-sm text-white/35">≈ US$ {Number(balance || 0).toFixed(2)} de referencia</p>
            </div>

            <button
              type="button"
              onClick={() => openMode("pay")}
              className="mt-8 flex min-h-14 w-full items-center justify-center gap-3 rounded-2xl bg-gradient-to-r from-violet-600 via-violet-500 to-indigo-500 px-5 text-sm font-bold text-white shadow-[0_18px_45px_rgba(91,33,182,.28)] transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 sm:max-w-md"
            >
              <ScanLine size={20} /> PAGAR CON QR
            </button>
            <p className="mt-2 text-xs text-white/30">Escaneá cualquier QR. CLOUVA te confirma si puede liquidarlo antes de mover saldo.</p>

            <div className="mt-5 grid grid-cols-3 gap-2 sm:max-w-md sm:gap-3">
              <ActionButton icon={<Send size={18} />} label="Enviar" onClick={() => openMode("send")} />
              <ActionButton icon={<QrCode size={18} />} label="Recibir" onClick={() => openMode("receive")} />
              <Link
                href="/mi-flow/billetera/flows#cargar-flow"
                className="flex min-h-[72px] flex-col items-center justify-center gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.035] px-2 text-xs font-semibold text-white/70 transition hover:border-violet-300/25 hover:bg-violet-300/[0.06] hover:text-white"
              >
                <Plus size={18} /> Cargar
              </Link>
            </div>
          </div>

          <aside className="border-t border-white/[0.07] bg-black/15 p-5 sm:p-7 lg:border-l lg:border-t-0 lg:p-8">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/30">Actividad</p>
                <h2 className="mt-1 font-semibold text-white/85">Movimientos recientes</h2>
              </div>
              <WalletCards size={18} className="text-violet-300/55" />
            </div>

            {recent.length ? (
              <div className="mt-5 divide-y divide-white/[0.06]">
                {recent.map((row) => (
                  <div key={row.id} className="flex items-center justify-between gap-3 py-3.5">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${row.amount >= 0 ? "bg-emerald-400/[0.08] text-emerald-200" : "bg-violet-400/[0.08] text-violet-200"}`}>
                        {row.amount >= 0 ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm text-white/75">{movementLabel(row)}</p>
                        <p className="mt-0.5 text-[11px] text-white/28">{when(row.created_at)}</p>
                      </div>
                    </div>
                    <strong className={`shrink-0 text-sm ${row.amount >= 0 ? "text-emerald-200" : "text-white/75"}`}>
                      {row.amount >= 0 ? "+" : ""}{flowNumber(row.amount)}
                    </strong>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-5 rounded-2xl border border-white/[0.06] bg-white/[0.025] p-5 text-sm text-white/35">Todavía no hay movimientos FLOW.</div>
            )}

            <Link href="/mi-flow/billetera/flows" className="mt-5 inline-flex items-center gap-2 text-xs font-semibold text-violet-300/80 hover:text-violet-200">
              Tus activos FLOW <ArrowRight size={13} />
            </Link>
          </aside>
        </div>
      </section>

      {mode ? (
        <div
          className="fixed inset-0 z-[110] overflow-y-auto bg-black/80 px-3 py-5 backdrop-blur-md sm:px-5 sm:py-8"
          onMouseDown={(event) => { if (event.currentTarget === event.target) close(); }}
        >
          {mode === "pay" ? (
            <section className="mx-auto w-full max-w-xl">
              <UniversalQrPayment embedded onClose={close} onPaymentConfirmed={onFlowChanged} />
            </section>
          ) : (
            <section className="mx-auto w-full max-w-lg rounded-[28px] border border-violet-300/15 bg-[#09070f] p-5 text-white shadow-[0_30px_100px_rgba(0,0,0,.6)] sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-300/65">MI FLOW</p>
                  <h2 className="mt-1 text-2xl font-semibold">{mode === "send" ? "Enviar FLOW" : "Recibir FLOW"}</h2>
                </div>
                <button type="button" onClick={close} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-white/10 text-white/55 hover:text-white" aria-label="Cerrar">
                  <X size={18} />
                </button>
              </div>

              {mode === "send" ? (
                <div className="mt-6">
                  <p className="text-sm leading-6 text-white/45">Buscá un Player CLOUVA. El envío final usa el pago FLOW existente, con ledger e idempotencia.</p>
                  <div className="mt-4 flex gap-2">
                    <input
                      value={recipientQuery}
                      onChange={(event) => setRecipientQuery(event.target.value)}
                      onKeyDown={(event) => { if (event.key === "Enter") void searchRecipients(); }}
                      placeholder="@player o nombre"
                      className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/35 px-4 text-base text-white outline-none placeholder:text-white/20 focus:border-violet-400/45"
                    />
                    <button type="button" onClick={() => void searchRecipients()} disabled={recipientBusy || recipientQuery.trim().length < 2} className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-violet-600 disabled:opacity-35" aria-label="Buscar Player">
                      {recipientBusy ? <Loader2 size={17} className="animate-spin" /> : <Search size={17} />}
                    </button>
                  </div>

                  <div className="mt-4 space-y-2">
                    {recipients.map((recipient) => (
                      <Link key={recipient.playerId} href={recipient.paymentHref} className="flex items-center justify-between gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-3.5 transition hover:border-violet-300/25 hover:bg-violet-300/[0.05]">
                        <div className="flex min-w-0 items-center gap-3">
                          {recipient.profileImageUrl ? <img src={recipient.profileImageUrl} alt="" className="h-11 w-11 shrink-0 rounded-xl object-cover" /> : <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-violet-500/10 text-violet-200"><ClouvaLogoMark size={21} /></span>}
                          <div className="min-w-0"><strong className="block truncate text-sm">{recipient.displayName}</strong><span className="block truncate text-xs text-white/35">{recipient.username ? `@${recipient.username.replace(/^@/, "")}` : recipient.slug}</span></div>
                        </div>
                        <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-violet-200">Enviar <ArrowRight size={13} /></span>
                      </Link>
                    ))}
                  </div>
                  {recipientError ? <p className="mt-3 rounded-xl border border-white/[0.07] bg-white/[0.025] p-3 text-sm text-white/45">{recipientError}</p> : null}
                </div>
              ) : null}

              {mode === "receive" ? <div className="mt-6"><MyQrCard /></div> : null}
            </section>
          )}
        </div>
      ) : null}
    </>
  );
}

function ActionButton({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[72px] flex-col items-center justify-center gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.035] px-2 text-xs font-semibold text-white/70 transition hover:border-violet-300/25 hover:bg-violet-300/[0.06] hover:text-white"
    >
      {icon}
      {label}
    </button>
  );
}
