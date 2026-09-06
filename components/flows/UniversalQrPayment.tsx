"use client";

import Link from "next/link";
import { ArrowLeft, Camera, CheckCircle2, CircleAlert, Loader2, QrCode, RefreshCw, ScanLine, ShieldCheck, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth-provider";

type Resolution = {
  type?: string;
  capability?: "DETECTED" | "RESOLVABLE" | "PAYABLE" | "UNSUPPORTED" | "NOT_AUTHORIZED";
  provider?: string | null;
  administrator?: string | null;
  merchant?: { name?: string | null; city?: string | null; merchantId?: string | null; mcc?: string | null } | null;
  amount?: string | null;
  currency?: string | null;
  amountEditable?: boolean;
  safeMessage?: string | null;
  paymentMethods?: string[];
};

type Quote = {
  operationId: string;
  merchantAmount: string;
  merchantCurrency: string;
  referenceUsd: string;
  flowUnits: string;
  flowAmount: string;
  totalFlowUnits: string;
  totalFlow: string;
  fxRate: string;
  fxPair: string;
  fxSource: string;
  quotedAt: string;
  expiresAt: string;
};

type PaymentOperation = {
  id: string;
  status: string;
  provider?: string | null;
  merchant_name?: string | null;
  merchant_amount?: string | number | null;
  merchant_currency?: string | null;
  totalFlow?: string | null;
  flowAmount?: string | null;
  fx_rate?: string | number | null;
  fx_source?: string | null;
  provider_payment_id?: string | null;
  qr_transaction_id?: string | null;
  confirmed_at?: string | null;
  last_safe_message?: string | null;
  sandbox?: boolean;
};

type UniversalQrPaymentProps = {
  embedded?: boolean;
  onClose?: () => void;
  onPaymentConfirmed?: () => void;
};

function money(value: string | number | null | undefined, currency = "ARS") {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "—";
  return new Intl.NumberFormat("es-AR", { style: "currency", currency, maximumFractionDigits: 2 }).format(numeric);
}

function when(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString("es-AR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function UniversalQrPayment({ embedded = false, onClose, onPaymentConfirmed }: UniversalQrPaymentProps = {}) {
  const { session, loading: authLoading } = useAuth();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scannerControls = useRef<{ stop(): void } | null>(null);
  const confirmedNotifiedRef = useRef<string | null>(null);
  const [cameraBusy, setCameraBusy] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [rawQr, setRawQr] = useState("");
  const [operationId, setOperationId] = useState<string | null>(null);
  const [resolution, setResolution] = useState<Resolution | null>(null);
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [payment, setPayment] = useState<PaymentOperation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const api = useCallback(async (url: string, init?: RequestInit) => {
    if (!session?.access_token) throw new Error("Iniciá sesión para pagar con FLOW.");
    const response = await fetch(url, {
      ...init,
      headers: { authorization: `Bearer ${session.access_token}`, "content-type": "application/json", ...(init?.headers || {}) },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok && response.status !== 202) throw new Error(body.error || "No se pudo completar la operación QR.");
    return { response, body };
  }, [session?.access_token]);

  const stopCamera = useCallback(() => {
    scannerControls.current?.stop();
    scannerControls.current = null;
    if (videoRef.current?.srcObject instanceof MediaStream) {
      for (const track of videoRef.current.srcObject.getTracks()) track.stop();
      videoRef.current.srcObject = null;
    }
    setCameraOn(false);
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  async function startCamera() {
    if (cameraBusy) return;
    setCameraBusy(true);
    setError(null);
    try {
      const { BrowserQRCodeReader } = await import("@zxing/browser");
      if (!videoRef.current) throw new Error("La cámara todavía no está disponible.");
      const reader = new BrowserQRCodeReader();
      let controls: { stop(): void } | null = null;
      controls = await reader.decodeFromVideoDevice(undefined, videoRef.current, (result) => {
        if (!result) return;
        setRawQr(result.getText());
        controls?.stop();
        scannerControls.current = null;
        setCameraOn(false);
      });
      scannerControls.current = controls;
      setCameraOn(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo abrir la cámara.");
      stopCamera();
    } finally {
      setCameraBusy(false);
    }
  }

  function reset() {
    stopCamera();
    confirmedNotifiedRef.current = null;
    setRawQr("");
    setOperationId(null);
    setResolution(null);
    setAmount("");
    setQuote(null);
    setPayment(null);
    setError(null);
  }

  async function resolveQr() {
    if (!rawQr.trim() || busy) return;
    setBusy(true);
    setError(null);
    setQuote(null);
    setPayment(null);
    try {
      const { body } = await api("/api/flows/qr/resolve", { method: "POST", body: JSON.stringify({ rawQr: rawQr.trim() }) });
      if (body.kind === "clouva") {
        setResolution(body.resolution || null);
        setOperationId(null);
        setError(body.safeMessage || "Este QR pertenece a CLOUVA y usa el flujo interno.");
        return;
      }
      setOperationId(body.operationId || null);
      const next = (body.resolution || null) as Resolution | null;
      setResolution(next);
      setAmount(next?.amount ? String(next.amount) : "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo resolver el QR.");
    } finally {
      setBusy(false);
    }
  }

  async function createQuote() {
    if (!operationId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { body } = await api("/api/flows/qr/quote", { method: "POST", body: JSON.stringify({ operationId, merchantAmount: amount }) });
      setQuote(body.quote as Quote);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo cotizar el pago.");
    } finally {
      setBusy(false);
    }
  }

  const recover = useCallback(async (id: string) => {
    try {
      const { body } = await api(`/api/flows/qr/payments/${encodeURIComponent(id)}`, { method: "GET" });
      setPayment(body.operation as PaymentOperation);
      return body.operation as PaymentOperation;
    } catch {
      return null;
    }
  }, [api]);

  async function pay() {
    if (!operationId || !quote || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { body } = await api("/api/flows/qr/pay", { method: "POST", body: JSON.stringify({ operationId }) });
      await recover(operationId);
      if (body.message && body.status !== "payment_confirmed") setError(body.message);
    } catch (cause) {
      await recover(operationId);
      setError(cause instanceof Error ? cause.message : "No se pudo ejecutar el pago.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!operationId || !payment || !["payment_pending", "payment_submitted"].includes(payment.status)) return;
    const timer = window.setInterval(() => void recover(operationId), 3000);
    return () => window.clearInterval(timer);
  }, [operationId, payment, recover]);

  const confirmed = payment?.status === "payment_confirmed";
  const pending = payment && ["flow_held", "payment_submitted", "payment_pending"].includes(payment.status);
  const unsupported = resolution && resolution.capability !== "PAYABLE";

  useEffect(() => {
    if (!confirmed || !payment?.id || confirmedNotifiedRef.current === payment.id) return;
    confirmedNotifiedRef.current = payment.id;
    window.dispatchEvent(new Event("clouva:flows-changed"));
    onPaymentConfirmed?.();
  }, [confirmed, onPaymentConfirmed, payment?.id]);

  return (
    <div className={embedded ? "w-full" : "mx-auto w-full max-w-lg px-4 pb-24 pt-4 sm:pt-8"}>
      <div className={`flex items-center justify-between ${embedded ? "mb-3" : "mb-5"}`}>
        {embedded ? (
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.16em] text-violet-300/65"><QrCode size={15}/>Pago desde Mi Flow</div>
        ) : (
          <Link href="/mi-flow/billetera?asset=flows" className="inline-flex items-center gap-2 text-sm text-white/55 hover:text-white"><ArrowLeft size={16}/>Mi Flow</Link>
        )}
        <div className="flex items-center gap-2">
          {operationId || resolution ? <button type="button" onClick={reset} className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-xs text-white/55"><RefreshCw size={14}/>Nuevo QR</button> : null}
          {embedded && onClose ? <button type="button" onClick={()=>{stopCamera();onClose();}} aria-label="Cerrar pago QR" className="grid h-9 w-9 place-items-center rounded-xl border border-white/10 text-white/45 hover:text-white"><X size={16}/></button> : null}
        </div>
      </div>

      <section className="overflow-hidden rounded-[30px] border border-violet-400/20 bg-[radial-gradient(circle_at_50%_-10%,rgba(124,58,237,.3),transparent_42%),#09070e] shadow-[0_30px_120px_rgba(91,33,182,.22)]">
        <header className="border-b border-white/[0.07] px-5 py-5 sm:px-7">
          <div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-violet-500/15 text-violet-200"><QrCode size={22}/></span><div><p className="text-[10px] font-bold uppercase tracking-[.2em] text-violet-300/75">Universal QR</p><h1 className="text-2xl font-semibold">Pagar con FLOW</h1></div></div>
          <p className="mt-3 text-sm leading-6 text-white/45">Escaneá el QR del comercio. CLOUVA separa reconocer un QR de tener un rail realmente autorizado para pagarlo.</p>
        </header>

        {!resolution ? (
          <div className="p-5 sm:p-7">
            <div className="relative aspect-[4/3] overflow-hidden rounded-[24px] border border-white/10 bg-black">
              <video ref={videoRef} className="h-full w-full object-cover" autoPlay muted playsInline />
              {!cameraOn ? <div className="absolute inset-0 grid place-items-center bg-[radial-gradient(circle,rgba(124,58,237,.13),transparent_45%)]"><div className="text-center text-white/30"><ScanLine className="mx-auto mb-2" size={38}/><p className="text-xs">La cámara se activa cuando vos decidís.</p></div></div> : null}
              {cameraOn ? <div className="pointer-events-none absolute inset-[14%] rounded-[24px] border-2 border-violet-300/70 shadow-[0_0_40px_rgba(139,92,246,.18)]"/> : null}
              {cameraOn ? <button type="button" onClick={stopCamera} className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-black/70 text-white"><X size={17}/></button> : null}
            </div>
            <button type="button" onClick={cameraOn ? stopCamera : startCamera} disabled={cameraBusy} className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-violet-600 px-5 py-3.5 font-semibold text-white disabled:opacity-50">{cameraBusy?<Loader2 size={18} className="animate-spin"/>:<Camera size={18}/>} {cameraOn?"Cerrar cámara":"Escanear QR"}</button>
            <div className="my-5 flex items-center gap-3 text-[10px] uppercase tracking-[.18em] text-white/20"><span className="h-px flex-1 bg-white/[.07]"/>o pegalo<span className="h-px flex-1 bg-white/[.07]"/></div>
            <textarea value={rawQr} onChange={(event)=>setRawQr(event.target.value)} rows={4} placeholder="Pegá el contenido RAW del QR" className="w-full resize-none rounded-2xl border border-white/10 bg-black/30 p-4 text-sm text-white outline-none placeholder:text-white/25 focus:border-violet-400/40"/>
            {process.env.NODE_ENV !== "production" ? <button type="button" onClick={()=>setRawQr("CLOUVA-SANDBOX:KIOSK:KIOSCO_PEPE:ARS:8500.00")} className="mt-2 text-xs text-violet-300/65">Cargar fixture Kiosco Pepe · $8.500</button> : null}
            <button type="button" onClick={resolveQr} disabled={!rawQr.trim()||busy||authLoading||!session?.access_token} className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-violet-400/25 bg-violet-400/[.08] px-5 py-3.5 font-semibold text-violet-100 disabled:opacity-35">{busy?<Loader2 size={18} className="animate-spin"/>:<ScanLine size={18}/>}Resolver QR</button>
            {!authLoading&&!session?.access_token?<Link href={embedded?"/login?next=%2Fmi-flow%2Fbilletera%3Fasset%3Dflows%26action%3Dpay-qr":"/login?next=%2Fmi-flow%2Fpagar-qr"} className="mt-3 block text-center text-sm text-violet-300">Iniciar sesión para continuar</Link>:null}
          </div>
        ) : null}

        {resolution ? (
          <div className="space-y-4 p-5 sm:p-7">
            <div className="rounded-2xl border border-white/[.08] bg-white/[.035] p-4">
              <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[.18em] text-white/30">QR detectado</p><h2 className="mt-1 text-xl font-semibold">{resolution.merchant?.name||"Comercio detectado"}</h2><p className="mt-1 text-xs text-white/35">{resolution.type?.replaceAll("_"," ")} {resolution.provider?`· ${resolution.provider}`:""} {resolution.administrator?`· ${resolution.administrator}`:""}</p></div><span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold ${resolution.capability==="PAYABLE"?"border-emerald-300/20 bg-emerald-300/[.08] text-emerald-200":"border-amber-300/20 bg-amber-300/[.08] text-amber-200"}`}>{resolution.capability}</span></div>
              {resolution.safeMessage?<p className="mt-3 text-xs leading-5 text-white/45">{resolution.safeMessage}</p>:null}
            </div>

            {unsupported ? <div className="flex gap-3 rounded-2xl border border-amber-300/15 bg-amber-300/[.05] p-4 text-sm leading-6 text-amber-100/75"><CircleAlert className="mt-0.5 shrink-0" size={18}/><p>El QR fue reconocido, pero CLOUVA no va a simular el pago. Hace falta habilitar el rail merchant correspondiente.</p></div> : null}

            {!unsupported&&!quote ? <>
              <div className="rounded-2xl border border-white/[.08] bg-black/20 p-4"><label className="text-[10px] font-bold uppercase tracking-[.18em] text-white/30">Monto del comercio</label><div className="mt-2 flex items-end gap-2"><span className="pb-2 text-xl text-white/40">$</span><input value={amount} onChange={(event)=>setAmount(event.target.value.replace(",","."))} disabled={!resolution.amountEditable&&Boolean(resolution.amount)} inputMode="decimal" className="min-w-0 flex-1 bg-transparent text-4xl font-semibold outline-none disabled:text-white"/><span className="pb-2 text-sm text-white/35">{resolution.currency||"ARS"}</span></div>{!resolution.amountEditable&&resolution.amount?<p className="mt-2 text-xs text-white/35">Monto definido por el comercio.</p>:<p className="mt-2 text-xs text-white/35">QR abierto: ingresá el monto que te indicó el comercio.</p>}</div>
              <button type="button" onClick={createQuote} disabled={busy||!amount} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-violet-600 px-5 py-3.5 font-semibold disabled:opacity-40">{busy?<Loader2 size={18} className="animate-spin"/>:null}Ver cuánto FLOW</button>
            </> : null}

            {quote && !confirmed ? <div className="rounded-[24px] border border-violet-300/20 bg-violet-400/[.07] p-5"><p className="text-[10px] font-bold uppercase tracking-[.18em] text-violet-200/65">Confirmación</p><div className="mt-3 flex items-baseline justify-between gap-4"><span className="text-sm text-white/45">Comercio</span><b>{money(quote.merchantAmount,quote.merchantCurrency)}</b></div><div className="mt-2 flex items-baseline justify-between gap-4"><span className="text-sm text-white/45">Se usarán</span><b className="text-2xl">{quote.totalFlow} FLOW</b></div><div className="mt-2 flex items-baseline justify-between gap-4 text-xs"><span className="text-white/35">FX</span><span className="text-white/55">1 USD = {quote.fxRate} ARS · {quote.fxSource}</span></div><div className="mt-4 flex gap-2 rounded-xl border border-emerald-300/10 bg-emerald-300/[.04] p-3 text-xs leading-5 text-emerald-100/70"><ShieldCheck className="mt-0.5 shrink-0" size={16}/><p>Al confirmar, CLOUVA hace hold exacto de tus unidades FLOW. Solo se redimen si el provider confirma el pago.</p></div><button type="button" onClick={pay} disabled={busy||Boolean(pending)} className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-violet-600 px-5 py-3.5 font-semibold disabled:opacity-45">{busy||pending?<Loader2 size={18} className="animate-spin"/>:null}{pending?"Esperando confirmación…":"Confirmar pago"}</button><p className="mt-2 text-center text-[10px] text-white/25">Cotización hasta {when(quote.expiresAt)}</p></div> : null}

            {confirmed ? <div className="rounded-[24px] border border-emerald-300/20 bg-emerald-300/[.07] p-5"><div className="flex items-center gap-2 text-lg font-semibold text-emerald-100"><CheckCircle2 size={22}/>PAGO CONFIRMADO</div><dl className="mt-4 space-y-2 text-sm"><ReceiptRow label="Comercio" value={payment?.merchant_name||resolution.merchant?.name||"Comercio"}/><ReceiptRow label="Pagó el comercio" value={money(payment?.merchant_amount, payment?.merchant_currency||"ARS")}/><ReceiptRow label="FLOW usados" value={`${payment?.totalFlow||quote.totalFlow} FLOW`}/><ReceiptRow label="Provider" value={payment?.provider||resolution.provider||"—"}/><ReceiptRow label="Provider payment" value={payment?.provider_payment_id||"—"}/><ReceiptRow label="QR transaction" value={payment?.qr_transaction_id||"—"}/><ReceiptRow label="Fecha" value={when(payment?.confirmed_at)}/><ReceiptRow label="Operation ID" value={payment?.id||operationId||"—"}/></dl>{embedded?<button type="button" onClick={()=>{reset();onClose?.();}} className="mt-5 flex w-full items-center justify-center rounded-xl border border-emerald-300/20 px-4 py-3 text-sm font-semibold text-emerald-100">Volver a Mi Flow</button>:<Link href="/mi-flow/billetera?asset=flows" className="mt-5 flex w-full items-center justify-center rounded-xl border border-emerald-300/20 px-4 py-3 text-sm font-semibold text-emerald-100">Ver en Mi Flow</Link>}</div> : null}

            {payment?.sandbox&&pending&&process.env.NODE_ENV!=="production" ? <div className="grid grid-cols-2 gap-2"><button type="button" onClick={async()=>{setBusy(true);try{await api("/api/flows/qr/sandbox/settle",{method:"POST",body:JSON.stringify({operationId,outcome:"confirmed"})});await recover(operationId!)}catch(cause){setError(cause instanceof Error?cause.message:"Sandbox error")}finally{setBusy(false)}}} className="rounded-xl border border-emerald-300/20 px-3 py-2 text-xs text-emerald-200">Sandbox: confirmar</button><button type="button" onClick={async()=>{setBusy(true);try{await api("/api/flows/qr/sandbox/settle",{method:"POST",body:JSON.stringify({operationId,outcome:"failed"})});await recover(operationId!)}catch(cause){setError(cause instanceof Error?cause.message:"Sandbox error")}finally{setBusy(false)}}} className="rounded-xl border border-rose-300/20 px-3 py-2 text-xs text-rose-200">Sandbox: rechazar</button></div>:null}
          </div>
        ) : null}

        {error ? <div className="mx-5 mb-5 rounded-2xl border border-rose-300/15 bg-rose-300/[.06] p-4 text-sm leading-6 text-rose-100 sm:mx-7"><div className="flex gap-2"><CircleAlert className="mt-0.5 shrink-0" size={17}/><span>{error}</span></div></div> : null}
      </section>
    </div>
  );
}

function ReceiptRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-start justify-between gap-4 border-b border-white/[.06] pb-2"><dt className="text-white/40">{label}</dt><dd className="max-w-[65%] break-all text-right text-white/80">{value}</dd></div>;
}
