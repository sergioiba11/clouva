"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Check,
  Copy,
  Database,
  ExternalLink,
  Eye,
  File,
  FileText,
  GitBranch,
  Grid2X2,
  HardDrive,
  Image as ImageIcon,
  List,
  Loader2,
  Music2,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  TriangleAlert,
  Upload,
  Video,
  X,
} from "lucide-react";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type AssetSource = "gcs" | "supabase" | "github";
type Asset = {
  source: AssetSource;
  bucket: string;
  name: string;
  path: string;
  folder: string;
  url: string | null;
  size: number;
  contentType: string | null;
  updatedAt: string | null;
};

type StorageBucket = {
  source: AssetSource;
  name: string;
  public: boolean | null;
};

type SourceWarning = {
  source: AssetSource;
  message: string;
};

type AssetList = {
  items: Asset[];
  buckets: StorageBucket[];
  warnings?: SourceWarning[];
  total: number;
  gcsBucket: string;
};

type UploadResult = { asset: Asset };
type MutationResult = {
  ok: true;
  path: string;
  name?: string;
  updatedReferences?: number;
  commitSha?: string;
};
type AssetKind = "image" | "video" | "audio" | "3d" | "document" | "other";
type SortMode = "updated-desc" | "name-asc" | "size-desc" | "size-asc";

const UPLOAD_FOLDERS = ["brand", "backgrounds", "players", "products", "3d", "uploads"];
const FORMAT_PRIORITY = [
  "GLB",
  "PNG",
  "WEBP",
  "JPG",
  "JPEG",
  "SVG",
  "GLTF",
  "FBX",
  "OBJ",
  "MP4",
  "MOV",
  "WEBM",
  "MP3",
  "WAV",
  "OGG",
  "M4A",
  "PDF",
  "JSON",
];

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function formatDate(value: string | null) {
  if (!value) return "Sin fecha";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin fecha";
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function assetExtension(asset: Asset) {
  const extension = asset.name.split(".").pop()?.trim().toUpperCase() ?? "";
  if (!extension || extension === asset.name.toUpperCase()) return "SIN EXT";
  return extension;
}

function assetCategory(asset: Asset) {
  const folder = (asset.folder || "")
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean)[0];
  return folder || "sin-categoria";
}

function assetKey(asset: Asset) {
  return `${asset.source}:${asset.bucket}:${asset.path}`;
}

function categoryLabel(category: string) {
  const labels: Record<string, string> = {
    brand: "Marca / Logos",
    backgrounds: "Fondos",
    players: "Players / Avatares",
    products: "Productos",
    "3d": "3D",
    uploads: "Uploads",
    audio: "Audio",
    video: "Video",
    icons: "Iconos",
    ui: "UI",
    "sin-categoria": "Sin categoría",
  };
  return labels[category] ?? category.replace(/[-_]+/g, " ").replace(/^./, (letter) => letter.toUpperCase());
}

function assetKind(asset: Asset): AssetKind {
  const mime = asset.contentType?.toLowerCase() ?? "";
  const extension = asset.name.split(".").pop()?.toLowerCase() ?? "";
  if (mime.startsWith("image/") || ["png", "jpg", "jpeg", "webp", "gif", "svg"].includes(extension)) return "image";
  if (mime.startsWith("video/") || ["mp4", "webm", "mov"].includes(extension)) return "video";
  if (mime.startsWith("audio/") || ["mp3", "wav", "ogg", "m4a"].includes(extension)) return "audio";
  if (mime.includes("gltf") || ["glb", "gltf", "fbx", "obj"].includes(extension)) return "3d";
  if (mime.includes("pdf") || mime.startsWith("text/") || ["pdf", "txt", "json", "csv", "md"].includes(extension)) return "document";
  return "other";
}

function KindIcon({ asset, className = "h-5 w-5" }: { asset: Asset; className?: string }) {
  const kind = assetKind(asset);
  if (kind === "image") return <ImageIcon className={className} />;
  if (kind === "video") return <Video className={className} />;
  if (kind === "audio") return <Music2 className={className} />;
  if (kind === "3d") return <Box className={className} />;
  if (kind === "document") return <FileText className={className} />;
  return <File className={className} />;
}

function SourceBadge({ source }: { source: AssetSource }) {
  if (source === "gcs") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-400/20 bg-sky-400/10 px-2.5 py-1 text-[11px] font-medium text-sky-200">
        <HardDrive className="h-3 w-3" /> Google Cloud
      </span>
    );
  }

  if (source === "github") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-400/20 bg-violet-400/10 px-2.5 py-1 text-[11px] font-medium text-violet-200">
        <GitBranch className="h-3 w-3" /> Repo / public
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-[11px] font-medium text-emerald-200">
      <Database className="h-3 w-3" /> Supabase
    </span>
  );
}

function sourceLabel(source: AssetSource) {
  if (source === "gcs") return "Google Cloud";
  if (source === "github") return "Repo / public";
  return "Supabase";
}

