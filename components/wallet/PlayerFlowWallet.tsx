"use client";

import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Camera,
  CheckCircle2,
  Coins,
  History,
  Loader2,
  Package,
  Plus,
  QrCode,
  ScanLine,
  Search,
  Send,
  ShieldCheck,
  WalletCards,
  X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { MyQrCard } from "@/components/account/MyQrCard";
import { ClouvaLogoMark } from "@/components/brand/clouva-logo";
import { FlowCoin, FlowMetricCard, FlowPanel, FlowStatusBadge } from "@/components/flows/flow-ui";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type FlowActivity = {
  id: string;
  transaction_type: string;
  amount: number;
  balance_after: number;
  source: string | null;
  created_at: string;
};

type FlowAssetPreview = {
  id: string;
  flow_number: number;
  status: string;
};

type PlayerIdentity = {
  id: string;
  display_name: string;
  slug: string;
  username?: string | null;
  profile_image_url?: string | null;
} | null;

type QrResolution = {
  kind: "clouva" | "external";
  supported: boolean;
  entityType?: string;
  publicToken?: string;
  href?: string;
  provider?: string;
  message?: string;
  recipient?: {
    playerId: string;
    displayName: string;
    username: string | null;
    profileImageUrl: string | null;
  };
};

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
type ScannerControls = { stop: () => void };

function when(value: string) {
  return new Date(value).toLocaleString("es-AR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function flowNumber(value: number) {
  return new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 }).format(Number(value) || 0);
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

function assetLabel(asset: FlowAssetPreview) {
  return `FLOW #${String(asset.flow_number).padStart(6, "0")}`;
}

