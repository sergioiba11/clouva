"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronRight,
  Eye,
  FolderOpen,
  Image as ImageIcon,
  Menu,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import {
  ASSET_CATEGORIES,
  compactPath,
  type AdminAssetCategory,
  type NormalizedAdminAsset,
} from "@/lib/admin-assets/classification";

const ROW_HEIGHT = 50;
const OVERSCAN = 8;

type ExplorerProps = {
  assets: NormalizedAdminAsset[];
  totalAssets: number;
  categoryCounts: Record<AdminAssetCategory, number>;
  activeCategory: AdminAssetCategory | "all";
  onCategoryChange: (category: AdminAssetCategory | "all") => void;
  selectedKeys: Set<string>;
  onToggleSelection: (asset: NormalizedAdminAsset, shiftKey?: boolean) => void;
  onSetAssetsSelection: (assets: NormalizedAdminAsset[], selected: boolean) => void;
  onPreview: (asset: NormalizedAdminAsset) => void;
  onRename: (asset: NormalizedAdminAsset) => void;
  onDelete: (asset: NormalizedAdminAsset) => void;
  groupVariants: boolean;
  onGroupVariantsChange: (value: boolean) => void;
  busy: boolean;
};

type ExplorerRow =
  | { type: "asset"; asset: NormalizedAdminAsset; nested?: boolean }
  | { type: "family"; familyKey: string; label: string; assets: NormalizedAdminAsset[]; expanded: boolean };

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "short", year: "2-digit" }).format(date);
}

function sourceLabel(source: NormalizedAdminAsset["source"]) {
  if (source === "gcs") return "Google Cloud";
  if (source === "github") return "Repo / public";
  return "Supabase";
}

function AssetThumb({ asset }: { asset: NormalizedAdminAsset }) {
  if (asset.kind === "image" && asset.url) {
    return <img src={asset.url} alt="" loading="lazy" className="h-full w-full object-cover" />;
  }
  return <ImageIcon className="h-4 w-4 text-white/25" />;
}

function CategoryList({
  totalAssets,
  counts,
  active,
  onChange,
}: {
  totalAssets: number;
  counts: Record<AdminAssetCategory, number>;
  active: AdminAssetCategory | "all";
  onChange: (value: AdminAssetCategory | "all") => void;
}) {
  return (
    <nav className="space-y-1 p-2">
      <button
        type="button"
        onClick={() => onChange("all")}
        className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition ${active === "all" ? "bg-violet-500/15 text-violet-100" : "text-white/55 hover:bg-white/[0.05] hover:text-white/80"}`}
      >
        <span className="flex items-center gap-2"><FolderOpen className="h-4 w-4" />Todos</span>
        <span className="text-xs text-white/30">{totalAssets.toLocaleString("es-AR")}</span>
      </button>
      {ASSET_CATEGORIES.map((category) => (
        <button
          key={category.id}
          type="button"
          onClick={() => onChange(category.id)}
          className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition ${active === category.id ? "bg-violet-500/15 text-violet-100" : "text-white/50 hover:bg-white/[0.05] hover:text-white/80"}`}
        >
          <span className="truncate">{category.label}</span>
          <span className="ml-2 text-xs text-white/30">{(counts[category.id] ?? 0).toLocaleString("es-AR")}</span>
        </button>
      ))}
    </nav>
  );
}

