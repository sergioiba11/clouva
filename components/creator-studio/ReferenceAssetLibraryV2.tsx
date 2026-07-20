"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  FileBox,
  FolderOpen,
  Loader2,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import {
  deleteReferenceAsset,
  listReferenceAssets,
  makeReferenceAsset,
  REFERENCE_CATEGORIES,
  saveReferenceAsset,
  type ReferenceAsset,
  type ReferenceCategory,
} from "@/lib/creator-studio/reference-assets";

type Props = {
  selectedAssetId: string | null;
  onSelect: (asset: ReferenceAsset | null, objectUrl: string | null) => void;
  onCategoryChange?: (category: ReferenceCategory) => void;
};

const CATEGORY_LABELS: Record<ReferenceCategory, string> = {
  hoodie: "Buzos", remera: "Remeras", campera: "Camperas", baggy: "Baggys",
  zapatillas: "Zapatillas", gorra: "Gorras", cadena: "Cadenas", lentes: "Lentes",
  mochila: "Mochilas", aros: "Aros", guantes: "Guantes", pulseras: "Pulseras", anillos: "Anillos",
};

const CATEGORY_EMOJI: Record<ReferenceCategory, string> = {
  hoodie: "👕", remera: "👚", campera: "🧥", baggy: "👖", zapatillas: "👟",
  gorra: "🧢", cadena: "⛓️", lentes: "🕶️", mochila: "🎒", aros: "✨",
  guantes: "🧤", pulseras: "📿", anillos: "💍",
};