export function PlayerFlowWallet({
  player,
  balance,
  activity,
  assets = [],
  isAdmin,
}: {
  player: PlayerIdentity;
  balance: number;
  activity: FlowActivity[];
  assets?: FlowAssetPreview[];
  isAdmin: boolean;
}) {
  const [mode, setMode] = useState<WalletMode>(null);
  const [qrValue, setQrValue] = useState("");
  const [resolution, setResolution] = useState<QrResolution | null>(null);
  const [qrBusy, setQrBusy] = useState(false);
  const [qrError, setQrError] = useState<string | null>(null);
  const [scannerActive, setScannerActive] = useState(false);
  const [scannerMessage, setScannerMessage] = useState<string | null>(null);
  const scannerControls = useRef<ScannerControls | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const [recipientQuery, setRecipientQuery] = useState("");
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [recipientBusy, setRecipientBusy] = useState(false);
  const [recipientError, setRecipientError] = useState<string | null>(null);

  const stopScanner = useCallback(() => {
    scannerControls.current?.stop();
    scannerControls.current = null;
    setScannerActive(false);
  }, []);

  useEffect(() => () => stopScanner(), [stopScanner]);

  function close() {
    stopScanner();
    setMode(null);
    setQrValue("");
    setResolution(null);
    setQrError(null);
    setScannerMessage(null);
    setRecipientQuery("");
    setRecipients([]);
    setRecipientError(null);
  }

  async function resolveQr(value: string) {
    const clean = value.trim();
    if (!clean) {
      setQrError("Escaneá un QR o pegá su contenido.");
      return;
    }
    setQrBusy(true);
    setQrError(null);
    setResolution(null);
    try {
      const response = await authenticatedFetch("/api/clouva-qr/resolve", {
        method: "POST",
        body: JSON.stringify({ value: clean }),
      });
      const payload = await readApiJson<QrResolution>(response);
      setResolution(payload);
    } catch (cause) {
      setQrError(cause instanceof Error ? cause.message : "No se pudo leer el QR.");
    } finally {
      setQrBusy(false);
    }
  }

  async function startScanner() {
    if (!videoRef.current || scannerActive) return;
    setQrError(null);
    setScannerMessage("Abriendo cámara…");
    try {
      const { BrowserQRCodeReader } = await import("@zxing/browser");
      const reader = new BrowserQRCodeReader();
      const controls = await reader.decodeFromVideoDevice(
        undefined,
        videoRef.current,
        (result, error, currentControls) => {
          void error;
          if (!result) return;
          currentControls.stop();
          scannerControls.current = null;
          setScannerActive(false);
          setScannerMessage("QR leído.");
          const text = result.getText();
          setQrValue(text);
          void resolveQr(text);
        },
      );
      scannerControls.current = controls;
      setScannerActive(true);
      setScannerMessage("Apuntá la cámara al QR.");
    } catch (cause) {
      stopScanner();
      setScannerMessage(null);
      setQrError(cause instanceof Error ? cause.message : "No se pudo abrir la cámara.");
    }
  }

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
  const previewAssets = assets.slice(0, 3);
  const username = player?.username?.replace(/^@/, "") || null;

  return (
    <>
      <section className="relative min-h-[300px] overflow-hidden rounded-[28px] border border-violet-300/12 bg-[#090815] shadow-[0_24px_80px_rgba(0,0,0,0.3)]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_82%_12%,rgba(139,92,246,0.17),transparent_28%),radial-gradient(circle_at_58%_115%,rgba(34,211,238,0.08),transparent_42%),linear-gradient(115deg,rgba(11,9,25,0.98),rgba(5,5,11,0.96)_58%,rgba(10,7,21,0.98))]" />
        <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-violet-300/20 to-transparent" />

        <div className="relative z-10 grid min-h-[300px] gap-7 px-5 py-7 sm:px-7 md:px-9 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div className="min-w-0 max-w-3xl">
            <div className="flex min-w-0 items-center gap-3">
              {player?.profile_image_url ? (
                <img
                  src={player.profile_image_url}
                  alt=""
                  className="h-11 w-11 shrink-0 rounded-[14px] border border-white/10 object-cover"
                />
              ) : (
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] border border-violet-300/20 bg-violet-500/10 text-sm font-bold text-violet-100">
                  {avatarLabel(player)}
                </span>
              )}
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/38">Mi Flow / Billetera</p>
                <p className="truncate text-sm font-semibold text-white/72">{player?.display_name || "Mi Player"}</p>
                {username ? <p className="truncate text-[11px] text-white/30">@{username}</p> : null}
              </div>
            </div>

            <h1 className="mt-5 text-[38px] font-semibold leading-none tracking-[-0.045em] text-white sm:text-5xl lg:text-[54px]">
              MI BILLETERA
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-white/48 sm:text-[15px]">
              Tus FLOW, pagos y movimientos en una sola experiencia CLOUVA.
            </p>

            <div className="mt-6 flex flex-wrap items-end gap-x-3 gap-y-1">
              <strong className="text-5xl font-semibold tracking-[-0.05em] text-white sm:text-6xl">{flowNumber(balance)}</strong>
              <span className="pb-1.5 text-lg font-semibold text-violet-200">FLOW</span>
            </div>
            <p className="mt-2 text-sm text-white/35">≈ US$ {Number(balance || 0).toFixed(2)} de referencia</p>

            <div className="mt-5 flex flex-wrap items-center gap-2.5">
              <span className="rounded-full border border-white/[0.08] bg-black/20 px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-white/45">
                1 FLOW = US$ 1.00
              </span>
              <span className="rounded-full border border-violet-300/15 bg-violet-300/[0.05] px-3 py-1.5 text-[10px] font-medium text-violet-100/70">
                Billetera del Player
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between gap-5 lg:flex-col lg:items-end">
            <div className="hidden xl:block"><FlowCoin /></div>
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setMode("pay")}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-[15px] border border-violet-200/20 bg-gradient-to-r from-violet-600 via-indigo-500 to-cyan-500 px-5 text-sm font-semibold text-white shadow-[0_12px_34px_rgba(124,58,237,0.22)] transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/80"
              >
                <ScanLine size={17} /> PAGAR CON QR
              </button>
              {isAdmin ? (
                <Link
                  href="/mi-flow/billetera/flows"
                  className="inline-flex min-h-12 items-center justify-center rounded-[15px] border border-white/[0.08] bg-black/20 px-4 text-xs font-semibold text-white/60 transition hover:border-violet-300/20 hover:text-white"
                >
                  Vista avanzada
                </Link>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <section className="mt-4 grid gap-3 sm:grid-cols-3">
        <ActionCard icon={<Send size={18} />} label="ENVIAR" detail="FLOW → Player" onClick={() => setMode("send")} />
        <ActionCard icon={<QrCode size={18} />} label="RECIBIR" detail="Mostrar mi QR" onClick={() => setMode("receive")} />
        <Link
          href="/mi-flow/billetera/flows#cargar-flow"
          className="group min-h-[96px] rounded-[22px] border border-white/[0.075] bg-white/[0.025] p-4 transition hover:border-violet-300/20 hover:bg-violet-300/[0.045]"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.17em] text-white/38">CARGAR</p>
              <strong className="mt-2 block text-base font-semibold text-white">+ FLOW</strong>
              <p className="mt-1 text-[11px] text-white/30">Usar checkout existente</p>
            </div>
            <span className="grid h-10 w-10 place-items-center rounded-[14px] border border-violet-300/15 bg-violet-300/[0.06] text-violet-200 group-hover:text-white">
              <Plus size={18} />
            </span>
          </div>
        </Link>
      </section>

      <section className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <FlowMetricCard
          icon={<Coins size={17} />}
          label="FLOW DISPONIBLE"
          value={`${flowNumber(balance)} FLOW`}
          detail="Saldo real informado por la billetera FLOW."
          tone="violet"
        />
        <FlowMetricCard
          icon={<WalletCards size={17} />}
          label="VALOR DE REFERENCIA"
          value={`US$ ${Number(balance || 0).toFixed(2)}`}
          detail="Referencia actual de 1 FLOW = US$ 1.00."
          tone="neutral"
        />
        <FlowMetricCard
          icon={<Package size={17} />}
          label="ACTIVOS FLOW"
          value={String(assets.length)}
          detail="Registros FLOW visibles para este Player."
          tone="cyan"
        />
        <FlowMetricCard
          icon={<History size={17} />}
          label="MOVIMIENTOS"
          value={String(activity.length)}
          detail="Actividad reciente devuelta por el ledger FLOW."
          tone="neutral"
        />
      </section>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(330px,.55fr)]">
        <FlowPanel
          eyebrow="Actividad del Player"
          title="Movimientos recientes"
          action={<Link href="/mi-flow/billetera/flows" className="text-[11px] font-semibold text-violet-300/75 hover:text-violet-200">Ver todos →</Link>}
        >
          {recent.length ? (
            <div className="divide-y divide-white/[0.06]">
              {recent.map((row) => (
                <div key={row.id} className="flex items-center justify-between gap-4 px-5 py-4 sm:px-6">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl border ${row.amount >= 0 ? "border-emerald-300/10 bg-emerald-300/[0.05] text-emerald-200" : "border-violet-300/10 bg-violet-300/[0.05] text-violet-200"}`}>
                      {row.amount >= 0 ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm text-white/76">{movementLabel(row)}</p>
                      <p className="mt-0.5 text-[11px] text-white/28">{when(row.created_at)}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <strong className={`text-sm ${row.amount >= 0 ? "text-emerald-200" : "text-white/78"}`}>
                      {row.amount >= 0 ? "+" : ""}{flowNumber(row.amount)} FLOW
                    </strong>
                    <p className="mt-0.5 text-[10px] text-white/25">saldo {flowNumber(row.balance_after)}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="px-5 py-8 text-sm text-white/35 sm:px-6">Todavía no hay movimientos FLOW.</p>
          )}
        </FlowPanel>

        <FlowPanel
          eyebrow="Activos del Player"
          title="Tus activos FLOW"
          action={<Link href="/mi-flow/billetera/flows" className="text-[11px] font-semibold text-violet-300/75 hover:text-violet-200">Ver todos →</Link>}
        >
          {previewAssets.length ? (
            <div className="divide-y divide-white/[0.06]">
              {previewAssets.map((asset) => (
                <Link
                  key={asset.id}
                  href="/mi-flow/billetera/flows"
                  className="flex items-center justify-between gap-3 px-5 py-4 transition hover:bg-white/[0.025] sm:px-6"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[14px] border border-violet-300/15 bg-violet-300/[0.05] text-violet-200">
                      <ClouvaLogoMark size={20} label="FLOW" />
                    </span>
                    <div className="min-w-0">
                      <strong className="block truncate text-sm text-white/82">{assetLabel(asset)}</strong>
                      <span className="mt-0.5 block text-[10px] uppercase tracking-[0.14em] text-white/25">Activo CLOUVA</span>
                    </div>
                  </div>
                  <FlowStatusBadge label={asset.status} />
                </Link>
              ))}
            </div>
          ) : (
            <p className="px-5 py-8 text-sm text-white/35 sm:px-6">No hay activos FLOW visibles todavía.</p>
          )}
          <div className="border-t border-white/[0.06] px-5 py-4 sm:px-6">
            <Link href="/mi-flow/billetera/flows" className="inline-flex items-center gap-2 text-xs font-semibold text-violet-300/80 hover:text-violet-200">
              VER MIS FLOWS <ArrowRight size={13} />
            </Link>
          </div>
        </FlowPanel>
      </div>

      {mode ? (
        <div
          className="fixed inset-0 z-[110] overflow-y-auto bg-black/80 px-3 py-5 backdrop-blur-md sm:px-5 sm:py-8"
          onMouseDown={(event) => { if (event.currentTarget === event.target) close(); }}
        >
          <section className="mx-auto w-full max-w-lg overflow-hidden rounded-[26px] border border-white/[0.075] bg-[#0a0912]/98 text-white shadow-[0_30px_100px_rgba(0,0,0,.6)]">
            <header className="flex min-h-[74px] items-start justify-between gap-4 border-b border-white/[0.06] px-5 py-5 sm:px-6">
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-violet-300/60">MI FLOW / BILLETERA</p>
                <h2 className="mt-1 text-2xl font-semibold tracking-[-0.03em]">
                  {mode === "pay" ? "Pagar con QR" : mode === "send" ? "Enviar FLOW" : "Recibir FLOW"}
                </h2>
              </div>
              <button type="button" onClick={close} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/[0.08] bg-black/20 text-white/45 transition hover:text-white" aria-label="Cerrar">
                <X size={17} />
              </button>
            </header>

            <div className="p-5 sm:p-6">
              {mode === "pay" ? (
                <div className="space-y-4">
                  <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-black/40">
                    <video ref={videoRef} muted playsInline className="aspect-[4/3] w-full bg-black object-cover" />
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] p-3">
                      <span className="text-xs text-white/35">{scannerMessage || "La cámara se abre sólo cuando la activás."}</span>
                      {scannerActive ? (
                        <button type="button" onClick={stopScanner} className="rounded-xl border border-white/[0.08] px-3 py-2 text-xs text-white/60">Cerrar cámara</button>
                      ) : (
                        <button type="button" onClick={() => void startScanner()} className="inline-flex items-center gap-2 rounded-xl border border-violet-200/20 bg-violet-500/10 px-3 py-2 text-xs font-semibold text-violet-100">
                          <Camera size={14} /> Abrir cámara
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 text-[10px] uppercase tracking-[0.16em] text-white/25"><span className="h-px flex-1 bg-white/[0.07]" />o pegá el QR<span className="h-px flex-1 bg-white/[0.07]" /></div>
                  <textarea
                    value={qrValue}
                    onChange={(event) => setQrValue(event.target.value)}
                    rows={3}
                    placeholder="https://clouva.com.ar/q/... o contenido del QR externo"
                    className="w-full resize-none rounded-2xl border border-white/[0.08] bg-black/25 px-4 py-3 text-sm text-white outline-none placeholder:text-white/20 focus:border-violet-400/45"
                  />
                  <button type="button" onClick={() => void resolveQr(qrValue)} disabled={qrBusy || !qrValue.trim()} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-[15px] border border-violet-200/20 bg-gradient-to-r from-violet-600/90 via-indigo-500/90 to-cyan-500/90 text-sm font-semibold text-white disabled:opacity-35">
                    {qrBusy ? <Loader2 size={16} className="animate-spin" /> : <ScanLine size={16} />} Resolver QR
                  </button>

                  {resolution?.kind === "clouva" && resolution.supported && resolution.href ? (
                    <div className="rounded-2xl border border-emerald-300/15 bg-emerald-300/[0.05] p-4">
                      <div className="flex items-center gap-3">
                        {resolution.recipient?.profileImageUrl ? <img src={resolution.recipient.profileImageUrl} alt="" className="h-11 w-11 rounded-xl object-cover" /> : <span className="grid h-11 w-11 place-items-center rounded-xl border border-violet-300/15 bg-violet-500/10 text-violet-200"><ClouvaLogoMark size={22} /></span>}
                        <div className="min-w-0"><p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-200"><CheckCircle2 size={14} /> QR CLOUVA</p><strong className="block truncate text-sm">{resolution.recipient?.displayName || "Player CLOUVA"}</strong></div>
                      </div>
                      <Link href={resolution.href} className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-[15px] border border-violet-200/20 bg-gradient-to-r from-violet-600 via-indigo-500 to-cyan-500 px-4 text-sm font-semibold">Continuar al pago <ArrowRight size={15} /></Link>
                    </div>
                  ) : null}

                  {resolution && !resolution.supported ? (
                    <div className="rounded-2xl border border-amber-300/15 bg-amber-300/[0.05] p-4 text-sm leading-6 text-amber-100/80">
                      <p className="font-semibold">QR reconocido · pago no habilitado</p>
                      <p className="mt-1 text-xs text-amber-100/60">{resolution.message}</p>
                      <p className="mt-2 flex items-center gap-2 text-[11px] text-white/35"><ShieldCheck size={13} /> No se modificó tu saldo FLOW.</p>
                    </div>
                  ) : null}
                  {qrError ? <p role="alert" className="rounded-xl border border-rose-300/15 bg-rose-300/[0.05] p-3 text-sm text-rose-200">{qrError}</p> : null}
                </div>
              ) : null}

              {mode === "send" ? (
                <div>
                  <p className="text-sm leading-6 text-white/45">Buscá un Player CLOUVA. El envío final reutiliza el pago FLOW existente con su ledger e idempotencia.</p>
                  <div className="mt-4 flex gap-2">
                    <input
                      value={recipientQuery}
                      onChange={(event) => setRecipientQuery(event.target.value)}
                      onKeyDown={(event) => { if (event.key === "Enter") void searchRecipients(); }}
                      placeholder="@player o nombre"
                      className="min-w-0 flex-1 rounded-xl border border-white/[0.08] bg-black/25 px-4 text-base text-white outline-none placeholder:text-white/20 focus:border-violet-400/45"
                    />
                    <button type="button" onClick={() => void searchRecipients()} disabled={recipientBusy || recipientQuery.trim().length < 2} className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-violet-200/20 bg-violet-500/10 text-violet-100 disabled:opacity-35" aria-label="Buscar Player">
                      {recipientBusy ? <Loader2 size={17} className="animate-spin" /> : <Search size={17} />}
                    </button>
                  </div>

                  <div className="mt-4 space-y-2">
                    {recipients.map((recipient) => (
                      <Link key={recipient.playerId} href={recipient.paymentHref} className="flex items-center justify-between gap-3 rounded-2xl border border-white/[0.075] bg-white/[0.025] p-3.5 transition hover:border-violet-300/20 hover:bg-violet-300/[0.045]">
                        <div className="flex min-w-0 items-center gap-3">
                          {recipient.profileImageUrl ? <img src={recipient.profileImageUrl} alt="" className="h-11 w-11 shrink-0 rounded-xl object-cover" /> : <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-violet-300/15 bg-violet-500/10 text-violet-200"><ClouvaLogoMark size={21} /></span>}
                          <div className="min-w-0"><strong className="block truncate text-sm">{recipient.displayName}</strong><span className="block truncate text-xs text-white/35">{recipient.username ? `@${recipient.username.replace(/^@/, "")}` : recipient.slug}</span></div>
                        </div>
                        <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-violet-200">Enviar <ArrowRight size={13} /></span>
                      </Link>
                    ))}
                  </div>
                  {recipientError ? <p className="mt-3 rounded-xl border border-white/[0.07] bg-white/[0.025] p-3 text-sm text-white/45">{recipientError}</p> : null}
                </div>
              ) : null}

              {mode === "receive" ? <MyQrCard /> : null}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

function ActionCard({ icon, label, detail, onClick }: { icon: ReactNode; label: string; detail: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group min-h-[96px] rounded-[22px] border border-white/[0.075] bg-white/[0.025] p-4 text-left transition hover:border-violet-300/20 hover:bg-violet-300/[0.045]"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.17em] text-white/38">{label}</p>
          <strong className="mt-2 block text-base font-semibold text-white">{detail}</strong>
          <p className="mt-1 text-[11px] text-white/30">Acción de Mi Flow</p>
        </div>
        <span className="grid h-10 w-10 place-items-center rounded-[14px] border border-violet-300/15 bg-violet-300/[0.06] text-violet-200 group-hover:text-white">
          {icon}
        </span>
      </div>
    </button>
  );
}
