"use client";

import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Barcode,
  BadgeDollarSign,
  Boxes,
  Camera,
  ChartNoAxesCombined,
  CheckCircle2,
  CircleDollarSign,
  CircleGauge,
  ClipboardList,
  ExternalLink,
  Flashlight,
  History,
  ImagePlus,
  LoaderCircle,
  Megaphone,
  PackagePlus,
  Printer,
  QrCode,
  RefreshCw,
  ScanLine,
  Settings,
  Share2,
  ShoppingCart,
  Sparkles,
  Store,
  TrendingUp,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { IScannerControls } from "@zxing/browser";
import { useAuth } from "@/components/auth-provider";
import { AccountMenu } from "@/components/account/AccountMenu";
import { CatalogProductActions } from "@/components/commerce/CatalogProductActions";
import { CommerceBulkProductImport } from "@/components/commerce/CommerceBulkProductImport";
import {
  buildSpotSku,
  detectCommerceIdentifierType,
  type CommerceIdentifierType,
} from "@/lib/commerce/identifiers";
import type { CommerceProductRecognition } from "@/lib/commerce/product-recognition";
import {
  MAX_PRODUCT_DETAIL_IMAGES,
  MAX_PRODUCT_REFERENCE_IMAGES,
  orderProductCaptures,
  type ProductCaptureLabel,
} from "@/lib/commerce/product-capture-contract";

