"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  FileBox,
  FolderOpen,
  Loader2,
  Search,
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
  const [message, setMessage] = useState("Elegí uno de los GLB que ya guardaste en Supabase.");
  const [uploading, setUploading] = useState(false);
  const objectUrlRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function refresh() {
    try { setAssets(await listReferenceAssets()); }
    catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo abrir la biblioteca online"); }
  }

  useEffect(() => { void refresh(); }, []);

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
      return [asset.name, asset.fileName, asset.author, asset.license, asset.status]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedSearch));
    });
  }, [assets, filterCategory, search]);

  function selectAsset(asset: ReferenceAsset | null) {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    if (!asset) { onSelect(null, null); return; }
    const url = URL.createObjectURL(asset.file);
    objectUrlRef.current = url;
    onSelect(asset, url);
    onCategoryChange?.(asset.category);
    setMessage(asset.isTemplate
      ? `✓ ${asset.name} es una plantilla base. CLOUVA conservará su rig y sus pesos.`
      : `✓ ${asset.name} está listo para probar y Auto Rig con el worker existente.`);
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setMessage(`Leyendo ${file.name}…`);
    try {
      const normalizedName = file.name.trim().toLowerCase();
      const looksLikeGlb = normalizedName.endsWith(".glb") || file.type === "model/gltf-binary" || file.type === "application/octet-stream";
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
      setName(""); setSourceUrl(""); setAuthor("");
      await refresh();
      selectAsset(asset);
      setFilterCategory(asset.category);
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

  return (
    <section style={panel} className="glb-library-root">
      <header style={header}>
        <div>
          <h3 style={heading}><FileBox size={20}/> Biblioteca GLB de Supabase</h3>
          <p style={muted}>Las plantillas aparecen primero. Los demás objetos pueden pasar por Auto Rig usando el worker que ya está conectado.</p>
        </div>
        <div style={counter}><strong>{assets.length}</strong><span>assets guardados</span></div>
      </header>

      <div style={workspace} className="glb-library-workspace">
        <article style={uploadPanel} className="glb-upload-panel">
          <div style={stepLabel}>1 · AGREGAR OTRO MODELO</div>
          <label style={label}>¿Qué tipo de objeto es?</label>
          <select value={category} onChange={(event) => setCategory(event.target.value as ReferenceCategory)} style={input}>
            {REFERENCE_CATEGORIES.map((item) => <option key={item} value={item}>{CATEGORY_LABELS[item]}</option>)}
          </select>
          <input ref={fileInputRef} type="file" accept=".glb,model/gltf-binary,application/octet-stream" style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }} onChange={(event) => void handleFile(event.currentTarget.files?.[0])}/>
          <button type="button" onClick={openPicker} disabled={uploading} style={dropzone}>
            {uploading ? <Loader2 size={28} className="animate-spin"/> : <Upload size={28}/>} 
            <strong>{uploading ? "Guardando GLB…" : "Elegir archivo .glb"}</strong>
            <span>Máximo 80 MB · se guarda en la biblioteca existente</span>
          </button>
          <button type="button" onClick={() => setShowAdvanced((value) => !value)} style={advancedButton}>
            Datos opcionales del modelo <ChevronDown size={16} style={{ transform: showAdvanced ? "rotate(180deg)" : "none" }}/>
          </button>
          {showAdvanced ? (
            <div style={advancedGrid} className="glb-advanced-grid">
              <label><span style={label}>Nombre</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Se usa el nombre del archivo" style={input}/></label>
              <label><span style={label}>Autor</span><input value={author} onChange={(event) => setAuthor(event.target.value)} placeholder="Autor del modelo" style={input}/></label>
              <label><span style={label}>Licencia</span><input value={license} onChange={(event) => setLicense(event.target.value)} placeholder="Free Standard / CC BY" style={input}/></label>
              <label><span style={label}>URL de origen</span><input value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="BlenderKit, Sketchfab, etc." style={input}/></label>
            </div>
          ) : null}
          <div style={{ ...messageBox, borderColor: message.startsWith("Error:") ? "#7f3342" : "#3b2b49" }}>{message}</div>
        </article>

        <article style={libraryPanel} className="glb-assets-panel">
          <div style={libraryTop} className="glb-library-top">
            <div><div style={stepLabel}>2 · ELEGIR DE LO QUE YA SUBISTE</div><strong>Seleccioná una referencia o plantilla</strong></div>
            <div style={searchBox} className="glb-search"><Search size={16}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar modelo o estado…"/></div>
          </div>
          <div style={categories}>
            <button onClick={() => setFilterCategory("all")} style={{ ...categoryButton, ...(filterCategory === "all" ? activeCategory : {}) }}><FolderOpen size={16}/> Todos <span>{assets.length}</span></button>
            {REFERENCE_CATEGORIES.map((item) => (
              <button key={item} onClick={() => setFilterCategory(item)} style={{ ...categoryButton, ...(filterCategory === item ? activeCategory : {}) }}><span>{CATEGORY_EMOJI[item]}</span>{CATEGORY_LABELS[item]}<span>{categoryCounts.get(item) ?? 0}</span></button>
            ))}
          </div>
          {visibleAssets.length === 0 ? (
            <div style={empty}><FileBox size={30}/><strong>No hay GLB en esta categoría</strong><span>Elegí otra categoría o agregá un modelo.</span></div>
          ) : (
            <div style={assetGrid} className="glb-asset-grid">
              {visibleAssets.map((asset) => {
                const selected = selectedAssetId === asset.id;
                return (
                  <div key={asset.id} style={{ ...assetCard, ...(selected ? selectedCard : {}) }}>
                    <button onClick={() => selectAsset(asset)} style={assetMain}>
                      <div style={assetPreview}><span style={{ fontSize: 34 }}>{CATEGORY_EMOJI[asset.category]}</span><span style={asset.isTemplate ? templateBadge : referenceBadge}>{asset.isTemplate ? "Plantilla base" : asset.status === "processing" ? "Procesando" : asset.status === "error" ? "Con error" : "Sin validar"}</span>{selected ? <span style={selectedBadge}><Check size={13}/> Seleccionado</span> : null}</div>
                      <div style={assetInfo}><strong title={asset.name}>{asset.name}</strong><span>{CATEGORY_LABELS[asset.category]} · {(asset.size / 1024 / 1024).toFixed(1)} MB</span><small>{asset.isTemplate ? "Conservar rig y pesos" : "Disponible para Auto Rig"}</small></div>
                    </button>
                    <div style={cardActions}><button onClick={() => selectAsset(asset)} style={useButton}>{selected ? "Listo para probar" : asset.isTemplate ? "Usar plantilla" : "Usar en Auto Rig"}</button><button aria-label={`Eliminar ${asset.name}`} onClick={() => void removeAsset(asset)} style={trashButton}><Trash2 size={16}/></button></div>
                  </div>
                );
              })}
            </div>
          )}
        </article>
      </div>
      <style jsx>{`
        .glb-search input { width: 100%; min-width: 0; border: 0; outline: 0; background: transparent; color: white; }
        @media (max-width: 760px) {
          .glb-library-root { padding: 12px !important; border-radius: 16px !important; overflow: hidden; }
          .glb-library-workspace { grid-template-columns: minmax(0, 1fr) !important; }
          .glb-upload-panel, .glb-assets-panel { width: 100%; min-width: 0; box-sizing: border-box; }
          .glb-library-top { align-items: stretch !important; }
          .glb-search { width: 100%; min-width: 0 !important; box-sizing: border-box; }
          .glb-advanced-grid { grid-template-columns: minmax(0, 1fr) !important; }
          .glb-asset-grid { grid-template-columns: minmax(0, 1fr) !important; }
        }
      `}</style>
    </section>
  );
}