export function ReferenceAssetLibrary({ selectedAssetId, onSelect, onCategoryChange }: Props) {
  const [assets, setAssets] = useState<ReferenceAsset[]>([]);
  const [category, setCategory] = useState<ReferenceCategory>("gorra");
  const [filterCategory, setFilterCategory] = useState<ReferenceCategory | "all">("all");
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [license, setLicense] = useState("Free Standard");
  const [author, setAuthor] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [message, setMessage] = useState("Los GLB originales quedan intactos. Cada Auto Rig crea un resultado separado.");
  const [uploading, setUploading] = useState(false);
  const objectUrlRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function refresh() {
    try {
      setAssets(await listReferenceAssets());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo abrir la biblioteca online");
    }
  }

  useEffect(() => {
    void refresh();
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  const categoryCounts = useMemo(() => {
    const counts = new Map<ReferenceCategory, number>();
    for (const item of REFERENCE_CATEGORIES) counts.set(item, 0);
    for (const asset of assets) counts.set(asset.category, (counts.get(asset.category) ?? 0) + 1);
    return counts;
  }, [assets]);

  const visibleAssets = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return assets.filter((asset) => {
      if (filterCategory !== "all" && asset.category !== filterCategory) return false;
      if (!normalizedSearch) return true;
      const kind = asset.isTemplate ? "resultado riggeado" : "glb original";
      return [asset.name, asset.fileName, asset.author, asset.license, kind]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedSearch));
    });
  }, [assets, filterCategory, search]);

  const sourceAssets = visibleAssets.filter((asset) => !asset.isTemplate);
  const resultAssets = visibleAssets.filter((asset) => asset.isTemplate);

  function selectAsset(asset: ReferenceAsset | null) {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    if (!asset) {
      onSelect(null, null);
      return;
    }

    const url = URL.createObjectURL(asset.file);
    objectUrlRef.current = url;
    onSelect(asset, url);
    onCategoryChange?.(asset.category);
    setMessage(asset.isTemplate
      ? `✓ ${asset.name} es un resultado guardado. Su GLB original sigue separado e intacto.`
      : `✓ ${asset.name} es el GLB original. El intento empieza desde cero y nunca sobrescribe este archivo.`);
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setMessage(`Leyendo ${file.name}…`);
    try {
      const normalizedName = file.name.trim().toLowerCase();
      const looksLikeGlb = normalizedName.endsWith(".glb")
        || file.type === "model/gltf-binary"
        || file.type === "application/octet-stream";
      if (!looksLikeGlb) throw new Error(`El archivo elegido es ${file.name}. Exportalo desde Blender como .glb.`);
      if (file.size === 0) throw new Error("El archivo está vacío o el dispositivo no pudo leerlo.");
      if (file.size > 80 * 1024 * 1024) throw new Error("El GLB supera 80 MB. Optimizalo en Blender antes de subirlo.");

      const bytes = await file.arrayBuffer();
      const magic = new TextDecoder().decode(bytes.slice(0, 4));
      if (magic !== "glTF") throw new Error("El archivo no parece ser un GLB válido.");
      const safeFile = new File([bytes], file.name.endsWith(".glb") ? file.name : `${file.name}.glb`, {
        type: "model/gltf-binary",
        lastModified: file.lastModified,
      });
      const asset = makeReferenceAsset(safeFile, category, { name, sourceUrl, license, author });
      await saveReferenceAsset(asset);
      setName("");
      setSourceUrl("");
      setAuthor("");
      await refresh();
      selectAsset(asset);
      setFilterCategory(asset.category);
      setMessage(`✓ ${asset.name} quedó guardado como GLB original reutilizable.`);
    } catch (error) {
      setMessage(error instanceof Error ? `Error: ${error.message}` : "No se pudo guardar el archivo");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function removeAsset(asset: ReferenceAsset) {
    await deleteReferenceAsset(asset.id);
    if (selectedAssetId === asset.id) selectAsset(null);
    await refresh();
    setMessage(`${asset.name} fue eliminado de la biblioteca.`);
  }

  function openPicker() {
    if (uploading) return;
    if (fileInputRef.current) fileInputRef.current.value = "";
    fileInputRef.current?.click();
  }

  function renderCards(items: ReferenceAsset[], kind: "source" | "result") {
    if (!items.length) {
      return (
        <div className="grid min-h-36 place-items-center rounded-2xl border border-dashed border-white/10 text-center text-sm text-white/35">
          {kind === "source" ? "No hay GLB originales en este filtro." : "Todavía no hay resultados guardados."}
        </div>
      );
    }

    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((asset) => {
          const selected = selectedAssetId === asset.id;
          return (
            <article key={asset.id} className={`overflow-hidden rounded-2xl border bg-[#100c14] ${selected ? "border-violet-400 shadow-[0_0_0_1px_#a78bfa_inset]" : "border-white/10"}`}>
              <button type="button" onClick={() => selectAsset(asset)} className="block w-full bg-transparent text-left text-white">
                <div className="relative grid min-h-32 place-items-center bg-gradient-to-br from-[#241633] to-[#0d0a11]">
                  <span className="text-4xl">{CATEGORY_EMOJI[asset.category]}</span>
                  <span className={`absolute left-3 top-3 inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-black ${asset.isTemplate ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-200" : "border-violet-400/40 bg-violet-500/15 text-violet-200"}`}>
                    {asset.isTemplate ? <Sparkles className="h-3 w-3"/> : <ShieldCheck className="h-3 w-3"/>}
                    {asset.isTemplate ? "RESULTADO RIGGEADO" : "GLB ORIGINAL"}
                  </span>
                  {selected ? <span className="absolute bottom-3 right-3 inline-flex items-center gap-1 rounded-full bg-violet-600 px-2 py-1 text-[10px] font-bold"><Check className="h-3 w-3"/> Seleccionado</span> : null}
                </div>
                <div className="grid gap-1 p-4">
                  <strong className="truncate" title={asset.name}>{asset.name}</strong>
                  <span className="text-sm text-white/70">{CATEGORY_LABELS[asset.category]} · {(asset.size / 1024 / 1024).toFixed(1)} MB</span>
                  <small className="leading-5 text-white/45">
                    {asset.isTemplate
                      ? "Resultado guardado aparte. No reemplaza el archivo fuente."
                      : "Original intacto. Cada intento vuelve a empezar desde este archivo."}
                  </small>
                </div>
              </button>
              <div className="grid grid-cols-[1fr_auto] gap-2 px-3 pb-3">
                <button type="button" onClick={() => selectAsset(asset)} className="rounded-xl bg-violet-600/30 px-3 py-3 text-sm font-bold text-violet-100">
                  {asset.isTemplate ? "Usar resultado" : "Usar en Auto Rig"}
                </button>
                <button type="button" aria-label={`Eliminar ${asset.name}`} onClick={() => void removeAsset(asset)} className="rounded-xl border border-red-400/25 bg-red-500/10 px-3 text-red-300">
                  <Trash2 className="h-4 w-4"/>
                </button>
              </div>
            </article>
          );
        })}
      </div>
    );
  }

  return (
    <section className="mt-5 max-w-full overflow-hidden rounded-3xl border border-white/10 bg-[#0f0b13] p-3 sm:p-5">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-lg font-black"><FileBox className="h-5 w-5"/> Biblioteca GLB</h3>
          <p className="mt-1 text-sm leading-6 text-white/50">Los originales nunca se modifican. Blender guarda cada resultado como un archivo nuevo.</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-right text-xs text-white/50">
          <strong className="block text-lg text-white">{sourceAssets.length}</strong>
          originales visibles
        </div>
      </header>

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(260px,.65fr)_minmax(0,1.35fr)]">
        <article className="min-w-0 rounded-2xl border border-white/10 bg-[#0c0910] p-4">
          <div className="mb-2 text-[11px] font-black uppercase tracking-widest text-violet-300">1 · Agregar GLB original</div>
          <label className="mt-3 block text-sm text-white/60">¿Qué tipo de objeto es?</label>
          <select value={category} onChange={(event) => setCategory(event.target.value as ReferenceCategory)} className="mt-2 w-full rounded-xl border border-white/10 bg-[#0d0a10] px-3 py-3 text-white outline-none">
            {REFERENCE_CATEGORIES.map((item) => <option key={item} value={item}>{CATEGORY_LABELS[item]}</option>)}
          </select>
          <input ref={fileInputRef} type="file" accept=".glb,model/gltf-binary,application/octet-stream" className="absolute h-px w-px opacity-0" onChange={(event) => void handleFile(event.currentTarget.files?.[0])}/>
          <button type="button" onClick={openPicker} disabled={uploading} className="mt-3 grid w-full place-items-center gap-2 rounded-2xl border border-dashed border-violet-400/45 bg-violet-500/10 px-3 py-8 text-violet-100 disabled:opacity-50">
            {uploading ? <Loader2 className="h-7 w-7 animate-spin"/> : <Upload className="h-7 w-7"/>}
            <strong>{uploading ? "Guardando GLB…" : "Elegir archivo .glb"}</strong>
            <span className="text-xs text-white/40">Máximo 80 MB · se conserva sin modificar</span>
          </button>
          <button type="button" onClick={() => setShowAdvanced((value) => !value)} className="mt-3 flex w-full items-center justify-between rounded-xl border border-white/10 px-3 py-3 text-sm text-white/60">
            Datos opcionales <ChevronDown className={`h-4 w-4 transition ${showAdvanced ? "rotate-180" : ""}`}/>
          </button>
          {showAdvanced ? (
            <div className="mt-3 grid gap-3">
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Nombre" className="rounded-xl border border-white/10 bg-[#0d0a10] px-3 py-3 text-white outline-none"/>
              <input value={author} onChange={(event) => setAuthor(event.target.value)} placeholder="Autor" className="rounded-xl border border-white/10 bg-[#0d0a10] px-3 py-3 text-white outline-none"/>
              <input value={license} onChange={(event) => setLicense(event.target.value)} placeholder="Licencia" className="rounded-xl border border-white/10 bg-[#0d0a10] px-3 py-3 text-white outline-none"/>
              <input value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="URL de origen" className="rounded-xl border border-white/10 bg-[#0d0a10] px-3 py-3 text-white outline-none"/>
            </div>
          ) : null}
          <div className={`mt-3 rounded-xl border p-3 text-xs leading-5 ${message.startsWith("Error:") ? "border-red-400/30 bg-red-500/10 text-red-200" : "border-white/10 bg-white/[0.03] text-white/55"}`}>{message}</div>
        </article>

        <article className="min-w-0 rounded-2xl border border-white/10 bg-[#0c0910] p-3 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><div className="text-[11px] font-black uppercase tracking-widest text-violet-300">2 · Elegir archivo</div><strong>Originales y resultados separados</strong></div>
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-white/10 bg-[#100c14] px-3 py-2 text-white/40 sm:max-w-xs"><Search className="h-4 w-4"/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar modelo…" className="min-w-0 flex-1 bg-transparent text-white outline-none"/></div>
          </div>
          <div className="my-3 flex gap-2 overflow-x-auto pb-1">
            <button onClick={() => setFilterCategory("all")} className={`inline-flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-sm ${filterCategory === "all" ? "border-violet-400 bg-violet-500/20 text-white" : "border-white/10 text-white/50"}`}><FolderOpen className="h-4 w-4"/> Todos <span>{assets.length}</span></button>
            {REFERENCE_CATEGORIES.map((item) => (
              <button key={item} onClick={() => setFilterCategory(item)} className={`inline-flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-sm ${filterCategory === item ? "border-violet-400 bg-violet-500/20 text-white" : "border-white/10 text-white/50"}`}><span>{CATEGORY_EMOJI[item]}</span>{CATEGORY_LABELS[item]} <span>{categoryCounts.get(item) ?? 0}</span></button>
            ))}
          </div>

          <div className="space-y-5">
            <section>
              <div className="mb-2 flex items-center gap-2 text-xs font-black uppercase tracking-widest text-violet-200"><ShieldCheck className="h-4 w-4"/> GLB originales</div>
              {renderCards(sourceAssets, "source")}
            </section>
            <section>
              <div className="mb-2 flex items-center gap-2 text-xs font-black uppercase tracking-widest text-emerald-200"><Sparkles className="h-4 w-4"/> Resultados guardados</div>
              {renderCards(resultAssets, "result")}
            </section>
          </div>
        </article>
      </div>
    </section>
  );
}
