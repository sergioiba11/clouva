"use client";

import { useMemo, useState } from "react";
import {
  Activity,
  Box,
  CheckCircle2,
  CircleDashed,
  Download,
  Eye,
  ImagePlus,
  Layers3,
  Play,
  RotateCcw,
  Settings2,
  Sparkles,
  Upload,
  UserRound,
  WandSparkles,
} from "lucide-react";
import { SmartTryOnViewer, type TryOnAdjustments } from "@/components/creator-studio/SmartTryOnViewer";

const pipeline = [
  "Descargando modelo",
  "Importando GLB",
  "Limpiando geometría",
  "Reparando normales",
  "Ajustando escala",
  "Colocando sobre el avatar",
  "Aplicando Shrinkwrap",
  "Transfiriendo pesos",
  "Corrigiendo clipping",
  "Prueba Idle",
  "Prueba Walk",
  "Prueba Run",
  "Generando LOD",
  "Comprimiendo materiales",
  "Exportando GLB",
  "Generando miniaturas",
];

const categories = ["hoodie", "remera", "campera", "baggy", "zapatillas", "gorra", "cadena", "lentes", "mochila", "aros", "guantes", "pulseras", "anillos"];

const anchorByCategory: Record<string, string> = {
  hoodie: "Torso + brazos",
  remera: "Torso",
  campera: "Torso + brazos",
  baggy: "Cintura + piernas",
  zapatillas: "Pies",
  gorra: "Cabeza",
  cadena: "Cuello",
  lentes: "Ojos",
  mochila: "Espalda",
  aros: "Orejas",
  guantes: "Manos",
  pulseras: "Muñecas",
  anillos: "Dedos",
};

type Tab = "create" | "preview" | "viewer" | "process" | "publish";
type Fit = "Slim" | "Regular" | "Oversize";
type Pose = "T-Pose" | "Idle" | "Walk";
type View = "Frente" | "Lateral" | "Espalda";

const initialAdjustments: TryOnAdjustments = {
  scale: 100,
  length: 100,
  width: 100,
  x: 0,
  y: 0,
  rotation: 0,
  height: 0,
  distance: 8,
  sleeveLength: 100,
  legLength: 100,
  waistHeight: 50,
  neckSize: 50,
  hoodSize: 50,
};