type Tab = "dashboard" | "scanner" | "catalog" | "inventory" | "sales" | "orders" | "codes" | "settings";
type Listing = {
  id: string;
  catalog_product_id: string | null;
  product_type: string;
  listing_kind: string;
  name: string;
  slug: string;
  description: string | null;
  price: number;
  cost_amount: number | null;
  currency: string;
  stock: number | null;
  status: string;
  cover_url: string | null;
  gallery?: unknown;
  metadata: Record<string, unknown> | null;
  updated_at?: string | null;
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
type ProductCapture = {
  id: string;
  label: ProductCaptureLabel;
  dataUrl: string;
};
type DraftRecognition = {
  listingId: string;
  draftKey: string;
  status: "draft";
  stage: "incomplete";
  identifier: { value: string; type: CommerceIdentifierType };
  externalIdentifierPending: boolean;
  sourcePhotos: StoredProductSource[];
  missing: string[];
};
type RecognitionResult = {
  recognition: CommerceProductRecognition;
  provider: "google_vertex_ai";
  model: string;
  analyzedAt: string;
  draft?: DraftRecognition;
};
type GeneratedProductImageKind = "front_catalog" | "back_catalog" | "detail_catalog";
type StoredProductSource = {
  label: ProductCapture["label"];
  detailIndex: number | null;
  displayLabel: string;
  url: string;
  storagePath: string;
  mimeType: string;
};
type GeneratedProductImage = {
  kind: GeneratedProductImageKind;
  sourceLabel: ProductCapture["label"];
  detailIndex: number | null;
  url: string;
  storagePath: string;
  mimeType: string;
  model: string;
};
type ProductImagesResult = {
  provider: "google_vertex_ai";
  model: string;
  sourcePhotos: StoredProductSource[];
  generatedImages: GeneratedProductImage[];
  coverImage: string | null;
  generatedAt: string;
  listingId?: string | null;
  persisted?: boolean;
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
const CARD = "rounded-[20px] border border-white/[0.065] bg-[linear-gradient(180deg,rgba(13,11,20,.92),rgba(8,7,13,.94))] shadow-[0_16px_44px_rgba(0,0,0,.16)]";
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
const reviewedCaptureIds = new Set<string>();

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

function getFrontCapture(captures: ProductCapture[]) {
  return captures.find((capture) => capture.label === "Frente") ?? null;
}

function getBackCapture(captures: ProductCapture[]) {
  return captures.find((capture) => capture.label === "Atrás") ?? null;
}

function getDetailCaptures(captures: ProductCapture[]) {
  return captures.filter((capture) => capture.label === "Detalle");
}

function productCaptureDisplayLabels(captures: ProductCapture[]) {
  let detailIndex = 0;
  return orderProductCaptures(captures).map((capture) => capture.label === "Detalle" ? `Detalle ${++detailIndex}` : capture.label);
}

function productReferenceSummary(captures: ProductCapture[]) {
  const detailCount = getDetailCaptures(captures).length;
  const parts = [
    getFrontCapture(captures) ? "Frente" : null,
    getBackCapture(captures) ? "Atrás" : null,
    detailCount ? `${detailCount} ${detailCount === 1 ? "detalle" : "detalles"}` : null,
  ].filter(Boolean);
  return parts.length ? `Vertex AI usará ${parts.join(" + ")}.` : "Agregá el Frente para empezar.";
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function listingLifecycle(listing: Listing) {
  return jsonRecord(jsonRecord(listing.metadata).draft_lifecycle);
}

function listingDraftFields(listing: Listing) {
  return jsonRecord(jsonRecord(listing.metadata).draft_fields);
}

function listingProductImages(listing: Listing) {
  return jsonRecord(jsonRecord(listing.metadata).product_images);
}

function listingMissing(listing: Listing) {
  return stringList(listingLifecycle(listing).missing);
}

function storedSourcesFromListing(listing: Listing): StoredProductSource[] {
  const images = listingProductImages(listing);
  return (Array.isArray(images.source_photos) ? images.source_photos : []).flatMap((raw) => {
    const item = jsonRecord(raw);
    const url = typeof item.url === "string" ? item.url : "";
    const storagePath = typeof item.storage_path === "string" ? item.storage_path : "";
    const displayLabel = typeof item.display_label === "string" ? item.display_label : "";
    const label: ProductCaptureLabel = item.label === "Atrás" || displayLabel === "Atrás"
      ? "Atrás"
      : item.label === "Detalle" || (displayLabel && displayLabel !== "Frente")
        ? "Detalle"
        : "Frente";
    if (!url || !storagePath) return [];
    return [{
      label,
      detailIndex: typeof item.detail_index === "number" ? item.detail_index : null,
      displayLabel: displayLabel || label,
      url,
      storagePath,
      mimeType: typeof item.mime_type === "string" ? item.mime_type : "image/jpeg",
    } satisfies StoredProductSource];
  });
}

function generatedImagesFromListing(listing: Listing): GeneratedProductImage[] {
  const images = listingProductImages(listing);
  return (Array.isArray(images.generated_images) ? images.generated_images : []).flatMap((raw) => {
    const item = jsonRecord(raw);
    const url = typeof item.url === "string" ? item.url : "";
    const storagePath = typeof item.storage_path === "string" ? item.storage_path : "";
    if (!url || !storagePath) return [];
    const kind = item.kind === "back_catalog" ? "back_catalog" : item.kind === "detail_catalog" ? "detail_catalog" : "front_catalog";
    return [{
      kind,
      sourceLabel: item.source_label === "Atrás" || item.source_label === "Detalle" ? item.source_label : "Frente",
      detailIndex: typeof item.detail_index === "number" ? item.detail_index : null,
      url,
      storagePath,
      mimeType: typeof item.mime_type === "string" ? item.mime_type : "image/jpeg",
      model: typeof item.model === "string" ? item.model : "",
    } satisfies GeneratedProductImage];
  });
}

function restoredRecognition(listing: Listing): RecognitionResult | null {
  const raw = jsonRecord(jsonRecord(listing.metadata).recognition);
  if (!Object.keys(raw).length) return null;
  const confidenceRaw = jsonRecord(raw.confidence);
  const recognition: CommerceProductRecognition = {
    detectedObject: typeof raw.detected_object === "string" ? raw.detected_object : "",
    name: typeof raw.name === "string" ? raw.name : listing.name,
    brand: typeof raw.brand === "string" ? raw.brand : "",
    category: typeof raw.category === "string" ? raw.category : "",
    description: typeof raw.description === "string" ? raw.description : listing.description ?? "",
    productKind: ["physical", "avatar_item", "bundle", "digital"].includes(String(raw.product_kind))
      ? raw.product_kind as CommerceProductRecognition["productKind"]
      : "physical",
    listingKind: ["resale", "owned_design", "avatar", "combo"].includes(String(raw.listing_kind))
      ? raw.listing_kind as CommerceProductRecognition["listingKind"]
      : "resale",
    size: typeof raw.size === "string" ? raw.size : "",
    color: typeof raw.color === "string" ? raw.color : "",
    presentation: typeof raw.presentation === "string" ? raw.presentation : "",
    identifier: null,
    visibleText: stringList(raw.visible_text),
    uncertainFields: stringList(raw.uncertain_fields),
    confidence: {
      overall: Number(confidenceRaw.overall || 0),
      identity: Number(confidenceRaw.identity || 0),
      variant: Number(confidenceRaw.variant || 0),
      identifier: Number(confidenceRaw.identifier || 0),
    },
  };
  return {
    recognition,
    provider: "google_vertex_ai",
    model: typeof raw.model === "string" ? raw.model : "",
    analyzedAt: typeof raw.analyzed_at === "string" ? raw.analyzed_at : listing.updated_at || new Date().toISOString(),
  };
}

function cameraDisplayLabel(camera: MediaDeviceInfo, index: number) {
  const raw = camera.label.toLowerCase();
  if (/(back|rear|environment|trasera|posterior)/.test(raw)) return "Cámara trasera";
  if (/(front|user|frontal)/.test(raw)) return "Cámara frontal";
  if (/(external|usb|externa)/.test(raw)) return "Cámara externa";
  return `Cámara ${index + 1}`;
}

function imageToJpegDataUrl(source: CanvasImageSource, width: number, height: number) {
  const maxSide = 1440;
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No se pudo preparar la foto.");
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.84);
}

async function compressProductImage(file: File) {
  if (!file.type.startsWith("image/")) throw new Error("Elegí una imagen del producto.");
  const bitmap = await createImageBitmap(file);
  try {
    return imageToJpegDataUrl(bitmap, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
}

export function SpotCommerceDashboard({
  studioId,
  businessSpaceId,
  directSpotId,
}: {
  studioId: string;
  businessSpaceId?: string | null;
  directSpotId?: string | null;
}) {
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
  const [singleScannerOpen, setSingleScannerOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [cameraId, setCameraId] = useState("");
  const [torch, setTorch] = useState(false);
  const [productCaptures, setProductCaptures] = useState<ProductCapture[]>([]);
  const [recognizingProduct, setRecognizingProduct] = useState(false);
  const [recognitionResult, setRecognitionResult] = useState<RecognitionResult | null>(null);
  const [generatingProductImages, setGeneratingProductImages] = useState(false);
  const [productImagesResult, setProductImagesResult] = useState<ProductImagesResult | null>(null);
  const [selectedCoverImage, setSelectedCoverImage] = useState("");
  const [draftListingId, setDraftListingId] = useState("");
  const [draftSaveState, setDraftSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const draftKeyRef = useRef(crypto.randomUUID());
  const [creation, setCreation] = useState({ name: "", brand: "", category: "", description: "", productKind: "physical", listingKind: "resale", cost: "", price: "", stock: "", status: "draft", size: "", color: "", presentation: "" });
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

  useEffect(() => {
    if (!draftListingId || !creation.name.trim() || recognizingProduct || generatingProductImages) return;
    setDraftSaveState("saving");
    let disposed = false;
    const timer = window.setTimeout(() => {
      void authFetch(`/api/studios/${encodeURIComponent(studioId)}/commerce/products/update`, {
        method: "POST",
        body: JSON.stringify({
          listingId: draftListingId,
          name: creation.name,
          description: creation.description,
          brand: creation.brand,
          category: creation.category,
          productKind: creation.productKind,
          listingKind: creation.listingKind,
          size: creation.size,
          color: creation.color,
          presentation: creation.presentation,
          price: creation.price,
          costAmount: creation.cost,
          stock: creation.stock,
          status: "draft",
          autosave: true,
          coverUrlCandidate: selectedCoverImage || null,
        }),
      }).then(() => {
        if (!disposed) setDraftSaveState("saved");
      }).catch(() => {
        if (!disposed) setDraftSaveState("idle");
      });
    }, 900);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [
    authFetch,
    creation.brand,
    creation.category,
    creation.color,
    creation.cost,
    creation.description,
    creation.listingKind,
    creation.name,
    creation.presentation,
    creation.price,
    creation.productKind,
    creation.size,
    creation.stock,
    draftListingId,
    generatingProductImages,
    recognizingProduct,
    selectedCoverImage,
    studioId,
  ]);

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

  const processCode = useCallback(async (raw: string, requestedType?: CommerceIdentifierType) => {
    const code = raw.trim();
    if (!code) return;
    const now = Date.now();
    if (lastScanRef.current.value === code && now - lastScanRef.current.at < 2200) return;
    lastScanRef.current = { value: code, at: now };
    const identifierType = requestedType ?? detectCommerceIdentifierType(code);
    setManualCode(code);
    setScanType(identifierType);
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const payload = await authFetch(`/api/studios/${encodeURIComponent(studioId)}/commerce/scan?code=${encodeURIComponent(code)}&type=${encodeURIComponent(identifierType)}`);
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

  function invalidateProductAiResults() {
    setRecognitionResult(null);
    setProductImagesResult(null);
    setSelectedCoverImage("");
  }

  function removeProductCapture(captureId: string) {
    const removed = productCaptures.find((capture) => capture.id === captureId);
    setProductCaptures((current) => current.filter((capture) => capture.id !== captureId));
    invalidateProductAiResults();
    setMessage(removed?.label === "Detalle"
      ? "Detalle eliminado. Volvé a analizar o generar para usar el conjunto actualizado."
      : `${removed?.label || "Vista"} eliminada. Volvé a analizar el producto.`);
  }

  function captureProductPhoto(label: ProductCapture["label"]) {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
      setError("Abrí la cámara y enfocá el producto antes de capturar.");
      return;
    }
    const detailCount = getDetailCaptures(productCaptures).length;
    if (label === "Detalle" && detailCount >= MAX_PRODUCT_DETAIL_IMAGES) {
      setError(`Podés cargar hasta ${MAX_PRODUCT_DETAIL_IMAGES} imágenes de Detalle.`);
      return;
    }
    try {
      const dataUrl = imageToJpegDataUrl(video, video.videoWidth, video.videoHeight);
      const capture = { id: crypto.randomUUID(), label, dataUrl };
      setProductCaptures((current) => {
        if (label === "Detalle") {
          if (getDetailCaptures(current).length >= MAX_PRODUCT_DETAIL_IMAGES) return current;
          return orderProductCaptures([...current, capture]);
        }
        return orderProductCaptures([...current.filter((item) => item.label !== label), capture]);
      });
      invalidateProductAiResults();
      if (label === "Detalle") {
        const nextCount = Math.min(MAX_PRODUCT_DETAIL_IMAGES, detailCount + 1);
        setMessage(`Detalle agregado. ${nextCount} ${nextCount === 1 ? "detalle listo" : "detalles listos"} para Vertex AI.`);
      } else if (label === "Frente") {
        setMessage("Frente capturado. Ahora podés sumar Atrás y todos los Detalles que necesites.");
      } else {
        setMessage("Atrás capturado. Podés seguir agregando Detalles para darle más contexto a Vertex AI.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo capturar la foto.");
    }
  }

  async function uploadProductPhotos(files: FileList | null) {
    const incoming = Array.from(files ?? []);
    if (!incoming.length) return;
    const frontMissing = !getFrontCapture(productCaptures);
    const backMissing = !getBackCapture(productCaptures);
    const existingDetails = getDetailCaptures(productCaptures).length;
    const detailSlots = Math.max(0, MAX_PRODUCT_DETAIL_IMAGES - existingDetails);
    const capacity = (frontMissing ? 1 : 0) + (frontMissing && backMissing ? 1 : 0) + detailSlots;
    const selected = incoming.slice(0, Math.min(capacity, MAX_PRODUCT_REFERENCE_IMAGES));
    if (!selected.length) {
      setError(`Ya alcanzaste el límite de ${MAX_PRODUCT_DETAIL_IMAGES} imágenes de Detalle.`);
      return;
    }
    setError(null);
    try {
      const compressed = await Promise.all(selected.map(compressProductImage));
      setProductCaptures((current) => {
        let next = [...current];
        let cursor = 0;
        const needsFront = !getFrontCapture(next);
        if (needsFront && compressed[cursor]) {
          next = [...next.filter((item) => item.label !== "Frente"), { id: crypto.randomUUID(), label: "Frente" as const, dataUrl: compressed[cursor++] }];
        }
        if (needsFront && !getBackCapture(next) && compressed[cursor]) {
          next = [...next.filter((item) => item.label !== "Atrás"), { id: crypto.randomUUID(), label: "Atrás" as const, dataUrl: compressed[cursor++] }];
        }
        const room = Math.max(0, MAX_PRODUCT_DETAIL_IMAGES - getDetailCaptures(next).length);
        const details = compressed.slice(cursor, cursor + room).map((dataUrl) => ({ id: crypto.randomUUID(), label: "Detalle" as const, dataUrl }));
        return orderProductCaptures([...next, ...details]);
      });
      invalidateProductAiResults();
      const assignedBaseViews = frontMissing ? Math.min(backMissing ? 2 : 1, compressed.length) : 0;
      const addedDetails = Math.max(0, compressed.length - assignedBaseViews);
      const nextDetailCount = Math.min(MAX_PRODUCT_DETAIL_IMAGES, existingDetails + addedDetails);
      setMessage(addedDetails > 0
        ? `${nextDetailCount} ${nextDetailCount === 1 ? "detalle listo" : "detalles listos"} para Vertex AI. Las referencias nuevas invalidaron el análisis anterior.`
        : `${compressed.length} ${compressed.length === 1 ? "vista cargada" : "vistas cargadas"}. Ya podés analizar el producto.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudieron preparar las fotos.");
    }
  }

  async function analyzeProductWithGemini() {
    if (!data) {
      setError("Todavía estamos cargando los datos del Spot.");
      return;
    }
    if (!getFrontCapture(productCaptures)) {
      setError("Capturá el Frente del producto antes de analizarlo con Vertex AI.");
      return;
    }
    const orderedCaptures = orderProductCaptures(productCaptures);
    setRecognizingProduct(true);
    setError(null);
    setMessage(null);
    try {
      const payload = await authFetch(`/api/studios/${encodeURIComponent(studioId)}/commerce/recognize`, {
        method: "POST",
        body: JSON.stringify({
          images: orderedCaptures.map(({ label, dataUrl }) => ({ label, dataUrl })),
          identifier: manualCode.trim() || null,
          identifierType: manualCode.trim() ? scanType : null,
          draftListingId: draftListingId || null,
          draftKey: draftKeyRef.current,
        }),
      }) as RecognitionResult;
      const recognized = payload.recognition;
      const recognizedName = recognized.name || recognized.detectedObject;
      setRecognitionResult(payload);
      setCreation((current) => ({
        ...current,
        name: recognizedName || current.name,
        brand: recognized.brand || current.brand,
        category: recognized.category || current.category,
        description: recognized.description || current.description,
        productKind: recognized.productKind || current.productKind,
        listingKind: recognized.listingKind || current.listingKind,
        size: recognized.size || current.size,
        color: recognized.color || current.color,
        presentation: recognized.presentation || current.presentation,
        status: "draft",
      }));

      const draft = payload.draft;
      if (draft) {
        setDraftListingId(draft.listingId);
        draftKeyRef.current = draft.draftKey;
        setManualCode(draft.identifier.value);
        setScanType(draft.identifier.type);
        setScanResult({ exists: false });
        const sourceCover = draft.sourcePhotos.find((photo) => photo.label === "Frente")?.url || "";
        setProductImagesResult((current) => ({
          provider: "google_vertex_ai",
          model: payload.model,
          sourcePhotos: draft.sourcePhotos,
          generatedImages: current?.generatedImages ?? [],
          coverImage: current?.coverImage || sourceCover || null,
          generatedAt: current?.generatedAt || payload.analyzedAt,
          listingId: draft.listingId,
          persisted: true,
        }));
        setSelectedCoverImage((current) => current || sourceCover);
        setDraftSaveState("saved");
      }

      const completedFields = [
        recognizedName,
        recognized.brand,
        recognized.category,
        recognized.description,
        recognized.size,
        recognized.color,
        recognized.presentation,
      ].filter(Boolean).length;
      const identifierMessage = draft?.externalIdentifierPending
        ? " No encontró un código comercial seguro: quedó usando un SKU interno CLOUVA y podés agregar el barcode después."
        : draft?.identifier
          ? ` Código confirmado: ${draft.identifier.type.replaceAll("_", " ").toUpperCase()}.`
          : "";
      setMessage(`Google Cloud Vertex AI identificó ${recognized.detectedObject || recognizedName} y completó ${completedFields} campos. Borrador guardado.${identifierMessage}`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Vertex AI no pudo analizar el producto.");
    } finally {
      setRecognizingProduct(false);
    }
  }

  async function generateProductImagesWithGemini(options?: { quiet?: boolean }) {
    if (!data) {
      setError("Todavía estamos cargando los datos del Spot.");
      return null;
    }
    if (!productCaptures.some((capture) => capture.label === "Frente")) {
      setError("Capturá el Frente del producto antes de generar imágenes de catálogo.");
      return null;
    }
    const orderedCaptures = orderProductCaptures(productCaptures);
    setGeneratingProductImages(true);
    setError(null);
    if (!options?.quiet) setMessage(null);
    try {
      const payload = await authFetch(`/api/studios/${encodeURIComponent(studioId)}/commerce/product-images`, {
        method: "POST",
        body: JSON.stringify({
          captures: orderedCaptures.map(({ label, dataUrl }) => ({ label, dataUrl })),
          listingId: draftListingId || null,
          productDraft: {
            name: creation.name,
            brand: creation.brand,
            category: creation.category,
            description: creation.description,
            color: creation.color,
            size: creation.size,
            presentation: creation.presentation,
          },
          identifier: manualCode.trim() ? { value: manualCode.trim(), type: scanType } : null,
        }),
      }) as ProductImagesResult;
      setProductImagesResult(payload);
      if (payload.listingId) setDraftListingId(payload.listingId);
      const preferredCover = payload.coverImage || payload.generatedImages[0]?.url || "";
      setSelectedCoverImage(preferredCover);
      setDraftSaveState(payload.persisted ? "saved" : "idle");
      if (payload.persisted) await load();
      if (!options?.quiet) {
        setMessage(`Google Cloud Vertex AI generó ${payload.generatedImages.length} ${payload.generatedImages.length === 1 ? "imagen" : "imágenes"} de catálogo. ${payload.persisted ? "Quedaron guardadas en el borrador." : "Guardá el borrador para conservarlas asociadas al producto."}`);
      }
      return payload;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Vertex AI no pudo generar las imágenes del producto.");
      return null;
    } finally {
      setGeneratingProductImages(false);
    }
  }

  function resumeDraft(listing: Listing) {
    const fields = listingDraftFields(listing);
    const images = listingProductImages(listing);
    const sources = storedSourcesFromListing(listing);
    const generated = generatedImagesFromListing(listing);
    const recognition = restoredRecognition(listing);
    setDraftListingId(listing.id);
    setCreation({
      name: listing.name,
      brand: typeof fields.brand === "string" ? fields.brand : "",
      category: typeof fields.category === "string" ? fields.category : "",
      description: listing.description ?? "",
      productKind: typeof fields.product_kind === "string" ? fields.product_kind : listing.product_type,
      listingKind: typeof fields.listing_kind === "string" ? fields.listing_kind : listing.listing_kind,
      cost: listing.cost_amount == null || Number(listing.cost_amount) === 0 ? "" : String(listing.cost_amount),
      price: Number(listing.price || 0) > 0 ? String(listing.price) : "",
      stock: listing.stock == null ? "" : String(listing.stock),
      status: "draft",
      size: typeof fields.size === "string" ? fields.size : "",
      color: typeof fields.color === "string" ? fields.color : "",
      presentation: typeof fields.presentation === "string" ? fields.presentation : "",
    });
    setRecognitionResult(recognition);
    setProductCaptures([]);
    setProductImagesResult(sources.length || generated.length ? {
      provider: "google_vertex_ai",
      model: typeof images.model === "string" ? images.model : "",
      sourcePhotos: sources,
      generatedImages: generated,
      coverImage: typeof images.cover_image === "string" ? images.cover_image : listing.cover_url,
      generatedAt: typeof images.generated_at === "string" ? images.generated_at : listing.updated_at || new Date().toISOString(),
      listingId: listing.id,
      persisted: true,
    } : null);
    setSelectedCoverImage(listing.cover_url || "");
    const identifier = data?.identifiers.find((item) => item.catalog_product_id === listing.catalog_product_id && item.status === "active");
    setManualCode(identifier?.value || "");
    if (identifier) setScanType(identifier.identifier_type);
    setScanResult({ exists: false });
    setDraftSaveState("saved");
    setMessage(`${listing.name} recuperado. Podés seguir completándolo.`);
    setError(null);
  }

  function newProductDraft() {
    draftKeyRef.current = crypto.randomUUID();
    setDraftListingId("");
    setDraftSaveState("idle");
    setProductCaptures([]);
    setRecognitionResult(null);
    setProductImagesResult(null);
    setSelectedCoverImage("");
    setManualCode("");
    setScanType("code_128");
    setScanResult(null);
    setCreation({ name: "", brand: "", category: "", description: "", productKind: "physical", listingKind: "resale", cost: "", price: "", stock: "", status: "draft", size: "", color: "", presentation: "" });
    setMessage("Nuevo producto listo para escanear.");
    setError(null);
  }

  async function addDraftReferenceImage(file: File | undefined, label: "Atrás" | "Detalle" | "Código de barras") {
    if (!file || !draftListingId) return;
    setBusy(true);
    setError(null);
    try {
      const dataUrl = await compressProductImage(file);
      await authFetch(`/api/studios/${encodeURIComponent(studioId)}/commerce/products/images`, {
        method: "POST",
        body: JSON.stringify({
          action: "add_reference",
          listingId: draftListingId,
          dataUrl,
          label,
        }),
      });
      setDraftSaveState("saved");
      setMessage(`${label} guardado en el mismo borrador.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo guardar la referencia.");
    } finally {
      setBusy(false);
    }
  }

  async function detectBarcodePhoto(file: File | undefined) {
    if (!file || !draftListingId) return;
    setBusy(true);
    setError(null);
    try {
      let code = "";
      const Detector = (window as typeof window & { BarcodeDetector?: NativeBarcodeDetectorConstructor }).BarcodeDetector;
      if (Detector) {
        const bitmap = await createImageBitmap(file);
        try {
          const detector = new Detector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "qr_code"] });
          const found = await detector.detect(bitmap);
          code = found[0]?.rawValue?.trim() || "";
        } finally {
          bitmap.close();
        }
      }
      if (!code) {
        const dataUrl = await compressProductImage(file);
        const image = document.createElement("img");
        image.src = dataUrl;
        await new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () => reject(new Error("No se pudo leer la foto del código."));
        });
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        const reader = new BrowserMultiFormatReader();
        const result = await reader.decodeFromImageElement(image);
        code = result?.getText()?.trim() || "";
      }
      if (!code) throw new Error("No se detectó un código legible. Podés escanearlo con cámara o ingresarlo manualmente.");

      const identifierType = detectCommerceIdentifierType(code);
      const origin: Identifier["origin"] = ["ean_13", "ean_8", "upc_a", "upc_e"].includes(identifierType) ? "manufacturer" : "manual";
      await authFetch(`/api/studios/${encodeURIComponent(studioId)}/commerce/codes`, {
        method: "POST",
        body: JSON.stringify({
          action: "attach",
          listingId: draftListingId,
          variantId: null,
          code,
          identifierType,
          origin,
        }),
      });
      await addDraftReferenceImage(file, "Código de barras");
      setManualCode(code);
      setScanType(identifierType);
      setCodeDraft({ listingId: draftListingId, variantId: "" });
      setDraftSaveState("saved");
      setMessage(`Código ${identifierType.replaceAll("_", " ").toUpperCase()} leído y asociado al mismo producto.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo leer el código de la foto.");
    } finally {
      setBusy(false);
    }
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
    if (!creation.name.trim()) {
      setError("Confirmá el nombre del producto.");
      return;
    }
    if (creation.status === "published" && !(Number(creation.price) > 0)) {
      setError("Confirmá el precio antes de publicar. El borrador puede guardarse sin precio.");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (draftListingId) {
        const payload = await authFetch(`/api/studios/${encodeURIComponent(studioId)}/commerce/products/update`, {
          method: "POST",
          body: JSON.stringify({
            listingId: draftListingId,
            name: creation.name,
            description: creation.description,
            brand: creation.brand,
            category: creation.category,
            productKind: creation.productKind,
            listingKind: creation.listingKind,
            size: creation.size,
            color: creation.color,
            presentation: creation.presentation,
            price: creation.price,
            costAmount: creation.cost,
            stock: creation.stock,
            status: creation.status,
            coverUrlCandidate: selectedCoverImage || null,
          }),
        });
        setDraftSaveState("saved");
        setMessage(creation.status === "published"
          ? `${creation.name} quedó publicado.`
          : `${creation.name} quedó guardado como borrador. Podés salir y continuarlo después.`);
        await load();
        return payload;
      }

      const fallbackCode = manualCode.trim() || buildSpotSku({
        spotSlug: data?.spot.slug || "spot",
        productName: creation.name,
        color: creation.color,
        size: creation.size,
        suffix: draftKeyRef.current.slice(0, 6),
      });
      const fallbackType = manualCode.trim() ? scanType : "sku";
      setManualCode(fallbackCode);
      setScanType(fallbackType);
      const hasVariant = Boolean(creation.size || creation.color || creation.presentation);
      const payload = await authFetch(`/api/studios/${encodeURIComponent(studioId)}/commerce/scan`, {
        method: "POST",
        body: JSON.stringify({
          code: fallbackCode,
          identifierType: fallbackType,
          product: {
            product_kind: creation.productKind,
            name: creation.name,
            brand: creation.brand,
            category: creation.category,
            description: creation.description,
            metadata: recognitionResult ? { recognition: {
              source: "google_cloud_product_recognition",
              provider: recognitionResult.provider,
              model: recognitionResult.model,
              analyzed_at: recognitionResult.analyzedAt,
            } } : {},
          },
          listing: {
            listing_kind: creation.listingKind,
            cost: creation.cost || "",
            price: creation.price || 0,
            initial_stock: creation.stock || 0,
            status: creation.status,
            cover_url: selectedCoverImage || null,
            gallery: selectedCoverImage ? [selectedCoverImage] : [],
          },
          variant: hasVariant ? {
            size: creation.size,
            color: creation.color,
            presentation: creation.presentation,
          } : {},
          idempotencyKey: `scan-ui:${data?.spot.id}:${draftKeyRef.current}`,
        }),
      });
      const result = payload.result as ScanResult;
      setScanResult(result);
      if (result.listing?.id) setDraftListingId(result.listing.id);
      setDraftSaveState("saved");
      setMessage(`${creation.name} quedó guardado en ${data?.spot.name}.`);
      await load();
      return payload;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo guardar el producto.");
      return null;
    } finally {
      setBusy(false);
    }
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
  const frontCapture = getFrontCapture(productCaptures);
  const backCapture = getBackCapture(productCaptures);
  const detailCaptures = getDetailCaptures(productCaptures);
  const referenceSummary = productReferenceSummary(productCaptures);
  const draftListings = data.listings.filter((listing) => listing.status === "draft");
  const activeDraft = draftListingId ? data.listings.find((listing) => listing.id === draftListingId) ?? null : null;
  const activeDraftMissing = activeDraft ? listingMissing(activeDraft) : [];
  const activeDraftSources = activeDraft ? storedSourcesFromListing(activeDraft) : [];
  const activeDraftGenerated = activeDraft ? generatedImagesFromListing(activeDraft) : [];
  const activeDraftIdentifiers = activeDraft
    ? data.identifiers.filter((identifier) => identifier.catalog_product_id === activeDraft.catalog_product_id && identifier.status === "active")
    : [];
  const hasExternalIdentifier = activeDraftIdentifiers.some((identifier) => !["sku", "clouva_barcode", "clouva_qr"].includes(identifier.identifier_type));

  return (
    <main className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_48%_-18%,rgba(105,46,196,.16),transparent_34%),radial-gradient(circle_at_96%_26%,rgba(76,29,149,.08),transparent_24%),#050507] text-white">
      <div className="pointer-events-none fixed inset-0 opacity-[.075] [background-image:linear-gradient(rgba(139,92,246,.15)_1px,transparent_1px),linear-gradient(90deg,rgba(139,92,246,.15)_1px,transparent_1px)] [background-size:56px_56px] [mask-image:linear-gradient(to_bottom,black,transparent_82%)]" />
      <header className="sticky top-0 z-40 border-b border-white/[0.065] bg-[#050507]/92 shadow-[0_10px_32px_rgba(0,0,0,.18)] backdrop-blur-2xl">
        <div className="mx-auto flex max-w-[1540px] items-center justify-between gap-3 px-3 py-2.5 sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="relative grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-[14px] border border-violet-400/20 bg-[radial-gradient(circle_at_50%_18%,rgba(168,85,247,.23),rgba(76,29,149,.07))] shadow-[0_0_24px_rgba(124,58,237,.12)]">
              <Store className="h-[18px] w-[18px] text-violet-200" />
              <span className="absolute bottom-1 right-1 h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_7px_#34d399]" />
            </div>
            <div className="min-w-0">
              <p className="text-[9px] font-bold uppercase tracking-[.17em] text-violet-300/70">Mi Spot · Centro operativo</p>
              <div className="mt-0.5 flex min-w-0 items-center gap-2">
                <h1 className="truncate text-sm font-bold tracking-[-.01em] sm:text-[15px]">{data.spot.name}</h1>
                <span className="hidden rounded-full border border-emerald-400/18 bg-emerald-400/[0.08] px-2 py-0.5 text-[8px] font-bold uppercase tracking-wider text-emerald-300 sm:inline">Activo</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2">
            <button type="button" onClick={() => setTab("scanner")} className="flex h-9 items-center gap-2 rounded-[11px] border border-cyan-300/20 bg-cyan-400/[0.06] px-2.5 text-[11px] font-semibold text-cyan-100 transition hover:border-cyan-300/40 hover:bg-cyan-400/[0.10] sm:px-3">
              <ScanLine className="h-3.5 w-3.5" /><span className="hidden sm:inline">Scanner</span>
            </button>
            {businessSpaceId ? (
              <Link href={`/businesses/${businessSpaceId}/publicador`} className="hidden h-9 items-center gap-2 rounded-[11px] border border-blue-400/18 bg-blue-500/[0.05] px-3 text-[11px] font-semibold text-blue-100 transition hover:border-blue-400/35 xl:flex">
                <Share2 className="h-3.5 w-3.5" /> Publicador
              </Link>
            ) : directSpotId ? (
              <Link href={`/mi-spot/${directSpotId}/publicaciones`} className="hidden h-9 items-center gap-2 rounded-[11px] border border-white/[0.08] bg-white/[0.025] px-3 text-[11px] font-semibold text-white/60 transition hover:border-violet-400/25 hover:text-white xl:flex">
                <Megaphone className="h-3.5 w-3.5" /> Publicaciones
              </Link>
            ) : null}
            <button type="button" onClick={() => setTab("sales")} className="flex h-9 items-center gap-2 rounded-[11px] bg-violet-600 px-3 text-[11px] font-bold shadow-[0_8px_22px_rgba(124,58,237,.24)] transition hover:bg-violet-500">
              <ShoppingCart className="h-3.5 w-3.5" /><span className="hidden sm:inline">Nueva venta</span>
            </button>
            <Link href={`/studios/${data.studio.slug}/tienda`} aria-label="Ver tienda" className="grid h-9 w-9 place-items-center rounded-[11px] border border-white/[0.08] bg-white/[0.025] text-white/55 transition hover:border-violet-400/25 hover:text-white">
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
            <AccountMenu preferUsername />
          </div>
        </div>
      </header>

      <div className="relative mx-auto grid max-w-[1540px] gap-3 p-3 sm:p-4 lg:grid-cols-[205px_minmax(0,1fr)]">
        <aside className={`${CARD} flex gap-1 overflow-x-auto p-2 lg:sticky lg:top-[68px] lg:h-[calc(100vh-84px)] lg:flex-col lg:p-2.5`}>
          <p className="hidden px-3 pb-2 pt-1 text-[10px] font-bold uppercase tracking-[.18em] text-white/35 lg:block">Administración</p>
          {NAV.map((item) => { const Icon = item.icon; return <button key={item.id} type="button" onClick={() => setTab(item.id)} className={`group relative flex shrink-0 items-center gap-2.5 overflow-hidden rounded-[11px] px-3 py-2.5 text-left text-[13px] transition ${tab === item.id ? "border border-violet-400/20 bg-violet-500/[0.13] text-white shadow-[inset_0_1px_0_rgba(255,255,255,.04),0_8px_24px_rgba(109,40,217,.10)]" : "border border-transparent text-white/50 hover:border-white/[0.05] hover:bg-white/[0.035] hover:text-white"}`}>{tab === item.id ? <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-violet-300 shadow-[0_0_8px_rgba(196,181,253,.75)]" /> : null}<Icon className={`h-4 w-4 ${tab === item.id ? "text-white" : "text-white/35 transition group-hover:text-violet-300"}`} />{item.label}</button>; })}
          <div className="mt-auto hidden space-y-3 lg:block">
            <Link href="/clouva-ai" className="group flex items-center gap-3 rounded-2xl border border-violet-400/20 bg-[radial-gradient(circle_at_0%_0%,rgba(139,92,246,.18),transparent_60%),rgba(255,255,255,.025)] p-3 transition hover:border-violet-400/40">
              <div className="grid h-10 w-10 shrink-0 place-items-center"><Image src="/assets/clouva-ai/trebol-mascot.png" alt="Trébol CLOUVA AI" width={48} height={48} className="drop-shadow-[0_0_12px_rgba(168,85,247,.55)]" /></div>
              <div className="min-w-0 flex-1"><p className="text-xs font-semibold text-white/75">Trébol AI</p><p className="mt-1 text-[9px] text-white/30">Ayuda para tu Spot</p></div><ArrowUpRight className="h-3.5 w-3.5 text-violet-300/60 transition group-hover:text-violet-200" />
            </Link>
            <div className="border-t border-white/[0.08] px-2 pt-3 text-[10px] leading-5 text-white/30">◎ 1 Flow = USD 1<br />Cotización: {data.summary.fx_rate ? `${money(data.summary.fx_rate.local_per_quote)} / USD` : "sin actualizar"}</div>
          </div>
        </aside>

        <section className="min-w-0 space-y-3">
          {error ? <div className="flex items-start justify-between gap-3 rounded-xl border border-red-400/25 bg-red-400/10 p-3 text-sm text-red-100"><span>{error}</span><button onClick={() => setError(null)}><X className="h-4 w-4" /></button></div> : null}
          {message ? <div className="flex items-start justify-between gap-3 rounded-xl border border-emerald-400/25 bg-emerald-400/10 p-3 text-sm text-emerald-100"><span>{message}</span><button onClick={() => setMessage(null)}><X className="h-4 w-4" /></button></div> : null}

          {tab === "dashboard" ? <SpotDashboard data={data} goal={goal} goalProgress={goalProgress} busy={busy} onNavigate={setTab} onRefreshFx={() => void refreshFx()} /> : null}

          {tab === "scanner" ? <div className="space-y-4">
            <CommerceBulkProductImport studioId={studioId} onCompleted={load} />
            <button
              type="button"
              onClick={() => {
                if (singleScannerOpen) stopScanner();
                setSingleScannerOpen((current) => !current);
              }}
              className={`${CARD} flex w-full items-center justify-between gap-3 p-3 text-left transition hover:border-violet-400/25 sm:p-4`}
            >
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-semibold"><ScanLine className="h-4 w-4 text-violet-300" /> Escaneo individual</p>
                <p className="mt-1 truncate text-[10px] text-white/40 sm:text-xs">Cámara, reconocimiento IA, código manual y borradores.</p>
              </div>
              <span className="shrink-0 rounded-lg border border-white/10 px-2.5 py-1.5 text-[10px] font-semibold text-white/55">
                {singleScannerOpen ? "Cerrar" : "Abrir"}
              </span>
            </button>
            {singleScannerOpen ? <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
            <div className={`${CARD} min-w-0 overflow-hidden`}>
              <div className="flex flex-col gap-3 border-b border-white/10 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><h1 className="text-lg font-semibold leading-tight sm:text-xl">Escanear código o producto</h1><p className="mt-1 text-xs leading-5 text-white/45 sm:text-sm">EAN, UPC, Code 128, QR y reconocimiento visual con Google Cloud Vertex AI</p></div><div className="flex w-full shrink-0 gap-2 sm:w-auto"><button type="button" aria-label="Linterna" onClick={() => void toggleTorch()} disabled={!scanning} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-white/10 disabled:opacity-30"><Flashlight className={`h-5 w-5 ${torch ? "text-amber-300" : ""}`} /></button><button type="button" onClick={scanning ? stopScanner : () => void startScanner()} className="min-h-11 flex-1 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold sm:flex-none">{scanning ? "Detener" : "Abrir cámara"}</button></div></div>
              <div data-commerce-scanner-camera className="relative aspect-[16/10] min-h-[188px] max-h-[340px] overflow-hidden bg-black sm:aspect-[16/9] sm:min-h-[260px] sm:max-h-[520px] xl:aspect-[4/3] xl:max-h-none"><video ref={videoRef} muted playsInline className="h-full w-full object-cover" /><div className="pointer-events-none absolute inset-[14%] rounded-3xl border-2 border-violet-400 shadow-[0_0_0_999px_rgba(0,0,0,.42),0_0_35px_rgba(139,92,246,.45)]"><div className="absolute left-3 right-3 top-1/2 h-px bg-gradient-to-r from-transparent via-violet-300 to-transparent shadow-[0_0_15px_#c4b5fd]" /></div>{!scanning ? <div className="absolute inset-0 grid place-items-center px-5 text-center"><div><Camera className="mx-auto h-9 w-9 text-white/35" /><p className="mt-3 max-w-xs text-xs leading-5 text-white/55 sm:text-sm">Abrí la cámara para leer el código o fotografiar el producto</p></div></div> : null}</div>
              <div className="grid gap-2.5 p-3 sm:grid-cols-[1fr_auto] sm:p-4">{cameras.length > 1 ? <select aria-label="Seleccionar cámara" className={INPUT} value={cameraId} onChange={(event) => setCameraId(event.target.value)}>{cameras.map((camera, index) => <option key={camera.deviceId} value={camera.deviceId}>{cameraDisplayLabel(camera, index)}</option>)}</select> : <div className="text-xs leading-5 text-white/50 sm:text-sm">La cámara prioriza el lente trasero.</div>}{cameraId && scanning ? <button type="button" onClick={() => void startScanner()} className="min-h-10 rounded-xl border border-white/10 px-4 py-2 text-sm">Cambiar</button> : null}</div>
              {cameraError ? <p className="mx-3 mb-3 rounded-xl border border-amber-400/20 bg-amber-400/10 p-3 text-sm text-amber-100 sm:mx-4 sm:mb-4">{cameraError}</p> : null}
              <section className="border-t border-white/[0.08] bg-[radial-gradient(circle_at_0%_0%,rgba(124,58,237,.12),transparent_48%)] p-3 sm:p-4">
                <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[.15em] text-violet-300 sm:text-xs sm:tracking-[.18em]"><Sparkles className="h-4 w-4 shrink-0" /> Escanear producto con IA</p><p className="mt-2 text-[11px] leading-5 text-white/50 sm:text-xs">Frente obligatorio · Atrás opcional · hasta {MAX_PRODUCT_DETAIL_IMAGES} detalles. Revisá cada foto y confirmala antes de seguir.</p></div><span className="shrink-0 rounded-full border border-violet-400/20 bg-violet-500/10 px-2 py-1 text-[9px] font-bold text-violet-200">VERTEX AI</span></div>
                <div className="mt-3 grid grid-cols-3 gap-1.5 sm:mt-4 sm:gap-2">
                  <div className={`min-w-0 rounded-xl border px-2.5 py-2 ${frontCapture ? "border-emerald-400/25 bg-emerald-400/[0.07]" : "border-amber-400/20 bg-amber-400/[0.04]"}`}><div className="flex items-center justify-between gap-1"><span className="truncate text-[10px] font-semibold">Frente</span>{frontCapture ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-300" /> : null}</div><p className={`mt-1 truncate text-[9px] ${frontCapture ? "text-emerald-200/75" : "text-amber-200/65"}`}>{frontCapture ? "Capturado" : "Obligatorio"}</p></div>
                  <div className={`min-w-0 rounded-xl border px-2.5 py-2 ${backCapture ? "border-emerald-400/25 bg-emerald-400/[0.07]" : "border-white/10 bg-white/[0.02]"}`}><div className="flex items-center justify-between gap-1"><span className="truncate text-[10px] font-semibold">Atrás</span>{backCapture ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-300" /> : null}</div><p className={`mt-1 truncate text-[9px] ${backCapture ? "text-emerald-200/75" : "text-white/45"}`}>{backCapture ? "Capturado" : "Opcional"}</p></div>
                  <div className={`min-w-0 rounded-xl border px-2.5 py-2 ${detailCaptures.length ? "border-violet-400/25 bg-violet-400/[0.07]" : "border-white/10 bg-white/[0.02]"}`}><div className="flex items-center justify-between gap-1"><span className="truncate text-[10px] font-semibold">Detalles</span><span className="shrink-0 text-[9px] font-semibold text-violet-200">{detailCaptures.length}/{MAX_PRODUCT_DETAIL_IMAGES}</span></div><p className="mt-1 truncate text-[9px] text-white/45">Opcionales</p></div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <button type="button" disabled={!scanning} onClick={() => captureProductPhoto("Frente")} className="min-h-10 rounded-xl border border-white/10 px-2.5 py-2 text-xs transition hover:border-violet-400/25 disabled:cursor-not-allowed disabled:opacity-35"><Camera className="mr-1.5 inline h-3.5 w-3.5" />Frente</button>
                  <button type="button" disabled={!scanning} onClick={() => captureProductPhoto("Atrás")} className="min-h-10 rounded-xl border border-white/10 px-2.5 py-2 text-xs transition hover:border-violet-400/25 disabled:cursor-not-allowed disabled:opacity-35"><Camera className="mr-1.5 inline h-3.5 w-3.5" />Atrás</button>
                  <button type="button" disabled={!scanning || detailCaptures.length >= MAX_PRODUCT_DETAIL_IMAGES} onClick={() => captureProductPhoto("Detalle")} className="min-h-10 rounded-xl border border-white/10 px-2.5 py-2 text-xs transition hover:border-violet-400/25 disabled:cursor-not-allowed disabled:opacity-35"><Camera className="mr-1.5 inline h-3.5 w-3.5" />Detalle</button>
                  <label className="flex min-h-10 cursor-pointer items-center justify-center rounded-xl border border-white/10 px-2.5 py-2 text-center text-xs transition hover:border-violet-400/25"><ImagePlus className="mr-1.5 inline h-3.5 w-3.5" />{frontCapture ? "Subir detalles" : "Subir"}<input type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={(event) => { void uploadProductPhotos(event.currentTarget.files); event.currentTarget.value = ""; }} /></label>
                </div>
                <p className="mt-3 rounded-xl border border-violet-400/10 bg-violet-500/[0.04] px-3 py-2 text-[10px] leading-4 text-violet-100/70">{referenceSummary}</p>
                {frontCapture || backCapture ? <div className="mt-3 grid grid-cols-2 gap-2">{frontCapture ? <ProductCapturePreview key={frontCapture.id} capture={frontCapture} label="Frente" onRemove={() => removeProductCapture(frontCapture.id)} /> : <div className="grid min-h-[72px] place-items-center rounded-xl border border-dashed border-amber-400/20 px-2 text-center text-[10px] text-amber-200/55">Falta Frente</div>}{backCapture ? <ProductCapturePreview key={backCapture.id} capture={backCapture} label="Atrás" onRemove={() => removeProductCapture(backCapture.id)} /> : <div className="grid min-h-[72px] place-items-center rounded-xl border border-dashed border-white/10 px-2 text-center text-[10px] text-white/40">Atrás opcional</div>}</div> : null}
                {detailCaptures.length ? <div className="mt-3 rounded-2xl border border-white/[0.07] bg-black/20 p-2.5 sm:mt-4 sm:p-3"><div className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-[.16em] text-violet-300">Detalles del objeto</p><p className="mt-1 truncate text-[9px] text-white/45">Podés borrar cualquiera individualmente.</p></div><span className="shrink-0 rounded-full border border-violet-400/20 px-2 py-1 text-[9px] text-violet-200">{detailCaptures.length}</span></div><div className="mt-2.5 grid grid-cols-3 gap-2 sm:grid-cols-4">{detailCaptures.map((capture, index) => <ProductCapturePreview key={capture.id} capture={capture} label={`Detalle ${index + 1}`} onRemove={() => removeProductCapture(capture.id)} />)}</div></div> : null}
                <button type="button" disabled={recognizingProduct || !frontCapture} onClick={() => void analyzeProductWithGemini()} className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 px-4 py-3 text-sm font-semibold shadow-[0_10px_28px_rgba(124,58,237,.22)] disabled:cursor-not-allowed disabled:opacity-40">{recognizingProduct ? <><LoaderCircle className="h-4 w-4 animate-spin" />Analizando producto…</> : <><Sparkles className="h-4 w-4" />Analizar y completar datos</>}</button>
                <button type="button" disabled={generatingProductImages || !recognitionResult || !frontCapture} onClick={() => void generateProductImagesWithGemini()} className="mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-violet-400/30 bg-violet-500/[0.08] px-4 py-2.5 text-sm font-semibold text-violet-100 transition hover:bg-violet-500/[0.14] disabled:cursor-not-allowed disabled:opacity-35">{generatingProductImages ? <><LoaderCircle className="h-4 w-4 animate-spin" />Generando imágenes de catálogo…</> : <><ImagePlus className="h-4 w-4" />Generar imágenes del producto</>}</button>
                {productImagesResult ? <div className="mt-4 rounded-2xl border border-violet-400/20 bg-black/20 p-3"><div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-violet-300">Imágenes de catálogo</p><p className="mt-1 text-[10px] text-white/45">Elegí cuál será la portada del producto.</p></div><span className="rounded-full border border-violet-400/20 px-2 py-1 text-[9px] text-violet-200">{productImagesResult.generatedImages.length} VERTEX AI</span></div><div className="mt-3 grid grid-cols-3 gap-2">{productImagesResult.generatedImages.map((image) => { const selected = selectedCoverImage === image.url; return <button type="button" key={`${image.kind}-${image.url}`} onClick={() => setSelectedCoverImage(image.url)} className={`relative overflow-hidden rounded-xl border text-left ${selected ? "border-violet-300 shadow-[0_0_20px_rgba(139,92,246,.25)]" : "border-white/10"}`}><img src={image.url} alt={image.sourceLabel} className="aspect-square w-full object-cover" /><span className="absolute bottom-1.5 left-1.5 rounded-md bg-black/80 px-1.5 py-1 text-[9px]">{image.sourceLabel}{image.detailIndex ? ` ${image.detailIndex}` : ""}</span>{selected ? <span className="absolute right-1.5 top-1.5 rounded-md bg-violet-600 px-1.5 py-1 text-[8px] font-bold uppercase tracking-wider">Portada</span> : null}</button>; })}</div><p className="mt-3 text-[10px] text-white/45">Originales guardados: {productImagesResult.sourcePhotos.map((photo) => photo.displayLabel).join(" · ")}</p></div> : null}
              </section>
            </div>
            <div className="min-w-0 space-y-4">
              {draftListings.length ? <div className={`${CARD} p-4`}>
                <div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-violet-300">Borradores / incompletos</p><p className="mt-1 text-xs text-white/45">Salí cuando quieras y continuá desde acá.</p></div><button type="button" onClick={newProductDraft} className="rounded-lg border border-white/10 px-2.5 py-2 text-[10px] font-semibold text-white/60">Nuevo</button></div>
                <div className="mt-3 space-y-2">{draftListings.slice(0, 6).map((listing) => { const missing = listingMissing(listing); return <button type="button" key={listing.id} onClick={() => resumeDraft(listing)} className={`flex w-full items-center gap-3 rounded-xl border p-2.5 text-left transition ${draftListingId === listing.id ? "border-violet-400/40 bg-violet-500/10" : "border-white/8 bg-black/20 hover:border-violet-400/25"}`}>{listing.cover_url ? <img src={listing.cover_url} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" /> : <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-violet-500/10"><PackagePlus className="h-4 w-4 text-violet-300" /></span>}<span className="min-w-0 flex-1"><strong className="block truncate text-xs">{listing.name}</strong><small className="mt-1 block truncate text-[9px] text-white/35">{missing.length ? `${missing.length} pendientes · ${missing.slice(0, 2).join(" · ")}` : "Listo para revisar"} · {when(listing.updated_at)}</small></span><span className="text-[9px] font-semibold text-violet-200">Continuar</span></button>; })}</div>
              </div> : null}
              {draftListingId ? <div className={`${CARD} border-violet-400/20 p-4`}>
                <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-violet-300">Completar producto</p><p className="mt-1 text-sm font-semibold">{creation.name || "Borrador persistente"}</p></div><span className={`rounded-full border px-2 py-1 text-[9px] font-semibold ${draftSaveState === "saving" ? "border-amber-400/25 text-amber-200" : "border-emerald-400/25 text-emerald-200"}`}>{draftSaveState === "saving" ? "Guardando…" : "Guardado"}</span></div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-[10px]">
                  <DraftCheck ok={Boolean(activeDraftSources.some((photo) => photo.label === "Frente")) || Boolean(productImagesResult?.sourcePhotos.some((photo) => photo.label === "Frente")) || Boolean(frontCapture)} label="Foto frontal" />
                  <DraftCheck ok={Boolean(recognitionResult)} label="Producto identificado" />
                  <DraftCheck ok={Boolean(manualCode)} label="SKU / código interno" />
                  <DraftCheck ok={Boolean(activeDraftGenerated.length) || Boolean(productImagesResult?.generatedImages.length)} label="Imagen de catálogo" />
                  <DraftCheck ok={Boolean(activeDraftSources.some((photo) => photo.label === "Atrás")) || Boolean(productImagesResult?.sourcePhotos.some((photo) => photo.label === "Atrás")) || Boolean(backCapture)} label="Foto trasera" optional />
                  <DraftCheck ok={hasExternalIdentifier} label="Código comercial" optional />
                  <DraftCheck ok={Number(creation.price) > 0} label="Precio confirmado" />
                  <DraftCheck ok={creation.stock !== ""} label="Stock confirmado" />
                </div>
                {activeDraftMissing.length ? <p className="mt-3 text-[9px] leading-4 text-white/35">Pendientes persistidos: {activeDraftMissing.join(" · ")}</p> : null}
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <label className="flex min-h-10 cursor-pointer items-center justify-center rounded-xl border border-white/10 px-2.5 py-2 text-center text-[10px] font-semibold"><ImagePlus className="mr-1.5 h-3.5 w-3.5" />Agregar foto trasera<input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(event) => { void addDraftReferenceImage(event.currentTarget.files?.[0], "Atrás"); event.currentTarget.value = ""; }} /></label>
                  <label className="flex min-h-10 cursor-pointer items-center justify-center rounded-xl border border-white/10 px-2.5 py-2 text-center text-[10px] font-semibold"><Barcode className="mr-1.5 h-3.5 w-3.5" />Foto código de barras<input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(event) => { void detectBarcodePhoto(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} /></label>
                  <button type="button" onClick={() => { setCodeDraft({ listingId: draftListingId, variantId: "" }); setTab("codes"); }} className="col-span-2 min-h-10 rounded-xl border border-violet-400/25 bg-violet-500/[0.06] px-3 py-2 text-[10px] font-semibold text-violet-200">Agregar / administrar código de barras, QR o SKU</button>
                </div>
              </div> : null}
              {recognitionResult ? <RecognitionSummary result={recognitionResult} /> : null}
              <div className={`${CARD} p-4`}><p className="text-xs uppercase tracking-[.2em] text-white/45">Código detectado o Ingreso manual</p><div className="mt-3 flex gap-2"><input value={manualCode} onChange={(event) => { setManualCode(event.target.value); setScanType(detectCommerceIdentifierType(event.target.value)); }} onKeyDown={(event) => { if (event.key === "Enter") void processCode(manualCode); }} placeholder="Código de barras, SKU o QR" className={INPUT} /><button disabled={busy} onClick={() => void processCode(manualCode)} className="rounded-xl bg-violet-600 px-4"><ScanLine className="h-5 w-5" /></button></div><p className="mt-2 text-xs text-white/45">Detectado como {scanType.replaceAll("_", " ").toUpperCase()}</p></div>
              {scanResult?.listing ? <ScanExisting
                result={scanResult}
                onOpen={(listing, variant) => { setCodeDraft({ listingId: listing.id, variantId: variant?.id || "" }); setTab("catalog"); }}
                onSell={(listing, variant) => addToCart(listing, variant)}
                onStock={(listing, variant) => { setStockDraft((current) => ({ ...current, listingId: listing.id, variantId: variant?.id || "" })); setTab("inventory"); }}
                onPrint={(identifier) => void downloadLabel(identifier, DEFAULT_LABEL_OPTIONS, true)}
              /> : <CreateProductForm value={creation} onChange={setCreation} onSubmit={() => void createScannedProduct()} busy={busy} globalMatch={Boolean(scanResult?.catalog_product)} scannedCode={manualCode} scanType={scanType} onScan={() => void startScanner()} />}
            </div>
          </div> : null}
          </div> : null}

          {tab === "catalog" ? <Catalog data={data} studioId={studioId} onChanged={load} bundleDraft={bundleDraft} setBundleDraft={setBundleDraft} onSaveBundle={() => void saveBundle()} busy={busy} onSell={addToCart} onCodes={(listing, variant) => { setCodeDraft({ listingId: listing.id, variantId: variant?.id || "" }); setTab("codes"); }} /> : null}
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

function DraftCheck({ ok, label, optional = false }: { ok: boolean; label: string; optional?: boolean }) {
  return <div className={`flex items-center gap-2 rounded-xl border px-2.5 py-2 ${ok ? "border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-100" : "border-white/8 bg-black/20 text-white/45"}`}>
    {ok ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-300" /> : <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-white/20" />}
    <span className="truncate">{label}{optional && !ok ? " · opcional" : ""}</span>
  </div>;
}

function ProductCapturePreview({ capture, label, onRemove }: { capture: ProductCapture; label: string; onRemove: () => void }) {
  const [reviewing, setReviewing] = useState(() => !reviewedCaptureIds.has(capture.id));
  const accept = () => {
    reviewedCaptureIds.add(capture.id);
    setReviewing(false);
  };
  const reject = () => {
    reviewedCaptureIds.delete(capture.id);
    onRemove();
  };

  return <>
    <div data-commerce-capture-preview className="group relative min-w-0 overflow-hidden rounded-xl border border-emerald-400/20 bg-black">
      <img src={capture.dataUrl} alt={label} className="h-20 w-full object-cover sm:h-28" />
      <span className="absolute bottom-1.5 left-1.5 max-w-[calc(100%-2.5rem)] truncate rounded-md bg-black/80 px-1.5 py-1 text-[9px]">{label}</span>
      <span className="absolute left-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full border border-emerald-300/30 bg-emerald-500/90 text-white shadow-[0_0_16px_rgba(52,211,153,.25)]"><CheckCircle2 className="h-3.5 w-3.5" /></span>
      <button type="button" aria-label={`Repetir ${label}`} onClick={reject} className="absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-lg border border-red-300/20 bg-red-500/85 text-white transition hover:bg-red-500"><X className="h-4 w-4" /></button>
    </div>
    {reviewing ? <div className="fixed inset-0 z-[95] flex items-end justify-center bg-black/80 p-3 backdrop-blur-md sm:items-center sm:p-6">
      <div className="w-full max-w-lg overflow-hidden rounded-[1.5rem] border border-violet-300/25 bg-[#09070f] shadow-[0_24px_90px_rgba(0,0,0,.65)]">
        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div><p className="text-[10px] font-bold uppercase tracking-[.18em] text-violet-300">Revisar captura</p><p className="mt-1 text-sm font-semibold text-white">{label}</p></div>
          <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-semibold text-emerald-200">Foto tomada</span>
        </div>
        <div className="bg-black p-2 sm:p-3"><img src={capture.dataUrl} alt={`Vista previa ${label}`} className="mx-auto max-h-[58svh] w-full rounded-xl object-contain" /></div>
        <div className="p-3 sm:p-4">
          <p className="text-center text-xs text-white/55">¿La foto está bien? Confirmala o repetila antes de seguir.</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" onClick={reject} className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-red-400/25 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-100"><X className="h-4 w-4" />Repetir</button>
            <button type="button" onClick={accept} autoFocus className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 text-sm font-bold text-black shadow-[0_10px_28px_rgba(16,185,129,.2)]"><CheckCircle2 className="h-4 w-4" />Usar foto</button>
          </div>
        </div>
      </div>
    </div> : null}
  </>;
}

function SpotDashboard({ data, goal, goalProgress, busy, onNavigate, onRefreshFx }: {
  data: Overview;
  goal: Overview["summary"]["goal"];
  goalProgress: number;
  busy: boolean;
  onNavigate: (tab: Tab) => void;
  onRefreshFx: () => void;
}) {
  const variantProductIds = new Set(data.variants.map((variant) => variant.product_id));
  const stockTotal = data.variants.reduce((sum, variant) => sum + Math.max(0, Number(variant.stock || 0)), 0)
    + data.listings.filter((listing) => !variantProductIds.has(listing.id)).reduce((sum, listing) => sum + Math.max(0, Number(listing.stock || 0)), 0);
  const activeIdentifiers = data.identifiers.filter((identifier) => identifier.status === "active").length;
  const publishedProducts = data.listings.filter((listing) => listing.status === "published").length;
  const pendingOrders = data.orders.filter((order) => !["fulfilled", "completed", "cancelled"].includes(String(order.fulfillment_status || "").toLowerCase())).length;
  const target = Number(goal?.target_amount || 0);
  const generated = Number(goal?.progress_amount || 0);
  const remaining = Math.max(0, target - generated);
  const hasSales = Number(data.summary.gross_local || 0) > 0 || data.orders.length > 0;

  const quickActions: Array<{ label: string; detail: string; tab: Tab; icon: typeof Store; tone: string }> = [
    { label: "Nueva venta", detail: "Abrir caja", tab: "sales", icon: ShoppingCart, tone: "from-violet-600/55 to-fuchsia-500/12 text-violet-100" },
    { label: "Escanear", detail: "Buscar o crear", tab: "scanner", icon: ScanLine, tone: "from-cyan-500/15 to-cyan-500/0 text-cyan-200" },
    { label: "Cargar stock", detail: "Actualizar inventario", tab: "inventory", icon: PackagePlus, tone: "from-emerald-500/15 to-emerald-500/0 text-emerald-200" },
    { label: "Crear etiquetas", detail: "QR y barras", tab: "codes", icon: Printer, tone: "from-fuchsia-500/15 to-fuchsia-500/0 text-fuchsia-200" },
  ];

  return <div className="space-y-4">
    <section className="relative overflow-hidden rounded-[22px] border border-violet-400/12 bg-[linear-gradient(118deg,rgba(76,29,149,.20),rgba(11,9,18,.90)_48%,rgba(13,9,22,.94))] p-4 shadow-[0_18px_58px_rgba(50,18,91,.14)] sm:p-5">
      <div className="pointer-events-none absolute -right-20 -top-36 h-72 w-72 rounded-full bg-violet-600/12 blur-3xl" />
      <div className="pointer-events-none absolute bottom-0 right-[24%] h-20 w-48 bg-fuchsia-500/[0.07] blur-3xl" />
      <div className="relative grid items-center gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div>
          <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.19em] text-violet-300/85"><CircleGauge className="h-3.5 w-3.5" /> Centro operativo · {data.spot.name}</p>
          <h1 className="mt-2 max-w-2xl text-2xl font-bold tracking-[-.035em] sm:text-[30px]">{hasSales ? "Tu Spot está en movimiento." : "Todo listo para la primera venta."}</h1>
          <p className="mt-2 max-w-xl text-[13px] leading-5 text-white/52">{hasSales ? "Seguí ventas, stock, pedidos y crecimiento desde un solo lugar." : "Cargá un producto, asignale su código y vendelo desde la misma operación."}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={() => onNavigate("sales")} className="flex min-h-10 items-center gap-2 rounded-[11px] bg-white px-4 py-2 text-[11px] font-bold text-[#10091a] transition hover:bg-violet-100"><ShoppingCart className="h-3.5 w-3.5" /> Iniciar venta</button>
            <button type="button" onClick={() => onNavigate("scanner")} className="flex min-h-10 items-center gap-2 rounded-[11px] border border-white/[0.09] bg-white/[0.035] px-4 py-2 text-[11px] font-semibold text-white/72 transition hover:border-violet-400/30 hover:bg-violet-500/[0.06] hover:text-white"><ScanLine className="h-3.5 w-3.5 text-violet-300" /> Escanear producto</button>
          </div>
        </div>
        <div className="rounded-[18px] border border-white/[0.07] bg-black/18 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,.025)] backdrop-blur-sm">
          <div className="flex items-center justify-between"><span className="text-[10px] font-bold uppercase tracking-[.16em] text-white/38">Disponible</span><BadgeDollarSign className="h-4 w-4 text-emerald-300" /></div>
          <p className="mt-2 text-[28px] font-semibold tracking-tight">{money(data.summary.available_local, data.spot.currency)}</p>
          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-white/[0.07] pt-3"><div><p className="text-[10px] uppercase tracking-wider text-white/35">Neto en USD</p><p className="mt-1 text-[13px] font-semibold text-white/75">USD {decimal(data.summary.net_usd)}</p></div><div><p className="text-[10px] uppercase tracking-wider text-white/35">Saldo Flow</p><p className="mt-1 text-[13px] font-semibold text-violet-300">◎ {decimal(data.summary.flows)}</p></div></div>
        </div>
      </div>
    </section>

    <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-4">
      {quickActions.map(({ label, detail, tab, icon: Icon, tone }) => <button key={tab} type="button" onClick={() => onNavigate(tab)} className={`group flex min-h-[76px] items-center gap-3 rounded-[18px] border border-white/[0.065] bg-gradient-to-br ${tone} p-3.5 text-left shadow-[0_12px_28px_rgba(0,0,0,.12)] transition duration-200 hover:-translate-y-0.5 hover:border-white/[0.14] hover:shadow-[0_16px_34px_rgba(0,0,0,.18)]`}><span className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] border border-current/10 bg-black/18"><Icon className="h-[17px] w-[17px]" /></span><span className="min-w-0 flex-1"><strong className="block text-[13px] text-white/88">{label}</strong><small className="mt-1 hidden text-[10px] text-white/42 sm:block">{detail}</small></span><ArrowRight className="hidden h-3.5 w-3.5 text-white/28 transition group-hover:translate-x-0.5 group-hover:text-white/65 sm:block" /></button>)}
    </div>

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Metric label="Ventas brutas" value={money(data.summary.gross_local, data.spot.currency)} detail={`${data.orders.length} pedidos registrados`} icon={CircleDollarSign} />
      <Metric label="Ganancia neta" value={money(data.summary.net_local, data.spot.currency)} detail={`${money(data.summary.costs_local, data.spot.currency)} en costos`} icon={TrendingUp} positive />
      <Metric label="Stock disponible" value={`${decimal(stockTotal, 0)} unidades`} detail={`${publishedProducts} de ${data.listings.length} productos publicados`} icon={Boxes} />
      <Metric label="Identificadores" value={`${activeIdentifiers} activos`} detail="QR, EAN, UPC, SKU y Code 128" icon={QrCode} />
    </div>

    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className={`${CARD} relative overflow-hidden p-4 sm:p-5`}>
        <div className="pointer-events-none absolute right-0 top-0 h-40 w-40 rounded-full bg-violet-600/[0.055] blur-3xl" />
        <div className="relative grid items-center gap-4 sm:grid-cols-[minmax(0,1fr)_118px]">
          <div>
            <div className="flex items-center gap-2"><span className="rounded-full border border-violet-400/18 bg-violet-500/[0.08] px-2.5 py-1 text-[9px] font-bold uppercase tracking-[.16em] text-violet-300">Objetivo principal</span>{goalProgress >= 100 ? <CheckCircle2 className="h-4 w-4 text-emerald-300" /> : null}</div>
            <h2 className="mt-3 text-xl font-semibold tracking-tight sm:text-[26px]">{goal?.name || "Objetivo económico"}</h2>
            <p className="mt-1.5 text-[11px] leading-5 text-white/42">Cada venta confirmada actualiza el avance usando la cotización histórica guardada en ese pedido.</p>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/[0.055]"><div className="h-full rounded-full bg-gradient-to-r from-violet-600 via-fuchsia-500 to-pink-400 shadow-[0_0_14px_rgba(192,38,211,.30)] transition-[width] duration-700" style={{ width: `${goalProgress}%` }} /></div>
            <div className="mt-2.5 flex flex-wrap justify-between gap-2 text-[10px]"><span className="text-white/42">Generado <strong className="ml-1 text-white/78">USD {decimal(generated)}</strong></span><span className="text-white/42">Faltan <strong className="ml-1 text-violet-300">USD {decimal(remaining)}</strong></span></div>
          </div>
          <div className="mx-auto grid h-[104px] w-[104px] place-items-center rounded-full p-[7px] shadow-[0_0_34px_rgba(124,58,237,.11)]" style={{ background: `conic-gradient(#a855f7 ${goalProgress * 3.6}deg, rgba(255,255,255,.05) 0deg)` }}><div className="grid h-full w-full place-items-center rounded-full border border-white/[0.055] bg-[#0b0912]"><div className="text-center"><p className="text-xl font-bold">{goalProgress.toFixed(1)}%</p><span className="text-[8px] uppercase tracking-[.14em] text-white/35">Completado</span></div></div></div>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
        <section className={`${CARD} p-5`}><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[.18em] text-white/30">USD oficial</p><p className="mt-2 text-2xl font-semibold">{data.summary.fx_rate ? money(data.summary.fx_rate.local_per_quote, data.spot.currency) : "Sin datos"}</p><p className="mt-1 text-[9px] text-white/25">1 USD · fuente {data.spot.fx_source.replaceAll("_", " ")}</p></div><button type="button" disabled={busy} onClick={onRefreshFx} className="grid h-10 w-10 place-items-center rounded-xl border border-violet-400/20 bg-violet-500/[0.06] text-violet-300 transition hover:border-violet-400/40 disabled:opacity-40"><RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} /></button></div></section>
        <section className={`${CARD} p-5`}><div className="flex items-center justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[.18em] text-white/30">Operación</p><p className="mt-2 text-sm font-semibold text-white/75">{pendingOrders ? `${pendingOrders} pedidos por resolver` : "Todo al día"}</p></div><Activity className={`h-5 w-5 ${pendingOrders ? "text-amber-300" : "text-emerald-300"}`} /></div><button type="button" onClick={() => onNavigate("orders")} className="mt-4 flex items-center gap-2 text-[10px] font-semibold text-violet-300">Ver pedidos <ArrowRight className="h-3 w-3" /></button></section>
      </div>
    </div>

    <div className="grid gap-4 xl:grid-cols-2"><RecentMovements data={data} onNavigate={onNavigate} /><RecentOrders data={data} onNavigate={onNavigate} /></div>
  </div>;
}

function Metric({ label, value, detail, icon: Icon, positive = false }: { label: string; value: string; detail: string; icon: typeof Store; positive?: boolean }) {
  return <div className={`${CARD} group relative overflow-hidden p-3.5 transition duration-200 hover:border-violet-400/18 sm:p-4`}><div className="absolute right-0 top-0 h-20 w-20 rounded-full bg-violet-600/[0.035] blur-2xl transition group-hover:bg-violet-600/[0.075]" /><div className="relative flex items-center justify-between gap-3"><p className="text-[10px] font-bold uppercase tracking-[.15em] text-white/42">{label}</p><span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] border border-violet-400/10 bg-violet-500/[0.055]"><Icon className="h-3.5 w-3.5 text-violet-300" /></span></div><p className={`relative mt-2.5 text-[22px] font-semibold tracking-tight sm:text-[26px] ${positive ? "text-emerald-300" : "text-white/92"}`}>{value}</p><p className="relative mt-1.5 truncate text-[10px] text-white/38">{detail}</p></div>;
}

function RecentMovements({ data, onNavigate }: { data: Overview; onNavigate?: (tab: Tab) => void }) {
  return <section className={`${CARD} overflow-hidden`}><div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4"><div><p className="font-semibold">Movimientos recientes</p><p className="mt-1 text-[9px] text-white/25">Entradas y salidas de inventario</p></div>{onNavigate ? <button type="button" onClick={() => onNavigate("inventory")} className="text-[10px] font-semibold text-violet-300">Ver inventario</button> : null}</div><div className="space-y-2 p-4">{data.movements.slice(0, 7).map((movement) => <div key={String(movement.id)} className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-black/20 p-3 text-sm"><div className="flex items-center gap-3"><span className="grid h-8 w-8 place-items-center rounded-lg bg-white/[0.035]"><History className="h-3.5 w-3.5 text-violet-300" /></span><div><p className="text-xs capitalize text-white/70">{String(movement.movement_type).replaceAll("_", " ")}</p><p className="mt-1 text-[9px] text-white/25">{when(movement.created_at)}</p></div></div><span className={`text-xs font-semibold ${Number(movement.quantity_delta) > 0 ? "text-emerald-300" : "text-red-300"}`}>{Number(movement.quantity_delta) > 0 ? "+" : ""}{String(movement.quantity_delta)}</span></div>)}{!data.movements.length ? <EmptyDashboardState icon={Boxes} title="Sin movimientos todavía" detail="La primera carga de stock va a aparecer acá." action={onNavigate ? "Cargar inventario" : undefined} onClick={onNavigate ? () => onNavigate("inventory") : undefined} /> : null}</div></section>;
}

function RecentOrders({ data, onNavigate }: { data: Overview; onNavigate: (tab: Tab) => void }) {
  return <section className={`${CARD} overflow-hidden`}><div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4"><div><p className="font-semibold">Últimos pedidos</p><p className="mt-1 text-[9px] text-white/25">Ventas y estado de cobro</p></div><button type="button" onClick={() => onNavigate("orders")} className="text-[10px] font-semibold text-violet-300">Ver todos</button></div><div className="space-y-2 p-4">{data.orders.slice(0, 7).map((order) => <div key={String(order.id)} className="grid grid-cols-[1fr_auto] gap-3 rounded-xl border border-white/[0.06] bg-black/20 p-3 text-sm"><div className="flex items-center gap-3"><span className="grid h-8 w-8 place-items-center rounded-lg bg-white/[0.035]"><ClipboardList className="h-3.5 w-3.5 text-violet-300" /></span><div><p className="text-xs text-white/70">#{String(order.id).slice(0, 8)} · {String(order.sales_channel)}</p><p className="mt-1 text-[9px] text-white/25">{when(order.created_at)}</p></div></div><div className="text-right"><p className="text-xs font-semibold">{money(order.total, String(order.currency))}</p><p className="mt-1 text-[9px] text-emerald-300">{String(order.payment_status)}</p></div></div>)}{!data.orders.length ? <EmptyDashboardState icon={ShoppingCart} title="Todavía no hay ventas" detail="Abrí la caja y registrá la primera operación del Spot." action="Iniciar venta" onClick={() => onNavigate("sales")} /> : null}</div></section>;
}

function EmptyDashboardState({ icon: Icon, title, detail, action, onClick }: { icon: typeof Store; title: string; detail: string; action?: string; onClick?: () => void }) {
  return <div className="grid min-h-44 place-items-center rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.015] px-5 py-7 text-center"><div><span className="mx-auto grid h-11 w-11 place-items-center rounded-2xl border border-violet-400/15 bg-violet-500/[0.06]"><Icon className="h-4 w-4 text-violet-300" /></span><p className="mt-3 text-sm font-semibold text-white/65">{title}</p><p className="mx-auto mt-1 max-w-xs text-[10px] leading-5 text-white/25">{detail}</p>{action && onClick ? <button type="button" onClick={onClick} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-violet-400/20 px-3 py-2 text-[10px] font-semibold text-violet-300 transition hover:bg-violet-500/10">{action}<ArrowRight className="h-3 w-3" /></button> : null}</div></div>;
}

function RecognitionSummary({ result }: { result: RecognitionResult }) {
  const recognition = result.recognition;
  const confidence = Math.round(recognition.confidence.overall * 100);
  const facts = [recognition.brand, recognition.category, recognition.presentation, recognition.color, recognition.size].filter(Boolean);
  return <div className={`${CARD} overflow-hidden border-violet-400/20`}>
    <div className="flex items-start justify-between gap-3 border-b border-white/[0.08] bg-violet-500/[0.06] p-4"><div><p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.2em] text-violet-300"><Sparkles className="h-3.5 w-3.5" /> Datos completados por Google Cloud Vertex AI</p><h2 className="mt-2 text-lg font-semibold">{recognition.name || recognition.detectedObject}</h2><p className="mt-1 text-xs text-white/40">Objeto: {recognition.detectedObject || "producto físico"}</p></div><span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-semibold text-emerald-200">{confidence}%</span></div>
    <div className="p-4"><div className="flex flex-wrap gap-1.5">{facts.map((fact) => <span key={fact} className="rounded-lg border border-white/10 bg-white/[0.025] px-2 py-1 text-[10px] text-white/55">{fact}</span>)}</div>{recognition.visibleText.length ? <p className="mt-3 line-clamp-2 text-[10px] leading-5 text-white/30">Texto leído: {recognition.visibleText.join(" · ")}</p> : null}{recognition.uncertainFields.length ? <p className="mt-3 text-[10px] leading-5 text-amber-200/65">Revisar: {recognition.uncertainFields.join(", ")}</p> : null}<p className="mt-3 border-t border-white/[0.07] pt-3 text-[10px] leading-5 text-white/30">La propuesta ya está en el formulario y se puede corregir. Precio, costo y stock se confirman manualmente.</p></div>
  </div>;
}

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
    <div className="mt-4 grid gap-3 sm:grid-cols-2">{field("name", "Nombre")}{field("brand", "Marca")}{field("category", "Categoría")}<select className={INPUT} value={value.productKind} onChange={(event) => onChange((current) => ({ ...current, productKind: event.target.value }))}><option value="physical">Físico</option><option value="avatar_item">Prenda 3D</option><option value="bundle">Combo físico + 3D</option><option value="digital">Digital</option></select>{field("cost", "Costo", "number")}{field("price", "Precio", "number")}{field("stock", "Stock inicial", "number")}<select className={INPUT} value={value.status} onChange={(event) => onChange((current) => ({ ...current, status: event.target.value }))}><option value="draft">Borrador</option><option value="published">Publicado</option></select>{field("color", "Color")}{field("size", "Talle")}{field("presentation", "Presentación")}<select className={INPUT} value={value.listingKind} onChange={(event) => onChange((current) => ({ ...current, listingKind: event.target.value }))}><option value="resale">Reventa</option><option value="owned_design">Diseño propio</option><option value="avatar">Avatar 3D</option><option value="combo">Combo</option></select><textarea className={`${INPUT} sm:col-span-2`} value={value.description} placeholder="Descripción" onChange={(event) => onChange((current) => ({ ...current, description: event.target.value }))} /></div><button disabled={busy} onClick={onSubmit} className="mt-4 w-full rounded-xl bg-violet-600 px-4 py-3 font-semibold disabled:opacity-50">{busy ? "Guardando…" : value.status === "published" ? "Publicar producto" : "Guardar borrador"}</button>
  </div>;
}

type BundleDraft = { bundleListingId: string; physicalSelection: string; digitalSelection: string };

function Catalog({ data, studioId, onChanged, bundleDraft, setBundleDraft, onSaveBundle, busy, onSell, onCodes }: { data: Overview; studioId: string; onChanged: () => void | Promise<void>; bundleDraft: BundleDraft; setBundleDraft: React.Dispatch<React.SetStateAction<BundleDraft>>; onSaveBundle: () => void; busy: boolean; onSell: (listing: Listing, variant?: Variant | null) => void; onCodes: (listing: Listing, variant?: Variant | null) => void }) {
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
        <CatalogProductActions studioId={studioId} listing={listing} onChanged={onChanged} />
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

    {subtab === "scan" ? <div className={`${CARD} p-6 text-center`}><ScanLine className="mx-auto h-10 w-10 text-violet-300" /><h2 className="mt-3 text-xl font-semibold">Escaneá el código o el producto completo</h2><p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-white/45">EAN/UPC, SKU, Code 128 y QR consultan el catálogo canónico. También podés fotografiar Frente, Atrás y Detalle para que Google Cloud Vertex AI reconozca el objeto y complete automáticamente su ficha.</p><button onClick={onScan} className="mt-5 rounded-xl bg-violet-600 px-5 py-3 font-semibold">Abrir escáner de código o producto</button></div> : null}

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
