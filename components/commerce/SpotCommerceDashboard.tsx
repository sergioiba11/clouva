"use client";

import {
  Barcode,
  Boxes,
  Camera,
  ChartNoAxesCombined,
  CircleDollarSign,
  ClipboardList,
  ExternalLink,
  Flashlight,
  History,
  PackagePlus,
  Printer,
  QrCode,
  RefreshCw,
  ScanLine,
  Settings,
  ShoppingCart,
  Store,
  WalletCards,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { IScannerControls } from "@zxing/browser";
import { useAuth } from "@/components/auth-provider";
import { detectCommerceIdentifierType, type CommerceIdentifierType } from "@/lib/commerce/identifiers";

type Tab = "dashboard" | "scanner" | "catalog" | "inventory" | "sales" | "orders" | "codes" | "settings";
type Listing = {
  id: string;
  catalog_product_id: string | null;
  product_type: string;
  listing_kind: string;
  name: string;
  slug: string;
  price: number;
  cost_amount: number | null;
  currency: string;
  stock: number | null;
  status: string;
  cover_url: string | null;
  metadata: Record<string, unknown> | null;
};
type Variant = {
  id: string;
  product_id: string;
  catalog_variant_id: string | null;
  sku: string | null;
  title: string | null;
  size: string | null;
  color: string | null;
  price_override: number | null;
  cost_override: number | null;
  stock: number;
  active: boolean;
};
type Identifier = {
  id: string;
  catalog_product_id: string;
  catalog_variant_id: string | null;
  identifier_type: CommerceIdentifierType;
  value: string;
  created_at: string;
};
type BundleComponent = {
  id: string;
  bundle_listing_id: string;
  component_listing_id: string;
  component_variant_id: string | null;
  quantity: number;
  component_role: "physical" | "digital";
};
type Overview = {
  studio: { id: string; name: string; slug: string };
  role: string;
  spot: { id: string; name: string; slug: string; currency: string; status: string; fx_source: string };
  summary: {
    gross_local?: number;
    costs_local?: number;
    commissions_local?: number;
    net_local?: number;
    available_local?: number;
    net_usd?: number;
    flows?: number;
    goal?: { id: string; name: string; metric: string; target_amount: number; progress_amount: number } | null;
    fx_rate?: { id: string; local_per_quote: number; source: string; quoted_at: string } | null;
  };
  listings: Listing[];
  variants: Variant[];
  components: BundleComponent[];
  identifiers: Identifier[];
  movements: Array<Record<string, unknown>>;
  orders: Array<Record<string, unknown>>;
  payments: Array<Record<string, unknown>>;
  locations: Array<{ id: string; code: string; name: string; status: string }>;
};
type ScanResult = {
  exists?: boolean;
  exists_in_spot?: boolean;
  identifier?: Identifier;
  catalog_product?: Record<string, unknown>;
  catalog_variant?: Record<string, unknown> | null;
  listing?: Listing | null;
  listing_variant?: Variant | null;
};

type NativeBarcodeDetector = {
  detect(source: CanvasImageSource): Promise<Array<{ rawValue: string; format: string }>>;
};
type NativeBarcodeDetectorConstructor = new (options?: { formats?: string[] }) => NativeBarcodeDetector;

const NAV: Array<{ id: Tab; label: string; icon: typeof Store }> = [
  { id: "dashboard", label: "Dashboard", icon: ChartNoAxesCombined },
  { id: "scanner", label: "Escanear", icon: ScanLine },
  { id: "catalog", label: "Catálogo", icon: Store },
  { id: "inventory", label: "Inventario", icon: Boxes },
  { id: "sales", label: "Caja", icon: ShoppingCart },
  { id: "orders", label: "Pedidos", icon: ClipboardList },
  { id: "codes", label: "Códigos", icon: QrCode },
  { id: "settings", label: "Configuración", icon: Settings },
];

const INPUT = "w-full rounded-xl border border-white/10 bg-black/35 px-3 py-2.5 text-sm text-white outline-none transition focus:border-violet-400/60";
const CARD = "rounded-2xl border border-white/10 bg-[#0b0912]";

function money(value: unknown, currency = "ARS") {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(value || 0));
}

function decimal(value: unknown, maximumFractionDigits = 2) {
  return new Intl.NumberFormat("es-AR", { maximumFractionDigits }).format(Number(value || 0));
}