export function CreatorStudio() {
  const [prompt, setPrompt] = useState("");
  const [category, setCategory] = useState("hoodie");
  const [tab, setTab] = useState<Tab>("create");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [imageName, setImageName] = useState<string | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [message, setMessage] = useState("Listo para crear un nuevo modelo");
  const [generated, setGenerated] = useState(false);
  const [fit, setFit] = useState<Fit>("Regular");
  const [pose, setPose] = useState<Pose>("Idle");
  const [view, setView] = useState<View>("Frente");
  const [background, setBackground] = useState("#120b1f");
  const [showBody, setShowBody] = useState(true);
  const [garmentOnly, setGarmentOnly] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [adjustments, setAdjustments] = useState<TryOnAdjustments>(initialAdjustments);

  const currentStep = useMemo(
    () => Math.min(Math.floor((progress / 100) * pipeline.length), pipeline.length - 1),
    [progress],
  );

  function updateAdjustment(key: keyof TryOnAdjustments, value: number) {
    setAdjustments((current) => ({ ...current, [key]: value }));
  }

  function resetPreview() {
    setFit("Regular");
    setPose("Idle");
    setView("Frente");
    setRotation(0);
    setZoom(1);
    setShowBody(true);
    setGarmentOnly(false);
    setAdjustments(initialAdjustments);
  }

  function resetProject() {
    setPrompt("");
    setImageName(null);
    setImagePreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
    setProgress(0);
    setGenerated(false);
    resetPreview();
    setTab("create");
    setMessage("Nuevo proyecto creado");
  }

  async function generateModel() {
    setRunning(true);
    setProgress(8);
    setMessage("Enviando solicitud aprobada a Meshy…");
    try {
      const response = await fetch("/api/creator-studio/meshy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          category,
          quality: "high",
          polycount: 30000,
          textureResolution: 2048,
          previewSettings: { fit, pose, view, adjustments },
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo iniciar Meshy");
      setGenerated(true);
      setProgress(35);
      setMessage(data.mock ? "Vista previa aprobada. Falta configurar MESHY_API_KEY para generar el modelo real." : `Meshy iniciado: ${data.taskId}`);
      setTab("viewer");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Error inesperado");
    } finally {
      setRunning(false);
    }
  }

  async function processInBlender() {
    setRunning(true);
    setTab("process");
    setMessage("Iniciando Blender Worker…");
    for (let index = 0; index < pipeline.length; index += 1) {
      setProgress(Math.round(((index + 1) / pipeline.length) * 92));
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    try {
      const response = await fetch("/api/creator-studio/blender", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          rig: "clouva_base_v1",
          autoFix: true,
          autoWeight: true,
          autoExport: true,
          targetPolycount: 25000,
          maxFileSizeMb: 18,
          textureResolution: 2048,
          formats: ["glb", "fbx", "obj", "blend"],
          previewSettings: { fit, pose, view, adjustments },
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Falló Blender Worker");
      setProgress(100);
      setMessage(data.mock ? "Pipeline validado. Configurá BLENDER_WORKER_URL para procesar el archivo real." : `Trabajo Blender iniciado: ${data.jobId}`);
      setTab("publish");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Error inesperado");
    } finally {
      setRunning(false);
    }
  }

  return (
    <main style={{ minHeight: "100dvh", background: "radial-gradient(circle at 20% 0%, #271045 0, #0b0711 38%, #050507 100%)", color: "white", padding: 22, fontFamily: "Inter, system-ui, sans-serif" }}>
      <div style={{ maxWidth: 1440, margin: "0 auto" }}>
        <header style={{ display: "flex", justifyContent: "space-between", gap: 18, alignItems: "center", marginBottom: 22, flexWrap: "wrap" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#c4a7ff", fontWeight: 800, letterSpacing: 1.5 }}><WandSparkles size={18}/> CLOUVA</div>
            <h1 style={{ margin: "5px 0 3px", fontSize: "clamp(28px, 5vw, 52px)", lineHeight: 1 }}>Creator Studio</h1>
            <p style={{ margin: 0, color: "#aaa3b5" }}>Referencia → Vista previa 3D real → Meshy → Blender → Marketplace</p>
          </div>
          <button onClick={resetProject} style={primaryButton}><Sparkles size={18}/> Nuevo modelo</button>
        </header>

        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 18 }}>
          {[{label:"Proyectos",value:"12",icon:<Box/>},{label:"Procesando",value:running?"1":"0",icon:<Activity/>},{label:"Listos",value:"8",icon:<CheckCircle2/>},{label:"Errores",value:"0",icon:<CircleDashed/>}].map((item) => <div key={item.label} style={card}><div style={{ color: "#bda2ff" }}>{item.icon}</div><strong style={{ fontSize: 26 }}>{item.value}</strong><span style={{ color: "#9e97a8" }}>{item.label}</span></div>)}
        </section>

        <nav style={{ display: "flex", gap: 8, overflowX: "auto", marginBottom: 16 }}>
          {(["create","preview","viewer","process","publish"] as const).map((item, index) => <button key={item} onClick={() => setTab(item)} style={{ ...tabButton, ...(tab === item ? activeTab : {}) }}>{index + 1}. {item === "create" ? "Referencia" : item === "preview" ? "Probar en mi avatar" : item === "viewer" ? "Modelo generado" : item === "process" ? "Blender Worker" : "Marketplace"}</button>)}
        </nav>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.5fr) minmax(280px, .7fr)", gap: 16 }} className="creator-grid">
          <section style={{ ...panel, minHeight: 620 }}>
            {tab === "create" && <div>
              <h2 style={title}><ImagePlus/> Referencia inicial</h2>
              <label style={label}>Imagen de referencia</label>
              <label style={{ ...dropzone, borderColor: imageName ? "#8b5cf6" : "#40364b" }}>
                <Upload/><span>{imageName ?? "Tocá para subir PNG, JPG o WEBP"}</span>
                <input hidden type="file" accept="image/*" onChange={(event) => {
                  const file = event.target.files?.[0];
                  setImageName(file?.name ?? null);
                  setImagePreviewUrl((current) => {
                    if (current) URL.revokeObjectURL(current);
                    return file ? URL.createObjectURL(file) : null;
                  });
                }}/>
              </label>
              <label style={label}>Prompt</label>
              <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Ejemplo: hoodie oversize violeta y negro, tela gruesa, logo CLOUVA bordado…" style={{ ...input, minHeight: 125, resize: "vertical" }}/>
              <div style={formGrid}>
                <Field label="Categoría"><select value={category} onChange={(event) => setCategory(event.target.value)} style={input}>{categories.map((item) => <option key={item}>{item}</option>)}</select></Field>
                <Field label="Zona automática"><div style={readonlyField}>{anchorByCategory[category]}</div></Field>
                <Field label="Costo de vista previa"><div style={readonlyField}>0 créditos</div></Field>
              </div>
              <button disabled={!prompt && !imageName} onClick={() => setTab("preview")} style={{ ...primaryButton, width: "100%", justifyContent: "center", opacity: !prompt && !imageName ? .5 : 1 }}><UserRound/> Probar en mi avatar</button>
            </div>}

            {tab === "preview" && <div>
              <h2 style={title}><UserRound/> Probar en mi avatar</h2>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.2fr) minmax(250px,.8fr)", gap: 16 }} className="preview-grid">
                <div>
                  <div style={{ ...smartViewer, background }}>
                    <SmartTryOnViewer
                      category={category}
                      fit={fit}
                      pose={pose}
                      view={view}
                      background={background}
                      showBody={showBody}
                      garmentOnly={garmentOnly}
                      adjustments={{ ...adjustments, rotation: adjustments.rotation + rotation, scale: adjustments.scale * zoom }}
                      imageUrl={imagePreviewUrl}
                    />
                    <div style={viewerBadge}>{generated ? "Modelo generado" : "Vista previa estimada · 0 créditos"}</div>
                  </div>

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                    {(["Frente","Lateral","Espalda"] as View[]).map((item) => <button key={item} onClick={() => setView(item)} style={{ ...toolButton, ...(view === item ? activeTool : {}) }}>{item}</button>)}
                    {(["T-Pose","Idle","Walk"] as Pose[]).map((item) => <button key={item} onClick={() => setPose(item)} style={{ ...toolButton, ...(pose === item ? activeTool : {}) }}>{item}</button>)}
                  </div>

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                    <button onClick={() => setRotation((value) => value - 45)} style={toolButton}>↶ Rotar</button>
                    <button onClick={() => setRotation((value) => value + 45)} style={toolButton}>Rotar ↷</button>
                    <button onClick={() => setZoom((value) => Math.min(1.5, value + .1))} style={toolButton}>Zoom +</button>
                    <button onClick={() => setZoom((value) => Math.max(.7, value - .1))} style={toolButton}>Zoom −</button>
                    <button onClick={() => setShowBody((value) => !value)} style={toolButton}>{showBody ? "Ocultar cuerpo" : "Mostrar cuerpo"}</button>
                    <button onClick={() => setGarmentOnly((value) => !value)} style={toolButton}>{garmentOnly ? "Mostrar avatar" : "Solo prenda"}</button>
                    <button onClick={resetPreview} style={toolButton}><RotateCcw size={15}/> Reiniciar</button>
                  </div>
                </div>

                <div>
                  <div style={formGrid}>
                    <Field label="Ajuste"><select value={fit} onChange={(event) => setFit(event.target.value as Fit)} style={input}><option>Slim</option><option>Regular</option><option>Oversize</option></select></Field>
                    <Field label="Fondo"><input type="color" value={background} onChange={(event) => setBackground(event.target.value)} style={{ ...input, height: 46, padding: 5 }}/></Field>
                  </div>
                  <Range label="Escala" value={adjustments.scale} min={70} max={140} onChange={(value) => updateAdjustment("scale", value)} />
                  <Range label="Largo" value={adjustments.length} min={60} max={150} onChange={(value) => updateAdjustment("length", value)} />
                  <Range label="Ancho" value={adjustments.width} min={60} max={150} onChange={(value) => updateAdjustment("width", value)} />
                  <Range label="Posición X" value={adjustments.x} min={-80} max={80} onChange={(value) => updateAdjustment("x", value)} />
                  <Range label="Posición Y" value={adjustments.y} min={-80} max={80} onChange={(value) => updateAdjustment("y", value)} />
                  <Range label="Rotación" value={adjustments.rotation} min={-45} max={45} onChange={(value) => updateAdjustment("rotation", value)} />
                  <Range label="Altura" value={adjustments.height} min={-50} max={50} onChange={(value) => updateAdjustment("height", value)} />
                  <Range label="Distancia al cuerpo" value={adjustments.distance} min={0} max={30} onChange={(value) => updateAdjustment("distance", value)} />
                  {(category === "hoodie" || category === "remera" || category === "campera") ? <Range label="Largo de mangas" value={adjustments.sleeveLength} min={50} max={140} onChange={(value) => updateAdjustment("sleeveLength", value)} /> : null}
                  {category === "baggy" ? <><Range label="Largo de piernas" value={adjustments.legLength} min={60} max={150} onChange={(value) => updateAdjustment("legLength", value)} /><Range label="Altura de cintura" value={adjustments.waistHeight} min={0} max={100} onChange={(value) => updateAdjustment("waistHeight", value)} /></> : null}
                  {(category === "hoodie" || category === "remera") ? <Range label="Tamaño del cuello" value={adjustments.neckSize} min={20} max={100} onChange={(value) => updateAdjustment("neckSize", value)} /> : null}
                  {category === "hoodie" ? <Range label="Tamaño de capucha" value={adjustments.hoodSize} min={20} max={120} onChange={(value) => updateAdjustment("hoodSize", value)} /> : null}
                </div>
              </div>
              <div style={{ marginTop: 14, padding: 12, borderRadius: 12, background: "#16101c", border: "1px solid #3a2c46", color: "#cfc3db" }}>La vista previa no consume créditos. El costo real de Meshy debe cargarse desde la API antes de confirmar.</div>
              <button disabled={running} onClick={generateModel} style={{ ...primaryButton, width: "100%", justifyContent: "center", marginTop: 14 }}><Sparkles/> {running ? "Generando…" : "Generar modelo 3D"}</button>
            </div>}

            {tab === "viewer" && <div style={{ height: "100%" }}>
              <h2 style={title}><Eye/> Comparar vista previa ↔ modelo generado</h2>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 14 }}>
                <div style={viewer}><div style={{ textAlign: "center" }}><UserRound size={58} strokeWidth={1}/><h3>Vista previa aprobada</h3><p style={{ color: "#978fa3" }}>{category} · {fit} · {anchorByCategory[category]}</p></div></div>
                <div style={viewer}><div style={{ textAlign: "center" }}><Layers3 size={58} strokeWidth={1}/><h3>Modelo generado por Meshy</h3><p style={{ color: "#978fa3" }}>Se reemplaza automáticamente cuando Meshy devuelve el GLB real.</p></div></div>
              </div>
              <button onClick={processInBlender} disabled={running} style={{ ...primaryButton, width: "100%", justifyContent: "center", marginTop: 14 }}><Play/> Enviar a Blender</button>
            </div>}

            {tab === "process" && <div>
              <h2 style={title}><Settings2/> Monitor Blender Worker</h2>
              <div style={{ height: 10, background: "#211a29", borderRadius: 99, overflow: "hidden", marginBottom: 18 }}><div style={{ width: `${progress}%`, height: "100%", background: "linear-gradient(90deg,#7c3aed,#d8b4fe)", transition: "width .2s" }}/></div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 8 }}>{pipeline.map((step, index) => <div key={step} style={{ display: "flex", alignItems: "center", gap: 10, padding: 11, borderRadius: 12, background: index < currentStep ? "#17251e" : index === currentStep ? "#261b35" : "#110e15", color: index <= currentStep ? "white" : "#736d7b" }}>{index < currentStep ? <CheckCircle2 color="#65d894" size={18}/> : <CircleDashed size={18}/>} {step}</div>)}</div>
            </div>}

            {tab === "publish" && <div>
              <h2 style={title}><Download/> Publicar y exportar</h2>
              <div style={successBox}><CheckCircle2 size={42}/><div><strong>Modelo preparado para CLOUVA</strong><p style={{ margin: "5px 0 0", color: "#b8c9bd" }}>Compatible con clouva_base_v1, body masks, slots y animaciones.</p></div></div>
              <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>{["GLB","FBX","OBJ","BLEND","PNG","Render 360°","GIF"].map((format) => <button key={format} style={toolButton}><Download size={15}/>{format}</button>)}</div>
              <button style={{ ...primaryButton, width: "100%", justifyContent: "center", marginTop: 18 }}>Publicar en Marketplace</button>
            </div>}
          </section>

          <aside style={panel}>
            <h3 style={{ marginTop: 0 }}>Configuración automática</h3>
            {["Auto Fix","Auto Weight","Auto Rig","Auto Export","Shrinkwrap","Surface Deform","Transfer Vertex Groups","Generar LOD","Bake PBR","Comprimir texturas"].map((setting) => <label key={setting} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 0", borderBottom: "1px solid #211b29" }}><span>{setting}</span><input type="checkbox" defaultChecked /></label>)}
            <h3>Estado</h3>
            <div style={{ padding: 14, background: "#100c14", borderRadius: 14, color: "#c9bfd3", lineHeight: 1.5 }}>{message}</div>
            <div style={{ marginTop: 14, color: "#91899b", fontSize: 13 }}>Progreso general: {progress}%</div>
            <div style={{ marginTop: 14, padding: 12, borderRadius: 12, border: "1px solid #30243a", background: "#0e0a12" }}><strong style={{ display: "block", marginBottom: 6 }}>Anclaje detectado</strong><span style={{ color: "#bda2ff" }}>{anchorByCategory[category]}</span></div>
          </aside>
        </div>
      </div>
      <style jsx>{`@media (max-width: 850px){.creator-grid,.preview-grid{grid-template-columns:1fr!important}}`}</style>
    </main>
  );
}

