"use client";

import {
  ArrowRight,
  Camera,
  CheckCircle2,
  Loader2,
  Plus,
  QrCode,
  ScanLine,
  Search,
  Send,
  ShieldCheck,
  X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { MyQrCard } from "@/components/account/MyQrCard";
import { ClouvaLogoMark } from "@/components/brand/clouva-logo";
import { FlowLogo } from "@/components/flows/flow-logo";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

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

function flowNumber(value: number) {
  return new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 }).format(Number(value) || 0);
}

function plural(value: number, singular: string, pluralLabel: string) {
  return `${value} ${value === 1 ? singular : pluralLabel}`;
}

export function PlayerFlowWallet({
  player,
  balance,
  assetCount = 0,
  availableCount = 0,
}: {
  player: PlayerIdentity;
  balance: number;
  assetCount?: number;
  availableCount?: number;
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

  const username = player?.username?.replace(/^@/, "") || null;

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

  return (
    <>
      <section className="relative overflow-hidden rounded-[28px] border border-violet-300/14 bg-[#090815] shadow-[0_22px_70px_rgba(0,0,0,0.26)]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_88%_8%,rgba(139,92,246,0.15),transparent_28%),radial-gradient(circle_at_54%_120%,rgba(34,211,238,0.07),transparent_38%),linear-gradient(120deg,rgba(11,9,25,0.98),rgba(5,5,11,0.96)_60%,rgba(10,7,21,0.98))]" />
        <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-violet-300/30 to-transparent" />

        <div className="relative z-10 grid gap-6 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.62fr)] lg:items-center lg:p-7">
          <div className="min-w-0">
            <div className="flex items-center gap-4">
              <FlowLogo size={64} priority />
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-300/60">FLOW / MI BILLETERA</p>
                <h2 className="mt-1 text-3xl font-semibold tracking-[-0.035em] text-white sm:text-[34px]">FLOW</h2>
                <p className="mt-1 truncate text-xs text-white/35">
                  {player?.display_name || "Mi Player"}{username ? ` · @${username}` : ""}
                </p>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-end gap-x-3 gap-y-1">
              <strong className="text-4xl font-semibold tracking-[-0.045em] text-white sm:text-5xl">{flowNumber(balance)}</strong>
              <span className="pb-1 text-base font-semibold text-violet-200">FLOW</span>
            </div>
            <p className="mt-1.5 text-sm text-white/34">≈ US$ {Number(balance || 0).toFixed(2)} de referencia</p>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-white/[0.08] bg-black/20 px-3 py-1.5 text-[10px] font-medium text-white/45">
                {plural(assetCount, "activo", "activos")}
              </span>
              <span className="rounded-full border border-emerald-300/12 bg-emerald-300/[0.04] px-3 py-1.5 text-[10px] font-medium text-emerald-100/60">
                {plural(availableCount, "disponible", "disponibles")}
              </span>
              <span className="rounded-full border border-white/[0.08] bg-black/20 px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-white/38">
                1 FLOW = US$ 1.00
              </span>
            </div>
          </div>

          <div className="grid gap-2.5">
            <button
              type="button"
              onClick={() => setMode("pay")}
              className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[15px] border border-violet-200/20 bg-gradient-to-r from-violet-600 via-indigo-500 to-cyan-500 px-4 text-sm font-semibold text-white shadow-[0_12px_34px_rgba(124,58,237,0.2)] transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/80"
            >
              <ScanLine size={17} /> PAGAR CON QR
            </button>

            <div className="grid grid-cols-2 gap-2.5">
              <QuickAction icon={<Send size={16} />} label="ENVIAR" onClick={() => setMode("send")} />
              <QuickAction icon={<QrCode size={16} />} label="RECIBIR" onClick={() => setMode("receive")} />
            </div>

            <Link
              href="/mi-flow/billetera/flows"
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[14px] border border-violet-300/16 bg-violet-300/[0.055] px-4 text-xs font-semibold text-violet-100 transition hover:border-violet-300/28 hover:bg-violet-300/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/70"
            >
              VER MIS FLOWS <ArrowRight size={14} />
            </Link>

            <Link
              href="/mi-flow/billetera/flows#cargar-flow"
              className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-[13px] border border-white/[0.07] bg-black/15 px-4 text-[11px] font-semibold text-white/48 transition hover:border-violet-300/18 hover:text-white/75"
            >
              <Plus size={14} /> CARGAR FLOW
            </Link>
          </div>
        </div>
      </section>

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

function QuickAction({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[14px] border border-white/[0.075] bg-white/[0.025] px-3 text-xs font-semibold text-white/62 transition hover:border-violet-300/20 hover:bg-violet-300/[0.045] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/70"
    >
      {icon}
      {label}
    </button>
  );
}