function when(value: unknown) {
  if (typeof value !== "string" || !value) return "—";
  return new Date(value).toLocaleString("es-AR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function SpotCommerceDashboard({ studioId }: { studioId: string }) {
  const router = useRouter();
  const { session, user, loading: authLoading } = useAuth();
  const [tab, setTab] = useState<Tab>("dashboard");
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState("");
  const [scanType, setScanType] = useState<CommerceIdentifierType>("code_128");
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [cameraId, setCameraId] = useState("");
  const [torch, setTorch] = useState(false);
  const [creation, setCreation] = useState({ name: "", brand: "", category: "", description: "", productKind: "physical", listingKind: "resale", cost: "", price: "", stock: "1", status: "draft", size: "", color: "", presentation: "" });
  const [stockDraft, setStockDraft] = useState({ listingId: "", variantId: "", quantity: "1", note: "" });
  const [cart, setCart] = useState<Array<{ listingId: string; variantId: string | null; quantity: number }>>([]);
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [customer, setCustomer] = useState({ name: "", email: "" });
  const [codeDraft, setCodeDraft] = useState({ listingId: "", variantId: "" });
  const [bundleDraft, setBundleDraft] = useState({ bundleListingId: "", physicalSelection: "", digitalSelection: "" });
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationRef = useRef<number | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const lastScanRef = useRef<{ value: string; at: number }>({ value: "", at: 0 });

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

  const load = useCallback(async () => {
    if (!session?.access_token) return;
    setLoading(true);
    setError(null);
    try {
      const payload = await authFetch(`/api/studios/${encodeURIComponent(studioId)}/commerce/spot`);
      setData(payload as Overview);
      setStockDraft((current) => ({ ...current, listingId: current.listingId || payload.listings?.[0]?.id || "" }));
      setCodeDraft((current) => ({ ...current, listingId: current.listingId || payload.listings?.[0]?.id || "" }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo cargar El Iglú.");
    } finally {
      setLoading(false);
    }
  }, [authFetch, session?.access_token, studioId]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLoading(false);
      router.replace(`/login?next=${encodeURIComponent(`/studio-dashboard/${studioId}/commerce`)}`);
      return;
    }
    void load();
  }, [authLoading, load, router, studioId, user]);

  const stopScanner = useCallback(() => {
    if (animationRef.current != null) cancelAnimationFrame(animationRef.current);
    animationRef.current = null;
    controlsRef.current?.stop();
    controlsRef.current = null;
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setScanning(false);
    setTorch(false);
  }, []);

  useEffect(() => stopScanner, [stopScanner]);

  const processCode = useCallback(async (raw: string) => {
    const code = raw.trim();
    if (!code) return;
    const now = Date.now();
    if (lastScanRef.current.value === code && now - lastScanRef.current.at < 2200) return;
    lastScanRef.current = { value: code, at: now };
    setManualCode(code);
    setScanType(detectCommerceIdentifierType(code));
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const payload = await authFetch(`/api/studios/${encodeURIComponent(studioId)}/commerce/scan?code=${encodeURIComponent(code)}`);
      const result = payload.result as ScanResult;
      setScanResult(result);
      if (navigator.vibrate) navigator.vibrate(80);
      if (result.exists_in_spot) setMessage(`Encontrado en ${data?.spot.name || "el Spot"}.`);
      else if (result.catalog_product) setMessage("El producto ya existe en CLOUVA y puede agregarse a El Iglú sin duplicarlo.");
      else setMessage("Código nuevo: completá los datos para crear el producto.");
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : "No se pudo consultar el código.";
      if (/no tiene un dígito|formato válido/i.test(text)) setError(text);
      else {
        setScanResult({ exists: false });
        setMessage("Código nuevo: completá los datos para crear el producto.");
      }
    } finally {
      setBusy(false);
    }
  }, [authFetch, data?.spot.name, studioId]);

  const startScanner = useCallback(async () => {
    stopScanner();
    setCameraError(null);
    setError(null);
    const video = videoRef.current;
    if (!video) return;
    try {
      const Detector = (window as typeof window & { BarcodeDetector?: NativeBarcodeDetectorConstructor }).BarcodeDetector;
      const constraints: MediaStreamConstraints = {
        video: cameraId ? { deviceId: { exact: cameraId } } : { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      };
      if (Detector) {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        streamRef.current = stream;
        video.srcObject = stream;
        await video.play();
        setScanning(true);
        const devices = await navigator.mediaDevices.enumerateDevices();
        setCameras(devices.filter((device) => device.kind === "videoinput"));
        const detector = new Detector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "qr_code"] });
        const detect = async () => {
          if (!videoRef.current || videoRef.current.readyState < 2) {
            animationRef.current = requestAnimationFrame(() => void detect());
            return;
          }
          try {
            const found = await detector.detect(videoRef.current);
            if (found[0]?.rawValue) void processCode(found[0].rawValue);
          } catch {
            // The next frame retries. BarcodeDetector can reject while the camera changes resolution.
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
        setScanning(true);
        const devices = await navigator.mediaDevices.enumerateDevices();
        setCameras(devices.filter((device) => device.kind === "videoinput"));
      }
    } catch (cause) {
      stopScanner();
      const name = cause instanceof DOMException ? cause.name : "";
      setCameraError(name === "NotAllowedError" ? "La cámara está bloqueada. Habilitala desde los permisos del navegador o ingresá el código manualmente." : "No se pudo abrir la cámara. Podés elegir otra cámara o ingresar el código manualmente.");
    }
  }, [cameraId, processCode, stopScanner]);

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const capabilities = track.getCapabilities() as MediaTrackCapabilities & { torch?: boolean };
    if (!capabilities.torch) {
      setCameraError("Esta cámara no informa soporte de linterna.");
      return;
    }
    const next = !torch;
    await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
    setTorch(next);
  }

  async function refreshFx() {
    setBusy(true); setError(null); setMessage(null);
    try {
      await authFetch(`/api/studios/${encodeURIComponent(studioId)}/commerce/fx`, { method: "POST", body: "{}" });
      setMessage("Cotización BCRA actualizada y guardada como snapshot.");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo actualizar la cotización."); }
    finally { setBusy(false); }
  }

  async function createScannedProduct() {
    if (!manualCode || !creation.name.trim() || !creation.price) {
      setError("Completá código, nombre y precio."); return;
    }
    setBusy(true); setError(null); setMessage(null);
    try {
      const hasVariant = Boolean(creation.size || creation.color || creation.presentation);
      const payload = await authFetch(`/api/studios/${encodeURIComponent(studioId)}/commerce/scan`, {
        method: "POST",
        body: JSON.stringify({
          code: manualCode,
          identifierType: scanType,
          product: { product_kind: creation.productKind, name: creation.name, brand: creation.brand, category: creation.category, description: creation.description },
          listing: { listing_kind: creation.listingKind, cost: Number(creation.cost || 0), price: Number(creation.price), initial_stock: Number(creation.stock || 0), status: creation.status },
          variant: hasVariant ? { size: creation.size, color: creation.color, presentation: creation.presentation } : {},
          idempotencyKey: `scan-ui:${data?.spot.id}:${manualCode}:${Date.now()}`,
        }),
      });
      setScanResult(payload.result as ScanResult);
      setMessage(`${creation.name} quedó conectado al catálogo de ${data?.spot.name}.`);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo guardar el producto."); }
    finally { setBusy(false); }
  }

  async function adjustStock() {
    if (!stockDraft.listingId || !data?.locations[0]) return;
    const quantity = Number(stockDraft.quantity);
    if (!Number.isInteger(quantity) || quantity === 0) { setError("Ingresá una cantidad entera distinta de cero."); return; }
    setBusy(true); setError(null); setMessage(null);
    try {
      await authFetch(`/api/studios/${encodeURIComponent(studioId)}/commerce/inventory`, {
        method: "POST",
        body: JSON.stringify({ listingId: stockDraft.listingId, variantId: stockDraft.variantId || null, locationId: data.locations[0].id, quantityDelta: quantity, note: stockDraft.note, idempotencyKey: `inventory-ui:${data.spot.id}:${Date.now()}` }),
      });
      setMessage("Stock actualizado y movimiento registrado.");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo actualizar el stock."); }
    finally { setBusy(false); }
  }

  function addToCart(listing: Listing, variant?: Variant | null) {
    setCart((current) => {
      const index = current.findIndex((item) => item.listingId === listing.id && item.variantId === (variant?.id ?? null));
      if (index < 0) return [...current, { listingId: listing.id, variantId: variant?.id ?? null, quantity: 1 }];
      return current.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: item.quantity + 1 } : item);
    });
    setTab("sales");
  }

  async function completeSale() {
    if (!cart.length) { setError("Escaneá o agregá un producto al carrito."); return; }
    if (!data?.summary.fx_rate?.id) { setError("Actualizá la cotización BCRA antes de confirmar la venta."); return; }
    setBusy(true); setError(null); setMessage(null);
    try {
      const payload = await authFetch(`/api/studios/${encodeURIComponent(studioId)}/commerce/pos`, {
        method: "POST",
        body: JSON.stringify({ items: cart, paymentMethod, customerName: customer.name, customerEmail: customer.email, fxRateId: data.summary.fx_rate.id, idempotencyKey: `pos-ui:${data.spot.id}:${crypto.randomUUID()}` }),
      });
      setCart([]);
      setMessage(`Venta confirmada · Pedido ${String(payload.sale?.order_id || "registrado")}.`);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo cerrar la venta."); }
    finally { setBusy(false); }
  }

  async function generateCodes() {
    if (!codeDraft.listingId) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      await authFetch(`/api/studios/${encodeURIComponent(studioId)}/commerce/codes`, { method: "POST", body: JSON.stringify({ listingId: codeDraft.listingId, variantId: codeDraft.variantId || null }) });
      setMessage("SKU, código de barras y QR CLOUVA generados.");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudieron generar los códigos."); }
    finally { setBusy(false); }
  }

  async function saveBundle() {
    if (!bundleDraft.bundleListingId || !bundleDraft.physicalSelection || !bundleDraft.digitalSelection) {
      setError("Elegí el producto físico y la prenda digital del combo.");
      return;
    }
    const parseSelection = (selection: string) => {
      const [listingId, variantId = ""] = selection.split("|");
      return { listingId, variantId: variantId || null, quantity: 1 };
    };
    setBusy(true); setError(null); setMessage(null);
    try {
      await authFetch(`/api/studios/${encodeURIComponent(studioId)}/commerce/bundles`, {
        method: "POST",
        body: JSON.stringify({
          bundleListingId: bundleDraft.bundleListingId,
          components: [parseSelection(bundleDraft.physicalSelection), parseSelection(bundleDraft.digitalSelection)],
        }),
      });
      setMessage("Combo físico + 3D conectado. Stock y entrega digital se resolverán en la misma venta.");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo configurar el combo."); }
    finally { setBusy(false); }
  }

  async function downloadLabel(identifier: Identifier, print = false) {
    try {
      const response = await fetch(`/api/studios/${encodeURIComponent(studioId)}/commerce/labels/${encodeURIComponent(identifier.id)}`, { headers: { authorization: `Bearer ${session?.access_token || ""}` } });
      if (!response.ok) throw new Error("No se pudo generar la etiqueta.");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      if (print) {
        const popup = window.open(url, "_blank", "noopener,noreferrer");
        if (popup) popup.addEventListener("load", () => popup.print(), { once: true });
      } else {
        const anchor = document.createElement("a");
        anchor.href = url; anchor.download = `el-iglu-${identifier.identifier_type}-${identifier.id}.svg`; anchor.click();
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo generar la etiqueta."); }
  }

  const cartTotal = useMemo(() => cart.reduce((sum, item) => {
    const listing = data?.listings.find((candidate) => candidate.id === item.listingId);
    const variant = data?.variants.find((candidate) => candidate.id === item.variantId);
    return sum + Number(variant?.price_override ?? listing?.price ?? 0) * item.quantity;
  }, 0), [cart, data?.listings, data?.variants]);

  if (authLoading || loading) return <main className="grid min-h-screen place-items-center bg-black text-white/55">Abriendo El Iglú…</main>;
  if (!data) return <main className="grid min-h-screen place-items-center bg-black p-6 text-white"><div className={`${CARD} max-w-xl p-6`}><h1 className="text-xl font-semibold">No se pudo abrir el Spot</h1><p className="mt-2 text-white/55">{error || "No hay información disponible."}</p></div></main>;

  const goal = data.summary.goal;
  const goalProgress = goal ? Math.max(0, Math.min(100, Number(goal.progress_amount || 0) / Number(goal.target_amount || 1) * 100)) : 0;

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_50%_-20%,rgba(91,33,182,.18),transparent_35%),#050507] text-white">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-black/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-2xl border border-violet-400/25 bg-violet-500/10"><Store className="h-5 w-5 text-violet-300" /></div><div className="min-w-0"><p className="truncate font-semibold">MI SPOT — {data.spot.name}</p><p className="text-xs text-white/35">{data.studio.name} · {data.role}</p></div></div>
          <div className="hidden items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm md:flex"><span className="text-violet-300">◎ {decimal(data.summary.flows)} FLOWS</span><span className="text-white/25">·</span><span>{money(data.summary.available_local, data.spot.currency)}</span><span className="text-white/25">·</span><span>USD {decimal(data.summary.net_usd)}</span></div>
          <Link href={`/studios/${data.studio.slug}/tienda`} className="flex items-center gap-2 rounded-xl border border-violet-400/25 px-3 py-2 text-sm text-violet-200">Ver tienda <ExternalLink className="h-4 w-4" /></Link>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1600px] gap-4 p-3 sm:p-5 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className={`${CARD} flex gap-2 overflow-x-auto p-2 lg:sticky lg:top-[78px] lg:h-[calc(100vh-98px)] lg:flex-col`}>
          {NAV.map((item) => { const Icon = item.icon; return <button key={item.id} type="button" onClick={() => setTab(item.id)} className={`flex shrink-0 items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition ${tab === item.id ? "bg-violet-600 text-white" : "text-white/50 hover:bg-white/5 hover:text-white"}`}><Icon className="h-4 w-4" />{item.label}</button>; })}
          <div className="mt-auto hidden border-t border-white/10 pt-3 text-xs text-white/35 lg:block">◎ 1 Flow = USD 1<br />Cotización: {data.summary.fx_rate ? `${money(data.summary.fx_rate.local_per_quote)} / USD` : "sin actualizar"}</div>
        </aside>

        <section className="min-w-0 space-y-4">
          {error ? <div className="flex items-start justify-between gap-3 rounded-xl border border-red-400/25 bg-red-400/10 p-3 text-sm text-red-100"><span>{error}</span><button onClick={() => setError(null)}><X className="h-4 w-4" /></button></div> : null}
          {message ? <div className="flex items-start justify-between gap-3 rounded-xl border border-emerald-400/25 bg-emerald-400/10 p-3 text-sm text-emerald-100"><span>{message}</span><button onClick={() => setMessage(null)}><X className="h-4 w-4" /></button></div> : null}

          {tab === "dashboard" ? <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric label="Ventas brutas" value={money(data.summary.gross_local, data.spot.currency)} icon={CircleDollarSign} />
              <Metric label="Costos" value={money(data.summary.costs_local, data.spot.currency)} icon={WalletCards} />
              <Metric label="Ganancia neta" value={money(data.summary.net_local, data.spot.currency)} positive icon={ChartNoAxesCombined} />
              <Metric label="Saldo Flow" value={`◎ ${decimal(data.summary.flows)} `} icon={History} />
            </div>
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
              <div className={`${CARD} p-5 sm:p-6`}><div className="flex items-start justify-between gap-4"><div><p className="text-xs uppercase tracking-[.2em] text-violet-300">Objetivo</p><h2 className="mt-2 text-3xl font-semibold">{goal?.name || "Objetivo económico"}</h2></div><span className="rounded-full border border-violet-400/25 px-3 py-1 text-sm text-violet-200">{goalProgress.toFixed(1)}%</span></div><div className="mt-8 h-3 overflow-hidden rounded-full bg-white/8"><div className="h-full rounded-full bg-gradient-to-r from-violet-700 to-fuchsia-400" style={{ width: `${goalProgress}%` }} /></div><div className="mt-4 flex justify-between text-sm"><span className="text-white/50">◎ {decimal(goal?.progress_amount)} generados</span><span>◎ {decimal(goal?.target_amount)} meta</span></div></div>
              <div className={`${CARD} p-5`}><div className="flex items-center justify-between"><div><p className="text-xs uppercase tracking-[.2em] text-white/35">USD oficial</p><p className="mt-2 text-2xl font-semibold">{data.summary.fx_rate ? money(data.summary.fx_rate.local_per_quote, data.spot.currency) : "Sin datos"}</p></div><button disabled={busy} onClick={() => void refreshFx()} className="grid h-11 w-11 place-items-center rounded-xl border border-violet-400/25 text-violet-200"><RefreshCw className={`h-5 w-5 ${busy ? "animate-spin" : ""}`} /></button></div><p className="mt-4 text-xs leading-5 text-white/40">Fuente configurada: {data.spot.fx_source}. Cada venta conserva su propia cotización histórica.</p></div>
            </div>
            <div className="grid gap-4 xl:grid-cols-2"><RecentMovements data={data} /><RecentOrders data={data} /></div>
          </> : null}

          {tab === "scanner" ? <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
            <div className={`${CARD} overflow-hidden`}><div className="flex items-center justify-between border-b border-white/10 p-4"><div><h1 className="text-xl font-semibold">Escanear producto</h1><p className="mt-1 text-sm text-white/40">EAN, UPC, Code 128 y QR</p></div><div className="flex gap-2"><button onClick={() => void toggleTorch()} disabled={!scanning} className="rounded-xl border border-white/10 p-2.5 disabled:opacity-30"><Flashlight className={`h-5 w-5 ${torch ? "text-amber-300" : ""}`} /></button><button onClick={scanning ? stopScanner : () => void startScanner()} className="rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold">{scanning ? "Detener" : "Abrir cámara"}</button></div></div><div className="relative aspect-[4/3] bg-black"><video ref={videoRef} muted playsInline className="h-full w-full object-cover" /><div className="pointer-events-none absolute inset-[14%] rounded-3xl border-2 border-violet-400 shadow-[0_0_0_999px_rgba(0,0,0,.42),0_0_35px_rgba(139,92,246,.45)]"><div className="absolute left-3 right-3 top-1/2 h-px bg-gradient-to-r from-transparent via-violet-300 to-transparent shadow-[0_0_15px_#c4b5fd]" /></div>{!scanning ? <div className="absolute inset-0 grid place-items-center text-center"><div><Camera className="mx-auto h-10 w-10 text-white/30" /><p className="mt-3 text-sm text-white/45">Abrí la cámara trasera para escanear</p></div></div> : null}</div><div className="grid gap-3 p-4 sm:grid-cols-[1fr_auto]">{cameras.length > 1 ? <select className={INPUT} value={cameraId} onChange={(event) => setCameraId(event.target.value)}>{cameras.map((camera, index) => <option key={camera.deviceId} value={camera.deviceId}>Cámara {index + 1} {camera.label}</option>)}</select> : <div className="text-sm text-white/35">La cámara prioriza el lente trasero.</div>}{cameraId && scanning ? <button onClick={() => void startScanner()} className="rounded-xl border border-white/10 px-4 py-2 text-sm">Cambiar</button> : null}</div>{cameraError ? <p className="mx-4 mb-4 rounded-xl border border-amber-400/20 bg-amber-400/10 p-3 text-sm text-amber-100">{cameraError}</p> : null}</div>
            <div className="space-y-4"><div className={`${CARD} p-4`}><p className="text-xs uppercase tracking-[.2em] text-white/35">Ingreso manual</p><div className="mt-3 flex gap-2"><input value={manualCode} onChange={(event) => { setManualCode(event.target.value); setScanType(detectCommerceIdentifierType(event.target.value)); }} onKeyDown={(event) => { if (event.key === "Enter") void processCode(manualCode); }} placeholder="Código de barras, SKU o QR" className={INPUT} /><button disabled={busy} onClick={() => void processCode(manualCode)} className="rounded-xl bg-violet-600 px-4"><ScanLine className="h-5 w-5" /></button></div><p className="mt-2 text-xs text-white/35">Detectado como {scanType.replaceAll("_", " ").toUpperCase()}</p></div>
              {scanResult?.listing ? <ScanExisting studioSlug={data.studio.slug} result={scanResult} onSell={(listing, variant) => addToCart(listing, variant)} onStock={(listing, variant) => { setStockDraft((current) => ({ ...current, listingId: listing.id, variantId: variant?.id || "" })); setTab("inventory"); }} /> : <CreateProductForm value={creation} onChange={setCreation} onSubmit={() => void createScannedProduct()} busy={busy} globalMatch={Boolean(scanResult?.catalog_product)} />}
            </div>
          </div> : null}

          {tab === "catalog" ? <Catalog data={data} bundleDraft={bundleDraft} setBundleDraft={setBundleDraft} onSaveBundle={() => void saveBundle()} busy={busy} onSell={addToCart} onCodes={(listing, variant) => { setCodeDraft({ listingId: listing.id, variantId: variant?.id || "" }); setTab("codes"); }} /> : null}
          {tab === "inventory" ? <Inventory data={data} draft={stockDraft} setDraft={setStockDraft} onSubmit={() => void adjustStock()} busy={busy} /> : null}
          {tab === "sales" ? <Sales data={data} cart={cart} setCart={setCart} total={cartTotal} paymentMethod={paymentMethod} setPaymentMethod={setPaymentMethod} customer={customer} setCustomer={setCustomer} onSubmit={() => void completeSale()} busy={busy} /> : null}
          {tab === "orders" ? <Orders data={data} /> : null}
          {tab === "codes" ? <Codes data={data} draft={codeDraft} setDraft={setCodeDraft} onGenerate={() => void generateCodes()} onDownload={downloadLabel} busy={busy} /> : null}
          {tab === "settings" ? <SettingsPanel data={data} onRefreshFx={() => void refreshFx()} busy={busy} /> : null}
        </section>
      </div>
    </main>
  );
}

function Metric({ label, value, icon: Icon, positive = false }: { label: string; value: string; icon: typeof Store; positive?: boolean }) { return <div className={`${CARD} p-4`}><div className="flex items-center justify-between"><p className="text-xs uppercase tracking-[.16em] text-white/35">{label}</p><Icon className="h-4 w-4 text-violet-300" /></div><p className={`mt-3 text-2xl font-semibold ${positive ? "text-emerald-300" : ""}`}>{value}</p></div>; }
function RecentMovements({ data }: { data: Overview }) { return <div className={`${CARD} p-5`}><h2 className="font-semibold">Movimientos recientes</h2><div className="mt-4 space-y-2">{data.movements.slice(0, 7).map((movement) => <div key={String(movement.id)} className="flex items-center justify-between gap-3 rounded-xl border border-white/8 bg-black/25 p-3 text-sm"><div><p>{String(movement.movement_type).replaceAll("_", " ")}</p><p className="text-xs text-white/35">{when(movement.created_at)}</p></div><span className={Number(movement.quantity_delta) > 0 ? "text-emerald-300" : "text-red-300"}>{Number(movement.quantity_delta) > 0 ? "+" : ""}{String(movement.quantity_delta)}</span></div>)}{!data.movements.length ? <p className="py-8 text-center text-sm text-white/35">Todavía no hay movimientos.</p> : null}</div></div>; }
function RecentOrders({ data }: { data: Overview }) { return <div className={`${CARD} p-5`}><h2 className="font-semibold">Últimos pedidos</h2><div className="mt-4 space-y-2">{data.orders.slice(0, 7).map((order) => <div key={String(order.id)} className="grid grid-cols-[1fr_auto] gap-3 rounded-xl border border-white/8 bg-black/25 p-3 text-sm"><div><p>#{String(order.id).slice(0, 8)} · {String(order.sales_channel)}</p><p className="text-xs text-white/35">{when(order.created_at)}</p></div><div className="text-right"><p>{money(order.total, String(order.currency))}</p><p className="text-xs text-emerald-300">{String(order.payment_status)}</p></div></div>)}{!data.orders.length ? <p className="py-8 text-center text-sm text-white/35">Todavía no hay pedidos.</p> : null}</div></div>; }

function ScanExisting({ studioSlug, result, onSell, onStock }: { studioSlug: string; result: ScanResult; onSell: (listing: Listing, variant?: Variant | null) => void; onStock: (listing: Listing, variant?: Variant | null) => void }) { const listing = result.listing!; const variant = result.listing_variant; return <div className={`${CARD} p-5`}><p className="text-xs uppercase tracking-[.2em] text-emerald-300">Producto encontrado</p><h2 className="mt-2 text-2xl font-semibold">{listing.name}</h2><p className="mt-1 text-sm text-white/45">{[variant?.color, variant?.size, variant?.sku].filter(Boolean).join(" · ")}</p><div className="mt-5 grid grid-cols-3 gap-2"><button onClick={() => onSell(listing, variant)} className="rounded-xl bg-violet-600 px-3 py-3 text-sm font-semibold">Vender</button><button onClick={() => onStock(listing, variant)} className="rounded-xl border border-white/15 px-3 py-3 text-sm">Agregar stock</button><Link href={`/studios/${studioSlug}/tienda/${listing.slug}`} className="rounded-xl border border-white/15 px-3 py-3 text-center text-sm">Consultar</Link></div></div>; }

type CreationState = { name: string; brand: string; category: string; description: string; productKind: string; listingKind: string; cost: string; price: string; stock: string; status: string; size: string; color: string; presentation: string };
function CreateProductForm({ value, onChange, onSubmit, busy, globalMatch }: { value: CreationState; onChange: React.Dispatch<React.SetStateAction<CreationState>>; onSubmit: () => void; busy: boolean; globalMatch: boolean }) { const field = (key: keyof CreationState, placeholder: string, type = "text") => <input type={type} className={INPUT} value={value[key]} placeholder={placeholder} onChange={(event) => onChange((current) => ({ ...current, [key]: event.target.value }))} />; return <div className={`${CARD} p-5`}><p className="text-xs uppercase tracking-[.2em] text-violet-300">{globalMatch ? "Agregar producto global a El Iglú" : "Crear producto desde el código"}</p><div className="mt-4 grid gap-3 sm:grid-cols-2">{field("name", "Nombre")}{field("brand", "Marca")}{field("category", "Categoría")}<select className={INPUT} value={value.productKind} onChange={(event) => onChange((current) => ({ ...current, productKind: event.target.value }))}><option value="physical">Físico</option><option value="avatar_item">Prenda 3D</option><option value="bundle">Combo físico + 3D</option><option value="digital">Digital</option></select>{field("cost", "Costo", "number")}{field("price", "Precio", "number")}{field("stock", "Stock inicial", "number")}<select className={INPUT} value={value.status} onChange={(event) => onChange((current) => ({ ...current, status: event.target.value }))}><option value="draft">Borrador</option><option value="published">Publicado</option></select>{field("color", "Color")}{field("size", "Talle")}{field("presentation", "Presentación")}<select className={INPUT} value={value.listingKind} onChange={(event) => onChange((current) => ({ ...current, listingKind: event.target.value }))}><option value="resale">Reventa</option><option value="owned_design">Diseño propio</option><option value="avatar">Avatar 3D</option><option value="combo">Combo</option></select><textarea className={`${INPUT} sm:col-span-2`} value={value.description} placeholder="Descripción" onChange={(event) => onChange((current) => ({ ...current, description: event.target.value }))} /></div><button disabled={busy} onClick={onSubmit} className="mt-4 w-full rounded-xl bg-violet-600 px-4 py-3 font-semibold disabled:opacity-50">{busy ? "Guardando…" : "Crear y conectar producto"}</button></div>; }

type BundleDraft = { bundleListingId: string; physicalSelection: string; digitalSelection: string };

function Catalog({ data, bundleDraft, setBundleDraft, onSaveBundle, busy, onSell, onCodes }: { data: Overview; bundleDraft: BundleDraft; setBundleDraft: React.Dispatch<React.SetStateAction<BundleDraft>>; onSaveBundle: () => void; busy: boolean; onSell: (listing: Listing, variant?: Variant | null) => void; onCodes: (listing: Listing, variant?: Variant | null) => void }) {
  const openBundle = (listing: Listing) => {
    const components = data.components.filter((component) => component.bundle_listing_id === listing.id);
    const physical = components.find((component) => component.component_role === "physical");
    const digital = components.find((component) => component.component_role === "digital");
    setBundleDraft({
      bundleListingId: listing.id,
      physicalSelection: physical ? `${physical.component_listing_id}|${physical.component_variant_id || ""}` : "",
      digitalSelection: digital ? `${digital.component_listing_id}|${digital.component_variant_id || ""}` : "",
    });
  };

  return <div className={`${CARD} p-5`}>
    <div className="flex items-center justify-between"><div><p className="text-xs uppercase tracking-[.2em] text-violet-300">Catálogo canónico</p><h1 className="mt-1 text-2xl font-semibold">Productos de {data.spot.name}</h1></div><span className="rounded-full border border-white/10 px-3 py-1 text-sm">{data.listings.length}</span></div>
    {bundleDraft.bundleListingId ? <BundleConfigurator data={data} draft={bundleDraft} setDraft={setBundleDraft} onSave={onSaveBundle} busy={busy} /> : null}
    <div className="mt-5 grid gap-3 lg:grid-cols-2">{data.listings.map((listing) => {
      const variants = data.variants.filter((variant) => variant.product_id === listing.id);
      const components = data.components.filter((component) => component.bundle_listing_id === listing.id);
      const configuredBundle = listing.product_type !== "bundle" || (components.some((component) => component.component_role === "physical") && components.some((component) => component.component_role === "digital"));
      return <article key={listing.id} className="rounded-2xl border border-white/10 bg-black/25 p-4"><div className="flex gap-4">{listing.cover_url ? <img src={listing.cover_url} alt="" className="h-20 w-20 rounded-2xl object-cover" /> : <div className="grid h-20 w-20 place-items-center rounded-2xl bg-violet-500/10"><Store className="h-6 w-6 text-violet-300" /></div>}<div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-3"><div><h2 className="truncate font-semibold">{listing.name}</h2><p className="mt-1 text-xs text-white/35">{listing.listing_kind} · {listing.status}</p></div><p className="font-semibold">{money(listing.price, listing.currency)}</p></div><p className="mt-2 text-sm text-white/45">{listing.product_type === "bundle" ? `${components.length} componentes conectados` : `Stock ${variants.length ? variants.reduce((sum, variant) => sum + variant.stock, 0) : listing.stock ?? "∞"}`}</p></div></div><div className="mt-4 space-y-2">{listing.product_type === "bundle" ? <div className="flex items-center justify-between gap-3 rounded-xl border border-violet-400/20 px-3 py-2 text-sm"><button onClick={() => openBundle(listing)} className="rounded-lg border border-violet-400/25 px-3 py-2 text-violet-200">Configurar físico + 3D</button><button disabled={!configuredBundle} onClick={() => onSell(listing, null)} className="rounded-lg bg-violet-600 px-3 py-2 disabled:opacity-35">Vender combo</button></div> : (variants.length ? variants : [null]).map((variant) => <div key={variant?.id || "base"} className="flex items-center justify-between gap-3 rounded-xl border border-white/8 px-3 py-2 text-sm"><span>{variant ? [variant.color, variant.size, variant.sku].filter(Boolean).join(" · ") || "Variante" : "Producto base"}</span><div className="flex gap-2"><button onClick={() => onCodes(listing, variant)} className="rounded-lg border border-white/10 p-2"><QrCode className="h-4 w-4" /></button><button onClick={() => onSell(listing, variant)} className="rounded-lg bg-violet-600 px-3 py-2">Vender</button></div></div>)}</div></article>;
    })}{!data.listings.length ? <p className="py-16 text-center text-white/35 lg:col-span-2">Escaneá el primer producto para empezar el catálogo.</p> : null}</div>
  </div>;
}

function BundleConfigurator({ data, draft, setDraft, onSave, busy }: { data: Overview; draft: BundleDraft; setDraft: React.Dispatch<React.SetStateAction<BundleDraft>>; onSave: () => void; busy: boolean }) {
  const options = (role: "physical" | "digital") => data.listings
    .filter((listing) => role === "physical" ? listing.product_type === "physical" : !["physical", "bundle"].includes(listing.product_type))
    .flatMap((listing) => {
      const variants = data.variants.filter((variant) => variant.product_id === listing.id);
      return (role === "physical" && variants.length ? variants : [null]).map((variant) => ({
        value: `${listing.id}|${variant?.id || ""}`,
        label: [listing.name, variant?.color, variant?.size, variant?.sku].filter(Boolean).join(" · "),
      }));
    });
  const bundle = data.listings.find((listing) => listing.id === draft.bundleListingId);
  return <div className="mt-5 rounded-2xl border border-violet-400/25 bg-violet-500/[0.06] p-4"><div className="flex items-center justify-between gap-3"><div><p className="text-xs uppercase tracking-[.18em] text-violet-300">Arquitectura del combo</p><h2 className="mt-1 font-semibold">{bundle?.name}</h2></div><button onClick={() => setDraft({ bundleListingId: "", physicalSelection: "", digitalSelection: "" })}><X className="h-4 w-4 text-white/45" /></button></div><div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto_1fr_auto]"><select className={INPUT} value={draft.physicalSelection} onChange={(event) => setDraft((current) => ({ ...current, physicalSelection: event.target.value }))}><option value="">Producto físico</option>{options("physical").map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><span className="self-center text-center text-violet-300">+</span><select className={INPUT} value={draft.digitalSelection} onChange={(event) => setDraft((current) => ({ ...current, digitalSelection: event.target.value }))}><option value="">Prenda / asset digital</option>{options("digital").map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><button disabled={busy} onClick={onSave} className="rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold disabled:opacity-40">Guardar combo</button></div></div>;
}

function Inventory({ data, draft, setDraft, onSubmit, busy }: { data: Overview; draft: { listingId: string; variantId: string; quantity: string; note: string }; setDraft: React.Dispatch<React.SetStateAction<{ listingId: string; variantId: string; quantity: string; note: string }>>; onSubmit: () => void; busy: boolean }) { const variants = data.variants.filter((variant) => variant.product_id === draft.listingId); return <div className="grid gap-4 xl:grid-cols-[380px_minmax(0,1fr)]"><div className={`${CARD} p-5`}><p className="text-xs uppercase tracking-[.2em] text-violet-300">Movimiento de inventario</p><div className="mt-4 space-y-3"><select className={INPUT} value={draft.listingId} onChange={(event) => setDraft((current) => ({ ...current, listingId: event.target.value, variantId: "" }))}><option value="">Producto</option>{data.listings.map((listing) => <option key={listing.id} value={listing.id}>{listing.name}</option>)}</select>{variants.length ? <select className={INPUT} value={draft.variantId} onChange={(event) => setDraft((current) => ({ ...current, variantId: event.target.value }))}><option value="">Elegí variante</option>{variants.map((variant) => <option key={variant.id} value={variant.id}>{[variant.color, variant.size, variant.sku].filter(Boolean).join(" · ")}</option>)}</select> : null}<input className={INPUT} type="number" value={draft.quantity} onChange={(event) => setDraft((current) => ({ ...current, quantity: event.target.value }))} placeholder="Cantidad (+ entrada / - salida)" /><textarea className={INPUT} value={draft.note} onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))} placeholder="Nota del movimiento" /><button disabled={busy} onClick={onSubmit} className="w-full rounded-xl bg-violet-600 px-4 py-3 font-semibold disabled:opacity-50"><PackagePlus className="mr-2 inline h-4 w-4" />Registrar stock</button></div></div><RecentMovements data={data} /></div>; }

