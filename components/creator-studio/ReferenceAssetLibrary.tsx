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
  hoodie: "Buzos",
  remera: "Remeras",
  campera: "Camperas",
  baggy: "Baggys",
  zapatillas: "Zapatillas",
  gorra: "Gorras",
  cadena: "Cadenas",
  lentes: "Lentes",
  mochila: "Mochilas",
  aros: "Aros",
  guantes: "Guantes",
  pulseras: "Pulseras",
  anillos: "Anillos",
};

const CATEGORY_EMOJI: Record<ReferenceCategory, string> = {
  hoodie: "👕",
  remera: "👚",
  campera: "🧥",
  baggy: "👖",
  zapatillas: "👟",
  gorra: "🧢",
  cadena: "⛓️",
  lentes: "🕶️",
  mochila: "🎒",
  aros: "✨",
  guantes: "🧤",
  pulseras: "📿",
  anillos: "💍",
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
  const [message, setMessage] = useState("Subí tu primer GLB y después seleccionalo para acomodarlo sobre el avatar.");
  const [uploading, setUploading] = useState(false);
  const objectUrlRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function refresh() {
    try {
      setAssets(await listReferenceAssets());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo abrir la biblioteca local");
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
      return [asset.name, asset.fileName, asset.author, asset.license]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedSearch));
    });
  }, [assets, filterCategory, search]);

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
    setMessage(`✓ ${asset.name} está listo. Tocá “Probar GLB en mi avatar” para ubicarlo y ajustarlo.`);
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
      setName("");
      setSourceUrl("");
      setAuthor("");
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
    <section style={panel}>
      <header style={header}>
        <div>
          <h3 style={heading}><FileBox size={20}/> Biblioteca GLB</h3>
          <p style={muted}>Importá modelos desde Blender, guardalos por categoría y elegí cuál querés probar sobre tu avatar.</p>
        </div>
        <div style={counter}><strong>{assets.length}</strong><span>assets guardados</span></div>
      </header>

      <div style={workspace}>
        <article style={uploadPanel}>
          <div style={stepLabel}>1 · IMPORTAR MODELO</div>
          <label style={label}>¿Qué tipo de objeto es?</label>
          <select value={category} onChange={(event) => setCategory(event.target.value as ReferenceCategory)} style={input}>
            {REFERENCE_CATEGORIES.map((item) => <option key={item} value={item}>{CATEGORY_LABELS[item]}</option>)}
          </select>

          <input
            ref={fileInputRef}
            type="file"
            accept=".glb,model/gltf-binary,application/octet-stream"
            style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
            onChange={(event) => void handleFile(event.currentTarget.files?.[0])}
          />
          <button type="button" onClick={openPicker} disabled={uploading} style={dropzone}>
            {uploading ? <Loader2 size={28} className="animate-spin"/> : <Upload size={28}/>} 
            <strong>{uploading ? "Guardando GLB…" : "Elegir archivo .glb"}</strong>
            <span>Máximo 80 MB · compatible con Blender y Android</span>
          </button>

          <button type="button" onClick={() => setShowAdvanced((value) => !value)} style={advancedButton}>
            Datos opcionales del modelo <ChevronDown size={16} style={{ transform: showAdvanced ? "rotate(180deg)" : "none" }}/>
          </button>

          {showAdvanced ? (
            <div style={advancedGrid}>
              <label><span style={label}>Nombre</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Se usa el nombre del archivo" style={input}/></label>
              <label><span style={label}>Autor</span><input value={author} onChange={(event) => setAuthor(event.target.value)} placeholder="Autor del modelo" style={input}/></label>
              <label><span style={label}>Licencia</span><input value={license} onChange={(event) => setLicense(event.target.value)} placeholder="Free Standard / CC BY" style={input}/></label>
              <label><span style={label}>URL de origen</span><input value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="BlenderKit, Sketchfab, etc." style={input}/></label>
            </div>
          ) : null}

          <div style={{ ...messageBox, borderColor: message.startsWith("Error:") ? "#7f3342" : "#3b2b49" }}>{message}</div>
        </article>

        <article style={libraryPanel}>
          <div style={libraryTop}>
            <div>
              <div style={stepLabel}>2 · ELEGIR DE LA BIBLIOTECA</div>
              <strong>Seleccioná un GLB para acomodarlo</strong>
            </div>
            <div style={searchBox}><Search size={16}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar modelo…"/></div>
          </div>

          <div style={categories}>
            <button onClick={() => setFilterCategory("all")} style={{ ...categoryButton, ...(filterCategory === "all" ? activeCategory : {}) }}>
              <FolderOpen size={16}/> Todos <span>{assets.length}</span>
            </button>
            {REFERENCE_CATEGORIES.map((item) => (
              <button key={item} onClick={() => setFilterCategory(item)} style={{ ...categoryButton, ...(filterCategory === item ? activeCategory : {}) }}>
                <span>{CATEGORY_EMOJI[item]}</span>{CATEGORY_LABELS[item]}<span>{categoryCounts.get(item) ?? 0}</span>
              </button>
            ))}
          </div>

          {visibleAssets.length === 0 ? (
            <div style={empty}><FileBox size={30}/><strong>No hay GLB en esta categoría</strong><span>Elegí una categoría y subí un archivo desde el panel de la izquierda.</span></div>
          ) : (
            <div style={assetGrid}>
              {visibleAssets.map((asset) => {
                const selected = selectedAssetId === asset.id;
                return (
                  <div key={asset.id} style={{ ...assetCard, ...(selected ? selectedCard : {}) }}>
                    <button onClick={() => selectAsset(asset)} style={assetMain}>
                      <div style={assetPreview}>
                        <span style={{ fontSize: 34 }}>{CATEGORY_EMOJI[asset.category]}</span>
                        {selected ? <span style={selectedBadge}><Check size={13}/> Seleccionado</span> : null}
                      </div>
                      <div style={assetInfo}>
                        <strong title={asset.name}>{asset.name}</strong>
                        <span>{CATEGORY_LABELS[asset.category]} · {(asset.size / 1024 / 1024).toFixed(1)} MB</span>
                        <small>{asset.author || "Autor sin registrar"}</small>
                      </div>
                    </button>
                    <div style={cardActions}>
                      <button onClick={() => selectAsset(asset)} style={useButton}>{selected ? "Listo para probar" : "Usar en el visor"}</button>
                      <button aria-label={`Eliminar ${asset.name}`} onClick={() => void removeAsset(asset)} style={trashButton}><Trash2 size={16}/></button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </article>
      </div>
    </section>
  );
}

const panel: React.CSSProperties = { marginTop: 18, padding: 16, borderRadius: 20, background: "#0f0b13", border: "1px solid #30243a" };
const header: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14, flexWrap: "wrap", marginBottom: 14 };
const heading: React.CSSProperties = { margin: 0, display: "flex", alignItems: "center", gap: 8 };
const muted: React.CSSProperties = { color: "#9f97a9", fontSize: 13, lineHeight: 1.45, margin: "5px 0 0" };
const counter: React.CSSProperties = { display: "flex", alignItems: "baseline", gap: 7, border: "1px solid #33283e", borderRadius: 12, padding: "8px 11px", color: "#aaa1b4", fontSize: 12 };
const workspace: React.CSSProperties = { display: "grid", gridTemplateColumns: "minmax(260px,.75fr) minmax(0,1.7fr)", gap: 12 };
const uploadPanel: React.CSSProperties = { padding: 14, borderRadius: 16, background: "#0a080d", border: "1px solid #292031" };
const libraryPanel: React.CSSProperties = { minWidth: 0, padding: 14, borderRadius: 16, background: "#0a080d", border: "1px solid #292031" };
const stepLabel: React.CSSProperties = { color: "#a879ef", fontSize: 11, fontWeight: 800, letterSpacing: 1.1, marginBottom: 7 };
const label: React.CSSProperties = { display: "block", color: "#aaa1b4", fontSize: 12, margin: "8px 0 5px" };
const input: React.CSSProperties = { width: "100%", boxSizing: "border-box", background: "#09070c", border: "1px solid #33283e", borderRadius: 10, color: "white", padding: "10px 11px" };
const dropzone: React.CSSProperties = { width: "100%", marginTop: 10, minHeight: 124, border: "1px dashed #6d4695", borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 6, cursor: "pointer", background: "linear-gradient(145deg,#171020,#0e0a12)", color: "white" };
const advancedButton: React.CSSProperties = { width: "100%", marginTop: 9, display: "flex", alignItems: "center", justifyContent: "space-between", border: 0, background: "transparent", color: "#aaa1b4", padding: "8px 2px", cursor: "pointer" };
const advancedGrid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8 };
const messageBox: React.CSSProperties = { marginTop: 9, padding: 10, borderRadius: 10, background: "#17101e", border: "1px solid #3b2b49", color: "#cdbdde", fontSize: 12 };
const libraryTop: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" };
const searchBox: React.CSSProperties = { display: "flex", alignItems: "center", gap: 7, minWidth: 190, background: "#100c14", border: "1px solid #30243a", borderRadius: 10, padding: "8px 10px", color: "#8f8498" };
const categories: React.CSSProperties = { display: "flex", gap: 7, overflowX: "auto", padding: "12px 0 10px" };
const categoryButton: React.CSSProperties = { flex: "0 0 auto", display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid #30243a", background: "#120e16", color: "#aaa1b4", borderRadius: 999, padding: "7px 10px", cursor: "pointer", whiteSpace: "nowrap" };
const activeCategory: React.CSSProperties = { borderColor: "#8b5cf6", color: "white", background: "#2c1742" };
const assetGrid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))", gap: 9 };
const assetCard: React.CSSProperties = { overflow: "hidden", border: "1px solid #292031", borderRadius: 14, background: "#100c14" };
const selectedCard: React.CSSProperties = { borderColor: "#9b6be3", boxShadow: "0 0 0 1px rgba(155,107,227,.2)" };
const assetMain: React.CSSProperties = { width: "100%", border: 0, background: "transparent", color: "white", padding: 0, cursor: "pointer", textAlign: "left" };
const assetPreview: React.CSSProperties = { position: "relative", minHeight: 92, display: "grid", placeItems: "center", background: "radial-gradient(circle at 50% 20%,#2a1b3c,#0b0810 70%)" };
const selectedBadge: React.CSSProperties = { position: "absolute", left: 7, top: 7, display: "inline-flex", alignItems: "center", gap: 4, borderRadius: 999, padding: "4px 7px", background: "#7542b8", fontSize: 9 };
const assetInfo: React.CSSProperties = { display: "grid", gap: 3, padding: 10, minWidth: 0 };
const cardActions: React.CSSProperties = { display: "flex", borderTop: "1px solid #292031" };
const useButton: React.CSSProperties = { flex: 1, border: 0, background: "#1a1122", color: "#d7c3f4", padding: 9, cursor: "pointer", fontWeight: 700, fontSize: 11 };
const trashButton: React.CSSProperties = { border: 0, borderLeft: "1px solid #292031", background: "#130e17", color: "#b49fbb", padding: "0 12px", cursor: "pointer" };
const empty: React.CSSProperties = { minHeight: 180, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, color: "#81798a", textAlign: "center", border: "1px dashed #292031", borderRadius: 14, padding: 16 };
