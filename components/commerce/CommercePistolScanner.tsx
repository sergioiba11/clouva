"use client";

import {
  ArrowLeft,
  Check,
  DollarSign,
  Flashlight,
  LoaderCircle,
  Plus,
  ScanLine,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { IScannerControls } from "@zxing/browser";
import { useAuth } from "@/components/auth-provider";
import type { CommerceProductRecognition } from "@/lib/commerce/product-recognition";
import {
  detectCommerceIdentifierType,
  type CommerceIdentifierType,
} from "@/lib/commerce/identifiers";

type Listing = {
  id: string;
  catalog_product_id: string | null;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  stock: number | null;
  status: string;
  cover_url: string | null;
};

type Overview = {
  spot: { id: string; name: string; currency: string };
  summary: {
    fx_rate?: { id: string; local_per_quote: number; quoted_at: string } | null;
  };
  listings: Listing[];
};

type ScanResult = {
  exists?: boolean;
  exists_in_spot?: boolean;
  catalog_product?: Record<string, unknown>;
  catalog_variant?: Record<string, unknown> | null;
  listing?: Listing | null;
  listing_variant?: { id?: string | null } | null;
};

type IdentifyPayload = {
  recognition: CommerceProductRecognition;
  provider: "google_vertex_ai";
  model: string;
};

type NativeBarcodeDetector = {
  detect(source: CanvasImageSource): Promise<Array<{ rawValue: string; format: string }>>;
};
type NativeBarcodeDetectorConstructor = new (options?: { formats?: string[] }) => NativeBarcodeDetector;

type Mode = "ready" | "identifying" | "identified" | "reading_code" | "matched" | "adding" | "sold";

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function money(value: number, currency = "ARS") {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function cropFrame(video: HTMLVideoElement, rect: DOMRect, clientX: number, clientY: number) {
  if (!video.videoWidth || !video.videoHeight) throw new Error("La cámara todavía no está lista.");

  const displayX = Math.max(0, Math.min(rect.width, clientX - rect.left));
  const displayY = Math.max(0, Math.min(rect.height, clientY - rect.top));
  const scale = Math.max(rect.width / video.videoWidth, rect.height / video.videoHeight);
  const renderedWidth = video.videoWidth * scale;
  const renderedHeight = video.videoHeight * scale;
  const cropOffsetX = Math.max(0, (renderedWidth - rect.width) / 2);
  const cropOffsetY = Math.max(0, (renderedHeight - rect.height) / 2);
  const sourceX = (displayX + cropOffsetX) / scale;
  const sourceY = (displayY + cropOffsetY) / scale;

  const side = Math.max(320, Math.min(video.videoWidth, video.videoHeight) * 0.62);
  const sx = Math.max(0, Math.min(video.videoWidth - side, sourceX - side / 2));
  const sy = Math.max(0, Math.min(video.videoHeight - side, sourceY - side / 2));

  const maxOutput = 1024;
  const outputSide = Math.min(maxOutput, Math.round(side));
  const canvas = document.createElement("canvas");
  canvas.width = outputSide;
  canvas.height = outputSide;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No se pudo preparar la captura.");

  context.drawImage(video, sx, sy, side, side, 0, 0, outputSide, outputSide);
  return canvas.toDataURL("image/jpeg", 0.86);
}

export function CommercePistolScanner({ studioId }: { studioId: string }) {
  const router = useRouter();
  const { session, user, loading: authLoading } = useAuth();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const animationRef = useRef<number | null>(null);
  const lastCodeRef = useRef<{ value: string; at: number }>({ value: "", at: 0 });

  const [overview, setOverview] = useState<Overview | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [torch, setTorch] = useState(false);
  const [mode, setMode] = useState<Mode>("ready");
  const [recognition, setRecognition] = useState<CommerceProductRecognition | null>(null);
  const [matchedListing, setMatchedListing] = useState<Listing | null>(null);
  const [matchedVariantId, setMatchedVariantId] = useState<string | null>(null);
  const [lastCapture, setLastCapture] = useState("");
  const [scannedCode, setScannedCode] = useState("");
  const [scanType, setScanType] = useState<CommerceIdentifierType>("code_128");
  const [confirmAdd, setConfirmAdd] = useState(false);
  const [saleOpen, setSaleOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [quantity, setQuantity] = useState(1);
  const [message, setMessage] = useState("Tocá un objeto para identificarlo.");
  const [error, setError] = useState("");

  const authFetch = useCallback(async (url: string, init?: RequestInit) => {
    if (!session?.access_token) throw new Error("La sesión no está disponible.");
    const response = await fetch(url, {
      ...init,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${session.access_token}`,
        ...(init?.headers ?? {}),
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "La operación no pudo completarse.");
    return payload;
  }, [session?.access_token]);

  const loadOverview = useCallback(async () => {
    const payload = await authFetch(`/api/studios/${encodeURIComponent(studioId)}/commerce/spot`);
    setOverview(payload as Overview);
    return payload as Overview;
  }, [authFetch, studioId]);

  const findVisualListing = useCallback((recognized: CommerceProductRecognition, source?: Overview | null) => {
    const current = source ?? overview;
    if (!current) return null;
    const candidates = [recognized.name, recognized.detectedObject].map(normalize).filter(Boolean);
    return current.listings.find((listing) =>
      listing.status !== "archived" && candidates.includes(normalize(listing.name)),
    ) ?? null;
  }, [overview]);

  const processCode = useCallback(async (raw: string) => {
    const code = raw.trim();
    if (!code) return;
    const now = Date.now();
    if (lastCodeRef.current.value === code && now - lastCodeRef.current.at < 2500) return;
    lastCodeRef.current = { value: code, at: now };

    const type = detectCommerceIdentifierType(code);
    setScannedCode(code);
    setScanType(type);
    setMode("reading_code");
    setMessage("Código detectado. Buscando en tu catálogo…");
    setError("");

    try {
      const payload = await authFetch(
        `/api/studios/${encodeURIComponent(studioId)}/commerce/scan?code=${encodeURIComponent(code)}&type=${encodeURIComponent(type)}`,
      );
      const result = payload.result as ScanResult;
      if (result.listing?.id) {
        setMatchedListing(result.listing);
        setMatchedVariantId(result.listing_variant?.id || null);
        setMode("matched");
        setMessage("Producto encontrado. Listo para vender.");
        if (navigator.vibrate) navigator.vibrate([45, 35, 80]);
        return;
      }

      if (result.catalog_product) {
        setMode("identified");
        setMessage("El producto existe en CLOUVA, pero todavía no está cargado en este Spot.");
        return;
      }

      setMode("identified");
      setMessage("Código leído. Este producto todavía no está en tu catálogo.");
    } catch (cause) {
      setMode((current) => current === "matched" ? "matched" : "ready");
      setMessage("Tocá el objeto para identificarlo o mostrale el código a la cámara.");
      setError(cause instanceof Error ? cause.message : "No se pudo consultar el código.");
    }
  }, [authFetch, studioId]);

  const stopCamera = useCallback(() => {
    if (animationRef.current != null) cancelAnimationFrame(animationRef.current);
    animationRef.current = null;
    controlsRef.current?.stop();
    controlsRef.current = null;
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraReady(false);
    setTorch(false);
  }, []);

  const startCamera = useCallback(async () => {
    stopCamera();
    setError("");
    const video = videoRef.current;
    if (!video) return;

    try {
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      };

      const Detector = (window as typeof window & { BarcodeDetector?: NativeBarcodeDetectorConstructor }).BarcodeDetector;
      if (Detector) {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        streamRef.current = stream;
        video.srcObject = stream;
        await video.play();
        setCameraReady(true);

        const detector = new Detector({
          formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "qr_code"],
        });
        const detect = async () => {
          if (!videoRef.current || videoRef.current.readyState < 2) {
            animationRef.current = requestAnimationFrame(() => void detect());
            return;
          }
          try {
            const found = await detector.detect(videoRef.current);
            if (found[0]?.rawValue) void processCode(found[0].rawValue);
          } catch {
            // La siguiente lectura reintenta automáticamente.
          }
          animationRef.current = requestAnimationFrame(() => void detect());
        };
        animationRef.current = requestAnimationFrame(() => void detect());
      } else {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        const reader = new BrowserMultiFormatReader();
        controlsRef.current = await reader.decodeFromConstraints(constraints, video, (result) => {
          if (result?.getText()) void processCode(result.getText());
        });
        streamRef.current = video.srcObject as MediaStream;
        setCameraReady(true);
      }
    } catch (cause) {
      const name = cause instanceof DOMException ? cause.name : "";
      setError(name === "NotAllowedError"
        ? "La cámara está bloqueada. Habilitá el permiso para usar el scanner."
        : "No se pudo abrir la cámara trasera.");
    }
  }, [processCode, stopCamera]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace(`/login?next=${encodeURIComponent(`/studio-dashboard/${studioId}/commerce/scanner`)}`);
      return;
    }
    void loadOverview().catch((cause) => setError(cause instanceof Error ? cause.message : "No se pudo cargar el Spot."));
    void startCamera();
    return stopCamera;
  }, [authLoading, loadOverview, router, startCamera, stopCamera, studioId, user]);

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const capabilities = track.getCapabilities() as MediaTrackCapabilities & { torch?: boolean };
    if (!capabilities.torch) {
      setMessage("Esta cámara no informa soporte de linterna.");
      return;
    }
    const next = !torch;
    await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
    setTorch(next);
  }

  async function identifyAt(clientX: number, clientY: number) {
    const video = videoRef.current;
    const viewport = viewportRef.current;
    if (!video || !viewport || !cameraReady || mode === "identifying" || mode === "adding" || saleOpen) return;

    setMode("identifying");
    setError("");
    setConfirmAdd(false);
    setMatchedListing(null);
    setMatchedVariantId(null);
    setScannedCode("");
    setMessage("Identificando…");

    try {
      const frame = cropFrame(video, viewport.getBoundingClientRect(), clientX, clientY);
      setLastCapture(frame);
      const payload = await authFetch(`/api/studios/${encodeURIComponent(studioId)}/commerce/identify`, {
        method: "POST",
        body: JSON.stringify({ image: frame }),
      }) as IdentifyPayload;

      setRecognition(payload.recognition);
      const listing = findVisualListing(payload.recognition);
      if (listing) {
        setMatchedListing(listing);
        setMode("matched");
        setMessage("Coincide con un producto de tu catálogo. Si tiene código, mostralo para confirmarlo.");
      } else {
        setMode("identified");
        setMessage("¿Tiene QR o código de barras? Mostralo a la cámara. Si no, podés agregarlo con +.");
      }
      if (navigator.vibrate) navigator.vibrate(45);
    } catch (cause) {
      setMode("ready");
      setMessage("Tocá el objeto que querés identificar.");
      setError(cause instanceof Error ? cause.message : "No se pudo identificar el objeto.");
    }
  }

  async function addProduct() {
    if (matchedListing) {
      setConfirmAdd(false);
      setMessage("Este producto ya existe en tu catálogo; CLOUVA no lo va a duplicar.");
      return;
    }
    if (!lastCapture || !recognition) {
      setMessage("Primero tocá el objeto que querés agregar.");
      return;
    }
    if (!confirmAdd) {
      setConfirmAdd(true);
      setMessage(`¿Querés agregar “${recognition.name || recognition.detectedObject || "Producto"}”?`);
      return;
    }

    setMode("adding");
    setError("");
    setMessage("Agregando al catálogo…");
    try {
      const payload = await authFetch(`/api/studios/${encodeURIComponent(studioId)}/commerce/recognize`, {
        method: "POST",
        body: JSON.stringify({
          images: [{ label: "Frente", dataUrl: lastCapture }],
          identifier: scannedCode || null,
          identifierType: scannedCode ? scanType : null,
          draftKey: crypto.randomUUID(),
        }),
      });

      setConfirmAdd(false);
      setMode("identified");
      setMessage(`${recognition.name || recognition.detectedObject || "Producto"} agregado como borrador. Ya quedó dentro de CLOUVA.`);
      const nextOverview = await loadOverview();
      const created = nextOverview.listings.find((listing) => listing.id === payload.draft?.listingId) ?? null;
      if (created) {
        setMatchedListing(created);
        setMode("matched");
        setMessage(Number(created.price) > 0
          ? "Producto agregado. Ya está listo para vender."
          : "Producto agregado. Falta cargarle precio antes de vender.");
      }
      if (navigator.vibrate) navigator.vibrate([55, 45, 90]);
    } catch (cause) {
      setMode("identified");
      setError(cause instanceof Error ? cause.message : "No se pudo agregar el producto.");
    }
  }

  function openSale() {
    if (!matchedListing) {
      setMessage("Para venderlo primero tiene que existir en tu catálogo.");
      return;
    }
    setSaleOpen(true);
    setQuantity(1);
  }

  async function confirmSale() {
    if (!matchedListing || !overview?.summary.fx_rate?.id) {
      setError("La caja necesita una cotización vigente antes de confirmar la venta.");
      return;
    }

    setMode("adding");
    setError("");
    try {
      const payload = await authFetch(`/api/studios/${encodeURIComponent(studioId)}/commerce/pos`, {
        method: "POST",
        body: JSON.stringify({
          items: [{
            listingId: matchedListing.id,
            variantId: matchedVariantId,
            quantity,
          }],
          paymentMethod,
          fxRateId: overview.summary.fx_rate.id,
          idempotencyKey: `pistol-scan:${overview.spot.id}:${crypto.randomUUID()}`,
        }),
      });

      setSaleOpen(false);
      setMode("sold");
      setMessage(`Venta registrada · ${String(payload.sale?.order_id || "pedido creado")}`);
      if (navigator.vibrate) navigator.vibrate([60, 45, 120]);
      await loadOverview();
    } catch (cause) {
      setMode("matched");
      setError(cause instanceof Error ? cause.message : "No se pudo confirmar la venta.");
    }
  }

  const detectedName = useMemo(() =>
    matchedListing?.name
      || recognition?.name
      || recognition?.detectedObject
      || (scannedCode ? "Código detectado" : "Apuntá y tocá"),
  [matchedListing?.name, recognition?.detectedObject, recognition?.name, scannedCode]);

  const detectedInfo = useMemo(() => {
    if (matchedListing) {
      return [recognition?.brand, recognition?.presentation, `${matchedListing.stock ?? 0} u. en stock`]
        .filter(Boolean)
        .join(" · ");
    }
    if (recognition) {
      return [recognition.brand, recognition.category, recognition.presentation].filter(Boolean).join(" · ")
        || "Objeto identificado";
    }
    return "CLOUVA Scanner";
  }, [matchedListing, recognition]);

  const price = matchedListing ? money(matchedListing.price, matchedListing.currency || overview?.spot.currency) : "";
  const busy = mode === "identifying" || mode === "reading_code" || mode === "adding";

  return (
    <main className="relative min-h-[100svh] overflow-hidden bg-black text-white">
      <div
        ref={viewportRef}
        className="absolute inset-0 touch-manipulation select-none"
        onPointerUp={(event) => {
          if ((event.target as HTMLElement).closest("[data-scanner-control]")) return;
          void identifyAt(event.clientX, event.clientY);
        }}
      >
        <video ref={videoRef} muted playsInline className="h-full w-full object-cover" />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,rgba(0,0,0,.52),transparent_22%,transparent_62%,rgba(0,0,0,.92)_92%)]" />

        <div className="pointer-events-none absolute left-1/2 top-[43%] h-[38vw] max-h-72 min-h-48 w-[58vw] max-w-sm -translate-x-1/2 -translate-y-1/2">
          <span className="absolute left-0 top-0 h-12 w-12 rounded-tl-[28px] border-l-[3px] border-t-[3px] border-cyan-300 shadow-[0_0_24px_rgba(103,232,249,.55)]" />
          <span className="absolute right-0 top-0 h-12 w-12 rounded-tr-[28px] border-r-[3px] border-t-[3px] border-cyan-300 shadow-[0_0_24px_rgba(103,232,249,.55)]" />
          <span className="absolute bottom-0 left-0 h-12 w-12 rounded-bl-[28px] border-b-[3px] border-l-[3px] border-cyan-300 shadow-[0_0_24px_rgba(103,232,249,.55)]" />
          <span className="absolute bottom-0 right-0 h-12 w-12 rounded-br-[28px] border-b-[3px] border-r-[3px] border-cyan-300 shadow-[0_0_24px_rgba(103,232,249,.55)]" />
          <span className="absolute left-3 right-3 top-1/2 h-px bg-cyan-300/80 shadow-[0_0_18px_3px_rgba(34,211,238,.7)]" />
        </div>
      </div>

      <header data-scanner-control className="absolute inset-x-0 top-0 z-20 flex items-center justify-between px-4 pb-4 pt-[max(18px,env(safe-area-inset-top))]">
        <button type="button" onClick={() => router.back()} className="grid h-11 w-11 place-items-center rounded-full border border-white/15 bg-black/35 backdrop-blur-xl" aria-label="Volver">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[.3em] text-cyan-200/75">CLOUVA</p>
          <p className="mt-0.5 text-sm font-semibold">Scanner</p>
        </div>
        <button type="button" onClick={() => void toggleTorch()} className={`grid h-11 w-11 place-items-center rounded-full border backdrop-blur-xl ${torch ? "border-cyan-300/60 bg-cyan-300/20 text-cyan-100" : "border-white/15 bg-black/35"}`} aria-label="Linterna">
          <Flashlight className="h-5 w-5" />
        </button>
      </header>

      <div className="pointer-events-none absolute right-5 top-28 z-10 text-right">
        <p className="text-[10px] font-semibold uppercase tracking-[.23em] text-cyan-200/80">
          {mode === "matched" ? "Producto encontrado" : mode === "identifying" ? "Analizando" : "Scanner activo"}
        </p>
        <div className="ml-auto mt-2 h-0.5 w-20 rounded-full bg-cyan-300/80" />
      </div>

      <section data-scanner-control className="absolute inset-x-0 bottom-0 z-20 px-4 pb-[max(18px,env(safe-area-inset-bottom))]">
        <div className="mx-auto max-w-md">
          <div className="rounded-[26px] border border-white/15 bg-[#061116]/80 p-3 shadow-[0_28px_80px_rgba(0,0,0,.5)] backdrop-blur-2xl">
            <div className="flex items-center gap-3">
              <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-2xl border border-cyan-300/30 bg-cyan-300/[0.06]">
                {lastCapture ? <img src={lastCapture} alt="" className="h-full w-full object-cover" /> : <ScanLine className="h-7 w-7 text-cyan-200" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h1 className="truncate text-xl font-bold uppercase tracking-tight">{detectedName}</h1>
                  {matchedListing ? <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-emerald-300/50 text-emerald-300"><Check className="h-3.5 w-3.5" /></span> : null}
                </div>
                <p className="mt-1 truncate text-sm text-white/45">{detectedInfo}</p>
                {price ? <p className="mt-1 text-xl font-bold text-cyan-300">{price}</p> : null}
              </div>
              {busy ? <LoaderCircle className="h-5 w-5 shrink-0 animate-spin text-cyan-300" /> : null}
            </div>

            <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 px-3 py-2.5 text-center text-xs text-white/65">
              {confirmAdd ? `¿Querés agregar “${detectedName}”? Tocá + otra vez.` : message}
            </div>
            {error ? <p className="mt-2 text-center text-xs text-rose-300">{error}</p> : null}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-8 px-5">
            <button
              type="button"
              onClick={() => void addProduct()}
              disabled={busy || Boolean(matchedListing)}
              className="mx-auto grid h-20 w-20 place-items-center rounded-full border-2 border-emerald-300/80 bg-emerald-400/10 shadow-[0_0_28px_rgba(52,211,153,.24)] transition active:scale-95 disabled:opacity-35"
              aria-label="Agregar producto"
            >
              {mode === "adding" && !saleOpen ? <LoaderCircle className="h-8 w-8 animate-spin text-emerald-200" /> : <Plus className="h-10 w-10 text-emerald-200" />}
            </button>

            <button
              type="button"
              onClick={openSale}
              disabled={busy || !matchedListing}
              className="relative mx-auto grid h-20 w-20 place-items-center rounded-full border-2 border-blue-300/80 bg-blue-500/10 shadow-[0_0_28px_rgba(96,165,250,.24)] transition active:scale-95 disabled:opacity-30"
              aria-label="Vender producto"
            >
              <DollarSign className="h-9 w-9 text-blue-200" />
              {matchedListing ? <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-blue-300/30 bg-[#07111f]/95 px-2 py-1 text-[10px] font-bold text-blue-100">{price}</span> : null}
            </button>
          </div>
        </div>
      </section>

      {!cameraReady && !error ? (
        <div className="absolute inset-0 z-30 grid place-items-center bg-black">
          <div className="text-center">
            <LoaderCircle className="mx-auto h-8 w-8 animate-spin text-cyan-300" />
            <p className="mt-3 text-sm text-white/50">Abriendo cámara…</p>
          </div>
        </div>
      ) : null}

      {saleOpen && matchedListing ? (
        <div data-scanner-control className="absolute inset-0 z-40 flex items-end bg-black/60 backdrop-blur-sm">
          <div className="w-full rounded-t-[32px] border-t border-white/10 bg-[#090b10] px-5 pb-[max(24px,env(safe-area-inset-bottom))] pt-5">
            <div className="mx-auto max-w-md">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[.2em] text-blue-300">Caja</p>
                  <h2 className="mt-1 text-2xl font-semibold">{matchedListing.name}</h2>
                  <p className="mt-1 text-sm text-white/45">{price} · {matchedListing.stock ?? 0} u. en stock</p>
                </div>
                <button type="button" onClick={() => setSaleOpen(false)} className="grid h-10 w-10 place-items-center rounded-full border border-white/10">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-5 grid grid-cols-[110px_1fr] gap-3">
                <input
                  type="number"
                  min="1"
                  value={quantity}
                  onChange={(event) => setQuantity(Math.max(1, Number(event.target.value) || 1))}
                  className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-center outline-none"
                  aria-label="Cantidad"
                />
                <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)} className="rounded-2xl border border-white/10 bg-[#11141b] px-4 py-3 outline-none">
                  <option value="cash">Efectivo</option>
                  <option value="transfer">Transferencia</option>
                  <option value="debit_card">Débito</option>
                  <option value="credit_card">Crédito</option>
                  <option value="other">Otro</option>
                </select>
              </div>

              <div className="mt-4 flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4">
                <span className="text-sm text-white/45">Total</span>
                <strong className="text-2xl">{money(matchedListing.price * quantity, matchedListing.currency || overview?.spot.currency)}</strong>
              </div>

              {!overview?.summary.fx_rate?.id ? <p className="mt-3 text-xs text-amber-200">Falta una cotización vigente en Caja.</p> : null}

              <button
                type="button"
                onClick={() => void confirmSale()}
                disabled={mode === "adding" || !overview?.summary.fx_rate?.id}
                className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-500 px-5 py-4 font-bold text-white disabled:opacity-35"
              >
                {mode === "adding" ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <DollarSign className="h-5 w-5" />}
                Confirmar venta
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