function Sales({ data, cart, setCart, total, paymentMethod, setPaymentMethod, customer, setCustomer, onSubmit, busy }: { data: Overview; cart: Array<{ listingId: string; variantId: string | null; quantity: number }>; setCart: React.Dispatch<React.SetStateAction<Array<{ listingId: string; variantId: string | null; quantity: number }>>>; total: number; paymentMethod: string; setPaymentMethod: (value: string) => void; customer: { name: string; email: string }; setCustomer: React.Dispatch<React.SetStateAction<{ name: string; email: string }>>; onSubmit: () => void; busy: boolean }) { return <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]"><div className={`${CARD} p-5`}><div className="flex items-center justify-between"><h1 className="text-xl font-semibold">Caja · Venta</h1><button onClick={() => setCart([])} className="text-sm text-white/35">Vaciar</button></div><div className="mt-4 space-y-2">{cart.map((item, index) => { const listing = data.listings.find((candidate) => candidate.id === item.listingId); const variant = data.variants.find((candidate) => candidate.id === item.variantId); const price = Number(variant?.price_override ?? listing?.price ?? 0); return <div key={`${item.listingId}:${item.variantId}`} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-xl border border-white/10 p-3"><div><p className="font-medium">{listing?.name}</p><p className="text-xs text-white/35">{[variant?.color, variant?.size, variant?.sku].filter(Boolean).join(" · ")}</p></div><input className="w-16 rounded-lg bg-white/8 p-2 text-center" type="number" min="1" value={item.quantity} onChange={(event) => setCart((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, quantity: Math.max(1, Number(event.target.value) || 1) } : row))} /><div className="flex items-center gap-2"><span>{money(price * item.quantity, listing?.currency)}</span><button onClick={() => setCart((current) => current.filter((_, rowIndex) => rowIndex !== index))}><X className="h-4 w-4 text-white/35" /></button></div></div>; })}{!cart.length ? <div className="grid min-h-64 place-items-center text-center text-white/35"><div><ShoppingCart className="mx-auto h-9 w-9" /><p className="mt-3">Escaneá productos o agregalos desde el catálogo.</p></div></div> : null}</div></div><div className={`${CARD} h-fit p-5`}><p className="text-xs uppercase tracking-[.2em] text-violet-300">Cobro</p><p className="mt-3 text-4xl font-semibold">{money(total, data.spot.currency)}</p><div className="mt-5 space-y-3"><select className={INPUT} value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}><option value="cash">Efectivo</option><option value="transfer">Transferencia</option><option value="debit_card">Débito</option><option value="credit_card">Crédito</option><option value="other">Otro</option></select><input className={INPUT} value={customer.name} onChange={(event) => setCustomer((current) => ({ ...current, name: event.target.value }))} placeholder="Cliente (opcional)" /><input className={INPUT} value={customer.email} onChange={(event) => setCustomer((current) => ({ ...current, email: event.target.value }))} placeholder="Email (opcional)" />{data.summary.fx_rate ? <p className="rounded-xl border border-white/8 p-3 text-xs text-white/45">Snapshot: 1 USD = {money(data.summary.fx_rate.local_per_quote, data.spot.currency)} · Venta ≈ ◎ {decimal(total / Number(data.summary.fx_rate.local_per_quote || 1))}</p> : <button onClick={() => location.reload()} className="w-full rounded-xl border border-amber-400/25 p-3 text-sm text-amber-200">Falta cotización BCRA</button>}<button disabled={busy || !cart.length || !data.summary.fx_rate} onClick={onSubmit} className="w-full rounded-xl bg-emerald-500 px-4 py-3 font-semibold text-black disabled:opacity-40">{busy ? "Confirmando…" : "Confirmar venta"}</button></div></div></div>; }

