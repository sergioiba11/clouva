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
  MoreVertical,
  Music2,
  Pencil,
  RefreshCw,
  Search,
  TableProperties,
  Trash2,
  TriangleAlert,
  Upload,
  Video,
  X,
} from "lucide-react";
import { AssetExplorer } from "@/components/admin/assets/AssetExplorer";
import {
  ASSET_CATEGORIES,
  categoryLabel,
  normalizeAdminAssets,
  type AdminAsset,
  type AdminAssetCategory,
  type AdminAssetKind,
  type AdminAssetSource,
  type NormalizedAdminAsset,
} from "@/lib/admin-assets/classification";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type StorageBucket = {
  source: AdminAssetSource;
  name: string;
  public: boolean | null;
};

type SourceWarning = {
  source: AdminAssetSource;
  message: string;
};

type AssetList = {
  items: AdminAsset[];
  buckets: StorageBucket[];
  warnings?: SourceWarning[];
  total: number;
  gcsBucket: string;
};

type UploadResult = {
  asset?: AdminAsset | null;
  imported?: number;
  kind?: string;
};

type MutationResult = {
  ok: true;
  path: string;
  name?: string;
  updatedReferences?: number;
  commitSha?: string;
};

type SortMode = "updated-desc" | "name-asc" | "size-desc" | "size-asc" | "category" | "format" | "storage";
type ViewMode = "explorer" | "grid" | "list";

const VIEW_STORAGE_KEY = "clouva-admin-assets-view";
const GROUP_STORAGE_KEY = "clouva-admin-assets-group-variants";
const UPLOAD_FOLDERS = [
  { id: "brand", label: "Marca / Logos" },
  { id: "backgrounds", label: "Fondos" },
  { id: "players", label: "Players / Avatares" },
  { id: "garments", label: "Ropa" },
  { id: "products", label: "Productos" },
  { id: "3d", label: "3D" },
  { id: "audio", label: "Audio" },
  { id: "video", label: "Video" },
  { id: "ui", label: "UI" },
  { id: "icons", label: "Iconos" },
  { id: "uploads", label: "Uploads" },
];
const FORMAT_PRIORITY = ["GLB", "FBX", "PNG", "WEBP", "JPG", "JPEG", "SVG", "GLTF", "OBJ", "MP4", "MOV", "WEBM", "MP3", "WAV", "OGG", "M4A", "PDF", "JSON"];

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

function sourceLabel(source: AdminAssetSource) {
  if (source === "gcs") return "Google Cloud";
  if (source === "github") return "Repo / public";
  return "Supabase";
}

function KindIcon({ asset, className = "h-5 w-5" }: { asset: NormalizedAdminAsset; className?: string }) {
  if (asset.kind === "image") return <ImageIcon className={className} />;
  if (asset.kind === "video") return <Video className={className} />;
  if (asset.kind === "audio") return <Music2 className={className} />;
  if (asset.kind === "3d") return <Box className={className} />;
  if (asset.kind === "document") return <FileText className={className} />;
  return <File className={className} />;
}

function SourceBadge({ source }: { source: AdminAssetSource }) {
  if (source === "gcs") {
    return <span className="inline-flex items-center gap-1 rounded-full border border-sky-400/20 bg-sky-400/10 px-2 py-1 text-[10px] text-sky-200"><HardDrive className="h-3 w-3" />Cloud</span>;
  }
  if (source === "github") {
    return <span className="inline-flex items-center gap-1 rounded-full border border-violet-400/20 bg-violet-400/10 px-2 py-1 text-[10px] text-violet-200"><GitBranch className="h-3 w-3" />public</span>;
  }
  return <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-[10px] text-emerald-200"><Database className="h-3 w-3" />Supabase</span>;
}

