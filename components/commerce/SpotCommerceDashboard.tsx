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
  spot_id?: string | null;
  identifier_type: CommerceIdentifierType;
  value: string;
  normalized_value?: string;
  origin: "manufacturer" | "imported" | "manual" | "clouva_generated";
  status: "active" | "disabled" | "replaced";
  scope?: "global" | "spot";
  is_primary: boolean;
  public_token?: string | null;
  destination_type?: "product" | "variant" | "authenticity" | "product_3d" | "digital_claim" | "experience";
  destination_path?: string | null;
  replaces_identifier_id?: string | null;
  disabled_at?: string | null;
  created_at: string;
};
type IdentifierEvent = {
  id: string;
  identifier_id: string;
  event_type: string;
  from_status?: string | null;
  to_status?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
};
type LabelOptions = {
  format: "svg" | "png" | "pdf";
  layout: "barcode" | "qr" | "combined" | "full";
  page: "label" | "a4";
  size: "30x20" | "40x30" | "50x30";
  copies: number;
  marginMm: number;
  showPrice: boolean;
  showSku: boolean;
  showQr: boolean;
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
  identifierEvents: IdentifierEvent[];
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
const DEFAULT_LABEL_OPTIONS: LabelOptions = {
  format: "pdf",
  layout: "full",
  page: "label",
  size: "40x30",
  copies: 1,
  marginMm: 8,
  showPrice: true,
  showSku: true,
  showQr: true,
};

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
    if (!response.ok) {
      const requestError = new Error(payload.error || "La operación no pudo completarse.") as Error & { payload?: Record<string, unknown> };
      requestError.payload = payload;
      throw requestError;
    }
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
      if (result.catalog_product && !result.listing) {
        setCreation((current) => ({
          ...current,
          name: String(result.catalog_product?.name || current.name),
          brand: String(result.catalog_product?.brand || current.brand || ""),
          category: String(result.catalog_product?.category || current.category || ""),
          description: String(result.catalog_product?.description || current.description || ""),
          productKind: String(result.catalog_product?.product_kind || current.productKind),
        }));
      }
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

  async function generateCodes(action: "generate" | "generate_all_variants" = "generate", identifierTypes?: Array<"sku" | "code_128" | "clouva_qr">) {
    if (!codeDraft.listingId) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const payload = await authFetch(`/api/studios/${encodeURIComponent(studioId)}/commerce/codes`, {
        method: "POST",
        body: JSON.stringify({ action, listingId: codeDraft.listingId, variantId: codeDraft.variantId || null, identifierTypes }),
      });
      const created = Array.isArray(payload.results) ? payload.results.filter((row: { status?: string }) => row.status === "created").length : 0;
      setMessage(action === "generate_all_variants"
        ? `${created} identificadores nuevos guardados. Los códigos activos se conservaron.`
        : "Identificadores guardados dentro del producto.");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudieron generar los códigos."); }
    finally { setBusy(false); }
  }

  async function attachCode(code: string, identifierType: CommerceIdentifierType, origin: Identifier["origin"]) {
    if (!codeDraft.listingId) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      await authFetch(`/api/studios/${encodeURIComponent(studioId)}/commerce/codes`, {
        method: "POST",
        body: JSON.stringify({ action: "attach", listingId: codeDraft.listingId, variantId: codeDraft.variantId || null, code, identifierType, origin }),
      });
      setMessage("Código validado y guardado permanentemente en el producto.");
      await load();
    } catch (cause) {
      const product = ((cause as Error & { payload?: { result?: { product?: Listing } } }).payload?.result?.product);
      if (product?.id && data?.listings.some((listing) => listing.id === product.id)) {
        setCodeDraft({ listingId: product.id, variantId: "" });
        setMessage(`El código ya corresponde a ${product.name}. Abrimos su ficha sin duplicarlo.`);
      }
      setError(cause instanceof Error ? cause.message : "No se pudo guardar el código.");
    } finally { setBusy(false); }
  }

  async function updateIdentifier(identifier: Identifier, action: "disable" | "replace" | "destination", values?: { code?: string; identifierType?: CommerceIdentifierType; destinationType?: string; destinationPath?: string }) {
    setBusy(true); setError(null); setMessage(null);
    try {
      await authFetch(`/api/studios/${encodeURIComponent(studioId)}/commerce/codes`, {
        method: "PATCH",
        body: JSON.stringify({
          action,
          identifierId: identifier.id,
          code: values?.code,
          identifierType: values?.identifierType,
          destinationType: values?.destinationType,
          destinationPath: values?.destinationPath,
          origin: values?.identifierType && ["ean_13", "ean_8", "upc_a", "upc_e"].includes(values.identifierType) ? "manufacturer" : "manual",
          confirmed: action === "replace",
        }),
      });
      setMessage(action === "disable" ? "Identificador desactivado; el historial se conservó." : action === "replace" ? "Identificador reemplazado y anterior conservado como REPLACED." : "Destino del QR actualizado sin reimprimirlo.");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo actualizar el identificador."); }
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

  function labelQuery(options: LabelOptions, print = false) {
    return new URLSearchParams({
      format: options.format,
      layout: options.layout,
      page: options.page,
      size: options.size,
      copies: String(options.copies),
      marginMm: String(options.marginMm),
      showPrice: String(options.showPrice),
      showSku: String(options.showSku),
      showQr: String(options.showQr),
      print: String(print),
    });
  }

  async function getLabelResponse(url: string) {
    const response = await fetch(url, { headers: { authorization: `Bearer ${session?.access_token || ""}` } });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || "No se pudo generar la etiqueta.");
    }
    return response;
  }

  async function previewLabel(identifier: Identifier, options: LabelOptions) {
    const previewOptions = { ...options, format: "svg", page: "label", copies: 1 } satisfies LabelOptions;
    const query = labelQuery(previewOptions);
    query.set("preview", "true");
    const response = await getLabelResponse(`/api/studios/${encodeURIComponent(studioId)}/commerce/labels/${encodeURIComponent(identifier.id)}?${query}`);
    return URL.createObjectURL(await response.blob());
  }

  async function downloadLabel(identifier: Identifier, options: LabelOptions, print = false) {
    try {
      const response = await getLabelResponse(`/api/studios/${encodeURIComponent(studioId)}/commerce/labels/${encodeURIComponent(identifier.id)}?${labelQuery(options, print)}`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      if (print) {
        window.open(url, "_blank", "noopener,noreferrer");
      } else {
        const anchor = document.createElement("a");
        anchor.href = url; anchor.download = `el-iglu-${identifier.identifier_type}-${identifier.id}.${options.format}`; anchor.click();
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo generar la etiqueta."); }
  }

  async function downloadLabelBatch(options: LabelOptions, print = false) {
    if (!codeDraft.listingId) return;
    try {
      const query = labelQuery(options, print);
      query.set("listingId", codeDraft.listingId);
      if (codeDraft.variantId) query.set("variantId", codeDraft.variantId);
      const response = await getLabelResponse(`/api/studios/${encodeURIComponent(studioId)}/commerce/labels?${query}`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      if (print) window.open(url, "_blank", "noopener,noreferrer");
      else {
        const anchor = document.createElement("a");
        anchor.href = url; anchor.download = `el-iglu-etiquetas.${options.format}`; anchor.click();
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudieron generar las etiquetas."); }
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
              {scanResult?.listing ? <ScanExisting
                result={scanResult}
                onOpen={(listing, variant) => { setCodeDraft({ listingId: listing.id, variantId: variant?.id || "" }); setTab("catalog"); }}
                onSell={(listing, variant) => addToCart(listing, variant)}
                onStock={(listing, variant) => { setStockDraft((current) => ({ ...current, listingId: listing.id, variantId: variant?.id || "" })); setTab("inventory"); }}
                onPrint={(identifier) => void downloadLabel(identifier, DEFAULT_LABEL_OPTIONS, true)}
              /> : <CreateProductForm value={creation} onChange={setCreation} onSubmit={() => void createScannedProduct()} busy={busy} globalMatch={Boolean(scanResult?.catalog_product)} scannedCode={manualCode} scanType={scanType} onScan={() => void startScanner()} />}
            </div>
          </div> : null}

          {tab === "catalog" ? <Catalog data={data} bundleDraft={bundleDraft} setBundleDraft={setBundleDraft} onSaveBundle={() => void saveBundle()} busy={busy} onSell={addToCart} onCodes={(listing, variant) => { setCodeDraft({ listingId: listing.id, variantId: variant?.id || "" }); setTab("codes"); }} /> : null}
          {tab === "inventory" ? <Inventory data={data} draft={stockDraft} setDraft={setStockDraft} onSubmit={() => void adjustStock()} busy={busy} /> : null}
          {tab === "sales" ? <Sales data={data} cart={cart} setCart={setCart} total={cartTotal} paymentMethod={paymentMethod} setPaymentMethod={setPaymentMethod} customer={customer} setCustomer={setCustomer} onSubmit={() => void completeSale()} busy={busy} /> : null}
          {tab === "orders" ? <Orders data={data} /> : null}
          {tab === "codes" ? <Codes
            data={data}
            draft={codeDraft}
            setDraft={setCodeDraft}
            onGenerate={(action, types) => void generateCodes(action, types)}
            onAttach={(code, type, origin) => void attachCode(code, type, origin)}
            onUpdate={(identifier, action, values) => void updateIdentifier(identifier, action, values)}
            onDownload={(identifier, options, print) => void downloadLabel(identifier, options, print)}
            onBatch={(options, print) => void downloadLabelBatch(options, print)}
            onPreview={previewLabel}
            onScan={() => setTab("scanner")}
            busy={busy}
          /> : null}
          {tab === "settings" ? <SettingsPanel data={data} onRefreshFx={() => void refreshFx()} busy={busy} /> : null}
        </section>
      </div>
    </main>
  );
}

function Metric({ label, value, icon: Icon, positive = false }: { label: string; value: string; icon: typeof Store; positive?: boolean }) { return <div className={`${CARD} p-4`}><div className="flex items-center justify-between"><p className="text-xs uppercase tracking-[.16em] text-white/35">{label}</p><Icon className="h-4 w-4 text-violet-300" /></div><p className={`mt-3 text-2xl font-semibold ${positive ? "text-emerald-300" : ""}`}>{value}</p></div>; }
function RecentMovements({ data }: { data: Overview }) { return <div className={`${CARD} p-5`}><h2 className="font-semibold">Movimientos recientes</h2><div className="mt-4 space-y-2">{data.movements.slice(0, 7).map((movement) => <div key={String(movement.id)} className="flex items-center justify-between gap-3 rounded-xl border border-white/8 bg-black/25 p-3 text-sm"><div><p>{String(movement.movement_type).replaceAll("_", " ")}</p><p className="text-xs text-white/35">{when(movement.created_at)}</p></div><span className={Number(movement.quantity_delta) > 0 ? "text-emerald-300" : "text-red-300"}>{Number(movement.quantity_delta) > 0 ? "+" : ""}{String(movement.quantity_delta)}</span></div>)}{!data.movements.length ? <p className="py-8 text-center text-sm text-white/35">Todavía no hay movimientos.</p> : null}</div></div>; }
function RecentOrders({ data }: { data: Overview }) { return <div className={`${CARD} p-5`}><h2 className="font-semibold">Últimos pedidos</h2><div className="mt-4 space-y-2">{data.orders.slice(0, 7).map((order) => <div key={String(order.id)} className="grid grid-cols-[1fr_auto] gap-3 rounded-xl border border-white/8 bg-black/25 p-3 text-sm"><div><p>#{String(order.id).slice(0, 8)} · {String(order.sales_channel)}</p><p className="text-xs text-white/35">{when(order.created_at)}</p></div><div className="text-right"><p>{money(order.total, String(order.currency))}</p><p className="text-xs text-emerald-300">{String(order.payment_status)}</p></div></div>)}{!data.orders.length ? <p className="py-8 text-center text-sm text-white/35">Todavía no hay pedidos.</p> : null}</div></div>; }

function ScanExisting({ result, onOpen, onSell, onStock, onPrint }: { result: ScanResult; onOpen: (listing: Listing, variant?: Variant | null) => void; onSell: (listing: Listing, variant?: Variant | null) => void; onStock: (listing: Listing, variant?: Variant | null) => void; onPrint: (identifier: Identifier) => void }) {
  const listing = result.listing!;
  const variant = result.listing_variant;
  return <div className={`${CARD} p-5`}>
    <p className="text-xs uppercase tracking-[.2em] text-emerald-300">Código perteneciente a El Iglú</p>
    <div className="mt-4 flex gap-4">{listing.cover_url ? <img src={listing.cover_url} alt={listing.name} className="h-20 w-20 rounded-2xl object-cover" /> : <div className="grid h-20 w-20 place-items-center rounded-2xl bg-violet-500/10"><Store className="h-6 w-6 text-violet-300" /></div>}<div><h2 className="text-2xl font-semibold">{listing.name}</h2><p className="mt-1 text-sm text-white/45">{[variant?.color, variant?.size, variant?.sku].filter(Boolean).join(" · ") || "Producto base"}</p><p className="mt-2 text-sm">{money(variant?.price_override ?? listing.price, listing.currency)} · Stock {variant?.stock ?? listing.stock ?? "∞"}</p></div></div>
    <dl className="mt-4 grid grid-cols-2 gap-2 text-xs"><Row label="Tipo" value={result.identifier?.identifier_type?.replaceAll("_", " ").toUpperCase() || "—"} /><Row label="Estado" value={listing.status} /><Row label="Código" value={result.identifier?.value || "—"} /><Row label="SKU" value={variant?.sku || "—"} /></dl>
    <div className="mt-5 grid grid-cols-2 gap-2"><button onClick={() => onOpen(listing, variant)} className="rounded-xl border border-white/15 px-3 py-3 text-sm">Abrir producto</button><button onClick={() => onSell(listing, variant)} className="rounded-xl bg-violet-600 px-3 py-3 text-sm font-semibold">Vender</button><button onClick={() => onStock(listing, variant)} className="rounded-xl border border-white/15 px-3 py-3 text-sm">Agregar stock</button><button disabled={!result.identifier} onClick={() => result.identifier && onPrint(result.identifier)} className="rounded-xl border border-violet-400/25 px-3 py-3 text-sm text-violet-200 disabled:opacity-35">Imprimir etiqueta</button></div>
  </div>;
}

type CreationState = { name: string; brand: string; category: string; description: string; productKind: string; listingKind: string; cost: string; price: string; stock: string; status: string; size: string; color: string; presentation: string };
function CreateProductForm({ value, onChange, onSubmit, busy, globalMatch, scannedCode, scanType, onScan }: { value: CreationState; onChange: React.Dispatch<React.SetStateAction<CreationState>>; onSubmit: () => void; busy: boolean; globalMatch: boolean; scannedCode: string; scanType: CommerceIdentifierType; onScan: () => void }) {
  const field = (key: keyof CreationState, placeholder: string, type = "text") => <input type={type} className={INPUT} value={value[key]} placeholder={placeholder} onChange={(event) => onChange((current) => ({ ...current, [key]: event.target.value }))} />;
  return <div className={`${CARD} p-5`}>
    <p className="text-xs uppercase tracking-[.2em] text-violet-300">{globalMatch ? "Agregar producto global a El Iglú" : "Crear producto con este código"}</p>
    <div className="mt-4 rounded-2xl border border-violet-400/20 bg-violet-500/[0.05] p-4"><p className="text-xs font-semibold uppercase tracking-[.16em]">¿Este producto ya tiene código?</p><div className="mt-3 grid grid-cols-3 gap-2 text-xs"><button onClick={onScan} className="rounded-xl border border-white/10 p-2">Escanear cámara</button><span className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-2 text-center text-emerald-200">Ingresado</span><span className="rounded-xl border border-white/10 p-2 text-center text-white/35">No tiene código</span></div><p className="mt-3 break-all font-mono text-xs text-white/55">{scannedCode || "Esperando código"} · {scanType.replaceAll("_", " ").toUpperCase()}</p></div>
    <div className="mt-4 grid gap-3 sm:grid-cols-2">{field("name", "Nombre")}{field("brand", "Marca")}{field("category", "Categoría")}<select className={INPUT} value={value.productKind} onChange={(event) => onChange((current) => ({ ...current, productKind: event.target.value }))}><option value="physical">Físico</option><option value="avatar_item">Prenda 3D</option><option value="bundle">Combo físico + 3D</option><option value="digital">Digital</option></select>{field("cost", "Costo", "number")}{field("price", "Precio", "number")}{field("stock", "Stock inicial", "number")}<select className={INPUT} value={value.status} onChange={(event) => onChange((current) => ({ ...current, status: event.target.value }))}><option value="draft">Borrador</option><option value="published">Publicado</option></select>{field("color", "Color")}{field("size", "Talle")}{field("presentation", "Presentación")}<select className={INPUT} value={value.listingKind} onChange={(event) => onChange((current) => ({ ...current, listingKind: event.target.value }))}><option value="resale">Reventa</option><option value="owned_design">Diseño propio</option><option value="avatar">Avatar 3D</option><option value="combo">Combo</option></select><textarea className={`${INPUT} sm:col-span-2`} value={value.description} placeholder="Descripción" onChange={(event) => onChange((current) => ({ ...current, description: event.target.value }))} /></div><button disabled={busy || !scannedCode} onClick={onSubmit} className="mt-4 w-full rounded-xl bg-violet-600 px-4 py-3 font-semibold disabled:opacity-50">{busy ? "Guardando…" : "Crear y conectar producto"}</button>
  </div>;
}

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
      const identifiers = data.identifiers.filter((identifier) => identifier.catalog_product_id === listing.catalog_product_id);
      const configuredBundle = listing.product_type !== "bundle" || (components.some((component) => component.component_role === "physical") && components.some((component) => component.component_role === "digital"));
      const targets = variants.length ? variants : [null];
      return <article key={listing.id} className="rounded-2xl border border-white/10 bg-black/25 p-4">
        <div className="flex gap-4">{listing.cover_url ? <img src={listing.cover_url} alt="" className="h-20 w-20 rounded-2xl object-cover" /> : <div className="grid h-20 w-20 place-items-center rounded-2xl bg-violet-500/10"><Store className="h-6 w-6 text-violet-300" /></div>}<div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-3"><div><h2 className="truncate font-semibold">{listing.name}</h2><p className="mt-1 text-xs text-white/35">{listing.listing_kind} · {listing.status}</p></div><p className="font-semibold">{money(listing.price, listing.currency)}</p></div><p className="mt-2 text-sm text-white/45">{listing.product_type === "bundle" ? `${components.length} componentes conectados` : `Stock ${variants.length ? variants.reduce((sum, variant) => sum + variant.stock, 0) : listing.stock ?? "∞"}`}</p></div></div>
        <div className="mt-4 space-y-2">{listing.product_type === "bundle" ? <div className="flex items-center justify-between gap-3 rounded-xl border border-violet-400/20 px-3 py-2 text-sm"><button onClick={() => openBundle(listing)} className="rounded-lg border border-violet-400/25 px-3 py-2 text-violet-200">Configurar físico + 3D</button><button disabled={!configuredBundle} onClick={() => onSell(listing, null)} className="rounded-lg bg-violet-600 px-3 py-2 disabled:opacity-35">Vender combo</button></div> : targets.map((variant) => <div key={variant?.id || "base"} className="flex items-center justify-between gap-3 rounded-xl border border-white/8 px-3 py-2 text-sm"><span>{variant ? [variant.color, variant.size, variant.sku].filter(Boolean).join(" · ") || "Variante" : "Producto base"}</span><button onClick={() => onSell(listing, variant)} className="rounded-lg bg-violet-600 px-3 py-2">Vender</button></div>)}</div>
        <section className="mt-4 rounded-2xl border border-violet-400/20 bg-violet-500/[0.04] p-3">
          <div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-violet-300">Identificación y etiquetas</p><p className="mt-1 text-xs text-white/40">{identifiers.filter((identifier) => identifier.status === "active").length} activos · historial permanente</p></div><button onClick={() => onCodes(listing, null)} className="rounded-lg border border-violet-400/25 px-3 py-2 text-xs text-violet-200">Abrir</button></div>
          <div className="mt-3 space-y-2">{targets.map((variant) => {
            const scoped = identifiers.filter((identifier) => identifier.catalog_variant_id === (variant?.catalog_variant_id ?? null));
            return <button key={variant?.id || "base-identifiers"} onClick={() => onCodes(listing, variant)} className="flex w-full items-center justify-between gap-3 rounded-xl border border-white/8 p-2 text-left text-xs"><span>{variant ? [variant.color, variant.size, variant.sku].filter(Boolean).join(" · ") || "Variante" : "Producto base"}</span><span className="text-white/40">{scoped.filter((identifier) => identifier.status === "active").map((identifier) => identifier.identifier_type.replace("clouva_", "").replace("code_128", "CODE 128").toUpperCase()).join(" · ") || "Sin códigos"}</span></button>;
          })}</div>
        </section>
      </article>;
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

function Codes({ data, draft, setDraft, onGenerate, onAttach, onUpdate, onDownload, onBatch, onPreview, onScan, busy }: {
  data: Overview;
  draft: { listingId: string; variantId: string };
  setDraft: React.Dispatch<React.SetStateAction<{ listingId: string; variantId: string }>>;
  onGenerate: (action: "generate" | "generate_all_variants", types?: Array<"sku" | "code_128" | "clouva_qr">) => void;
  onAttach: (code: string, type: CommerceIdentifierType, origin: Identifier["origin"]) => void;
  onUpdate: (identifier: Identifier, action: "disable" | "replace" | "destination", values?: { code?: string; identifierType?: CommerceIdentifierType; destinationType?: string; destinationPath?: string }) => void;
  onDownload: (identifier: Identifier, options: LabelOptions, print?: boolean) => void;
  onBatch: (options: LabelOptions, print?: boolean) => void;
  onPreview: (identifier: Identifier, options: LabelOptions) => Promise<string>;
  onScan: () => void;
  busy: boolean;
}) {
  const [subtab, setSubtab] = useState<"scan" | "create" | "labels" | "history">("create");
  const [manual, setManual] = useState("");
  const [manualType, setManualType] = useState<CommerceIdentifierType>("ean_13");
  const [origin, setOrigin] = useState<Identifier["origin"]>("manufacturer");
  const [selectedId, setSelectedId] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [labelOptions, setLabelOptions] = useState<LabelOptions>(DEFAULT_LABEL_OPTIONS);
  const listing = data.listings.find((item) => item.id === draft.listingId);
  const variants = data.variants.filter((variant) => variant.product_id === draft.listingId);
  const selectedVariant = variants.find((variant) => variant.id === draft.variantId);
  const identifiers = data.identifiers.filter((identifier) =>
    identifier.catalog_product_id === listing?.catalog_product_id
    && (!draft.variantId || identifier.catalog_variant_id === selectedVariant?.catalog_variant_id),
  );
  const activeIdentifiers = identifiers.filter((identifier) => identifier.status === "active");
  const selected = activeIdentifiers.find((identifier) => identifier.id === selectedId) ?? activeIdentifiers[0];
  const identifierIds = new Set(identifiers.map((identifier) => identifier.id));
  const events = data.identifierEvents.filter((event) => identifierIds.has(event.identifier_id));

  useEffect(() => {
    if (!selectedId || !activeIdentifiers.some((identifier) => identifier.id === selectedId)) setSelectedId(activeIdentifiers[0]?.id || "");
  }, [activeIdentifiers, selectedId]);

  useEffect(() => {
    if (subtab !== "labels" || !selected) return;
    let disposed = false;
    let objectUrl = "";
    void onPreview(selected, labelOptions).then((url) => {
      objectUrl = url;
      if (!disposed) setPreviewUrl(url);
      else URL.revokeObjectURL(url);
    }).catch(() => setPreviewUrl(""));
    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [labelOptions, onPreview, selected, subtab]);

  const changeManual = (value: string) => {
    setManual(value);
    const detected = detectCommerceIdentifierType(value);
    setManualType(detected);
    setOrigin(["ean_13", "ean_8", "upc_a", "upc_e"].includes(detected) ? "manufacturer" : "manual");
  };
  const replaceIdentifier = (identifier: Identifier) => {
    const code = window.prompt("Ingresá el código reemplazante. El actual quedará en historial como REPLACED.");
    if (!code) return;
    if (!window.confirm(`¿Reemplazar ${identifier.value} por ${code}?`)) return;
    onUpdate(identifier, "replace", { code, identifierType: detectCommerceIdentifierType(code) });
  };
  const updateQrDestination = (identifier: Identifier) => {
    const destinationType = window.prompt("Destino: product, variant, authenticity, product_3d, digital_claim o experience", identifier.destination_type || "product");
    if (!destinationType) return;
    const destinationPath = window.prompt("Ruta interna opcional (por ejemplo /experiencias/vida-de-flows)", identifier.destination_path || "") ?? "";
    onUpdate(identifier, "destination", { destinationType, destinationPath });
  };
  const setLabel = <K extends keyof LabelOptions>(key: K, value: LabelOptions[K]) => setLabelOptions((current) => ({ ...current, [key]: value }));

  return <div className="space-y-4">
    <div className={`${CARD} p-4`}>
      <div className="grid gap-3 lg:grid-cols-[1fr_1fr_auto]"><select className={INPUT} value={draft.listingId} onChange={(event) => setDraft({ listingId: event.target.value, variantId: "" })}><option value="">Producto</option>{data.listings.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><select className={INPUT} value={draft.variantId} onChange={(event) => setDraft((current) => ({ ...current, variantId: event.target.value }))}><option value="">Producto completo / todas las variantes</option>{variants.map((variant) => <option key={variant.id} value={variant.id}>{[variant.color, variant.size, variant.sku].filter(Boolean).join(" · ") || variant.title || "Variante"}</option>)}</select><span className="rounded-xl border border-white/10 px-4 py-2.5 text-center text-sm text-white/45">{activeIdentifiers.length} activos</span></div>
      <div className="mt-4 flex gap-2 overflow-x-auto">{([['scan', 'ESCANEAR'], ['create', 'CREAR CÓDIGO'], ['labels', 'ETIQUETAS'], ['history', 'HISTORIAL']] as const).map(([id, label]) => <button key={id} onClick={() => setSubtab(id)} className={`shrink-0 rounded-xl px-4 py-2 text-xs font-semibold ${subtab === id ? "bg-violet-600" : "border border-white/10 text-white/50"}`}>{label}</button>)}</div>
    </div>

    {subtab === "scan" ? <div className={`${CARD} p-6 text-center`}><ScanLine className="mx-auto h-10 w-10 text-violet-300" /><h2 className="mt-3 text-xl font-semibold">Escaneá y resolvé contra el mismo registro</h2><p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-white/45">EAN/UPC del fabricante, SKU, Code 128 y QR CLOUVA consultan el catálogo canónico. Si es desconocido, el código vuelve precargado al alta.</p><button onClick={onScan} className="mt-5 rounded-xl bg-violet-600 px-5 py-3 font-semibold">Abrir escáner</button></div> : null}

    {subtab === "create" ? <div className="grid gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
      <div className={`${CARD} p-5`}><p className="text-xs uppercase tracking-[.2em] text-violet-300">Identificación y etiquetas</p><h2 className="mt-1 text-xl font-semibold">{listing?.name || "Elegí un producto"}</h2><p className="mt-1 text-sm text-white/40">{selectedVariant ? [selectedVariant.color, selectedVariant.size, selectedVariant.sku].filter(Boolean).join(" · ") : variants.length ? "Todas las variantes" : "Producto base"}</p><div className="mt-5 space-y-3"><button onClick={onScan} className="w-full rounded-xl border border-white/10 px-4 py-3 text-sm"><Camera className="mr-2 inline h-4 w-4" />Escanear código existente</button><input className={INPUT} value={manual} onChange={(event) => changeManual(event.target.value)} placeholder="Ingresar código manualmente" /><div className="grid grid-cols-2 gap-2"><select className={INPUT} value={manualType} onChange={(event) => setManualType(event.target.value as CommerceIdentifierType)}>{["ean_13", "ean_8", "upc_a", "upc_e", "sku", "code_128"].map((type) => <option key={type} value={type}>{type.replaceAll("_", " ").toUpperCase()}</option>)}</select><select className={INPUT} value={origin} onChange={(event) => setOrigin(event.target.value as Identifier["origin"])}><option value="manufacturer">Fabricante</option><option value="imported">Importado</option><option value="manual">Manual</option></select></div><button disabled={busy || !listing || !manual} onClick={() => onAttach(manual, manualType, origin)} className="w-full rounded-xl bg-violet-600 px-4 py-3 font-semibold disabled:opacity-40">Guardar en el producto</button><div className="grid grid-cols-3 gap-2"><button disabled={busy || !listing} onClick={() => onGenerate("generate", ["sku"])} className="rounded-xl border border-white/10 p-2 text-xs">Generar SKU</button><button disabled={busy || !listing} onClick={() => onGenerate("generate", ["code_128"])} className="rounded-xl border border-white/10 p-2 text-xs">Code 128</button><button disabled={busy || !listing} onClick={() => onGenerate("generate", ["clouva_qr"])} className="rounded-xl border border-white/10 p-2 text-xs">QR CLOUVA</button></div><button disabled={busy || !listing} onClick={() => onGenerate("generate_all_variants")} className="w-full rounded-xl border border-violet-400/30 p-3 text-sm text-violet-200 disabled:opacity-40">Generar identificadores para todas las variantes</button></div><p className="mt-4 text-xs leading-5 text-white/35">Nunca se reemplaza un EAN comercial. Los códigos activos se reutilizan y no se regeneran.</p></div>
      <IdentifierRegistry identifiers={identifiers} spotId={data.spot.id} selectedId={selected?.id || ""} onSelect={setSelectedId} onUpdate={onUpdate} onReplace={replaceIdentifier} onDestination={updateQrDestination} busy={busy} />
    </div> : null}

    {subtab === "labels" ? <div className="grid gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
      <div className={`${CARD} p-5`}><p className="text-xs uppercase tracking-[.2em] text-violet-300">Configuración de impresión</p><div className="mt-4 space-y-3"><select className={INPUT} value={selected?.id || ""} onChange={(event) => setSelectedId(event.target.value)}><option value="">Identificador</option>{activeIdentifiers.map((identifier) => <option key={identifier.id} value={identifier.id}>{identifier.identifier_type.toUpperCase()} · {identifier.value}</option>)}</select><div className="grid grid-cols-2 gap-2"><select className={INPUT} value={labelOptions.layout} onChange={(event) => setLabel("layout", event.target.value as LabelOptions["layout"])}><option value="barcode">Solo barras</option><option value="qr">Solo QR</option><option value="combined">Barras + QR</option><option value="full">Etiqueta completa</option></select><select className={INPUT} value={labelOptions.size} onChange={(event) => setLabel("size", event.target.value as LabelOptions["size"])}><option value="30x20">30 × 20 mm</option><option value="40x30">40 × 30 mm</option><option value="50x30">50 × 30 mm</option></select><select className={INPUT} value={labelOptions.format} onChange={(event) => setLabel("format", event.target.value as LabelOptions["format"])}><option value="svg">SVG</option><option value="png">PNG</option><option value="pdf">PDF</option></select><select className={INPUT} value={labelOptions.page} onChange={(event) => setLabel("page", event.target.value as LabelOptions["page"])}><option value="label">Etiqueta individual</option><option value="a4">Hoja A4</option></select><input className={INPUT} type="number" min="1" max="200" value={labelOptions.copies} onChange={(event) => setLabel("copies", Math.max(1, Number(event.target.value) || 1))} placeholder="Copias" /><input className={INPUT} type="number" min="0" max="30" value={labelOptions.marginMm} onChange={(event) => setLabel("marginMm", Math.max(0, Number(event.target.value) || 0))} placeholder="Margen mm" /></div><div className="grid grid-cols-3 gap-2 text-xs">{([['showPrice', 'Precio'], ['showSku', 'SKU'], ['showQr', 'QR']] as const).map(([key, label]) => <label key={key} className="flex items-center gap-2 rounded-xl border border-white/10 p-2"><input type="checkbox" checked={labelOptions[key]} onChange={(event) => setLabel(key, event.target.checked)} />{label}</label>)}</div><button disabled={!selected} onClick={() => selected && onDownload(selected, labelOptions)} className="w-full rounded-xl border border-white/10 px-4 py-3 text-sm disabled:opacity-35">Descargar {labelOptions.format.toUpperCase()}</button><button disabled={!listing} onClick={() => onBatch({ ...labelOptions, format: "pdf", page: "a4" })} className="w-full rounded-xl border border-violet-400/25 px-4 py-3 text-sm text-violet-200 disabled:opacity-35">PDF A4 · todas las variantes</button><button disabled={!selected} onClick={() => selected && onDownload(selected, { ...labelOptions, format: "pdf" }, true)} className="w-full rounded-xl bg-violet-600 px-4 py-3 font-semibold disabled:opacity-35"><Printer className="mr-2 inline h-4 w-4" />Vista de impresión</button></div></div>
      <div className={`${CARD} grid min-h-[480px] place-items-center p-6`}><div className="w-full"><p className="text-center text-xs uppercase tracking-[.2em] text-white/35">Vista previa real</p>{previewUrl ? <img src={previewUrl} alt="Vista previa de etiqueta" className="mx-auto mt-5 max-h-[400px] max-w-full rounded-2xl bg-white p-5" /> : <p className="py-24 text-center text-white/35">Elegí un identificador activo.</p>}<p className="mt-4 text-center text-xs text-white/35">El PDF conserva {labelOptions.size.replace("x", " × ")} mm como medida física.</p></div></div>
    </div> : null}

    {subtab === "history" ? <div className={`${CARD} p-5`}><h2 className="font-semibold">Historial inmutable</h2><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="text-xs uppercase tracking-wider text-white/35"><tr><th className="pb-3">Fecha</th><th className="pb-3">Evento</th><th className="pb-3">Código</th><th className="pb-3">Estado</th><th className="pb-3">Detalle</th></tr></thead><tbody>{events.map((event) => { const identifier = identifiers.find((candidate) => candidate.id === event.identifier_id); return <tr key={event.id} className="border-t border-white/8"><td className="py-3">{when(event.created_at)}</td><td>{event.event_type.replaceAll("_", " ")}</td><td className="font-mono text-xs">{identifier?.value || event.identifier_id.slice(0, 8)}</td><td>{[event.from_status, event.to_status].filter(Boolean).join(" → ") || identifier?.status}</td><td className="max-w-xs truncate text-xs text-white/35">{event.metadata ? JSON.stringify(event.metadata) : "—"}</td></tr>; })}</tbody></table>{!events.length ? <p className="py-16 text-center text-white/35">Todavía no hay eventos para este producto.</p> : null}</div></div> : null}
  </div>;
}

function IdentifierRegistry({ identifiers, spotId, selectedId, onSelect, onUpdate, onReplace, onDestination, busy }: { identifiers: Identifier[]; spotId: string; selectedId: string; onSelect: (id: string) => void; onUpdate: (identifier: Identifier, action: "disable" | "replace" | "destination") => void; onReplace: (identifier: Identifier) => void; onDestination: (identifier: Identifier) => void; busy: boolean }) {
  return <div className={`${CARD} p-5`}><div className="flex items-center justify-between"><h2 className="font-semibold">Códigos existentes</h2><span className="rounded-full border border-white/10 px-2 py-1 text-xs">{identifiers.length}</span></div><div className="mt-4 space-y-3">{identifiers.map((identifier) => { const editable = identifier.spot_id === spotId; return <article key={identifier.id} onClick={() => onSelect(identifier.id)} className={`rounded-2xl border p-4 ${selectedId === identifier.id ? "border-violet-400/50 bg-violet-500/[0.06]" : "border-white/10 bg-white/[0.02]"}`}><div className="flex items-start justify-between gap-3"><div>{identifier.identifier_type === "clouva_qr" ? <QrCode className="h-7 w-7 text-violet-300" /> : <Barcode className="h-7 w-7 text-violet-300" />}<p className="mt-2 text-xs uppercase tracking-wider text-white/45">{identifier.identifier_type.replaceAll("_", " ")}</p></div><div className="text-right"><span className={`rounded-full border px-2 py-1 text-[10px] ${identifier.status === "active" ? "border-emerald-400/25 text-emerald-200" : "border-white/10 text-white/35"}`}>{identifier.status.toUpperCase()}</span>{identifier.is_primary ? <p className="mt-2 text-[10px] text-violet-300">PRINCIPAL</p> : null}</div></div><p className="mt-3 break-all font-mono text-xs text-white/70">{identifier.value}</p><div className="mt-3 grid grid-cols-2 gap-2 text-xs text-white/35"><span>Origen: {identifier.origin}</span><span>Creado: {when(identifier.created_at)}</span></div>{identifier.status === "active" && editable ? <div className="mt-4 flex flex-wrap gap-2"><button disabled={busy} onClick={(event) => { event.stopPropagation(); onUpdate(identifier, "disable"); }} className="rounded-lg border border-white/10 px-3 py-2 text-xs">Desactivar</button><button disabled={busy} onClick={(event) => { event.stopPropagation(); onReplace(identifier); }} className="rounded-lg border border-white/10 px-3 py-2 text-xs">Reemplazar</button>{identifier.identifier_type === "clouva_qr" ? <button disabled={busy} onClick={(event) => { event.stopPropagation(); onDestination(identifier); }} className="rounded-lg border border-violet-400/25 px-3 py-2 text-xs text-violet-200">Cambiar destino</button> : null}</div> : identifier.status === "active" ? <p className="mt-3 text-xs text-white/35">Identificador global administrado en su Spot de origen.</p> : null}</article>; })}{!identifiers.length ? <p className="py-16 text-center text-white/35">El producto todavía no tiene identificadores.</p> : null}</div></div>;
}

function SettingsPanel({ data, onRefreshFx, busy }: { data: Overview; onRefreshFx: () => void; busy: boolean }) { return <div className="grid gap-4 lg:grid-cols-2"><div className={`${CARD} p-5`}><p className="text-xs uppercase tracking-[.2em] text-violet-300">Spot</p><dl className="mt-4 space-y-3 text-sm"><Row label="Nombre" value={data.spot.name} /><Row label="Moneda" value={data.spot.currency} /><Row label="Estado" value={data.spot.status} /><Row label="Fuente FX" value={data.spot.fx_source} /><Row label="Ubicación" value={data.locations[0]?.name || "Sin ubicación"} /></dl></div><div className={`${CARD} p-5`}><p className="text-xs uppercase tracking-[.2em] text-violet-300">Cotización oficial</p><p className="mt-4 text-3xl font-semibold">{data.summary.fx_rate ? money(data.summary.fx_rate.local_per_quote, data.spot.currency) : "Sin snapshot"}</p><p className="mt-2 text-sm text-white/40">{data.summary.fx_rate ? `Guardada ${when(data.summary.fx_rate.quoted_at)}` : "Actualizala antes de la primera venta."}</p><button disabled={busy} onClick={onRefreshFx} className="mt-5 rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold"><RefreshCw className="mr-2 inline h-4 w-4" />Actualizar desde BCRA</button></div></div>; }
function Row({ label, value }: { label: string; value: string }) { return <div className="flex justify-between gap-4 border-b border-white/8 pb-3"><dt className="text-white/35">{label}</dt><dd>{value}</dd></div>; }