function ModalShell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/75 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div className="w-full max-w-2xl rounded-[2rem] border border-white/10 bg-[#0b0812] p-5 shadow-2xl shadow-violet-950/40" onMouseDown={(event) => event.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

export default function AdminAssetsPage() {
  const [items, setItems] = useState<Asset[]>([]);
  const [buckets, setBuckets] = useState<StorageBucket[]>([]);
  const [warnings, setWarnings] = useState<SourceWarning[]>([]);
  const [gcsBucket, setGcsBucket] = useState("clouva-generated-media");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [source, setSource] = useState<AssetSource | "all">("all");
  const [bucketFilter, setBucketFilter] = useState("all");
  const [kindFilter, setKindFilter] = useState<AssetKind | "all">("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [formatFilter, setFormatFilter] = useState("all");
  const [sortMode, setSortMode] = useState<SortMode>("updated-desc");
  const [view, setView] = useState<"grid" | "list">("grid");

  const [previewAsset, setPreviewAsset] = useState<Asset | null>(null);
  const [renameAsset, setRenameAsset] = useState<Asset | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteAsset, setDeleteAsset] = useState<Asset | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadFolder, setUploadFolder] = useState("uploads");
  const [uploadName, setUploadName] = useState("");
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const response = await authenticatedFetch("/api/admin/assets");
      const data = await readApiJson<AssetList>(response);
      setItems(data.items);
      setBuckets(data.buckets);
      setWarnings(data.warnings ?? []);
      setGcsBucket(data.gcsBucket);
      const availableKeys = new Set(data.items.map(assetKey));
      setSelectedKeys((current) => new Set(Array.from(current).filter((key) => availableKeys.has(key))));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudieron cargar los assets.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const bucketOptions = useMemo(() => {
    const names = buckets
      .filter((bucket) => source === "all" || bucket.source === source)
      .map((bucket) => bucket.name);
    return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b));
  }, [buckets, source]);

  const categoryOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const asset of items) {
      const category = assetCategory(asset);
      counts.set(category, (counts.get(category) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort(([a], [b]) => categoryLabel(a).localeCompare(categoryLabel(b), "es"));
  }, [items]);

  const formatOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const asset of items) {
      const format = assetExtension(asset);
      counts.set(format, (counts.get(format) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort(([a], [b]) => {
      const aPriority = FORMAT_PRIORITY.indexOf(a);
      const bPriority = FORMAT_PRIORITY.indexOf(b);
      if (aPriority !== -1 || bPriority !== -1) {
        if (aPriority === -1) return 1;
        if (bPriority === -1) return -1;
        return aPriority - bPriority;
      }
      return a.localeCompare(b);
    });
  }, [items]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const result = items.filter((asset) => {
      if (source !== "all" && asset.source !== source) return false;
      if (bucketFilter !== "all" && asset.bucket !== bucketFilter) return false;
      if (kindFilter !== "all" && assetKind(asset) !== kindFilter) return false;
      if (categoryFilter !== "all" && assetCategory(asset) !== categoryFilter) return false;
      if (formatFilter !== "all" && assetExtension(asset) !== formatFilter) return false;
      if (query) {
        const haystack = `${asset.name} ${asset.path} ${asset.folder} ${asset.bucket} ${asset.contentType ?? ""} ${assetExtension(asset)} ${categoryLabel(assetCategory(asset))}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });

    return result.sort((a, b) => {
      if (sortMode === "name-asc") return a.name.localeCompare(b.name);
      if (sortMode === "size-desc") return b.size - a.size;
      if (sortMode === "size-asc") return a.size - b.size;
      return String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? ""));
    });
  }, [items, search, source, bucketFilter, kindFilter, categoryFilter, formatFilter, sortMode]);

  const selectedAssets = useMemo(() => items.filter((asset) => selectedKeys.has(assetKey(asset))), [items, selectedKeys]);
  const allVisibleSelected = filtered.length > 0 && filtered.every((asset) => selectedKeys.has(assetKey(asset)));

  const totalSize = useMemo(() => items.reduce((sum, asset) => sum + asset.size, 0), [items]);
  const images = useMemo(() => items.filter((asset) => assetKind(asset) === "image").length, [items]);
  const models = useMemo(() => items.filter((asset) => assetKind(asset) === "3d").length, [items]);
  const pngCount = useMemo(() => items.filter((asset) => assetExtension(asset) === "PNG").length, [items]);
  const glbCount = useMemo(() => items.filter((asset) => assetExtension(asset) === "GLB").length, [items]);

  const hasLibraryFilters = categoryFilter !== "all" || formatFilter !== "all" || kindFilter !== "all" || source !== "all" || bucketFilter !== "all" || search.trim();

  const clearFilters = () => {
    setSearch("");
    setSource("all");
    setBucketFilter("all");
    setKindFilter("all");
    setCategoryFilter("all");
    setFormatFilter("all");
  };

  const toggleSelection = (asset: Asset) => {
    const key = assetKey(asset);
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleVisibleSelection = () => {
    const visibleKeys = filtered.map(assetKey);
    setSelectedKeys((current) => {
      const next = new Set(current);
      const shouldClear = visibleKeys.length > 0 && visibleKeys.every((key) => next.has(key));
      for (const key of visibleKeys) {
        if (shouldClear) next.delete(key);
        else next.add(key);
      }
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedKeys(new Set());
    setBulkDeleteOpen(false);
  };

  const copy = async (value: string) => {
    await navigator.clipboard.writeText(value);
    setMessage("Copiado al portapapeles.");
  };

  const submitRename = async () => {
    if (!renameAsset || !renameValue.trim() || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await authenticatedFetch("/api/admin/assets", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: renameAsset.source,
          bucket: renameAsset.bucket,
          path: renameAsset.path,
          name: renameValue.trim(),
        }),
      });
      const result = await readApiJson<MutationResult>(response);
      setSelectedKeys((current) => {
        const next = new Set(current);
        next.delete(assetKey(renameAsset));
        return next;
      });
      setRenameAsset(null);
      setRenameValue("");
      setMessage(
        result.updatedReferences
          ? `Asset renombrado y ${result.updatedReferences} referencia${result.updatedReferences === 1 ? "" : "s"} del repo actualizada${result.updatedReferences === 1 ? "" : "s"}.`
          : "Asset renombrado.",
      );
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo renombrar el asset.");
    } finally {
      setBusy(false);
    }
  };

  const submitDelete = async () => {
    if (!deleteAsset || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await authenticatedFetch("/api/admin/assets", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: deleteAsset.source,
          bucket: deleteAsset.bucket,
          path: deleteAsset.path,
        }),
      });
      await readApiJson<MutationResult>(response);
      const deletedKey = assetKey(deleteAsset);
      setSelectedKeys((current) => {
        const next = new Set(current);
        next.delete(deletedKey);
        return next;
      });
      setDeleteAsset(null);
      setPreviewAsset((current) => current && assetKey(current) === deletedKey ? null : current);
      await load();
      setMessage("Asset eliminado.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo eliminar el asset.");
    } finally {
      setBusy(false);
    }
  };

  const submitBulkDelete = async () => {
    if (!selectedAssets.length || busy) return;
    const targets = [...selectedAssets];
    const failed: Array<{ asset: Asset; message: string }> = [];
    const deletedKeys = new Set<string>();

    setBusy(true);
    setMessage(null);
    setBulkProgress({ done: 0, total: targets.length });

    try {
      for (let index = 0; index < targets.length; index += 1) {
        const asset = targets[index];
        try {
          const response = await authenticatedFetch("/api/admin/assets", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              source: asset.source,
              bucket: asset.bucket,
              path: asset.path,
            }),
          });
          await readApiJson<MutationResult>(response);
          deletedKeys.add(assetKey(asset));
        } catch (error) {
          failed.push({
            asset,
            message: error instanceof Error ? error.message : "No se pudo eliminar.",
          });
        } finally {
          setBulkProgress({ done: index + 1, total: targets.length });
        }
      }

      const failedKeys = new Set(failed.map(({ asset }) => assetKey(asset)));
      setSelectedKeys(failedKeys);
      setPreviewAsset((current) => current && deletedKeys.has(assetKey(current)) ? null : current);
      setBulkDeleteOpen(false);
      await load();

      const deletedCount = deletedKeys.size;
      if (!failed.length) {
        setMessage(`${deletedCount} asset${deletedCount === 1 ? "" : "s"} eliminado${deletedCount === 1 ? "" : "s"}.`);
      } else {
        const first = failed[0];
        const extra = failed.length > 1 ? ` y ${failed.length - 1} más` : "";
        setMessage(`${deletedCount} eliminado${deletedCount === 1 ? "" : "s"}. ${failed.length} no se pudo${failed.length === 1 ? "" : "ieron"} eliminar: ${first.asset.name} — ${first.message}${extra}.`);
      }
    } finally {
      setBulkProgress(null);
      setBusy(false);
    }
  };

  const upload = async () => {
    if (!uploadFiles.length || busy) return;
    setBusy(true);
    setMessage(null);
    let uploaded = 0;

    try {
      for (let index = 0; index < uploadFiles.length; index += 1) {
        const file = uploadFiles[index];
        setMessage(`Subiendo ${index + 1}/${uploadFiles.length}: ${file.name}…`);
        const form = new FormData();
        form.set("file", file);
        form.set("folder", uploadFolder);
        if (uploadFiles.length === 1 && uploadName.trim()) form.set("name", uploadName.trim());
        const response = await authenticatedFetch("/api/admin/assets", { method: "POST", body: form });
        await readApiJson<UploadResult>(response);
        uploaded += 1;
      }

      setUploadFiles([]);
      setUploadName("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      setUploadOpen(false);
      setMessage(uploaded === 1 ? "Asset subido." : `${uploaded} assets subidos.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo completar la subida.");
    } finally {
      setBusy(false);
    }
  };

  const openRename = (asset: Asset) => {
    setRenameAsset(asset);
    setRenameValue(asset.name);
  };

  return (
    <div className="space-y-5 pb-24 text-white">
      <header className="overflow-hidden rounded-[2rem] border border-violet-400/20 bg-[radial-gradient(circle_at_top_right,rgba(139,92,246,0.22),transparent_38%),rgba(0,0,0,0.38)] p-5 md:p-7">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-violet-300/20 bg-violet-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-violet-200">CLOUVA OS</span>
              <span className="text-xs text-white/35">Admin · Biblioteca de assets</span>
            </div>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight md:text-4xl">Todos los assets</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-white/50">Inventario unificado de Google Cloud Storage, Supabase Storage y los assets estáticos de <code className="text-violet-200">public/</code>. Navegá por categoría, formato, tipo, storage y bucket sin cambiar la arquitectura actual.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void load()} disabled={loading || busy} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 text-sm text-white/75 hover:bg-white/[0.08] disabled:opacity-40">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Actualizar
            </button>
            <button type="button" onClick={() => setUploadOpen((value) => !value)} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-white px-5 text-sm font-semibold text-black hover:bg-violet-100">
              <Upload className="h-4 w-4" /> Subir asset
            </button>
          </div>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-6">
        {[
          ["Assets", items.length.toLocaleString("es-AR"), <HardDrive key="assets" className="h-4 w-4" />],
          ["Peso total", formatBytes(totalSize), <Database key="size" className="h-4 w-4" />],
          ["Imágenes", images.toLocaleString("es-AR"), <ImageIcon key="images" className="h-4 w-4" />],
          ["Modelos 3D", models.toLocaleString("es-AR"), <Box key="models" className="h-4 w-4" />],
          ["PNG", pngCount.toLocaleString("es-AR"), <ImageIcon key="png" className="h-4 w-4" />],
          ["GLB", glbCount.toLocaleString("es-AR"), <Box key="glb" className="h-4 w-4" />],
        ].map(([label, value, icon]) => (
          <div key={String(label)} className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.15em] text-white/35">{icon}{label}</div>
            <p className="mt-2 text-xl font-semibold md:text-2xl">{value}</p>
          </div>
        ))}
      </section>

      {warnings.length ? (
        <section className="rounded-2xl border border-amber-300/15 bg-amber-300/[0.06] p-4">
          <div className="flex items-start gap-3">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-200" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-amber-100">El inventario cargó parcialmente</p>
              <div className="mt-1 space-y-1 text-xs text-amber-100/60">
                {warnings.map((warning) => <p key={`${warning.source}:${warning.message}`}><strong>{sourceLabel(warning.source)}:</strong> {warning.message}</p>)}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {uploadOpen ? (
        <section className="rounded-[2rem] border border-violet-400/20 bg-violet-400/[0.055] p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-200">Subida manual</p>
              <h2 className="mt-1 text-xl font-semibold">Agregar assets a CLOUVA</h2>
              <p className="mt-1 text-xs text-white/40">Destino: {gcsBucket}/admin-assets/...</p>
            </div>
            <button type="button" onClick={() => setUploadOpen(false)} className="rounded-full border border-white/10 p-2 text-white/55"><X className="h-4 w-4" /></button>
          </div>
          <div className="mt-5 grid gap-4 lg:grid-cols-[0.8fr_1fr_1.2fr_auto] lg:items-end">
            <label className="block text-xs text-white/50">Categoría / carpeta
              <select value={uploadFolder} onChange={(event) => setUploadFolder(event.target.value)} className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-black/35 px-3 text-sm outline-none">
                {UPLOAD_FOLDERS.map((folder) => <option key={folder} value={folder}>{categoryLabel(folder)}</option>)}
              </select>
            </label>
            <label className="block text-xs text-white/50">Nombre opcional
              <input value={uploadName} onChange={(event) => setUploadName(event.target.value)} disabled={uploadFiles.length > 1} placeholder="logo-oficial.png" className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-black/35 px-3 text-sm outline-none focus:border-violet-400/50 disabled:opacity-40" />
            </label>
            <label className="block text-xs text-white/50">Archivo(s)
              <input ref={fileInputRef} type="file" multiple onChange={(event) => setUploadFiles(Array.from(event.currentTarget.files ?? []))} className="mt-2 block h-12 w-full rounded-xl border border-white/10 bg-black/35 p-2 text-xs" />
            </label>
            <button type="button" onClick={() => void upload()} disabled={!uploadFiles.length || busy} className="h-12 rounded-xl bg-violet-500 px-5 text-sm font-semibold text-white disabled:opacity-40">
              {busy ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : `Subir${uploadFiles.length > 1 ? ` ${uploadFiles.length}` : ""}`}
            </button>
          </div>
        </section>
      ) : null}

      <section className="rounded-[2rem] border border-white/10 bg-white/[0.025] p-4 md:p-5">
        <div className="grid gap-3 xl:grid-cols-[minmax(280px,1fr)_180px_220px_170px_190px_auto]">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar nombre, ruta, categoría o formato…" className="h-11 w-full rounded-xl border border-white/10 bg-black/30 pl-10 pr-3 text-sm outline-none focus:border-violet-400/50" />
          </label>
          <select value={source} onChange={(event) => { setSource(event.target.value as AssetSource | "all"); setBucketFilter("all"); }} className="h-11 rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-white/80 outline-none">
            <option value="all">Todos los storages</option>
            <option value="gcs">Google Cloud</option>
            <option value="supabase">Supabase</option>
            <option value="github">Repo / public</option>
          </select>
          <select value={bucketFilter} onChange={(event) => setBucketFilter(event.target.value)} className="h-11 rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-white/80 outline-none">
            <option value="all">Todos los buckets</option>
            {bucketOptions.map((bucket) => <option key={bucket} value={bucket}>{bucket}</option>)}
          </select>
          <select value={kindFilter} onChange={(event) => setKindFilter(event.target.value as AssetKind | "all")} className="h-11 rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-white/80 outline-none">
            <option value="all">Todos los tipos</option>
            <option value="image">Imágenes</option>
            <option value="video">Videos</option>
            <option value="audio">Audio</option>
            <option value="3d">3D</option>
            <option value="document">Documentos</option>
            <option value="other">Otros</option>
          </select>
          <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)} className="h-11 rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-white/80 outline-none">
            <option value="updated-desc">Más recientes</option>
            <option value="name-asc">Nombre A–Z</option>
            <option value="size-desc">Más pesados</option>
            <option value="size-asc">Más livianos</option>
          </select>
          <div className="flex h-11 rounded-xl border border-white/10 bg-black/30 p-1">
            <button type="button" onClick={() => setView("grid")} className={`grid flex-1 place-items-center rounded-lg px-3 ${view === "grid" ? "bg-violet-500/20 text-violet-200" : "text-white/35"}`} aria-label="Vista en grilla"><Grid2X2 className="h-4 w-4" /></button>
            <button type="button" onClick={() => setView("list")} className={`grid flex-1 place-items-center rounded-lg px-3 ${view === "list" ? "bg-violet-500/20 text-violet-200" : "text-white/35"}`} aria-label="Vista en lista"><List className="h-4 w-4" /></button>
          </div>
        </div>

        <div className="mt-5 border-t border-white/[0.07] pt-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/35">Categorías</p>
            {hasLibraryFilters ? <button type="button" onClick={clearFilters} className="text-xs text-violet-200/80 hover:text-violet-100">Limpiar filtros</button> : null}
          </div>
          <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
            <button type="button" onClick={() => setCategoryFilter("all")} className={`shrink-0 rounded-full border px-3 py-2 text-xs transition ${categoryFilter === "all" ? "border-violet-400/40 bg-violet-500/20 text-violet-100" : "border-white/10 bg-black/25 text-white/50 hover:bg-white/[0.05]"}`}>Todas <span className="ml-1 text-white/35">{items.length}</span></button>
            {categoryOptions.map(([category, count]) => (
              <button key={category} type="button" onClick={() => setCategoryFilter(category)} className={`shrink-0 rounded-full border px-3 py-2 text-xs transition ${categoryFilter === category ? "border-violet-400/40 bg-violet-500/20 text-violet-100" : "border-white/10 bg-black/25 text-white/50 hover:bg-white/[0.05]"}`}>
                {categoryLabel(category)} <span className="ml-1 text-white/35">{count}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/35">Formatos</p>
          <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
            <button type="button" onClick={() => setFormatFilter("all")} className={`shrink-0 rounded-full border px-3 py-2 text-xs font-semibold transition ${formatFilter === "all" ? "border-violet-400/40 bg-violet-500/20 text-violet-100" : "border-white/10 bg-black/25 text-white/50 hover:bg-white/[0.05]"}`}>TODOS</button>
            {formatOptions.map(([format, count]) => (
              <button key={format} type="button" onClick={() => setFormatFilter(format)} className={`shrink-0 rounded-full border px-3 py-2 text-xs font-semibold transition ${formatFilter === format ? "border-violet-400/40 bg-violet-500/20 text-violet-100" : "border-white/10 bg-black/25 text-white/55 hover:bg-white/[0.05]"}`}>
                {format} <span className="ml-1 font-normal text-white/35">{count}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-white/35">
          <span>Mostrando {filtered.length.toLocaleString("es-AR")} de {items.length.toLocaleString("es-AR")} assets</span>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button type="button" onClick={toggleVisibleSelection} disabled={!filtered.length || busy} className="rounded-full border border-white/10 px-3 py-1.5 text-white/60 transition hover:bg-white/[0.05] disabled:opacity-35">
              {allVisibleSelected ? "Quitar selección visible" : `Seleccionar visibles (${filtered.length.toLocaleString("es-AR")})`}
            </button>
            <span>{buckets.length} fuente{buckets.length === 1 ? "" : "s"}/bucket{buckets.length === 1 ? "" : "s"} detectado{buckets.length === 1 ? "" : "s"}</span>
          </div>
        </div>
      </section>

      {selectedAssets.length ? (
        <section className="sticky top-3 z-40 flex flex-col gap-3 rounded-2xl border border-violet-400/30 bg-[#120d20]/95 px-4 py-3 shadow-2xl shadow-black/30 backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-xl border border-violet-400/30 bg-violet-500/15 text-violet-200"><Check className="h-4 w-4" /></span>
            <div>
              <p className="text-sm font-semibold">{selectedAssets.length.toLocaleString("es-AR")} asset{selectedAssets.length === 1 ? "" : "s"} seleccionado{selectedAssets.length === 1 ? "" : "s"}</p>
              <p className="text-xs text-white/35">Podés seguir seleccionando en la grilla o en la lista.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={toggleVisibleSelection} disabled={busy} className="rounded-full border border-white/10 px-4 py-2 text-xs text-white/65 hover:bg-white/[0.06] disabled:opacity-40">{allVisibleSelected ? "Quitar visibles" : "Sumar visibles"}</button>
            <button type="button" onClick={clearSelection} disabled={busy} className="rounded-full border border-white/10 px-4 py-2 text-xs text-white/65 hover:bg-white/[0.06] disabled:opacity-40">Limpiar</button>
            <button type="button" onClick={() => setBulkDeleteOpen(true)} disabled={busy} className="inline-flex items-center gap-2 rounded-full bg-red-500 px-4 py-2 text-xs font-semibold text-white hover:bg-red-400 disabled:opacity-40"><Trash2 className="h-3.5 w-3.5" /> Eliminar {selectedAssets.length.toLocaleString("es-AR")}</button>
          </div>
        </section>
      ) : null}

      {message ? (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-violet-400/20 bg-violet-400/10 px-4 py-3 text-sm text-violet-100">
          <span>{message}</span><button type="button" onClick={() => setMessage(null)}><X className="h-4 w-4" /></button>
        </div>
      ) : null}

      {loading ? (
        <div className="grid min-h-64 place-items-center rounded-[2rem] border border-white/10 bg-white/[0.02]">
          <div className="text-center text-sm text-white/45"><Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin text-violet-300" />Leyendo todos los assets de CLOUVA…</div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="grid min-h-64 place-items-center rounded-[2rem] border border-dashed border-white/10 bg-white/[0.02] p-8 text-center">
          <div><Search className="mx-auto h-7 w-7 text-white/20" /><p className="mt-3 font-medium">No hay assets con esos filtros.</p><p className="mt-1 text-sm text-white/35">Probá otra categoría, formato o storage.</p></div>
        </div>
      ) : view === "grid" ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {filtered.map((asset) => {
            const selected = selectedKeys.has(assetKey(asset));
            return (
              <article key={assetKey(asset)} className={`group overflow-hidden rounded-2xl border bg-black/25 transition hover:border-violet-400/25 hover:bg-white/[0.045] ${selected ? "border-violet-400/55 bg-violet-500/[0.08] ring-1 ring-violet-400/20" : "border-white/10"}`}>
                <div className="relative">
                  <button type="button" onClick={() => setPreviewAsset(asset)} className="relative block aspect-[16/9] w-full overflow-hidden bg-[radial-gradient(circle_at_center,rgba(139,92,246,0.12),transparent_60%)]">
                    {assetKind(asset) === "image" && asset.url ? (
                      <img src={asset.url} alt={asset.name} loading="lazy" className="h-full w-full object-contain transition duration-300 group-hover:scale-[1.02]" />
                    ) : assetKind(asset) === "video" && asset.url ? (
                      <video src={asset.url} muted preload="metadata" className="h-full w-full object-contain" />
                    ) : (
                      <div className="grid h-full place-items-center text-white/25"><KindIcon asset={asset} className="h-10 w-10" /></div>
                    )}
                    <div className="absolute left-2 top-2 flex flex-wrap gap-1.5">
                      <span className="rounded-full border border-white/10 bg-black/70 px-2.5 py-1 text-[10px] font-bold tracking-[0.08em] text-white/80 backdrop-blur">{assetExtension(asset)}</span>
                      <span className="max-w-40 truncate rounded-full border border-violet-400/20 bg-violet-500/15 px-2.5 py-1 text-[10px] text-violet-100/80 backdrop-blur">{categoryLabel(assetCategory(asset))}</span>
                    </div>
                    <span className="absolute right-12 top-2 rounded-full bg-black/65 p-2 text-white/65 opacity-0 backdrop-blur transition group-hover:opacity-100"><Eye className="h-4 w-4" /></span>
                  </button>
                  <button type="button" onClick={() => toggleSelection(asset)} aria-pressed={selected} aria-label={selected ? `Quitar ${asset.name} de la selección` : `Seleccionar ${asset.name}`} className={`absolute right-2 top-2 z-10 grid h-9 w-9 place-items-center rounded-xl border backdrop-blur transition ${selected ? "border-violet-300/70 bg-violet-500 text-white" : "border-white/20 bg-black/70 text-white/40 hover:border-violet-300/50 hover:text-white"}`}>
                    {selected ? <Check className="h-4 w-4" /> : <span className="h-3.5 w-3.5 rounded-[4px] border border-current" />}
                  </button>
                </div>
                <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0"><p className="truncate text-sm font-semibold" title={asset.name}>{asset.name}</p><p className="mt-1 truncate text-[11px] text-white/35" title={asset.path}>{asset.path}</p></div>
                    <SourceBadge source={asset.source} />
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3 text-xs text-white/40"><span>{formatBytes(asset.size)}</span><span className="truncate">{asset.bucket}</span></div>
                  <div className="mt-4 grid grid-cols-3 gap-2">
                    <button type="button" onClick={() => setPreviewAsset(asset)} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-white/10 text-xs text-white/70 hover:bg-white/[0.06]"><Eye className="h-3.5 w-3.5" /> Ver</button>
                    <button type="button" onClick={() => openRename(asset)} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-white/10 text-xs text-white/70 hover:bg-white/[0.06]"><Pencil className="h-3.5 w-3.5" /> Renombrar</button>
                    <button type="button" onClick={() => setDeleteAsset(asset)} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-red-400/15 text-xs text-red-300/80 hover:bg-red-400/10"><Trash2 className="h-3.5 w-3.5" /> Eliminar</button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-black/20">
          <div className="hidden grid-cols-[44px_minmax(260px,1.4fr)_90px_150px_130px_minmax(150px,0.8fr)_100px_150px] gap-3 border-b border-white/10 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/30 xl:grid">
            <button type="button" onClick={toggleVisibleSelection} disabled={!filtered.length || busy} className={`grid h-7 w-7 place-items-center rounded-lg border ${allVisibleSelected ? "border-violet-300/60 bg-violet-500 text-white" : "border-white/15 text-white/35"}`} aria-label={allVisibleSelected ? "Quitar selección visible" : "Seleccionar todo lo visible"}>{allVisibleSelected ? <Check className="h-3.5 w-3.5" /> : null}</button>
            <span>Asset</span><span>Formato</span><span>Categoría</span><span>Storage</span><span>Bucket</span><span>Tamaño</span><span className="text-right">Acciones</span>
          </div>
          {filtered.map((asset) => {
            const selected = selectedKeys.has(assetKey(asset));
            return (
              <div key={assetKey(asset)} className={`grid gap-3 border-b p-4 last:border-0 xl:grid-cols-[44px_minmax(260px,1.4fr)_90px_150px_130px_minmax(150px,0.8fr)_100px_150px] xl:items-center ${selected ? "border-violet-400/20 bg-violet-500/[0.07]" : "border-white/[0.07]"}`}>
                <button type="button" onClick={() => toggleSelection(asset)} aria-pressed={selected} className={`grid h-9 w-9 place-items-center rounded-xl border transition ${selected ? "border-violet-300/60 bg-violet-500 text-white" : "border-white/15 bg-black/20 text-white/35 hover:border-violet-300/40"}`} aria-label={selected ? `Quitar ${asset.name} de la selección` : `Seleccionar ${asset.name}`}>{selected ? <Check className="h-4 w-4" /> : <span className="h-3.5 w-3.5 rounded-[4px] border border-current" />}</button>
                <button type="button" onClick={() => setPreviewAsset(asset)} className="flex min-w-0 items-center gap-3 text-left">
                  <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-lg border border-white/10 bg-white/[0.035] text-white/35">
                    {assetKind(asset) === "image" && asset.url ? <img src={asset.url} alt="" loading="lazy" className="h-full w-full object-cover" /> : <KindIcon asset={asset} className="h-4 w-4" />}
                  </span>
                  <span className="min-w-0"><span className="block truncate text-sm font-medium">{asset.name}</span><span className="mt-0.5 block truncate text-[11px] text-white/35">{asset.path}</span></span>
                </button>
                <span className="w-fit rounded-full border border-white/10 bg-white/[0.035] px-2.5 py-1 text-[10px] font-bold text-white/70">{assetExtension(asset)}</span>
                <span className="truncate text-xs text-violet-100/65">{categoryLabel(assetCategory(asset))}</span>
                <div><SourceBadge source={asset.source} /></div>
                <span className="truncate text-xs text-white/50" title={asset.bucket}>{asset.bucket}</span>
                <span className="text-xs text-white/50">{formatBytes(asset.size)}</span>
                <div className="flex justify-end gap-1.5">
                  <button type="button" onClick={() => setPreviewAsset(asset)} className="rounded-lg border border-white/10 p-2 text-white/55" title="Ver"><Eye className="h-3.5 w-3.5" /></button>
                  <button type="button" onClick={() => openRename(asset)} className="rounded-lg border border-white/10 p-2 text-white/55" title="Renombrar"><Pencil className="h-3.5 w-3.5" /></button>
                  <button type="button" onClick={() => setDeleteAsset(asset)} className="rounded-lg border border-red-400/15 p-2 text-red-300/70" title="Eliminar"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {previewAsset ? (
        <ModalShell onClose={() => setPreviewAsset(null)}>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><SourceBadge source={previewAsset.source} /><span className="rounded-full border border-white/10 px-2.5 py-1 text-[10px] font-bold text-white/70">{assetExtension(previewAsset)}</span><span className="rounded-full border border-violet-400/20 bg-violet-500/10 px-2.5 py-1 text-[10px] text-violet-100/75">{categoryLabel(assetCategory(previewAsset))}</span><span className="text-xs text-white/35">{previewAsset.bucket}</span></div><h2 className="mt-3 truncate text-xl font-semibold">{previewAsset.name}</h2><p className="mt-1 break-all text-xs text-white/35">{previewAsset.path}</p></div>
            <button type="button" onClick={() => setPreviewAsset(null)} className="shrink-0 rounded-full border border-white/10 p-2 text-white/55"><X className="h-4 w-4" /></button>
          </div>
          <div className="mt-5 overflow-hidden rounded-2xl border border-white/10 bg-black/35">
            {assetKind(previewAsset) === "image" && previewAsset.url ? <img src={previewAsset.url} alt={previewAsset.name} className="max-h-[55vh] w-full object-contain" /> : null}
            {assetKind(previewAsset) === "video" && previewAsset.url ? <video src={previewAsset.url} controls className="max-h-[55vh] w-full" /> : null}
            {assetKind(previewAsset) === "audio" && previewAsset.url ? <div className="p-8"><audio src={previewAsset.url} controls className="w-full" /></div> : null}
            {assetKind(previewAsset) === "document" && previewAsset.contentType?.includes("pdf") && previewAsset.url ? <iframe src={previewAsset.url} title={previewAsset.name} className="h-[55vh] w-full" /> : null}
            {!previewAsset.url || ["3d", "other"].includes(assetKind(previewAsset)) || (assetKind(previewAsset) === "document" && !previewAsset.contentType?.includes("pdf")) ? <div className="grid min-h-64 place-items-center p-8 text-center text-white/30"><div><KindIcon asset={previewAsset} className="mx-auto h-12 w-12" /><p className="mt-3 text-sm">{previewAsset.contentType ?? "Archivo"}</p></div></div> : null}
          </div>
          <div className="mt-4 grid gap-3 rounded-2xl border border-white/10 bg-white/[0.025] p-4 text-xs sm:grid-cols-2 lg:grid-cols-4"><div><span className="text-white/30">Formato</span><p className="mt-1 font-semibold text-white/75">{assetExtension(previewAsset)}</p></div><div><span className="text-white/30">Categoría</span><p className="mt-1 truncate text-white/70">{categoryLabel(assetCategory(previewAsset))}</p></div><div><span className="text-white/30">Tamaño</span><p className="mt-1 text-white/70">{formatBytes(previewAsset.size)}</p></div><div><span className="text-white/30">Modificado</span><p className="mt-1 text-white/70">{formatDate(previewAsset.updatedAt)}</p></div></div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={() => void copy(previewAsset.path)} className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-xs text-white/70"><Copy className="h-3.5 w-3.5" /> Copiar ruta</button>
            {previewAsset.url ? <><button type="button" onClick={() => void copy(previewAsset.url!)} className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-xs text-white/70"><Copy className="h-3.5 w-3.5" /> Copiar URL</button><a href={previewAsset.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full border border-violet-400/20 px-4 py-2 text-xs text-violet-200"><ExternalLink className="h-3.5 w-3.5" /> Abrir original</a></> : null}
            <button type="button" onClick={() => { setPreviewAsset(null); openRename(previewAsset); }} className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-xs text-white/70"><Pencil className="h-3.5 w-3.5" /> Renombrar</button>
            <button type="button" onClick={() => { setPreviewAsset(null); setDeleteAsset(previewAsset); }} className="inline-flex items-center gap-2 rounded-full border border-red-400/15 px-4 py-2 text-xs text-red-300"><Trash2 className="h-3.5 w-3.5" /> Eliminar</button>
          </div>
        </ModalShell>
      ) : null}

      {renameAsset ? (
        <ModalShell onClose={() => !busy && setRenameAsset(null)}>
          <div className="flex items-start justify-between gap-4"><div><p className="text-xs uppercase tracking-[0.16em] text-violet-300">Renombrar asset</p><h2 className="mt-2 text-xl font-semibold">{renameAsset.name}</h2></div><button type="button" disabled={busy} onClick={() => setRenameAsset(null)} className="rounded-full border border-white/10 p-2 text-white/55"><X className="h-4 w-4" /></button></div>
          <p className="mt-4 text-xs text-white/40">{sourceLabel(renameAsset.source)} · {renameAsset.bucket} · {renameAsset.folder || "/"}</p>
          <input autoFocus value={renameValue} onChange={(event) => setRenameValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void submitRename(); }} className="mt-4 h-12 w-full rounded-xl border border-white/10 bg-black/35 px-4 text-sm outline-none focus:border-violet-400/60" />
          <p className="mt-2 text-xs text-white/35">{renameAsset.source === "github" ? "En public/ se crea un único commit y las referencias encontradas en el código se actualizan en el mismo cambio." : "Se conserva la carpeta actual y cambia el nombre del objeto en Storage."}</p>
          <div className="mt-5 flex justify-end gap-2"><button type="button" disabled={busy} onClick={() => setRenameAsset(null)} className="rounded-full border border-white/10 px-4 py-2 text-sm text-white/60">Cancelar</button><button type="button" disabled={!renameValue.trim() || busy} onClick={() => void submitRename()} className="inline-flex min-w-28 items-center justify-center gap-2 rounded-full bg-violet-500 px-5 py-2 text-sm font-semibold disabled:opacity-40">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Guardar</button></div>
        </ModalShell>
      ) : null}

      {deleteAsset ? (
        <ModalShell onClose={() => !busy && setDeleteAsset(null)}>
          <div className="grid h-12 w-12 place-items-center rounded-2xl border border-red-400/20 bg-red-400/10 text-red-300"><Trash2 className="h-5 w-5" /></div>
          <h2 className="mt-4 text-xl font-semibold">Eliminar asset</h2>
          <p className="mt-2 text-sm leading-6 text-white/50">Se va a eliminar <strong className="text-white/80">{deleteAsset.name}</strong> de <strong className="text-white/70">{sourceLabel(deleteAsset.source)} · {deleteAsset.bucket}</strong>.</p>
          {deleteAsset.source === "github" ? <p className="mt-2 text-xs leading-5 text-white/40">Si el asset todavía está referenciado por código, CLOUVA no lo borra y te muestra qué archivos lo están usando.</p> : null}
          <p className="mt-3 break-all rounded-xl border border-white/10 bg-black/30 p-3 text-xs text-white/35">{deleteAsset.path}</p>
          <div className="mt-5 flex justify-end gap-2"><button type="button" disabled={busy} onClick={() => setDeleteAsset(null)} className="rounded-full border border-white/10 px-4 py-2 text-sm text-white/60">Cancelar</button><button type="button" disabled={busy} onClick={() => void submitDelete()} className="inline-flex min-w-28 items-center justify-center gap-2 rounded-full bg-red-500 px-5 py-2 text-sm font-semibold text-white disabled:opacity-40">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Eliminar</button></div>
        </ModalShell>
      ) : null}

      {bulkDeleteOpen && selectedAssets.length ? (
        <ModalShell onClose={() => !busy && setBulkDeleteOpen(false)}>
          <div className="grid h-12 w-12 place-items-center rounded-2xl border border-red-400/20 bg-red-400/10 text-red-300"><Trash2 className="h-5 w-5" /></div>
          <h2 className="mt-4 text-xl font-semibold">Eliminar {selectedAssets.length.toLocaleString("es-AR")} assets</h2>
          <p className="mt-2 text-sm leading-6 text-white/50">Se van a eliminar todos los assets seleccionados, respetando las validaciones actuales de cada storage.</p>
          {selectedAssets.some((asset) => asset.source === "github") ? <p className="mt-2 text-xs leading-5 text-white/40">Los assets de <code className="text-violet-200">public/</code> que sigan referenciados por el código no se eliminan. El resto continúa procesándose y los que fallen quedan seleccionados.</p> : null}
          <div className="mt-4 max-h-56 space-y-2 overflow-y-auto rounded-2xl border border-white/10 bg-black/30 p-3">
            {selectedAssets.slice(0, 12).map((asset) => <div key={assetKey(asset)} className="flex items-center justify-between gap-3 text-xs"><span className="min-w-0 truncate text-white/70">{asset.name}</span><span className="shrink-0 text-white/30">{sourceLabel(asset.source)}</span></div>)}
            {selectedAssets.length > 12 ? <p className="pt-1 text-xs text-white/35">+ {selectedAssets.length - 12} assets más</p> : null}
          </div>
          {bulkProgress ? <div className="mt-4"><div className="flex items-center justify-between text-xs text-white/45"><span>Eliminando…</span><span>{bulkProgress.done}/{bulkProgress.total}</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-red-400 transition-all" style={{ width: `${bulkProgress.total ? (bulkProgress.done / bulkProgress.total) * 100 : 0}%` }} /></div></div> : null}
          <div className="mt-5 flex justify-end gap-2"><button type="button" disabled={busy} onClick={() => setBulkDeleteOpen(false)} className="rounded-full border border-white/10 px-4 py-2 text-sm text-white/60">Cancelar</button><button type="button" disabled={busy} onClick={() => void submitBulkDelete()} className="inline-flex min-w-36 items-center justify-center gap-2 rounded-full bg-red-500 px-5 py-2 text-sm font-semibold text-white disabled:opacity-40">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Eliminar {selectedAssets.length.toLocaleString("es-AR")}</button></div>
        </ModalShell>
      ) : null}
    </div>
  );
}