export function AssetExplorer({
  assets,
  totalAssets,
  categoryCounts,
  activeCategory,
  onCategoryChange,
  selectedKeys,
  onToggleSelection,
  onSetAssetsSelection,
  onPreview,
  onRename,
  onDelete,
  groupVariants,
  onGroupVariantsChange,
  busy,
}: ExplorerProps) {
  const [expandedFamilies, setExpandedFamilies] = useState<Set<string>>(() => new Set());
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(620);
  const viewportRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setViewportHeight(entry.contentRect.height));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setScrollTop(0);
    if (viewportRef.current) viewportRef.current.scrollTop = 0;
  }, [assets, groupVariants]);

  const rows = useMemo<ExplorerRow[]>(() => {
    if (!groupVariants) return assets.map((asset) => ({ type: "asset", asset }));

    const groups = new Map<string, NormalizedAdminAsset[]>();
    for (const asset of assets) {
      if (!asset.familyKey) continue;
      const current = groups.get(asset.familyKey) ?? [];
      current.push(asset);
      groups.set(asset.familyKey, current);
    }

    const emitted = new Set<string>();
    const result: ExplorerRow[] = [];
    for (const asset of assets) {
      const familyKey = asset.familyKey;
      const familyAssets = familyKey ? groups.get(familyKey) ?? [] : [];
      if (!familyKey || familyAssets.length < 2) {
        result.push({ type: "asset", asset });
        continue;
      }
      if (emitted.has(familyKey)) continue;
      emitted.add(familyKey);
      const expanded = expandedFamilies.has(familyKey);
      result.push({
        type: "family",
        familyKey,
        label: asset.familyLabel ?? asset.name,
        assets: familyAssets,
        expanded,
      });
      if (expanded) {
        for (const child of familyAssets) result.push({ type: "asset", asset: child, nested: true });
      }
    }
    return result;
  }, [assets, expandedFamilies, groupVariants]);

  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIndex = Math.min(rows.length, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN);
  const visibleRows = rows.slice(startIndex, endIndex);

  const toggleFamily = (key: string) => {
    setExpandedFamilies((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <section className="overflow-hidden rounded-[1.4rem] border border-white/10 bg-black/20">
      <div className="flex items-center justify-between gap-3 border-b border-white/[0.07] px-3 py-2 lg:hidden">
        <button type="button" onClick={() => setMobileSidebarOpen(true)} className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs text-white/65">
          <Menu className="h-4 w-4" /> Categorías
        </button>
        <label className="flex items-center gap-2 text-xs text-white/45">
          <input type="checkbox" checked={groupVariants} onChange={(event) => onGroupVariantsChange(event.target.checked)} className="accent-violet-500" />
          Agrupar variantes
        </label>
      </div>

      <div className="grid lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="hidden border-r border-white/[0.07] bg-white/[0.018] lg:block">
          <div className="border-b border-white/[0.07] px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/30">Biblioteca</p>
          </div>
          <CategoryList totalAssets={totalAssets} counts={categoryCounts} active={activeCategory} onChange={onCategoryChange} />
          <div className="border-t border-white/[0.07] p-3">
            <label className="flex items-center gap-2 rounded-xl px-2 py-2 text-xs text-white/45 hover:bg-white/[0.04]">
              <input type="checkbox" checked={groupVariants} onChange={(event) => onGroupVariantsChange(event.target.checked)} className="accent-violet-500" />
              Agrupar variantes
            </label>
          </div>
        </aside>

        <div className="min-w-0">
          <div className="hidden grid-cols-[42px_minmax(220px,1.7fr)_82px_130px_88px_120px_minmax(130px,1fr)_94px_104px] items-center gap-2 border-b border-white/10 bg-[#0d0b14] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/30 xl:grid">
            <span />
            <span>Nombre</span>
            <span>Formato</span>
            <span>Categoría</span>
            <span>Tamaño</span>
            <span>Storage</span>
            <span>Bucket</span>
            <span>Fecha</span>
            <span className="text-right">Acciones</span>
          </div>

          <div
            ref={viewportRef}
            onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
            className="h-[min(68vh,760px)] min-h-[420px] overflow-auto overscroll-contain"
          >
            <div className="relative" style={{ height: rows.length * ROW_HEIGHT }}>
              {visibleRows.map((row, visibleIndex) => {
                const absoluteIndex = startIndex + visibleIndex;
                const top = absoluteIndex * ROW_HEIGHT;

                if (row.type === "family") {
                  const allSelected = row.assets.every((asset) => selectedKeys.has(asset.key));
                  const someSelected = !allSelected && row.assets.some((asset) => selectedKeys.has(asset.key));
                  const totalSize = row.assets.reduce((sum, asset) => sum + asset.size, 0);
                  const formats = Array.from(new Set(row.assets.map((asset) => asset.extension))).slice(0, 2).join("/");
                  const category = row.assets[0]?.categoryLabel ?? "—";
                  return (
                    <div
                      key={`family:${row.familyKey}`}
                      className="absolute left-0 right-0 grid h-[50px] grid-cols-[42px_minmax(0,1fr)_auto] items-center gap-2 border-b border-white/[0.06] bg-violet-500/[0.045] px-3 xl:grid-cols-[42px_minmax(220px,1.7fr)_82px_130px_88px_120px_minmax(130px,1fr)_94px_104px]"
                      style={{ top }}
                    >
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onSetAssetsSelection(row.assets, !allSelected)}
                        className={`grid h-7 w-7 place-items-center rounded-lg border ${allSelected ? "border-violet-300/60 bg-violet-500 text-white" : someSelected ? "border-violet-300/40 bg-violet-500/30 text-violet-100" : "border-white/15 text-white/30"}`}
                        aria-label={allSelected ? "Quitar familia de la selección" : "Seleccionar familia"}
                      >
                        {allSelected ? <Check className="h-3.5 w-3.5" /> : someSelected ? <span className="h-0.5 w-3 rounded bg-current" /> : null}
                      </button>
                      <button type="button" onClick={() => toggleFamily(row.familyKey)} className="flex min-w-0 items-center gap-2 text-left">
                        <ChevronRight className={`h-4 w-4 shrink-0 text-violet-300 transition ${row.expanded ? "rotate-90" : ""}`} />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-white/85">{row.label}</span>
                          <span className="block truncate text-[11px] text-violet-200/55">{row.assets.length} variantes · {formats || "varios formatos"}</span>
                        </span>
                      </button>
                      <span className="text-right text-xs text-white/40 xl:hidden">{formatBytes(totalSize)}</span>
                      <span className="hidden text-xs font-semibold text-white/50 xl:block">{formats || "—"}</span>
                      <span className="hidden truncate text-xs text-violet-100/60 xl:block">{category}</span>
                      <span className="hidden text-xs text-white/40 xl:block">{formatBytes(totalSize)}</span>
                      <span className="hidden text-xs text-white/30 xl:block">{row.assets.length} archivos</span>
                      <span className="hidden truncate text-xs text-white/30 xl:block">Variantes agrupadas</span>
                      <span className="hidden text-xs text-white/25 xl:block">—</span>
                      <div className="hidden justify-end xl:flex"><button type="button" onClick={() => toggleFamily(row.familyKey)} className="rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] text-white/55">{row.expanded ? "Cerrar" : "Abrir"}</button></div>
                    </div>
                  );
                }

                const asset = row.asset;
                const selected = selectedKeys.has(asset.key);
                return (
                  <div
                    key={asset.key}
                    className={`absolute left-0 right-0 grid h-[50px] grid-cols-[42px_minmax(0,1fr)_auto] items-center gap-2 border-b px-3 transition xl:grid-cols-[42px_minmax(220px,1.7fr)_82px_130px_88px_120px_minmax(130px,1fr)_94px_104px] ${selected ? "border-violet-400/20 bg-violet-500/[0.07]" : "border-white/[0.055] hover:bg-white/[0.03]"}`}
                    style={{ top }}
                  >
                    <button
                      type="button"
                      disabled={busy}
                      onClick={(event) => onToggleSelection(asset, event.shiftKey)}
                      className={`grid h-7 w-7 place-items-center rounded-lg border transition ${selected ? "border-violet-300/60 bg-violet-500 text-white" : "border-white/15 text-white/25 hover:border-violet-300/40"}`}
                      aria-label={selected ? `Quitar ${asset.name} de la selección` : `Seleccionar ${asset.name}`}
                    >
                      {selected ? <Check className="h-3.5 w-3.5" /> : null}
                    </button>

                    <button type="button" onClick={() => onPreview(asset)} className={`flex min-w-0 items-center gap-2 text-left ${row.nested ? "pl-5" : ""}`}>
                      <span className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-md border border-white/10 bg-white/[0.035]"><AssetThumb asset={asset} /></span>
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-medium text-white/82" title={asset.name}>{asset.name}</span>
                        <span className="block truncate text-[10px] text-white/28" title={asset.path}>{compactPath(asset.path)}</span>
                      </span>
                    </button>

                    <div className="flex items-center justify-end gap-1 xl:hidden">
                      <span className="rounded-full border border-white/10 px-2 py-1 text-[9px] font-bold text-white/55">{asset.extension}</span>
                      <button type="button" onClick={() => onPreview(asset)} className="rounded-md p-1.5 text-white/40"><Eye className="h-3.5 w-3.5" /></button>
                      <button type="button" onClick={() => onDelete(asset)} className="rounded-md p-1.5 text-red-300/60"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>

                    <span className="hidden w-fit rounded-full border border-white/10 bg-white/[0.035] px-2 py-1 text-[9px] font-bold text-white/55 xl:block">{asset.extension}</span>
                    <span className="hidden truncate text-xs text-violet-100/60 xl:block">{asset.categoryLabel}</span>
                    <span className="hidden text-xs text-white/38 xl:block">{formatBytes(asset.size)}</span>
                    <span className="hidden truncate text-xs text-white/35 xl:block">{sourceLabel(asset.source)}</span>
                    <span className="hidden truncate text-xs text-white/28 xl:block" title={asset.bucket}>{asset.bucket}</span>
                    <span className="hidden text-xs text-white/25 xl:block">{formatDate(asset.updatedAt)}</span>
                    <div className="hidden justify-end gap-1 xl:flex">
                      <button type="button" onClick={() => onPreview(asset)} className="rounded-md border border-white/10 p-1.5 text-white/45 hover:bg-white/[0.06]" title="Ver"><Eye className="h-3.5 w-3.5" /></button>
                      <button type="button" onClick={() => onRename(asset)} className="rounded-md border border-white/10 p-1.5 text-white/45 hover:bg-white/[0.06]" title="Renombrar"><Pencil className="h-3.5 w-3.5" /></button>
                      <button type="button" onClick={() => onDelete(asset)} className="rounded-md border border-red-400/15 p-1.5 text-red-300/60 hover:bg-red-400/10" title="Eliminar"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {mobileSidebarOpen ? (
        <div className="fixed inset-0 z-[120] bg-black/70 backdrop-blur-sm lg:hidden" onMouseDown={() => setMobileSidebarOpen(false)}>
          <aside className="h-full w-[min(88vw,320px)] overflow-y-auto border-r border-white/10 bg-[#0b0911] p-2" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between px-3 py-3"><p className="text-sm font-semibold">Categorías</p><button type="button" onClick={() => setMobileSidebarOpen(false)} className="rounded-lg border border-white/10 p-2 text-white/50"><X className="h-4 w-4" /></button></div>
            <CategoryList totalAssets={totalAssets} counts={categoryCounts} active={activeCategory} onChange={(value) => { onCategoryChange(value); setMobileSidebarOpen(false); }} />
          </aside>
        </div>
      ) : null}
    </section>
  );
}