function Field({ label: text, children }: { label: string; children: React.ReactNode }) {
  return <label><span style={label}>{text}</span>{children}</label>;
}

function Range({ label: text, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return <label style={{ display: "block", marginBottom: 12 }}><span style={{ ...label, display: "flex", justifyContent: "space-between" }}><span>{text}</span><strong>{value}</strong></span><input type="range" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} style={{ width: "100%" }}/></label>;
}

const card: React.CSSProperties = { background: "rgba(19,14,24,.86)", border: "1px solid #2a2133", borderRadius: 18, padding: 16, display: "grid", gap: 6 };
const panel: React.CSSProperties = { background: "rgba(13,10,17,.91)", border: "1px solid #2d2337", borderRadius: 22, padding: "clamp(16px,3vw,26px)", boxShadow: "0 24px 80px rgba(0,0,0,.28)" };
const primaryButton: React.CSSProperties = { border: 0, borderRadius: 14, padding: "13px 18px", background: "linear-gradient(135deg,#7c3aed,#a855f7)", color: "white", fontWeight: 800, display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" };
const tabButton: React.CSSProperties = { border: "1px solid #33273e", background: "#100c14", color: "#aaa2b2", padding: "11px 15px", borderRadius: 12, whiteSpace: "nowrap", cursor: "pointer" };
const activeTab: React.CSSProperties = { background: "#2c1742", borderColor: "#8351c6", color: "white" };
const activeTool: React.CSSProperties = { background: "#382050", borderColor: "#9b6ee8", color: "white" };
const title: React.CSSProperties = { display: "flex", alignItems: "center", gap: 10, marginTop: 0 };
const label: React.CSSProperties = { display: "block", color: "#aaa1b4", fontSize: 13, margin: "13px 0 7px" };
const input: React.CSSProperties = { width: "100%", boxSizing: "border-box", background: "#0d0a10", border: "1px solid #33283e", borderRadius: 12, color: "white", padding: "12px 13px", outline: "none" };
const readonlyField: React.CSSProperties = { ...input, color: "#cbb7ef", minHeight: 44 };
const dropzone: React.CSSProperties = { minHeight: 130, border: "1px dashed", borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8, color: "#aaa1b4", cursor: "pointer", background: "#0c0910" };
const formGrid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12, marginBottom: 18 };
const viewer: React.CSSProperties = { minHeight: 330, borderRadius: 18, background: "radial-gradient(circle,#2a1b3b,#09070b 65%)", border: "1px solid #31253b", display: "grid", placeItems: "center", color: "#b79ed1", padding: 18 };
const smartViewer: React.CSSProperties = { minHeight: 500, borderRadius: 18, border: "1px solid #31253b", position: "relative", overflow: "hidden" };
const viewerBadge: React.CSSProperties = { position: "absolute", left: 14, bottom: 14, padding: "7px 10px", borderRadius: 99, background: "rgba(0,0,0,.55)", border: "1px solid rgba(255,255,255,.14)", fontSize: 12, zIndex: 5 };
const toolButton: React.CSSProperties = { border: "1px solid #3a2c46", background: "#16101c", color: "#d3cadb", borderRadius: 11, padding: "9px 11px", display: "inline-flex", gap: 6, alignItems: "center", cursor: "pointer" };
const successBox: React.CSSProperties = { display: "flex", gap: 14, alignItems: "center", padding: 18, background: "#132018", border: "1px solid #2c6640", borderRadius: 16, color: "#81e3a3", marginBottom: 16 };