function ModalShell({ children, onClose, maxWidth = "max-w-2xl" }: { children: React.ReactNode; onClose: () => void; maxWidth?: string }) {
  return (
    <div className="fixed inset-0 z-[150] grid place-items-center bg-black/75 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div className={`w-full ${maxWidth} max-h-[92vh] overflow-y-auto rounded-[1.6rem] border border-white/10 bg-[#0b0812] p-5 shadow-2xl shadow-violet-950/40`} onMouseDown={(event) => event.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

export default function AdminAssetsPage() {
  const [items, setItems] = useState<AdminAsset[]>([]);
  const [buckets, setBuckets] = useState<StorageBucket[]>([]);
  const [warnings, setWarnings] = useState<SourceWarning[]>([]);
  const [gcsBucket, setGcsBucket] = useState("clouva-generated-media");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [source, setSource] = useState<AdminAssetSource | "all">("all");
  const [bucketFilter, setBucketFilter] = useState("all");
  const [kindFilter, setKindFilter] = useState<AdminAssetKind | "all">("all");
  const [categoryFilter, setCategoryFilter] = useState<AdminAssetCategory | "all">("all");
  const [formatFilter, setFormatFilter] = useState("all");
  const [sortMode, setSortMode] = useState<SortMode>("updated-desc");
  const [view, setView] = useState<ViewMode>("explorer");
  const [groupVariants, setGroupVariants] = useState(true);

  const [previewAsset, setPreviewAsset] = useState<NormalizedAdminAsset | null>(null);
  const [renameAsset, setRenameAsset] = useState<NormalizedAdminAsset | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteAsset, setDeleteAsset] = useState<NormalizedAdminAsset | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [openMenuKey, setOpenMenuKey] = useState<string | null>(null);
  const lastSelectedIndexRef = useRef<number | null>(null);

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
      const available = new Set(data.items.map((asset) => `${asset.source}:${asset.bucket}:${asset.path}`));
      setSelectedKeys((current) => new Set(Array.from(current).filter((key) => available.has(key))));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudieron cargar los assets.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    try {
      const savedView = window.localStorage.getItem(VIEW_STORAGE_KEY);
      if (savedView === "explorer" || savedView === "grid" || savedView === "list") setView(savedView);
      const savedGroup = window.localStorage.getItem(GROUP_STORAGE_KEY);
      if (savedGroup === "0") setGroupVariants(false);
      if (savedGroup === "1") setGroupVariants(true);
    } catch { /* localStorage can be unavailable in hardened browsers */ }
  }, []);

  useEffect(() => {
    try { window.localStorage.setItem(VIEW_STORAGE_KEY, view); } catch { /* ignore */ }
  }, [view]);

  useEffect(() => {
    try { window.localStorage.setItem(GROUP_STORAGE_KEY, groupVariants ? "1" : "0"); } catch { /* ignore */ }
  }, [groupVariants]);

  const normalized = useMemo(() => normalizeAdminAssets(items), [items]);

  const bucketOptions = useMemo(() => {
    const names = buckets.filter((bucket) => source === "all" || bucket.source === source).map((bucket) => bucket.name);
    return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b));
  }, [buckets, source]);

  const formatOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const asset of normalized) counts.set(asset.extension, (counts.get(asset.extension) ?? 0) + 1);
    return Array.from(counts.entries()).sort(([a], [b]) => {
      const ai = FORMAT_PRIORITY.indexOf(a);
      const bi = FORMAT_PRIORITY.indexOf(b);
      if (ai !== -1 || bi !== -1) {
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      }
      return a.localeCompare(b);
    });
  }, [normalized]);

  const categoryCounts = useMemo(() => {
    const result = Object.fromEntries(ASSET_CATEGORIES.map((category) => [category.id, 0])) as Record<AdminAssetCategory, number>;
    for (const asset of normalized) result[asset.category] += 1;
    return result;
  }, [normalized]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
    const result = normalized.filter((asset) => {
      if (source !== "all" && asset.source !== source) return false;
      if (bucketFilter !== "all" && asset.bucket !== bucketFilter) return false;
      if (kindFilter !== "all" && asset.kind !== kindFilter) return false;
      if (categoryFilter !== "all" && asset.category !== categoryFilter) return false;
      if (formatFilter !== "all" && asset.extension !== formatFilter) return false;
      if (query && !asset.searchText.includes(query)) return false;
      return true;
    });

    return result.sort((a, b) => {
      if (sortMode === "name-asc") return a.name.localeCompare(b.name, "es");
      if (sortMode === "size-desc") return b.size - a.size || a.name.localeCompare(b.name, "es");
      if (sortMode === "size-asc") return a.size - b.size || a.name.localeCompare(b.name, "es");
      if (sortMode === "category") return a.categoryLabel.localeCompare(b.categoryLabel, "es") || a.name.localeCompare(b.name, "es");
      if (sortMode === "format") return a.extension.localeCompare(b.extension, "es") || a.name.localeCompare(b.name, "es");
      if (sortMode === "storage") return sourceLabel(a.source).localeCompare(sourceLabel(b.source), "es") || a.name.localeCompare(b.name, "es");
      return String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")) || a.name.localeCompare(b.name, "es");
    });
  }, [normalized, search, source, bucketFilter, kindFilter, categoryFilter, formatFilter, sortMode]);

  const filteredIndex = useMemo(() => new Map(filtered.map((asset, index) => [asset.key, index])), [filtered]);
  const selectedAssets = useMemo(() => normalized.filter((asset) => selectedKeys.has(asset.key)), [normalized, selectedKeys]);
  const allFilteredSelected = filtered.length > 0 && filtered.every((asset) => selectedKeys.has(asset.key));
  const totalSize = useMemo(() => normalized.reduce((sum, asset) => sum + asset.size, 0), [normalized]);
  const imageCount = useMemo(() => normalized.filter((asset) => asset.kind === "image").length, [normalized]);
  const modelCount = useMemo(() => normalized.filter((asset) => asset.kind === "3d").length, [normalized]);
  const pngCount = useMemo(() => normalized.filter((asset) => asset.extension === "PNG").length, [normalized]);
  const glbCount = useMemo(() => normalized.filter((asset) => asset.extension === "GLB").length, [normalized]);
  const hasFilters = Boolean(search.trim() || source !== "all" || bucketFilter !== "all" || kindFilter !== "all" || categoryFilter !== "all" || formatFilter !== "all");

  const setAssetsSelection = useCallback((assets: NormalizedAdminAsset[], selected: boolean) => {
    setSelectedKeys((current) => {
      const next = new Set(current);
      for (const asset of assets) {
        if (selected) next.add(asset.key);
        else next.delete(asset.key);
      }
      return next;
    });
  }, []);

  const toggleSelection = useCallback((asset: NormalizedAdminAsset, shiftKey = false) => {
    const index = filteredIndex.get(asset.key);
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (shiftKey && index != null && lastSelectedIndexRef.current != null) {
        const from = Math.min(lastSelectedIndexRef.current, index);
        const to = Math.max(lastSelectedIndexRef.current, index);
        for (let cursor = from; cursor <= to; cursor += 1) next.add(filtered[cursor].key);
      } else if (next.has(asset.key)) {
        next.delete(asset.key);
      } else {
        next.add(asset.key);
      }
      return next;
    });
    if (index != null) lastSelectedIndexRef.current = index;
  }, [filtered, filteredIndex]);

  const toggleFilteredSelection = useCallback(() => {
    setAssetsSelection(filtered, !allFilteredSelected);
  }, [allFilteredSelected, filtered, setAssetsSelection]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        setAssetsSelection(filtered, true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [filtered, setAssetsSelection]);

  const clearFilters = () => {
    setSearch("");
    setSource("all");
    setBucketFilter("all");
    setKindFilter("all");
    setCategoryFilter("all");
    setFormatFilter("all");
  };

  const clearSelection = () => {
    setSelectedKeys(new Set());
    setBulkDeleteOpen(false);
    lastSelectedIndexRef.current = null;
  };

  const copy = async (value: string) => {
    await navigator.clipboard.writeText(value);
    setMessage("Copiado al portapapeles.");
  };

  const openRename = (asset: NormalizedAdminAsset) => {
    setOpenMenuKey(null);
    setRenameAsset(asset);
    setRenameValue(asset.name);
  };

  const submitRename = async () => {
    if (!renameAsset || !renameValue.trim() || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await authenticatedFetch("/api/admin/assets", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: renameAsset.source, bucket: renameAsset.bucket, path: renameAsset.path, name: renameValue.trim() }),
      });
      const result = await readApiJson<MutationResult>(response);
      setSelectedKeys((current) => { const next = new Set(current); next.delete(renameAsset.key); return next; });
      setRenameAsset(null);
      setRenameValue("");
      await load();
      setMessage(result.updatedReferences ? `Asset renombrado y ${result.updatedReferences} referencia${result.updatedReferences === 1 ? "" : "s"} actualizada${result.updatedReferences === 1 ? "" : "s"}.` : "Asset renombrado.");
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
        body: JSON.stringify({ source: deleteAsset.source, bucket: deleteAsset.bucket, path: deleteAsset.path }),
      });
      await readApiJson<MutationResult>(response);
      const deletedKey = deleteAsset.key;
      setSelectedKeys((current) => { const next = new Set(current); next.delete(deletedKey); return next; });
      setDeleteAsset(null);
      setPreviewAsset((current) => current?.key === deletedKey ? null : current);
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
    const failed: Array<{ asset: NormalizedAdminAsset; message: string }> = [];
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
            body: JSON.stringify({ source: asset.source, bucket: asset.bucket, path: asset.path }),
          });
          await readApiJson<MutationResult>(response);
          deletedKeys.add(asset.key);
        } catch (error) {
          failed.push({ asset, message: error instanceof Error ? error.message : "No se pudo eliminar." });
        } finally {
          setBulkProgress({ done: index + 1, total: targets.length });
        }
      }

      setSelectedKeys(new Set(failed.map(({ asset }) => asset.key)));
      setPreviewAsset((current) => current && deletedKeys.has(current.key) ? null : current);
      setBulkDeleteOpen(false);
      await load();
      const deleted = deletedKeys.size;
      if (!failed.length) {
        setMessage(`${deleted} asset${deleted === 1 ? "" : "s"} eliminado${deleted === 1 ? "" : "s"}.`);
      } else {
        const first = failed[0];
        setMessage(`${deleted} eliminado${deleted === 1 ? "" : "s"}. ${failed.length} no se pudo${failed.length === 1 ? "" : "ieron"} eliminar. ${first.asset.name}: ${first.message}${failed.length > 1 ? ` · +${failed.length - 1} más` : ""}`);
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
    let uploadedFiles = 0;
    let importedAssets = 0;
    try {
      for (let index = 0; index < uploadFiles.length; index += 1) {
        const file = uploadFiles[index];
        setMessage(`Subiendo ${index + 1}/${uploadFiles.length}: ${file.name}…`);
        const form = new FormData();
        form.set("file", file);
        form.set("folder", uploadFolder);
        if (uploadFiles.length === 1 && uploadName.trim()) form.set("name", uploadName.trim());
        const response = await authenticatedFetch("/api/admin/assets", { method: "POST", body: form });
        const result = await readApiJson<UploadResult>(response);
        uploadedFiles += 1;
        importedAssets += result.imported ?? 1;
      }
      setUploadFiles([]);
      setUploadName("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      setUploadOpen(false);
      await load();
      setMessage(importedAssets > uploadedFiles ? `${importedAssets} assets importados desde ${uploadedFiles} archivo${uploadedFiles === 1 ? "" : "s"}.` : uploadedFiles === 1 ? "Asset subido." : `${uploadedFiles} assets subidos.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo completar la subida.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 pb-24 text-white">
      <header className="rounded-[1.5rem] border border-violet-400/15 bg-[radial-gradient(circle_at_top_right,rgba(139,92,246,0.16),transparent_36%),rgba(0,0,0,0.32)] px-4 py-4 md:px-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2"><span className="rounded-full border border-violet-300/20 bg-violet-400/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-200">CLOUVA OS</span><span className="text-xs text-white/30">Admin · Asset Explorer</span></div>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">CLOUVA Asset Explorer</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void load()} disabled={loading || busy} className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.035] px-3 text-xs text-white/65 hover:bg-white/[0.07] disabled:opacity-40"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Actualizar</button>
            <button type="button" onClick={() => setUploadOpen((value) => !value)} className="inline-flex h-10 items-center gap-2 rounded-xl bg-white px-4 text-xs font-semibold text-black hover:bg-violet-100"><Upload className="h-4 w-4" />Subir asset</button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-white/[0.06] pt-3 text-xs text-white/38">
          <span><strong className="text-white/65">{normalized.length.toLocaleString("es-AR")}</strong> assets</span>
          <span>{formatBytes(totalSize)}</span>
          <span>{imageCount.toLocaleString("es-AR")} imágenes</span>
          <span>{modelCount.toLocaleString("es-AR")} modelos 3D</span>
          <span>{pngCount.toLocaleString("es-AR")} PNG</span>
          <span>{glbCount.toLocaleString("es-AR")} GLB</span>
        </div>
      </header>

      {warnings.length ? (
        <section className="rounded-xl border border-amber-300/15 bg-amber-300/[0.055] px-4 py-3">
          <div className="flex items-start gap-3"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-200" /><div><p className="text-sm font-medium text-amber-100">El inventario cargó parcialmente</p>{warnings.map((warning) => <p key={`${warning.source}:${warning.message}`} className="mt-1 text-xs text-amber-100/55"><strong>{sourceLabel(warning.source)}:</strong> {warning.message}</p>)}</div></div>
        </section>
      ) : null}

      {uploadOpen ? (
        <section className="rounded-[1.4rem] border border-violet-400/20 bg-violet-400/[0.05] p-4">
          <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.15em] text-violet-200">Subida manual</p><p className="mt-1 text-xs text-white/35">Destino: {gcsBucket}/admin-assets/…</p></div><button type="button" onClick={() => setUploadOpen(false)} className="rounded-lg border border-white/10 p-2 text-white/45"><X className="h-4 w-4" /></button></div>
          <div className="mt-3 grid gap-3 lg:grid-cols-[0.8fr_1fr_1.3fr_auto] lg:items-end">
            <label className="text-xs text-white/45">Categoría<select value={uploadFolder} onChange={(event) => setUploadFolder(event.target.value)} className="mt-1.5 h-11 w-full rounded-xl border border-white/10 bg-black/35 px-3 text-sm outline-none">{UPLOAD_FOLDERS.map((folder) => <option key={folder.id} value={folder.id}>{folder.label}</option>)}</select></label>
            <label className="text-xs text-white/45">Nombre opcional<input value={uploadName} onChange={(event) => setUploadName(event.target.value)} disabled={uploadFiles.length > 1} placeholder="logo-oficial.png" className="mt-1.5 h-11 w-full rounded-xl border border-white/10 bg-black/35 px-3 text-sm outline-none disabled:opacity-35" /></label>
            <label className="text-xs text-white/45">Archivo(s)<input ref={fileInputRef} type="file" multiple onChange={(event) => setUploadFiles(Array.from(event.currentTarget.files ?? []))} className="mt-1.5 block h-11 w-full rounded-xl border border-white/10 bg-black/35 p-2 text-xs" /></label>
            <button type="button" onClick={() => void upload()} disabled={!uploadFiles.length || busy} className="h-11 rounded-xl bg-violet-500 px-5 text-sm font-semibold disabled:opacity-40">{busy ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : `Subir${uploadFiles.length > 1 ? ` ${uploadFiles.length}` : ""}`}</button>
          </div>
        </section>
      ) : null}

      <section className="sticky top-14 z-30 rounded-[1.3rem] border border-white/10 bg-[#0b0911]/95 p-3 shadow-xl shadow-black/20 backdrop-blur-xl">
        <div className="grid gap-2 xl:grid-cols-[minmax(260px,1.4fr)_150px_145px_145px_170px_165px_auto]">
          <label className="relative block"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar nombre, ruta, categoría, familia, storage…" className="h-10 w-full rounded-xl border border-white/10 bg-black/30 pl-9 pr-3 text-sm outline-none focus:border-violet-400/45" /></label>
          <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value as AdminAssetCategory | "all")} className="h-10 rounded-xl border border-white/10 bg-black/30 px-3 text-xs text-white/70 outline-none"><option value="all">Todas categorías</option>{ASSET_CATEGORIES.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}</select>
          <select value={kindFilter} onChange={(event) => setKindFilter(event.target.value as AdminAssetKind | "all")} className="h-10 rounded-xl border border-white/10 bg-black/30 px-3 text-xs text-white/70 outline-none"><option value="all">Todos los tipos</option><option value="image">Imágenes</option><option value="video">Video</option><option value="audio">Audio</option><option value="3d">3D</option><option value="document">Documentos</option><option value="other">Otros</option></select>
          <select value={formatFilter} onChange={(event) => setFormatFilter(event.target.value)} className="h-10 rounded-xl border border-white/10 bg-black/30 px-3 text-xs text-white/70 outline-none"><option value="all">Todos formatos</option>{formatOptions.map(([format, count]) => <option key={format} value={format}>{format} ({count})</option>)}</select>
          <select value={source} onChange={(event) => { setSource(event.target.value as AdminAssetSource | "all"); setBucketFilter("all"); }} className="h-10 rounded-xl border border-white/10 bg-black/30 px-3 text-xs text-white/70 outline-none"><option value="all">Todos los storages</option><option value="gcs">Google Cloud</option><option value="supabase">Supabase</option><option value="github">Repo / public</option></select>
          <select value={bucketFilter} onChange={(event) => setBucketFilter(event.target.value)} className="h-10 rounded-xl border border-white/10 bg-black/30 px-3 text-xs text-white/70 outline-none"><option value="all">Todos los buckets</option>{bucketOptions.map((bucket) => <option key={bucket} value={bucket}>{bucket}</option>)}</select>
          <div className="flex h-10 rounded-xl border border-white/10 bg-black/30 p-1">
            <button type="button" onClick={() => setView("explorer")} className={`grid flex-1 place-items-center rounded-lg px-2 ${view === "explorer" ? "bg-violet-500/20 text-violet-200" : "text-white/30"}`} title="Explorador"><TableProperties className="h-4 w-4" /></button>
            <button type="button" onClick={() => setView("grid")} className={`grid flex-1 place-items-center rounded-lg px-2 ${view === "grid" ? "bg-violet-500/20 text-violet-200" : "text-white/30"}`} title="Grilla"><Grid2X2 className="h-4 w-4" /></button>
            <button type="button" onClick={() => setView("list")} className={`grid flex-1 place-items-center rounded-lg px-2 ${view === "list" ? "bg-violet-500/20 text-violet-200" : "text-white/30"}`} title="Lista"><List className="h-4 w-4" /></button>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs text-white/35"><span>{hasFilters ? `${filtered.length.toLocaleString("es-AR")} de ${normalized.length.toLocaleString("es-AR")} assets` : `${normalized.length.toLocaleString("es-AR")} assets`}</span>{hasFilters ? <button type="button" onClick={clearFilters} className="text-violet-200/75 hover:text-violet-100">Limpiar filtros</button> : null}</div>
          <div className="flex items-center gap-2"><select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)} className="h-8 rounded-lg border border-white/10 bg-black/30 px-2 text-[11px] text-white/55 outline-none"><option value="updated-desc">Más recientes</option><option value="name-asc">Nombre A–Z</option><option value="size-desc">Más pesados</option><option value="size-asc">Más livianos</option><option value="category">Categoría</option><option value="format">Formato</option><option value="storage">Storage</option></select><button type="button" onClick={toggleFilteredSelection} disabled={!filtered.length || busy} className="h-8 rounded-lg border border-white/10 px-3 text-[11px] text-white/55 hover:bg-white/[0.05] disabled:opacity-30">{allFilteredSelected ? "Quitar resultados" : `Seleccionar resultados (${filtered.length})`}</button></div>
        </div>
      </section>

      {selectedAssets.length ? (
        <section className="sticky top-[8.8rem] z-20 flex flex-col gap-2 rounded-xl border border-violet-400/25 bg-[#130d20]/96 px-4 py-2.5 shadow-xl backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2"><span className="grid h-8 w-8 place-items-center rounded-lg bg-violet-500/15 text-violet-200"><Check className="h-4 w-4" /></span><span className="text-sm font-semibold">{selectedAssets.length.toLocaleString("es-AR")} seleccionado{selectedAssets.length === 1 ? "" : "s"}</span></div>
          <div className="flex flex-wrap gap-2"><button type="button" onClick={toggleFilteredSelection} disabled={busy} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-white/60">{allFilteredSelected ? "Quitar resultados" : "Sumar resultados"}</button><button type="button" onClick={clearSelection} disabled={busy} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-white/60">Limpiar</button><button type="button" onClick={() => setBulkDeleteOpen(true)} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-red-500 px-3 py-2 text-xs font-semibold"><Trash2 className="h-3.5 w-3.5" />Eliminar {selectedAssets.length}</button></div>
        </section>
      ) : null}

      {message ? <div className="flex items-center justify-between gap-3 rounded-xl border border-violet-400/20 bg-violet-400/10 px-4 py-3 text-sm text-violet-100"><span className="min-w-0 break-words">{message}</span><button type="button" onClick={() => setMessage(null)}><X className="h-4 w-4" /></button></div> : null}

      {loading ? (
        <div className="grid min-h-72 place-items-center rounded-[1.5rem] border border-white/10 bg-white/[0.02]"><div className="text-center text-sm text-white/40"><Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin text-violet-300" />Leyendo el inventario completo…</div></div>
      ) : filtered.length === 0 ? (
        <div className="grid min-h-72 place-items-center rounded-[1.5rem] border border-dashed border-white/10 bg-white/[0.02] p-8 text-center"><div><Search className="mx-auto h-7 w-7 text-white/20" /><p className="mt-3 font-medium">No hay assets con esos filtros.</p><button type="button" onClick={clearFilters} className="mt-2 text-sm text-violet-200/70">Limpiar filtros</button></div></div>
      ) : view === "explorer" ? (
        <AssetExplorer
          assets={filtered}
          totalAssets={normalized.length}
          categoryCounts={categoryCounts}
          activeCategory={categoryFilter}
          onCategoryChange={setCategoryFilter}
          selectedKeys={selectedKeys}
          onToggleSelection={toggleSelection}
          onSetAssetsSelection={setAssetsSelection}
          onPreview={setPreviewAsset}
          onRename={openRename}
          onDelete={(asset) => { setOpenMenuKey(null); setDeleteAsset(asset); }}
          groupVariants={groupVariants}
          onGroupVariantsChange={setGroupVariants}
          busy={busy}
        />
      ) : view === "grid" ? (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {filtered.map((asset) => {
            const selected = selectedKeys.has(asset.key);
            const menuOpen = openMenuKey === asset.key;
            return (
              <article key={asset.key} className={`group relative overflow-hidden rounded-xl border bg-black/25 transition ${selected ? "border-violet-400/55 bg-violet-500/[0.07] ring-1 ring-violet-400/15" : "border-white/10 hover:border-violet-400/25"}`}>
                <button type="button" onClick={() => setPreviewAsset(asset)} className="relative block aspect-[4/3] w-full overflow-hidden bg-[radial-gradient(circle_at_center,rgba(139,92,246,0.1),transparent_62%)]">
                  {asset.kind === "image" && asset.url ? <img src={asset.url} alt={asset.name} loading="lazy" className="h-full w-full object-contain" /> : asset.kind === "video" && asset.url ? <video src={asset.url} muted preload="metadata" className="h-full w-full object-contain" /> : <span className="grid h-full place-items-center text-white/22"><KindIcon asset={asset} className="h-9 w-9" /></span>}
                </button>
                <button type="button" onClick={(event) => { event.stopPropagation(); toggleSelection(asset, event.shiftKey); }} className={`absolute left-2 top-2 z-10 grid h-8 w-8 place-items-center rounded-lg border backdrop-blur ${selected ? "border-violet-300/60 bg-violet-500 text-white" : "border-white/20 bg-black/70 text-white/30"}`}>{selected ? <Check className="h-4 w-4" /> : null}</button>
                <button type="button" onClick={() => setOpenMenuKey(menuOpen ? null : asset.key)} className="absolute right-2 top-2 z-10 grid h-8 w-8 place-items-center rounded-lg border border-white/15 bg-black/70 text-white/50 backdrop-blur"><MoreVertical className="h-4 w-4" /></button>
                {menuOpen ? <div className="absolute right-2 top-11 z-30 w-44 rounded-xl border border-white/10 bg-[#100d17] p-1.5 shadow-2xl"><button type="button" onClick={() => { setOpenMenuKey(null); setPreviewAsset(asset); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-white/65 hover:bg-white/[0.06]"><Eye className="h-3.5 w-3.5" />Ver</button><button type="button" onClick={() => openRename(asset)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-white/65 hover:bg-white/[0.06]"><Pencil className="h-3.5 w-3.5" />Renombrar</button><button type="button" onClick={() => { void copy(asset.path); setOpenMenuKey(null); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-white/65 hover:bg-white/[0.06]"><Copy className="h-3.5 w-3.5" />Copiar ruta</button>{asset.url ? <button type="button" onClick={() => { void copy(asset.url!); setOpenMenuKey(null); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-white/65 hover:bg-white/[0.06]"><Copy className="h-3.5 w-3.5" />Copiar URL</button> : null}<button type="button" onClick={() => { setOpenMenuKey(null); setDeleteAsset(asset); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-red-300 hover:bg-red-400/10"><Trash2 className="h-3.5 w-3.5" />Eliminar</button></div> : null}
                <div className="p-3"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-xs font-semibold" title={asset.name}>{asset.name}</p><p className="mt-1 truncate text-[10px] text-violet-100/45">{asset.categoryLabel}</p></div><SourceBadge source={asset.source} /></div><div className="mt-2 flex items-center gap-2 text-[10px] text-white/32"><span className="rounded-full border border-white/10 px-2 py-0.5 font-bold text-white/50">{asset.extension}</span><span>{formatBytes(asset.size)}</span></div></div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="overflow-hidden rounded-[1.3rem] border border-white/10 bg-black/20">
          {filtered.map((asset) => {
            const selected = selectedKeys.has(asset.key);
            return <div key={asset.key} className={`grid min-h-[48px] grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-2 border-b px-3 py-1.5 last:border-0 md:grid-cols-[36px_minmax(220px,1.5fr)_80px_140px_90px_120px_auto] ${selected ? "border-violet-400/20 bg-violet-500/[0.06]" : "border-white/[0.06]"}`}><button type="button" onClick={(event) => toggleSelection(asset, event.shiftKey)} className={`grid h-7 w-7 place-items-center rounded-lg border ${selected ? "border-violet-300/60 bg-violet-500" : "border-white/15 text-white/25"}`}>{selected ? <Check className="h-3.5 w-3.5" /> : null}</button><button type="button" onClick={() => setPreviewAsset(asset)} className="flex min-w-0 items-center gap-2 text-left"><span className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-md border border-white/10 bg-white/[0.03]">{asset.kind === "image" && asset.url ? <img src={asset.url} alt="" loading="lazy" className="h-full w-full object-cover" /> : <KindIcon asset={asset} className="h-4 w-4 text-white/25" />}</span><span className="min-w-0"><span className="block truncate text-xs font-medium">{asset.name}</span><span className="block truncate text-[10px] text-white/28">{asset.path}</span></span></button><span className="hidden text-[10px] font-bold text-white/50 md:block">{asset.extension}</span><span className="hidden truncate text-xs text-violet-100/55 md:block">{asset.categoryLabel}</span><span className="hidden text-xs text-white/35 md:block">{formatBytes(asset.size)}</span><span className="hidden text-xs text-white/30 md:block">{sourceLabel(asset.source)}</span><div className="flex justify-end gap-1"><button type="button" onClick={() => setPreviewAsset(asset)} className="rounded-md border border-white/10 p-1.5 text-white/40"><Eye className="h-3.5 w-3.5" /></button><button type="button" onClick={() => openRename(asset)} className="hidden rounded-md border border-white/10 p-1.5 text-white/40 sm:block"><Pencil className="h-3.5 w-3.5" /></button><button type="button" onClick={() => setDeleteAsset(asset)} className="rounded-md border border-red-400/15 p-1.5 text-red-300/60"><Trash2 className="h-3.5 w-3.5" /></button></div></div>;
          })}
        </div>
      )}

      {previewAsset ? (
        <ModalShell onClose={() => setPreviewAsset(null)}>
          <div className="flex items-start justify-between gap-4"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><SourceBadge source={previewAsset.source} /><span className="rounded-full border border-white/10 px-2 py-1 text-[10px] font-bold text-white/60">{previewAsset.extension}</span><span className="rounded-full border border-violet-400/20 bg-violet-500/10 px-2 py-1 text-[10px] text-violet-100/70">{previewAsset.categoryLabel}</span></div><h2 className="mt-3 truncate text-xl font-semibold">{previewAsset.name}</h2><p className="mt-1 break-all text-xs text-white/30">{previewAsset.path}</p></div><button type="button" onClick={() => setPreviewAsset(null)} className="rounded-lg border border-white/10 p-2 text-white/45"><X className="h-4 w-4" /></button></div>
          <div className="mt-4 overflow-hidden rounded-xl border border-white/10 bg-black/35">{previewAsset.kind === "image" && previewAsset.url ? <img src={previewAsset.url} alt={previewAsset.name} className="max-h-[52vh] w-full object-contain" /> : null}{previewAsset.kind === "video" && previewAsset.url ? <video src={previewAsset.url} controls className="max-h-[52vh] w-full" /> : null}{previewAsset.kind === "audio" && previewAsset.url ? <div className="p-8"><audio src={previewAsset.url} controls className="w-full" /></div> : null}{previewAsset.kind === "document" && previewAsset.contentType?.includes("pdf") && previewAsset.url ? <iframe src={previewAsset.url} title={previewAsset.name} className="h-[52vh] w-full" /> : null}{!previewAsset.url || previewAsset.kind === "3d" || previewAsset.kind === "other" || (previewAsset.kind === "document" && !previewAsset.contentType?.includes("pdf")) ? <div className="grid min-h-56 place-items-center p-8 text-center text-white/25"><div><KindIcon asset={previewAsset} className="mx-auto h-11 w-11" /><p className="mt-3 text-sm">{previewAsset.contentType ?? "Archivo"}</p></div></div> : null}</div>
          <div className="mt-3 grid gap-2 rounded-xl border border-white/10 bg-white/[0.02] p-3 text-xs sm:grid-cols-2 lg:grid-cols-4"><div><span className="text-white/28">Categoría</span><p className="mt-1 text-white/70">{previewAsset.categoryLabel}</p></div><div><span className="text-white/28">Subcategoría</span><p className="mt-1 text-white/70">{previewAsset.subcategory ?? "—"}</p></div><div><span className="text-white/28">Tamaño</span><p className="mt-1 text-white/70">{formatBytes(previewAsset.size)}</p></div><div><span className="text-white/28">Modificado</span><p className="mt-1 text-white/70">{formatDate(previewAsset.updatedAt)}</p></div><div><span className="text-white/28">Storage</span><p className="mt-1 text-white/70">{sourceLabel(previewAsset.source)}</p></div><div className="sm:col-span-2"><span className="text-white/28">Bucket</span><p className="mt-1 truncate text-white/70">{previewAsset.bucket}</p></div><div><span className="text-white/28">Familia</span><p className="mt-1 truncate text-white/70">{previewAsset.familyLabel ?? "—"}</p></div></div>
          <div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={() => void copy(previewAsset.path)} className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs text-white/60"><Copy className="h-3.5 w-3.5" />Copiar ruta</button>{previewAsset.url ? <><button type="button" onClick={() => void copy(previewAsset.url!)} className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs text-white/60"><Copy className="h-3.5 w-3.5" />Copiar URL</button><a href={previewAsset.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-lg border border-violet-400/20 px-3 py-2 text-xs text-violet-200"><ExternalLink className="h-3.5 w-3.5" />Abrir original</a></> : null}<button type="button" onClick={() => { setPreviewAsset(null); openRename(previewAsset); }} className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs text-white/60"><Pencil className="h-3.5 w-3.5" />Renombrar</button><button type="button" onClick={() => { setPreviewAsset(null); setDeleteAsset(previewAsset); }} className="inline-flex items-center gap-2 rounded-lg border border-red-400/15 px-3 py-2 text-xs text-red-300"><Trash2 className="h-3.5 w-3.5" />Eliminar</button></div>
        </ModalShell>
      ) : null}

      {renameAsset ? (
        <ModalShell onClose={() => !busy && setRenameAsset(null)}>
          <div className="flex items-start justify-between gap-4"><div><p className="text-xs uppercase tracking-[0.15em] text-violet-300">Renombrar asset</p><h2 className="mt-2 text-lg font-semibold">{renameAsset.name}</h2></div><button type="button" disabled={busy} onClick={() => setRenameAsset(null)} className="rounded-lg border border-white/10 p-2 text-white/45"><X className="h-4 w-4" /></button></div><p className="mt-3 text-xs text-white/35">{sourceLabel(renameAsset.source)} · {renameAsset.bucket}</p><input autoFocus value={renameValue} onChange={(event) => setRenameValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void submitRename(); }} className="mt-4 h-11 w-full rounded-xl border border-white/10 bg-black/35 px-4 text-sm outline-none focus:border-violet-400/55" /><p className="mt-2 text-xs text-white/30">{renameAsset.source === "github" ? "En public/ se actualizan las referencias detectadas en el mismo cambio." : "Se conserva la carpeta física actual; solo cambia el nombre del objeto."}</p><div className="mt-5 flex justify-end gap-2"><button type="button" disabled={busy} onClick={() => setRenameAsset(null)} className="rounded-lg border border-white/10 px-4 py-2 text-sm text-white/55">Cancelar</button><button type="button" disabled={!renameValue.trim() || busy} onClick={() => void submitRename()} className="inline-flex min-w-28 items-center justify-center gap-2 rounded-lg bg-violet-500 px-4 py-2 text-sm font-semibold disabled:opacity-40">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Guardar</button></div>
        </ModalShell>
      ) : null}

      {deleteAsset ? (
        <ModalShell onClose={() => !busy && setDeleteAsset(null)}>
          <div className="grid h-11 w-11 place-items-center rounded-xl border border-red-400/20 bg-red-400/10 text-red-300"><Trash2 className="h-5 w-5" /></div><h2 className="mt-4 text-xl font-semibold">Eliminar asset</h2><p className="mt-2 text-sm leading-6 text-white/50">Se va a eliminar <strong className="text-white/80">{deleteAsset.name}</strong> de <strong className="text-white/70">{sourceLabel(deleteAsset.source)} · {deleteAsset.bucket}</strong>.</p>{deleteAsset.source === "github" ? <p className="mt-2 text-xs leading-5 text-white/38">Si todavía está referenciado por código, CLOUVA bloquea el borrado y muestra los archivos que lo usan.</p> : null}<p className="mt-3 break-all rounded-xl border border-white/10 bg-black/30 p-3 text-xs text-white/30">{deleteAsset.path}</p><div className="mt-5 flex justify-end gap-2"><button type="button" disabled={busy} onClick={() => setDeleteAsset(null)} className="rounded-lg border border-white/10 px-4 py-2 text-sm text-white/55">Cancelar</button><button type="button" disabled={busy} onClick={() => void submitDelete()} className="inline-flex min-w-28 items-center justify-center gap-2 rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold disabled:opacity-40">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}Eliminar</button></div>
        </ModalShell>
      ) : null}

      {bulkDeleteOpen ? (
        <ModalShell onClose={() => !busy && setBulkDeleteOpen(false)}>
          <div className="flex items-start justify-between gap-4"><div><p className="text-xs uppercase tracking-[0.15em] text-red-300">Borrado múltiple</p><h2 className="mt-2 text-xl font-semibold">Eliminar {selectedAssets.length.toLocaleString("es-AR")} assets</h2></div><button type="button" disabled={busy} onClick={() => setBulkDeleteOpen(false)} className="rounded-lg border border-white/10 p-2 text-white/45"><X className="h-4 w-4" /></button></div><p className="mt-3 text-sm leading-6 text-white/45">CLOUVA procesa cada asset con las mismas protecciones del borrado individual. Si uno está en uso, continúa con los demás y deja seleccionado el que falló.</p><div className="mt-3 max-h-44 overflow-y-auto rounded-xl border border-white/10 bg-black/30 p-3 text-xs text-white/40">{selectedAssets.slice(0, 30).map((asset) => <div key={asset.key} className="flex items-center justify-between gap-3 border-b border-white/[0.05] py-1.5 last:border-0"><span className="truncate">{asset.name}</span><span className="shrink-0 text-white/25">{asset.categoryLabel}</span></div>)}{selectedAssets.length > 30 ? <p className="pt-2 text-white/25">+ {selectedAssets.length - 30} más</p> : null}</div>{bulkProgress ? <div className="mt-4"><div className="flex items-center justify-between text-xs text-white/50"><span>Eliminando…</span><span>{bulkProgress.done} / {bulkProgress.total}</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-red-500 transition-all" style={{ width: `${bulkProgress.total ? (bulkProgress.done / bulkProgress.total) * 100 : 0}%` }} /></div></div> : null}<div className="mt-5 flex justify-end gap-2"><button type="button" disabled={busy} onClick={() => setBulkDeleteOpen(false)} className="rounded-lg border border-white/10 px-4 py-2 text-sm text-white/55">Cancelar</button><button type="button" disabled={busy || !selectedAssets.length} onClick={() => void submitBulkDelete()} className="inline-flex min-w-36 items-center justify-center gap-2 rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold disabled:opacity-40">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}Eliminar {selectedAssets.length}</button></div>
        </ModalShell>
      ) : null}
    </div>
  );
}