const panel: React.CSSProperties = { marginTop: 18, padding: 16, borderRadius: 20, background: "#0f0b13", border: "1px solid #30243a", maxWidth: "100%", boxSizing: "border-box" };
const header: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14, flexWrap: "wrap", marginBottom: 14 };
const heading: React.CSSProperties = { margin: 0, display: "flex", alignItems: "center", gap: 8 };
const muted: React.CSSProperties = { color: "#9f97a9", fontSize: 13, lineHeight: 1.45, margin: "5px 0 0" };
const counter: React.CSSProperties = { display: "flex", alignItems: "baseline", gap: 7, border: "1px solid #33283e", borderRadius: 12, padding: "8px 11px", color: "#aaa1b4", fontSize: 12 };
const workspace: React.CSSProperties = { display: "grid", gridTemplateColumns: "minmax(260px,.72fr) minmax(0,1.6fr)", gap: 14 };
const uploadPanel: React.CSSProperties = { minWidth: 0, border: "1px solid #2f2438", borderRadius: 16, padding: 14, background: "#0c0910" };
const libraryPanel: React.CSSProperties = { minWidth: 0, border: "1px solid #2f2438", borderRadius: 16, padding: 14, background: "#0c0910" };
const libraryTop: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" };
const stepLabel: React.CSSProperties = { color: "#a883e7", fontSize: 11, fontWeight: 800, letterSpacing: ".08em", marginBottom: 6 };
const label: React.CSSProperties = { display: "block", color: "#aaa1b4", fontSize: 13, margin: "13px 0 7px" };
const input: React.CSSProperties = { width: "100%", boxSizing: "border-box", background: "#0d0a10", border: "1px solid #33283e", borderRadius: 12, color: "white", padding: "12px 13px", outline: "none" };
const dropzone: React.CSSProperties = { width: "100%", marginTop: 12, border: "1px dashed #6c4994", borderRadius: 14, padding: "22px 12px", background: "#17101e", color: "#ded1f3", display: "grid", placeItems: "center", gap: 7, cursor: "pointer" };
const advancedButton: React.CSSProperties = { marginTop: 10, width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", border: "1px solid #31253b", borderRadius: 11, padding: "10px 12px", background: "#100c14", color: "#b9afc3", cursor: "pointer" };
const advancedGrid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 10 };
const messageBox: React.CSSProperties = { marginTop: 12, border: "1px solid #3b2b49", borderRadius: 11, padding: 10, color: "#cbbfd4", fontSize: 12, lineHeight: 1.45 };
const searchBox: React.CSSProperties = { minWidth: 220, flex: "1 1 240px", display: "flex", alignItems: "center", gap: 8, border: "1px solid #33283e", borderRadius: 11, padding: "9px 11px", color: "#8f8798", background: "#100c14" };
const categories: React.CSSProperties = { display: "flex", gap: 7, overflowX: "auto", padding: "12px 0", marginBottom: 4 };
const categoryButton: React.CSSProperties = { border: "1px solid #30253a", background: "#110d15", color: "#aaa1b3", borderRadius: 10, padding: "8px 10px", display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", cursor: "pointer" };
const activeCategory: React.CSSProperties = { background: "#2b1740", borderColor: "#7548ad", color: "white" };
const empty: React.CSSProperties = { minHeight: 210, display: "grid", placeItems: "center", alignContent: "center", gap: 8, color: "#8f8799", textAlign: "center" };
const assetGrid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(190px,1fr))", gap: 10 };
const assetCard: React.CSSProperties = { minWidth: 0, border: "1px solid #2f2538", borderRadius: 14, overflow: "hidden", background: "#100c14" };
const selectedCard: React.CSSProperties = { borderColor: "#9b6ee8", boxShadow: "0 0 0 1px #9b6ee8 inset" };
const assetMain: React.CSSProperties = { display: "block", width: "100%", textAlign: "left", border: 0, padding: 0, background: "transparent", color: "white", cursor: "pointer" };
const assetPreview: React.CSSProperties = { minHeight: 96, position: "relative", display: "grid", placeItems: "center", background: "linear-gradient(135deg,#20142e,#0d0a11)" };
const selectedBadge: React.CSSProperties = { position: "absolute", right: 7, bottom: 7, borderRadius: 99, padding: "4px 7px", background: "#4c2c71", display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10 };
const templateBadge: React.CSSProperties = { position: "absolute", left: 7, top: 7, borderRadius: 99, padding: "4px 7px", background: "#173825", border: "1px solid #3c8658", color: "#91edb0", fontSize: 10, fontWeight: 800 };
const referenceBadge: React.CSSProperties = { ...templateBadge, background: "#2b2036", border: "1px solid #73538d", color: "#d1b5e9" };
const assetInfo: React.CSSProperties = { display: "grid", gap: 4, padding: 11, minWidth: 0 };
const cardActions: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr auto", gap: 7, padding: "0 10px 10px" };
const useButton: React.CSSProperties = { border: 0, borderRadius: 9, padding: "8px 9px", background: "#2d1942", color: "#dac8ef", cursor: "pointer" };
const trashButton: React.CSSProperties = { border: "1px solid #4d2931", borderRadius: 9, padding: 8, background: "#211015", color: "#e58b9b", cursor: "pointer" };