function Orders({ data }: { data: Overview }) { return <div className={`${CARD} p-5`}><h1 className="text-xl font-semibold">Pedidos y pagos</h1><div className="mt-5 overflow-x-auto"><table className="w-full min-w-[780px] text-left text-sm"><thead className="text-xs uppercase tracking-wider text-white/35"><tr><th className="pb-3">Pedido</th><th className="pb-3">Canal</th><th className="pb-3">Cliente</th><th className="pb-3">Total</th><th className="pb-3">Pago</th><th className="pb-3">Entrega</th><th className="pb-3">Fecha</th></tr></thead><tbody>{data.orders.map((order) => <tr key={String(order.id)} className="border-t border-white/8"><td className="py-3">#{String(order.id).slice(0, 8)}</td><td>{String(order.sales_channel)}</td><td>{String(order.customer_name || order.customer_email || "Cliente CLOUVA")}</td><td>{money(order.total, String(order.currency))}</td><td className="text-emerald-300">{String(order.payment_status)}</td><td>{String(order.fulfillment_status)}</td><td>{when(order.created_at)}</td></tr>)}</tbody></table>{!data.orders.length ? <p className="py-16 text-center text-white/35">Todavía no hay pedidos.</p> : null}</div></div>; }

function Codes({ data, draft, setDraft, onGenerate, onDownload, busy }: { data: Overview; draft: { listingId: string; variantId: string }; setDraft: React.Dispatch<React.SetStateAction<{ listingId: string; variantId: string }>>; onGenerate: () => void; onDownload: (identifier: Identifier, print?: boolean) => void; busy: boolean }) { const listing = data.listings.find((item) => item.id === draft.listingId); const variants = data.variants.filter((variant) => variant.product_id === draft.listingId); const identifiers = data.identifiers.filter((identifier) => identifier.catalog_product_id === listing?.catalog_product_id && (!draft.variantId || identifier.catalog_variant_id === variants.find((variant) => variant.id === draft.variantId)?.catalog_variant_id)); return <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]"><div className={`${CARD} p-5`}><p className="text-xs uppercase tracking-[.2em] text-violet-300">Generar códigos CLOUVA</p><div className="mt-4 space-y-3"><select className={INPUT} value={draft.listingId} onChange={(event) => setDraft({ listingId: event.target.value, variantId: "" })}><option value="">Producto</option>{data.listings.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>{variants.length ? <select className={INPUT} value={draft.variantId} onChange={(event) => setDraft((current) => ({ ...current, variantId: event.target.value }))}><option value="">Elegí variante</option>{variants.map((variant) => <option key={variant.id} value={variant.id}>{[variant.color, variant.size, variant.sku].filter(Boolean).join(" · ")}</option>)}</select> : null}<button disabled={busy || !draft.listingId} onClick={onGenerate} className="w-full rounded-xl bg-violet-600 px-4 py-3 font-semibold disabled:opacity-40"><Barcode className="mr-2 inline h-4 w-4" />Generar SKU + barra + QR</button></div><p className="mt-4 text-xs leading-5 text-white/35">Los EAN/UPC comerciales se conservan. Los códigos CLOUVA se agregan sin reemplazarlos.</p></div><div className={`${CARD} p-5`}><h2 className="font-semibold">Etiquetas del producto</h2><div className="mt-4 grid gap-3 sm:grid-cols-2">{identifiers.map((identifier) => <article key={identifier.id} className="rounded-2xl border border-white/10 bg-white/[0.025] p-4"><div className="flex items-start justify-between"><div>{identifier.identifier_type === "clouva_qr" ? <QrCode className="h-8 w-8 text-violet-300" /> : <Barcode className="h-8 w-8 text-violet-300" />}<p className="mt-3 text-xs uppercase tracking-wider text-white/35">{identifier.identifier_type.replaceAll("_", " ")}</p></div><span className="rounded-full border border-white/10 px-2 py-1 text-[10px]">IMPRIMIBLE</span></div><p className="mt-3 break-all font-mono text-xs text-white/65">{identifier.value}</p><div className="mt-4 flex gap-2"><button onClick={() => void onDownload(identifier)} className="flex-1 rounded-xl border border-white/10 px-3 py-2 text-sm">Descargar</button><button onClick={() => void onDownload(identifier, true)} className="rounded-xl bg-violet-600 p-2.5"><Printer className="h-4 w-4" /></button></div></article>)}{!identifiers.length ? <p className="py-16 text-center text-white/35 sm:col-span-2">Elegí un producto y generá sus etiquetas.</p> : null}</div></div></div>; }

function SettingsPanel({ data, onRefreshFx, busy }: { data: Overview; onRefreshFx: () => void; busy: boolean }) { return <div className="grid gap-4 lg:grid-cols-2"><div className={`${CARD} p-5`}><p className="text-xs uppercase tracking-[.2em] text-violet-300">Spot</p><dl className="mt-4 space-y-3 text-sm"><Row label="Nombre" value={data.spot.name} /><Row label="Moneda" value={data.spot.currency} /><Row label="Estado" value={data.spot.status} /><Row label="Fuente FX" value={data.spot.fx_source} /><Row label="Ubicación" value={data.locations[0]?.name || "Sin ubicación"} /></dl></div><div className={`${CARD} p-5`}><p className="text-xs uppercase tracking-[.2em] text-violet-300">Cotización oficial</p><p className="mt-4 text-3xl font-semibold">{data.summary.fx_rate ? money(data.summary.fx_rate.local_per_quote, data.spot.currency) : "Sin snapshot"}</p><p className="mt-2 text-sm text-white/40">{data.summary.fx_rate ? `Guardada ${when(data.summary.fx_rate.quoted_at)}` : "Actualizala antes de la primera venta."}</p><button disabled={busy} onClick={onRefreshFx} className="mt-5 rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold"><RefreshCw className="mr-2 inline h-4 w-4" />Actualizar desde BCRA</button></div></div>; }
function Row({ label, value }: { label: string; value: string }) { return <div className="flex justify-between gap-4 border-b border-white/8 pb-3"><dt className="text-white/35">{label}</dt><dd>{value}</dd></div>; }
