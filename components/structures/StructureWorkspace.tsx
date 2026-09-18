"use client";

import Link from "next/link";
import {
  Box,
  Camera,
  Check,
  Crosshair,
  ChevronLeft,
  Cloud,
  Download,
  FileArchive,
  Image as ImageIcon,
  Loader2,
  Map as MapIcon,
  MapPin,
  Move,
  Play,
  RefreshCw,
  Save,
  ScanLine,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";
import {
  computeEvidenceCoverage,
  cornerEvidence,
  type StructureCameraNodeRecord,
  type StructureImageRecord,
  type StructureRecord,
  type StructureRuleRecord,
  type StructureSpatialFeatureRecord,
  type StructureSurfaceRecord,
} from "@/lib/structures/spatial";
import { StructureScene } from "@/components/structures/StructureScene";
import { StructureSatelliteMap, type SpatialEditMode } from "@/components/structures/StructureSatelliteMap";
import { PlanEditor } from "@/components/structures/PlanEditor";

type Tab = "project" | "images" | "spatial" | "plan" | "export" | "render";
type Corner = "NE" | "SE" | "SO" | "NO";
type RenderView = "front" | "corner" | "environment" | "aerial_oblique";

type RenderOutput = {
  id: string;
  job_id: string;
  structure_id: string;
  view_key: RenderView;
  public_url: string;
  storage_path: string;
  mime_type: string;
  reference_image_ids: string[];
  created_at: string;
};

type WorkspacePayload = {
  structure: StructureRecord;
  images: StructureImageRecord[];
  surfaces: StructureSurfaceRecord[];
  cameraNodes: StructureCameraNodeRecord[];
  rules: StructureRuleRecord[];
  renderJobs: Array<Record<string, unknown>>;
  renderOutputs: RenderOutput[];
  imageSurfaceLinks: Array<Record<string, unknown>>;
  spatialFeatures: StructureSpatialFeatureRecord[];
};

const TABS: Array<{ id: Tab; label: string; icon: typeof Box }> = [
  { id: "project", label: "Proyecto", icon: Box },
  { id: "images", label: "Imágenes", icon: ImageIcon },
  { id: "spatial", label: "3D espacial", icon: ScanLine },
  { id: "plan", label: "Plano", icon: MapIcon },
  { id: "export", label: "ZIP", icon: FileArchive },
  { id: "render", label: "Render CLOUD", icon: Cloud },
];

const RENDER_LABELS: Record<RenderView, string> = {
  front: "01 · Frente",
  corner: "02 · Esquina",
  environment: "03 · Entorno",
  aerial_oblique: "04 · Aérea oblicua",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Borrador",
  uploading: "Subiendo",
  analyzing: "Analizando",
  spatializing: "Ubicando",
  review: "Revisar",
  ready: "Listo",
  rendering: "Renderizando",
  completed: "Completo",
};

function tabHref(structureId: string, tab: Tab) {
  if (tab === "project") return `/structures/${structureId}`;
  return `/structures/${structureId}/${tab === "images" ? "images" : tab}`;
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function placementLabel(image: StructureImageRecord) {
  if (image.manual_verified || image.spatial_source === "manual") return "verificado manual";
  if (image.placement_status === "needs_review") return "revisar IA";
  if (image.placement_status === "blocked") return "sin ubicar";
  if (image.placement_status === "placed") {
    return image.spatial_source === "inferred_cloud" ? "ubicado por IA" : "ubicado por metadatos";
  }
  return "sin ubicar";
}

function placementTone(image: StructureImageRecord) {
  if (image.manual_verified || image.spatial_source === "manual") return "bg-emerald-400/90 text-black";
  if (image.placement_status === "needs_review") return "bg-amber-300/90 text-black";
  if (image.placement_status === "placed") return image.spatial_source === "inferred_cloud"
    ? "bg-amber-400/90 text-black"
    : "bg-violet-400/90 text-black";
  return "bg-black/75 text-white/60";
}

function EvidenceCard({
  image,
  selected,
  placing,
  onSelect,
  onPlace,
  onFocus,
}: {
  image: StructureImageRecord;
  selected: boolean;
  placing: boolean;
  onSelect: () => void;
  onPlace: () => void;
  onFocus: () => void;
}) {
  const canFocus = image.local_x != null && image.local_y != null;

  return (
    <article
      className={`group overflow-hidden rounded-2xl border transition ${
        selected ? "border-violet-300/70 bg-violet-500/10" : "border-white/10 bg-white/[0.025] hover:border-white/20"
      }`}
    >
      <button type="button" onClick={onSelect} className="block w-full text-left">
        <div className="relative aspect-[4/3] overflow-hidden bg-black">
          <img src={image.public_url} alt={image.description || image.original_filename} className="h-full w-full object-cover" />
          <div className="absolute inset-x-2 bottom-2 flex items-center justify-between gap-2">
            <span className="rounded-full bg-black/75 px-2 py-1 text-[9px] uppercase tracking-[0.12em] text-white/70 backdrop-blur">
              {image.cardinal_direction || "sin rumbo"}
            </span>
            <span className={`rounded-full px-2 py-1 text-[8px] font-semibold uppercase tracking-[0.1em] ${placementTone(image)}`}>
              {placementLabel(image)}
            </span>
          </div>
        </div>
        <div className="p-3 pb-2">
          <p className="truncate text-xs font-semibold">{image.ordered_filename || image.original_filename}</p>
          <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-white/40">{image.description || "Sin descripción"}</p>
        </div>
      </button>

      <div className="grid grid-cols-2 gap-1.5 px-2.5 pb-2.5">
        <button
          type="button"
          onClick={onPlace}
          disabled={placing}
          className="inline-flex min-h-8 items-center justify-center gap-1 rounded-lg border border-violet-400/20 bg-violet-500/[0.08] px-2 text-[9px] font-medium text-violet-100 disabled:opacity-40"
        >
          {placing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Crosshair className="h-3 w-3" />}
          Ubicar en 3D
        </button>
        <button
          type="button"
          onClick={onFocus}
          disabled={!canFocus || placing}
          className="inline-flex min-h-8 items-center justify-center gap-1 rounded-lg border border-white/10 px-2 text-[9px] font-medium text-white/55 disabled:opacity-30"
        >
          <Camera className="h-3 w-3" />
          Enfocar
        </button>
      </div>
    </article>
  );
}

function ImageInspector({
  image,
  saving,
  onSave,
  onClose,
}: {
  image: StructureImageRecord;
  saving: boolean;
  onSave: (patch: Record<string, unknown>) => Promise<void>;
  onClose?: () => void;
}) {
  const [form, setForm] = useState({
    sector: image.sector ?? "",
    sceneType: image.scene_type ?? "",
    sourceType: image.source_type ?? "unknown",
    description: image.description ?? "",
    latitude: image.latitude?.toString() ?? "",
    longitude: image.longitude?.toString() ?? "",
    localX: image.local_x?.toString() ?? "",
    localY: image.local_y?.toString() ?? "",
    heading: image.heading?.toString() ?? "",
    pitch: image.pitch?.toString() ?? "",
    fov: image.fov?.toString() ?? "",
    priority: String(image.priority ?? 0),
    visibleSurfaces: stringList(image.visible_surfaces).join(", "),
    tags: stringList(image.tags).join(", "),
    manualVerified: image.manual_verified,
  });

  useEffect(() => {
    setForm({
      sector: image.sector ?? "",
      sceneType: image.scene_type ?? "",
      sourceType: image.source_type ?? "unknown",
      description: image.description ?? "",
      latitude: image.latitude?.toString() ?? "",
      longitude: image.longitude?.toString() ?? "",
      localX: image.local_x?.toString() ?? "",
      localY: image.local_y?.toString() ?? "",
      heading: image.heading?.toString() ?? "",
      pitch: image.pitch?.toString() ?? "",
      fov: image.fov?.toString() ?? "",
      priority: String(image.priority ?? 0),
      visibleSurfaces: stringList(image.visible_surfaces).join(", "),
      tags: stringList(image.tags).join(", "),
      manualVerified: image.manual_verified,
    });
  }, [image]);

  const field = (key: keyof typeof form, value: string | boolean) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  async function save() {
    await onSave({
      sector: form.sector,
      sceneType: form.sceneType,
      sourceType: form.sourceType,
      description: form.description,
      latitude: form.latitude,
      longitude: form.longitude,
      localX: form.localX,
      localY: form.localY,
      heading: form.heading,
      pitch: form.pitch,
      fov: form.fov,
      priority: Number(form.priority) || 0,
      visibleSurfaces: form.visibleSurfaces.split(",").map((item) => item.trim()).filter(Boolean),
      tags: form.tags.split(",").map((item) => item.trim()).filter(Boolean),
      manualVerified: form.manualVerified,
    });
  }

  const headingNumber = Number(form.heading);

  return (
    <div className="rounded-[1.5rem] border border-white/10 bg-[#0b0811] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-white/80">{image.ordered_filename || image.original_filename}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className="text-[9px] uppercase tracking-[0.15em] text-violet-300">{image.analysis_status}</span>
            <span className={`rounded-full px-2 py-0.5 text-[8px] uppercase tracking-[0.1em] ${placementTone(image)}`}>
              {placementLabel(image)}
            </span>
          </div>
        </div>
        {onClose ? (
          <button type="button" onClick={onClose} className="rounded-full border border-white/10 p-1.5 text-white/45">
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      <img src={image.public_url} alt="" className="mt-3 aspect-video w-full rounded-xl object-cover" />

      <div className="mt-3 rounded-xl border border-white/10 bg-black/25 p-3 text-[10px]">
        <div className="flex items-center justify-between gap-3">
          <span className="text-white/35">Fuente espacial</span>
          <span className="font-semibold text-white/75">{image.spatial_source}</span>
        </div>
        <div className="mt-1 flex items-center justify-between gap-3">
          <span className="text-white/35">Confianza</span>
          <span className="font-semibold text-white/75">{image.confidence == null ? "sin dato" : `${Math.round(image.confidence * 100)}%`}</span>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label>
          <span className="mb-1 block text-[10px] uppercase tracking-[0.13em] text-white/35">Sector</span>
          <input value={form.sector} onChange={(e) => field("sector", e.target.value)} className="w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-xs outline-none focus:border-violet-400/50" />
        </label>
        <label>
          <span className="mb-1 block text-[10px] uppercase tracking-[0.13em] text-white/35">Escena</span>
          <input value={form.sceneType} onChange={(e) => field("sceneType", e.target.value)} className="w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-xs outline-none focus:border-violet-400/50" />
        </label>
        <label>
          <span className="mb-1 block text-[10px] uppercase tracking-[0.13em] text-white/35">Latitud</span>
          <input value={form.latitude} onChange={(e) => field("latitude", e.target.value)} placeholder="sin dato" className="w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-xs outline-none focus:border-violet-400/50" />
        </label>
        <label>
          <span className="mb-1 block text-[10px] uppercase tracking-[0.13em] text-white/35">Longitud</span>
          <input value={form.longitude} onChange={(e) => field("longitude", e.target.value)} placeholder="sin dato" className="w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-xs outline-none focus:border-violet-400/50" />
        </label>
        <label>
          <span className="mb-1 block text-[10px] uppercase tracking-[0.13em] text-white/35">Local X · m</span>
          <input value={form.localX} onChange={(e) => field("localX", e.target.value)} placeholder="sin dato" className="w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-xs outline-none focus:border-cyan-300/50" />
        </label>
        <label>
          <span className="mb-1 block text-[10px] uppercase tracking-[0.13em] text-white/35">Local Y · m</span>
          <input value={form.localY} onChange={(e) => field("localY", e.target.value)} placeholder="sin dato" className="w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-xs outline-none focus:border-cyan-300/50" />
        </label>
        <label>
          <span className="mb-1 block text-[10px] uppercase tracking-[0.13em] text-white/35">Heading</span>
          <input value={form.heading} onChange={(e) => field("heading", e.target.value)} placeholder="sin dato" className="w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-xs outline-none focus:border-violet-400/50" />
        </label>
        <label>
          <span className="mb-1 block text-[10px] uppercase tracking-[0.13em] text-white/35">FOV</span>
          <input value={form.fov} onChange={(e) => field("fov", e.target.value)} placeholder="sin dato" className="w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-xs outline-none focus:border-violet-400/50" />
        </label>
      </div>

      <label className="mt-3 block">
        <span className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-[0.13em] text-white/35">
          <span>Rotar dirección</span>
          <span>{Number.isFinite(headingNumber) ? `${Math.round(headingNumber)}°` : "sin heading"}</span>
        </span>
        <input
          type="range"
          min="0"
          max="359"
          step="1"
          value={Number.isFinite(headingNumber) ? headingNumber : 0}
          onChange={(e) => {
            field("heading", e.target.value);
            field("manualVerified", true);
          }}
          className="w-full accent-cyan-300"
        />
      </label>

      <label className="mt-3 block">
        <span className="mb-1 block text-[10px] uppercase tracking-[0.13em] text-white/35">Descripción espacial</span>
        <textarea value={form.description} onChange={(e) => field("description", e.target.value)} rows={3} className="w-full resize-none rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-xs leading-5 outline-none focus:border-violet-400/50" />
      </label>
      <label className="mt-3 block">
        <span className="mb-1 block text-[10px] uppercase tracking-[0.13em] text-white/35">Superficies · separadas por coma</span>
        <input value={form.visibleSurfaces} onChange={(e) => field("visibleSurfaces", e.target.value)} className="w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-xs outline-none focus:border-violet-400/50" />
      </label>
      <label className="mt-3 flex items-center justify-between rounded-xl border border-white/10 bg-black/20 px-3 py-2">
        <span className="text-xs text-white/60">Dato verificado manualmente</span>
        <input
          type="checkbox"
          checked={form.manualVerified}
          onChange={(e) => field("manualVerified", e.target.checked)}
          className="h-4 w-4 accent-violet-500"
        />
      </label>

      <button
        type="button"
        onClick={() => void save()}
        disabled={saving}
        className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-full bg-white text-sm font-semibold text-black disabled:opacity-40"
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        Guardar referencia
      </button>
    </div>
  );
}

export function StructureWorkspace({
  structureId,
  initialTab = "project",
}: {
  structureId: string;
  initialTab?: Tab;
}) {
  const [data, setData] = useState<WorkspacePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(null);
  const [selectedCorner, setSelectedCorner] = useState<Corner | null>("NE");
  const [analysisProgress, setAnalysisProgress] = useState<string | null>(null);
  const [placementProgress, setPlacementProgress] = useState<string | null>(null);
  const [cameraEditMode, setCameraEditMode] = useState(false);
  const [spatialViewMode, setSpatialViewMode] = useState<"3d" | "satellite" | "dual">("3d");
  const [spatialEditMode, setSpatialEditMode] = useState<SpatialEditMode>("select");
  const [originPickActive, setOriginPickActive] = useState(false);
  const [originForm, setOriginForm] = useState({ lat: "", lon: "", alt: "", north: "0" });
  const [volumeHeight, setVolumeHeight] = useState("3");
  const stopAnalysisRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [projectForm, setProjectForm] = useState({
    description: "",
    locationName: "",
    historicalNotes: "",
    rules: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await authenticatedFetch(`/api/structures/${structureId}`);
      const payload = await readApiJson<WorkspacePayload>(response);
      setData(payload);
      setProjectForm({
        description: payload.structure.description ?? "",
        locationName: payload.structure.location_name ?? "",
        historicalNotes: payload.structure.historical_notes ?? "",
        rules: [
          ...new Set([
            ...((Array.isArray(payload.structure.reconstruction_rules) ? payload.structure.reconstruction_rules : []) as string[]),
            ...payload.rules.filter((rule) => rule.active).map((rule) => rule.rule),
          ]),
        ].join("\n"),
      });
      setOriginForm({
        lat: payload.structure.origin_latitude?.toString() ?? "",
        lon: payload.structure.origin_longitude?.toString() ?? "",
        alt: payload.structure.origin_alt?.toString() ?? "",
        north: (payload.structure.north_rotation_deg ?? 0).toString(),
      });
      const focusFromUrl = typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("focus")
        : null;
      setSelectedImageId((current) => {
        if (focusFromUrl && payload.images.some((image) => image.id === focusFromUrl)) return focusFromUrl;
        if (current && payload.images.some((image) => image.id === current)) return current;
        return payload.images[0]?.id ?? null;
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo cargar la estructura.");
    } finally {
      setLoading(false);
    }
  }, [structureId]);

  useEffect(() => { void load(); }, [load]);

  const selectedImage = useMemo(
    () => data?.images.find((image) => image.id === selectedImageId) ?? null,
    [data?.images, selectedImageId],
  );

  const selectedCamera = useMemo(
    () => data?.cameraNodes.find((node) => node.image_id === selectedImageId) ?? null,
    [data?.cameraNodes, selectedImageId],
  );
  const selectedCameraNodeId = selectedCamera?.id ?? null;

  const selectedFeature = useMemo(
    () => data?.spatialFeatures.find((feature) => feature.id === selectedFeatureId) ?? null,
    [data?.spatialFeatures, selectedFeatureId],
  );

  useEffect(() => {
    if (!selectedFeature) return;
    const height = Number(selectedFeature.properties.height_m);
    if (Number.isFinite(height) && height > 0) setVolumeHeight(String(height));
  }, [selectedFeature?.id, selectedFeature?.properties]);

  const coverage = useMemo(
    () => computeEvidenceCoverage(data?.images ?? []),
    [data?.images],
  );

  const corner = useMemo(
    () => selectedCorner ? cornerEvidence(data?.images ?? [], selectedCorner) : null,
    [data?.images, selectedCorner],
  );

  const latestOutputs = useMemo(() => {
    const map = new Map<RenderView, RenderOutput>();
    for (const output of data?.renderOutputs ?? []) {
      if (!map.has(output.view_key)) map.set(output.view_key, output);
    }
    return map;
  }, [data?.renderOutputs]);

  async function uploadFiles(files: File[]) {
    if (!files.length) return;
    setBusy("upload");
    setMessage(null);
    try {
      const form = new FormData();
      files.forEach((file) => form.append("files", file));
      const response = await authenticatedFetch(`/api/structures/${structureId}/images`, {
        method: "POST",
        body: form,
      });
      const payload = await readApiJson<{ imported: number; failures: Array<{ file: string; error: string }> }>(response);
      setMessage(
        payload.failures.length
          ? `${payload.imported} importadas · ${payload.failures.length} con error. Revisá el lote.`
          : `${payload.imported} imágenes incorporadas a la base espacial.`,
      );
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudieron subir las imágenes.");
    } finally {
      setBusy(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function analyzeAllPending() {
    if (busy) return;
    stopAnalysisRef.current = false;
    setBusy("analyze");
    setMessage(null);
    let processed = 0;
    try {
      for (let batch = 0; batch < 100 && !stopAnalysisRef.current; batch += 1) {
        setAnalysisProgress(processed ? `Analizadas ${processed} imágenes…` : "Preparando análisis espacial…");
        const response = await authenticatedFetch(`/api/structures/${structureId}/analyze`, {
          method: "POST",
          body: JSON.stringify({ limit: 4 }),
        });
        const payload = await readApiJson<{ processed: number; remaining: number; needsReview: number }>(response);
        processed += payload.processed;
        setAnalysisProgress(`Analizadas ${processed} · quedan ${payload.remaining}`);
        if (!payload.processed || payload.remaining <= 0) break;
      }
      setMessage(stopAnalysisRef.current
        ? `Análisis detenido después de ${processed} imágenes.`
        : `Análisis espacial completado: ${processed} imágenes procesadas.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "El análisis espacial se interrumpió.");
      await load();
    } finally {
      setBusy(null);
      setAnalysisProgress(null);
      stopAnalysisRef.current = false;
    }
  }

  async function saveImage(patch: Record<string, unknown>) {
    if (!selectedImage) return;
    setBusy("image");
    try {
      const response = await authenticatedFetch(
        `/api/structures/${structureId}/images/${selectedImage.id}`,
        { method: "PATCH", body: JSON.stringify(patch) },
      );
      await readApiJson(response);
      setMessage("Referencia espacial actualizada.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo guardar la referencia.");
    } finally {
      setBusy(null);
    }
  }

  async function placeImage(imageId: string, focusAfter = false) {
    if (busy) return;
    setBusy(`place:${imageId}`);
    setMessage(null);
    try {
      const response = await authenticatedFetch(
        `/api/structures/${structureId}/images/${imageId}/place`,
        { method: "POST", body: JSON.stringify({}) },
      );
      const payload = await readApiJson<{
        image: StructureImageRecord;
        usedCloud: boolean;
        needsReview: boolean;
      }>(response);
      setSelectedImageId(imageId);
      setMessage(
        payload.needsReview
          ? "CLOUVA ubicó la cámara por inferencia, pero necesita revisión manual."
          : payload.usedCloud
            ? "CLOUVA Cloud ubicó la cámara y su dirección."
            : "Cámara ubicada usando metadatos reales.",
      );
      await load();
      if (focusAfter && typeof window !== "undefined") {
        window.location.href = `/structures/${structureId}/spatial?focus=${encodeURIComponent(imageId)}`;
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo ubicar la cámara.");
    } finally {
      setBusy(null);
    }
  }

  async function placeAllImages() {
    if (busy || !data?.images.length) return;
    setBusy("place-all");
    setMessage(null);
    let processed = 0;
    let placed = 0;
    let review = 0;
    try {
      for (let batch = 0; batch < 100; batch += 1) {
        setPlacementProgress(processed ? `Ubicadas/revisadas ${processed} imágenes…` : "Acomodando cámaras en el espacio…");
        const response = await authenticatedFetch(`/api/structures/${structureId}/place-all`, {
          method: "POST",
          body: JSON.stringify({ limit: 4 }),
        });
        const payload = await readApiJson<{
          processed: number;
          placed: number;
          review: number;
          remaining: number;
        }>(response);
        processed += payload.processed;
        placed += payload.placed;
        review = payload.review;
        setPlacementProgress(`Procesadas ${processed} · faltan ${payload.remaining} · revisar ${payload.review}`);
        if (!payload.processed || payload.remaining <= 0) break;
      }
      setMessage(`Cámaras acomodadas: ${placed} listas · ${review} para revisar.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "La colocación automática se interrumpió.");
      await load();
    } finally {
      setPlacementProgress(null);
      setBusy(null);
    }
  }

  async function focusImageInScene(image: StructureImageRecord) {
    setSelectedImageId(image.id);
    if (image.local_x == null || image.local_y == null || image.placement_status === "unplaced" || image.placement_status === "blocked") {
      await placeImage(image.id, false);
    }
    if (typeof window !== "undefined") {
      window.location.href = `/structures/${structureId}/spatial?focus=${encodeURIComponent(image.id)}`;
    }
  }

  async function selectSpatialImage(image: StructureImageRecord) {
    setSelectedImageId(image.id);
    if (
      !busy
      && (image.local_x == null || image.local_y == null || image.heading == null || image.placement_status === "unplaced")
    ) {
      await placeImage(image.id, false);
    }
  }

  async function moveImageNode(imageId: string, localX: number, localY: number) {
    if (busy) return;
    setBusy("move-camera");
    setSelectedImageId(imageId);
    try {
      const response = await authenticatedFetch(
        `/api/structures/${structureId}/images/${imageId}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            localX,
            localY,
            manualVerified: true,
          }),
        },
      );
      await readApiJson(response);
      setMessage("Posición manual guardada. Esta corrección ahora tiene prioridad.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo mover la cámara.");
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function defineOrigin(payload: Record<string, unknown>) {
    if (busy) return;
    setBusy("origin");
    setMessage(null);
    try {
      const response = await authenticatedFetch(`/api/structures/${structureId}/spatial/origin`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const result = await readApiJson<{ recalculated: number }>(response);
      setMessage(`Origen espacial guardado · ${result.recalculated} cámaras recalculadas.`);
      setOriginPickActive(false);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo definir el origen.");
    } finally {
      setBusy(null);
    }
  }

  async function defineOriginManual() {
    await defineOrigin({
      originLat: originForm.lat,
      originLon: originForm.lon,
      originAlt: originForm.alt,
      northRotationDeg: originForm.north,
    });
  }

  async function defineOriginFromSelectedCamera() {
    if (!selectedImage) return;
    await defineOrigin({
      imageId: selectedImage.id,
      northRotationDeg: originForm.north,
    });
  }

  async function recalculateSpatialWorld() {
    if (busy) return;
    setBusy("recalculate");
    try {
      const response = await authenticatedFetch(`/api/structures/${structureId}/spatial/recalculate`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      const result = await readApiJson<{ recalculated: number }>(response);
      setMessage(`Escena recalculada desde lat/lon: ${result.recalculated} cámaras.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo recalcular la escena.");
    } finally {
      setBusy(null);
    }
  }

  async function createSpatialFeature(payload: {
    featureType: StructureSpatialFeatureRecord["feature_type"];
    name?: string;
    geometry: StructureSpatialFeatureRecord["geometry"];
    properties?: Record<string, unknown>;
  }) {
    const response = await authenticatedFetch(`/api/structures/${structureId}/spatial/features`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const result = await readApiJson<{ feature: StructureSpatialFeatureRecord }>(response);
    setSelectedFeatureId(result.feature.id);
    setData((current) => current ? {
      ...current,
      spatialFeatures: [...current.spatialFeatures, result.feature],
    } : current);
    setMessage(`${payload.name || "Geometría"} agregada al mapa y al 3D.`);
  }

  async function updateSpatialFeature(featureId: string, patch: Record<string, unknown>) {
    const response = await authenticatedFetch(`/api/structures/${structureId}/spatial/features/${featureId}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    const result = await readApiJson<{ feature: StructureSpatialFeatureRecord }>(response);
    setData((current) => current ? {
      ...current,
      spatialFeatures: current.spatialFeatures.map((feature) => feature.id === featureId ? result.feature : feature),
    } : current);
  }

  async function generateBaseVolume() {
    if (!selectedFeature || selectedFeature.feature_type !== "building_footprint") return;
    const height = Number(volumeHeight);
    if (!Number.isFinite(height) || height <= 0) {
      setMessage("Ingresá una altura válida en metros.");
      return;
    }
    setBusy("volume");
    try {
      await updateSpatialFeature(selectedFeature.id, {
        properties: {
          ...selectedFeature.properties,
          height_m: height,
          volume_enabled: true,
        },
      });
      setMessage(`Volumen base generado a ${height.toFixed(2)} m y vinculado a la huella.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo generar el volumen.");
    } finally {
      setBusy(null);
    }
  }

  async function saveProject() {
    setBusy("project");
    try {
      const response = await authenticatedFetch(`/api/structures/${structureId}`, {
        method: "PATCH",
        body: JSON.stringify({
          description: projectForm.description,
          locationName: projectForm.locationName,
          historicalNotes: projectForm.historicalNotes,
          reconstructionRules: projectForm.rules.split("\n").map((rule) => rule.trim()).filter(Boolean),
        }),
      });
      await readApiJson(response);
      setMessage("Proyecto y reglas guardados.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo guardar el proyecto.");
    } finally {
      setBusy(null);
    }
  }

  async function saveBlockout(blockout: Record<string, unknown>) {
    setBusy("plan");
    try {
      const response = await authenticatedFetch(`/api/structures/${structureId}`, {
        method: "PATCH",
        body: JSON.stringify({ blockout }),
      });
      await readApiJson(response);
      setMessage("Plano guardado y conectado al visor 3D.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo guardar el plano.");
    } finally {
      setBusy(null);
    }
  }

  async function exportZip() {
    if (!data) return;
    setBusy("export");
    setMessage(null);
    try {
      const response = await authenticatedFetch(`/api/structures/${structureId}/export`);
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error || "No se pudo generar el ZIP.");
      }
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") ?? "";
      const matched = disposition.match(/filename="([^"]+)"/);
      downloadBlob(blob, matched?.[1] || `${data.structure.slug}_BASE_3D.zip`);
      setMessage("ZIP BASE 3D generado con manifiesto, cámaras, índices e imágenes ordenadas.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo generar el ZIP.");
    } finally {
      setBusy(null);
    }
  }

  async function renderViews(views?: RenderView[]) {
    setBusy("render");
    setMessage(null);
    try {
      const response = await authenticatedFetch(`/api/structures/${structureId}/render`, {
        method: "POST",
        body: JSON.stringify({ views }),
      });
      const payload = await readApiJson<{ outputs: RenderOutput[]; errors: string[] }>(response);
      setMessage(
        payload.errors.length
          ? `CLOUVA Cloud generó ${payload.outputs.length} vista(s); ${payload.errors.length} necesitan reintento.`
          : `CLOUVA Cloud generó ${payload.outputs.length} vista(s) del mismo lugar.`,
      );
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "CLOUVA Cloud no pudo generar las vistas.");
      await load();
    } finally {
      setBusy(null);
    }
  }

  if (loading && !data) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#05030a] text-white">
        <Loader2 className="h-7 w-7 animate-spin text-violet-300" />
      </main>
    );
  }

  if (!data) {
    return (
      <main className="min-h-screen bg-[#05030a] p-8 text-white">
        <Link href="/structures" className="text-violet-300">← Structures</Link>
        <p className="mt-8 text-white/60">{message || "No se pudo abrir la estructura."}</p>
      </main>
    );
  }

  const blockout = data.structure.blockout && typeof data.structure.blockout === "object"
    ? data.structure.blockout as { height?: number; footprint?: Array<{ x: number; y: number }> }
    : {};

  return (
    <main className="min-h-screen bg-[#05030a] pb-20 text-white">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".jpg,.jpeg,.png,.webp,.zip,image/jpeg,image/png,image/webp,application/zip"
        className="hidden"
        onChange={(event) => void uploadFiles(Array.from(event.target.files ?? []))}
      />

      <div className="mx-auto w-full max-w-[1500px] px-3 pt-6 sm:px-5 lg:px-7">
        <header className="rounded-[1.8rem] border border-white/10 bg-white/[0.025] p-5 sm:p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <Link href="/structures" className="inline-flex items-center gap-1 text-xs text-white/40 transition hover:text-white">
                <ChevronLeft className="h-3.5 w-3.5" />
                Structures
              </Link>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold sm:text-4xl">{data.structure.name}</h1>
                <span className="rounded-full border border-violet-400/20 bg-violet-500/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.15em] text-violet-200">
                  {STATUS_LABELS[data.structure.status] ?? data.structure.status}
                </span>
              </div>
              {data.structure.location_name ? (
                <p className="mt-2 flex items-center gap-1.5 text-sm text-white/45">
                  <MapPin className="h-3.5 w-3.5" />
                  {data.structure.location_name}
                </p>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={Boolean(busy)}
                className="inline-flex h-10 items-center gap-2 rounded-full border border-white/15 px-4 text-sm text-white/75 transition hover:border-violet-400/40 hover:text-white disabled:opacity-40"
              >
                {busy === "upload" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Subir evidencia
              </button>
              <button
                type="button"
                onClick={() => void analyzeAllPending()}
                disabled={Boolean(busy) || !data.images.length}
                className="inline-flex h-10 items-center gap-2 rounded-full bg-violet-500 px-4 text-sm font-semibold text-white transition hover:bg-violet-400 disabled:opacity-40"
              >
                {busy === "analyze" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanLine className="h-4 w-4" />}
                {busy === "analyze" ? "Analizando…" : "Analizar pendientes"}
              </button>
              {busy === "analyze" ? (
                <button
                  type="button"
                  onClick={() => { stopAnalysisRef.current = true; }}
                  className="h-10 rounded-full border border-white/15 px-4 text-xs text-white/60"
                >
                  Detener después del lote
                </button>
              ) : null}
            </div>
          </div>

          {analysisProgress ? <p className="mt-4 text-xs text-violet-200">{analysisProgress}</p> : null}
          {placementProgress ? <p className="mt-4 text-xs text-cyan-200">{placementProgress}</p> : null}
          {message ? (
            <div className="mt-4 rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-xs text-white/70">
              {message}
            </div>
          ) : null}
        </header>

        <nav className="mt-3 flex gap-2 overflow-x-auto rounded-2xl border border-white/10 bg-[#08060d] p-2">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const active = tab.id === initialTab;
            return (
              <Link
                key={tab.id}
                href={tabHref(structureId, tab.id)}
                className={`inline-flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium transition ${
                  active ? "bg-white text-black" : "text-white/50 hover:bg-white/5 hover:text-white"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
              </Link>
            );
          })}
        </nav>

        {initialTab === "project" ? (
          <section className="mt-4 grid gap-4 xl:grid-cols-[1fr_360px]">
            <div className="rounded-[1.6rem] border border-white/10 bg-white/[0.025] p-5">
              <h2 className="text-lg font-semibold">Definición de la estructura</h2>
              <p className="mt-1 text-sm text-white/45">Estas reglas pasan al manifiesto y al contexto de reconstrucción de CLOUVA Cloud.</p>
              <div className="mt-5 grid gap-4">
                <label>
                  <span className="mb-2 block text-xs text-white/40">Ubicación descriptiva</span>
                  <input value={projectForm.locationName} onChange={(e) => setProjectForm((c) => ({ ...c, locationName: e.target.value }))} className="w-full rounded-2xl border border-white/10 bg-black/25 px-4 py-3 outline-none focus:border-violet-400/50" />
                </label>
                <label>
                  <span className="mb-2 block text-xs text-white/40">Descripción</span>
                  <textarea value={projectForm.description} onChange={(e) => setProjectForm((c) => ({ ...c, description: e.target.value }))} rows={4} className="w-full resize-none rounded-2xl border border-white/10 bg-black/25 px-4 py-3 outline-none focus:border-violet-400/50" />
                </label>
                <label>
                  <span className="mb-2 block text-xs text-white/40">Notas históricas</span>
                  <textarea value={projectForm.historicalNotes} onChange={(e) => setProjectForm((c) => ({ ...c, historicalNotes: e.target.value }))} rows={4} className="w-full resize-none rounded-2xl border border-white/10 bg-black/25 px-4 py-3 outline-none focus:border-violet-400/50" />
                </label>
                <label>
                  <span className="mb-2 block text-xs text-white/40">Reglas obligatorias · una por línea</span>
                  <textarea value={projectForm.rules} onChange={(e) => setProjectForm((c) => ({ ...c, rules: e.target.value }))} rows={6} className="w-full resize-none rounded-2xl border border-violet-400/20 bg-violet-500/[0.05] px-4 py-3 outline-none focus:border-violet-400/60" />
                </label>
                <button type="button" onClick={() => void saveProject()} disabled={Boolean(busy)} className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-white font-semibold text-black disabled:opacity-40">
                  {busy === "project" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Guardar proyecto
                </button>
              </div>
            </div>

            <aside className="space-y-4">
              <div className="rounded-[1.6rem] border border-white/10 bg-white/[0.025] p-5">
                <p className="text-xs uppercase tracking-[0.17em] text-violet-300">Cobertura real</p>
                <div className="mt-4 space-y-3 text-sm">
                  {[
                    ["Imágenes", coverage.total.toString()],
                    ["Analizadas", `${coverage.analyzed}%`],
                    ["Verificadas", `${coverage.verified}%`],
                    ["Geolocalizadas", `${coverage.geolocated}%`],
                    ["Cobertura angular exterior", `${coverage.exteriorAngular}%`],
                    ["Evidencia interior", coverage.interiorEvidence.toString()],
                    ["Evidencia de techo", coverage.roofEvidence.toString()],
                    ["Evidencia de contexto", coverage.contextEvidence.toString()],
                  ].map(([label, value]) => (
                    <div key={label} className="flex items-center justify-between gap-4 border-b border-white/[0.06] pb-2 last:border-0">
                      <span className="text-white/45">{label}</span>
                      <span className="font-medium">{value}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-[1.6rem] border border-white/10 bg-white/[0.025] p-5">
                <p className="text-xs uppercase tracking-[0.17em] text-white/35">Grafo</p>
                <div className="mt-4 grid grid-cols-2 gap-3 text-center">
                  <div className="rounded-2xl bg-black/25 p-3"><p className="text-2xl font-semibold">{data.surfaces.length}</p><p className="mt-1 text-[10px] text-white/40">superficies</p></div>
                  <div className="rounded-2xl bg-black/25 p-3"><p className="text-2xl font-semibold">{data.cameraNodes.length}</p><p className="mt-1 text-[10px] text-white/40">cámaras</p></div>
                </div>
              </div>
            </aside>
          </section>
        ) : null}

        {initialTab === "images" ? (
          <section className="mt-4 grid gap-4 xl:grid-cols-[1fr_380px]">
            <div>
              <div
                onDragEnter={(event) => { event.preventDefault(); setDragActive(true); }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={(event) => { event.preventDefault(); setDragActive(false); }}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragActive(false);
                  void uploadFiles(Array.from(event.dataTransfer.files ?? []));
                }}
                className={`mb-4 flex min-h-28 items-center justify-center rounded-[1.5rem] border border-dashed p-5 text-center transition ${
                  dragActive ? "border-violet-300 bg-violet-500/10" : "border-white/15 bg-white/[0.02]"
                }`}
              >
                <button type="button" onClick={() => fileInputRef.current?.click()} className="text-sm text-white/55">
                  <Upload className="mx-auto mb-2 h-5 w-5 text-violet-300" />
                  Arrastrá JPG, PNG, WEBP o ZIP · o tocá para seleccionar
                </button>
              </div>

              {data.images.length ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
                  {data.images.map((image) => (
                    <EvidenceCard
                      key={image.id}
                      image={image}
                      selected={image.id === selectedImageId}
                      placing={busy === `place:${image.id}`}
                      onSelect={() => setSelectedImageId(image.id)}
                      onPlace={() => { void placeImage(image.id, false); }}
                      onFocus={() => { void focusImageInScene(image); }}
                    />
                  ))}
                </div>
              ) : (
                <div className="grid min-h-[280px] place-items-center rounded-[1.6rem] border border-white/10 bg-white/[0.02] text-center">
                  <div>
                    <ImageIcon className="mx-auto h-7 w-7 text-white/25" />
                    <p className="mt-3 text-sm text-white/45">Todavía no hay evidencia visual.</p>
                  </div>
                </div>
              )}
            </div>
            <aside>
              {selectedImage ? (
                <ImageInspector image={selectedImage} saving={busy === "image"} onSave={saveImage} />
              ) : (
                <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.025] p-5 text-sm text-white/40">
                  Seleccioná una imagen para revisar sus datos espaciales.
                </div>
              )}
            </aside>
          </section>
        ) : null}

        {initialTab === "spatial" ? (
          <section className="mt-4 grid gap-4 xl:grid-cols-[1fr_360px]">
            <div>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/10 bg-white/[0.025] p-3">
                <div>
                  <p className="text-sm font-semibold">Cámaras reales</p>
                  <p className="mt-0.5 text-[11px] text-white/40">
                    Cada punto representa dónde estaba el muñequito/cámara y la línea muestra hacia dónde miraba.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void placeAllImages()}
                    disabled={Boolean(busy) || !data.images.length}
                    className="inline-flex h-9 items-center gap-2 rounded-full bg-cyan-300 px-4 text-xs font-semibold text-black disabled:opacity-35"
                  >
                    {busy === "place-all" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Crosshair className="h-3.5 w-3.5" />}
                    Colocar automáticamente todas
                  </button>
                  <button
                    type="button"
                    onClick={() => setCameraEditMode((current) => !current)}
                    disabled={busy === "move-camera"}
                    className={`inline-flex h-9 items-center gap-2 rounded-full border px-4 text-xs font-medium transition ${
                      cameraEditMode
                        ? "border-cyan-300/60 bg-cyan-400/10 text-cyan-100"
                        : "border-white/10 text-white/55"
                    }`}
                  >
                    <Move className="h-3.5 w-3.5" />
                    {cameraEditMode ? "Ajuste manual ON" : "Ajustar cámaras"}
                  </button>
                </div>
              </div>

              <StructureScene
                images={data.images}
                cameraNodes={data.cameraNodes}
                blockout={blockout}
                selectedImageId={selectedImageId}
                onSelectImage={setSelectedImageId}
                selectedCorner={selectedCorner}
                onSelectCorner={setSelectedCorner}
                editMode={cameraEditMode}
                onMoveImage={moveImageNode}
              />

              <div className="mt-3 flex gap-2 overflow-x-auto pb-2">
                {data.images.slice(0, 120).map((image) => (
                  <button
                    type="button"
                    key={image.id}
                    onClick={() => { void selectSpatialImage(image); }}
                    className={`relative h-16 w-24 shrink-0 overflow-hidden rounded-xl border ${
                      selectedImageId === image.id ? "border-violet-300" : "border-white/10"
                    }`}
                    title={`${placementLabel(image)} · ${image.cardinal_direction || "sin rumbo"}`}
                  >
                    <img src={image.public_url} alt="" className="h-full w-full object-cover" />
                    <span className={`absolute bottom-1 right-1 h-2.5 w-2.5 rounded-full border border-black/60 ${
                      image.placement_status === "placed"
                        ? image.spatial_source === "inferred_cloud" ? "bg-amber-300" : "bg-emerald-400"
                        : image.placement_status === "needs_review" ? "bg-amber-400" : "bg-white/35"
                    }`} />
                  </button>
                ))}
              </div>
            </div>

            <aside className="space-y-4">
              {selectedImage ? (
                <div className="rounded-[1.5rem] border border-cyan-300/15 bg-cyan-400/[0.035] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.17em] text-cyan-300">Cámara seleccionada</p>
                      <p className="mt-1 text-sm font-semibold">{selectedImage.cardinal_direction || "sin rumbo"} · {placementLabel(selectedImage)}</p>
                    </div>
                    <span className={`rounded-full px-2 py-1 text-[8px] uppercase tracking-[0.1em] ${placementTone(selectedImage)}`}>
                      {selectedImage.spatial_source}
                    </span>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2 text-[10px]">
                    <div className="rounded-xl border border-white/10 bg-black/20 p-2.5">
                      <p className="text-white/30">LAT</p>
                      <p className="mt-1 font-mono text-white/75">{selectedImage.latitude?.toFixed(7) ?? "—"}</p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-black/20 p-2.5">
                      <p className="text-white/30">LON</p>
                      <p className="mt-1 font-mono text-white/75">{selectedImage.longitude?.toFixed(7) ?? "—"}</p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-black/20 p-2.5">
                      <p className="text-white/30">LOCAL X</p>
                      <p className="mt-1 font-mono text-white/75">{selectedCamera?.local_x?.toFixed(2) ?? selectedImage.local_x?.toFixed(2) ?? "—"} m</p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-black/20 p-2.5">
                      <p className="text-white/30">LOCAL Y</p>
                      <p className="mt-1 font-mono text-white/75">{selectedCamera?.local_y?.toFixed(2) ?? selectedImage.local_y?.toFixed(2) ?? "—"} m</p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-black/20 p-2.5">
                      <p className="text-white/30">HEADING</p>
                      <p className="mt-1 font-mono text-white/75">{selectedImage.heading == null ? "—" : `${selectedImage.heading.toFixed(1)}°`}</p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-black/20 p-2.5">
                      <p className="text-white/30">CONFIANZA</p>
                      <p className="mt-1 font-mono text-white/75">{selectedImage.confidence == null ? "—" : `${Math.round(selectedImage.confidence * 100)}%`}</p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => { void placeImage(selectedImage.id, false); }}
                    disabled={Boolean(busy)}
                    className="mt-3 inline-flex h-9 w-full items-center justify-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-400/[0.06] text-xs text-cyan-100 disabled:opacity-35"
                  >
                    {busy === `place:${selectedImage.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Crosshair className="h-3.5 w-3.5" />}
                    Recalcular / ubicar esta cámara
                  </button>
                </div>
              ) : null}

              <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.025] p-4">
                <p className="text-xs uppercase tracking-[0.17em] text-cyan-300">Esquinas</p>
                <div className="mt-3 grid grid-cols-4 gap-2">
                  {(["NO", "NE", "SO", "SE"] as Corner[]).map((key) => (
                    <button
                      type="button"
                      key={key}
                      onClick={() => setSelectedCorner(key)}
                      className={`rounded-xl border px-2 py-2 text-xs ${
                        selectedCorner === key ? "border-cyan-300 bg-cyan-400/10 text-white" : "border-white/10 text-white/45"
                      }`}
                    >
                      {key}
                    </button>
                  ))}
                </div>

                {corner ? (
                  <div className="mt-4">
                    <p className="text-sm font-semibold">Esquina {corner.corner}</p>
                    <div className="mt-3 space-y-2 text-xs">
                      <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                        <span className="text-white/35">Conocemos</span>
                        <p className="mt-1 text-emerald-200">{corner.available.length ? corner.available.join(" · ") : "sin vistas direccionales confirmadas"}</p>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                        <span className="text-white/35">Vistas faltantes</span>
                        <p className="mt-1 text-amber-200">{corner.missing.length ? corner.missing.join(" · ") : "cobertura angular básica completa"}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="mt-3 inline-flex h-9 w-full items-center justify-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-400/[0.06] text-xs text-cyan-100"
                    >
                      <Camera className="h-3.5 w-3.5" />
                      Agregar referencia
                    </button>
                  </div>
                ) : null}
              </div>

              {selectedImage ? (
                <ImageInspector image={selectedImage} saving={busy === "image"} onSave={saveImage} />
              ) : null}
            </aside>
          </section>
        ) : null}

        {initialTab === "plan" ? (
          <section className="mt-4">
            <PlanEditor initialBlockout={blockout} saving={busy === "plan"} onSave={saveBlockout} />
          </section>
        ) : null}

        {initialTab === "export" ? (
          <section className="mt-4 grid gap-4 lg:grid-cols-[1fr_360px]">
            <div className="rounded-[1.6rem] border border-white/10 bg-white/[0.025] p-6">
              <FileArchive className="h-8 w-8 text-violet-300" />
              <h2 className="mt-4 text-2xl font-semibold">BASE 3D portable</h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-white/50">
                CLOUVA arma el ZIP con imágenes ordenadas espacialmente, manifiesto JSON/CSV, cámaras GeoJSON, reglas, duplicados, resumen de sectores y contact sheets.
              </p>
              <button
                type="button"
                onClick={() => void exportZip()}
                disabled={Boolean(busy) || !data.images.length}
                className="mt-6 inline-flex h-12 items-center gap-2 rounded-full bg-white px-6 font-semibold text-black disabled:opacity-40"
              >
                {busy === "export" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                Generar ZIP BASE 3D
              </button>
            </div>
            <aside className="rounded-[1.6rem] border border-white/10 bg-white/[0.025] p-5">
              <p className="text-xs uppercase tracking-[0.16em] text-violet-300">Contenido real</p>
              <div className="mt-4 space-y-2 text-xs text-white/55">
                <p>MANIFEST_BASE_3D.json</p>
                <p>MANIFEST_BASE_3D.csv</p>
                <p>PUNTOS_CAMARA.geojson</p>
                <p>REGLAS_RECONSTRUCCION.txt</p>
                <p>DUPLICADOS_EXACTOS.txt</p>
                <p>RESUMEN_SECTORES.txt</p>
                <p>CONTACT_SHEET_###.jpg</p>
                <p>Imágenes por sector y dirección</p>
              </div>
            </aside>
          </section>
        ) : null}

        {initialTab === "render" ? (
          <section className="mt-4">
            <div className="rounded-[1.6rem] border border-violet-400/15 bg-gradient-to-br from-violet-500/[0.08] to-transparent p-5 sm:p-6">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                <div className="max-w-2xl">
                  <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-violet-300">
                    <Cloud className="h-4 w-4" />
                    CLOUVA Cloud
                  </div>
                  <h2 className="mt-3 text-2xl font-semibold">4 cámaras del mismo lugar</h2>
                  <p className="mt-2 text-sm leading-6 text-white/50">
                    El constructor elige evidencia relevante para cada cámara y comparte el mismo identity pack de geometría, reglas, superficies y proporciones.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void renderViews()}
                  disabled={Boolean(busy) || !data.images.length}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-white px-6 font-semibold text-black disabled:opacity-40"
                >
                  {busy === "render" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                  {busy === "render" ? "CLOUD reconstruyendo…" : "GENERAR 4 VISTAS"}
                </button>
              </div>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {(["front", "corner", "environment", "aerial_oblique"] as RenderView[]).map((view) => {
                const output = latestOutputs.get(view);
                return (
                  <article key={view} className="overflow-hidden rounded-[1.6rem] border border-white/10 bg-white/[0.025]">
                    <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
                      <p className="text-sm font-semibold">{RENDER_LABELS[view]}</p>
                      <button
                        type="button"
                        onClick={() => void renderViews([view])}
                        disabled={Boolean(busy) || !data.images.length}
                        className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1.5 text-[10px] text-white/55 disabled:opacity-35"
                      >
                        <RefreshCw className="h-3 w-3" />
                        Regenerar
                      </button>
                    </div>
                    {output ? (
                      <img src={output.public_url} alt={RENDER_LABELS[view]} className="aspect-video w-full object-cover" />
                    ) : (
                      <div className="grid aspect-video place-items-center bg-black/25 text-center text-xs text-white/30">
                        Todavía no generada
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
