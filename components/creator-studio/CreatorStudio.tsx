"use client";

import { useMemo, useState } from "react";
import { Activity, Box, CheckCircle2, CircleDashed, Download, Eye, ImagePlus, Layers3, Play, Settings2, Sparkles, Upload, WandSparkles } from "lucide-react";

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

const categories = ["hoodie", "remera", "campera", "baggy", "short", "zapatillas", "gorra", "accesorio", "objeto", "escenario"];

export function CreatorStudio() {
  const [prompt, setPrompt] = useState("");
  const [category, setCategory] = useState("hoodie");
  const [tab, setTab] = useState<"create" | "viewer" | "process" | "publish">("create");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [imageName, setImageName] = useState<string | null>(null);
  const [message, setMessage] = useState("Listo para crear un nuevo modelo");

  const currentStep = useMemo(() => Math.min(Math.floor((progress / 100) * pipeline.length), pipeline.length - 1), [progress]);

  async function generateModel() {
    setRunning(true);
    setProgress(8);
    setMessage("Enviando solicitud a Meshy…");
    try {
      const response = await fetch("/api/creator-studio/meshy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, category, quality: "high", polycount: 30000, textureResolution: 2048 }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo iniciar Meshy");
      setProgress(35);
      setMessage(data.mock ? "Proyecto preparado. Falta configurar MESHY_API_KEY para generar el modelo real." : `Meshy iniciado: ${data.taskId}`);
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
    <main style={{ minHeight: "100dvh", background: "radial-gradient(circle at 20% 0%, #271045 0, #0b0711 38%, #050507 100%)", color: "white", padding: "22px", fontFamily: "Inter, system-ui, sans-serif" }}>
      <div style={{ maxWidth: 1440, margin: "0 auto" }}>
        <header style={{ display: "flex", justifyContent: "space-between", gap: 18, alignItems: "center", marginBottom: 22, flexWrap: "wrap" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#c4a7ff", fontWeight: 800, letterSpacing: 1.5 }}><WandSparkles size={18}/> CLOUVA</div>
            <h1 style={{ margin: "5px 0 3px", fontSize: "clamp(28px, 5vw, 52px)", lineHeight: 1 }}>Creator Studio</h1>
            <p style={{ margin: 0, color: "#aaa3b5" }}>Referencia → Meshy → Blender → Optimización → Marketplace</p>
          </div>
          <button onClick={() => { setPrompt(""); setProgress(0); setTab("create"); setMessage("Nuevo proyecto creado"); }} style={primaryButton}><Sparkles size={18}/> Nuevo modelo</button>
        </header>

        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 18 }}>
          {[{label:"Proyectos",value:"12",icon:<Box/>},{label:"Procesando",value:running?"1":"0",icon:<Activity/>},{label:"Listos",value:"8",icon:<CheckCircle2/>},{label:"Errores",value:"0",icon:<CircleDashed/>}].map((item) => <div key={item.label} style={card}><div style={{ color: "#bda2ff" }}>{item.icon}</div><strong style={{ fontSize: 26 }}>{item.value}</strong><span style={{ color: "#9e97a8" }}>{item.label}</span></div>)}
        </section>

        <nav style={{ display: "flex", gap: 8, overflowX: "auto", marginBottom: 16 }}>
          {(["create","viewer","process","publish"] as const).map((item, index) => <button key={item} onClick={() => setTab(item)} style={{ ...tabButton, ...(tab === item ? activeTab : {}) }}>{index + 1}. {item === "create" ? "Generación" : item === "viewer" ? "Visor 3D" : item === "process" ? "Blender Worker" : "Marketplace"}</button>)}
        </nav>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.5fr) minmax(280px, .7fr)", gap: 16 }} className="creator-grid">
          <section style={{ ...panel, minHeight: 580 }}>
            {tab === "create" && <div>
              <h2 style={title}><ImagePlus/> Generación Meshy</h2>
              <label style={label}>Imagen de referencia</label>
              <label style={{ ...dropzone, borderColor: imageName ? "#8b5cf6" : "#40364b" }}><Upload/><span>{imageName ?? "Tocá para subir PNG, JPG o WEBP"}</span><input hidden type="file" accept="image/*" onChange={(event) => setImageName(event.target.files?.[0]?.name ?? null)}/></label>
              <label style={label}>Prompt</label>
              <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Ejemplo: hoodie oversize violeta y negro, tela gruesa, logo CLOUVA bordado…" style={{ ...input, minHeight: 125, resize: "vertical" }}/>
              <div style={formGrid}>
                <Field label="Categoría"><select value={category} onChange={(event) => setCategory(event.target.value)} style={input}>{categories.map((item) => <option key={item}>{item}</option>)}</select></Field>
                <Field label="Estilo"><select style={input}><option>CLOUVA</option><option>Anime</option><option>NLB</option><option>Realista</option></select></Field>
                <Field label="Calidad"><select style={input}><option>Alta</option><option>Media</option><option>Preview</option></select></Field>
                <Field label="Polycount"><input style={input} type="number" defaultValue={30000}/></Field>
                <Field label="Textura"><select style={input}><option>2048 px</option><option>1024 px</option><option>4096 px</option></select></Field>
                <Field label="Materiales"><select style={input}><option>PBR</option><option>Optimizado móvil</option><option>Sin textura</option></select></Field>
              </div>
              <button disabled={running || (!prompt && !imageName)} onClick={generateModel} style={{ ...primaryButton, width: "100%", justifyContent: "center", opacity: running || (!prompt && !imageName) ? .5 : 1 }}><Sparkles/> {running ? "Generando…" : "Generar modelo"}</button>
            </div>}

            {tab === "viewer" && <div style={{ height: "100%" }}>
              <h2 style={title}><Eye/> Visor 3D + Avatar CLOUVA</h2>
              <div style={viewer}><div style={{ textAlign: "center" }}><Layers3 size={72} strokeWidth={1}/><h3>Vista previa del modelo</h3><p style={{ color: "#978fa3" }}>Acá se carga el GLB generado por Meshy sobre el avatar oficial.</p></div></div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>{["Rotar","Zoom","Wireframe","Materiales","Normales","UV","Huesos","Colisiones","Clipping","HDR"].map((tool) => <button key={tool} style={toolButton}>{tool}</button>)}</div>
              <button onClick={processInBlender} disabled={running} style={{ ...primaryButton, width: "100%", justifyContent: "center", marginTop: 14 }}><Play/> Procesar en Blender</button>
            </div>}

            {tab === "process" && <div>
              <h2 style={title}><Settings2/> Monitor Blender Worker</h2>
              <div style={{ height: 10, background: "#211a29", borderRadius: 99, overflow: "hidden", marginBottom: 18 }}><div style={{ width: `${progress}%`, height: "100%", background: "linear-gradient(90deg,#7c3aed,#d8b4fe)", transition: "width .2s" }}/></div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 8 }}>{pipeline.map((step, index) => <div key={step} style={{ display: "flex", alignItems: "center", gap: 10, padding: 11, borderRadius: 12, background: index < currentStep ? "#17251e" : index === currentStep ? "#261b35" : "#110e15", color: index <= currentStep ? "white" : "#736d7b" }}>{index < currentStep ? <CheckCircle2 color="#65d894" size={18}/> : <CircleDashed size={18}/>} {step}</div>)}</div>
            </div>}

            {tab === "publish" && <div>
              <h2 style={title}><Download/> Publicar y exportar</h2>
              <div style={successBox}><CheckCircle2 size={42}/><div><strong>Modelo preparado para CLOUVA</strong><p style={{ margin: "5px 0 0", color: "#b8c9bd" }}>Compatible con clouva_base_v1, body masks, slots y animaciones.</p></div></div>
              <div style={formGrid}><Field label="Nombre"><input style={input} defaultValue="Nuevo modelo CLOUVA"/></Field><Field label="Precio"><input style={input} type="number" defaultValue={0}/></Field><Field label="Licencia"><select style={input}><option>Gratis</option><option>Premium</option></select></Field><Field label="Versión"><input style={input} defaultValue="1.0.0"/></Field></div>
              <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>{["GLB","FBX","OBJ","BLEND","PNG","Render 360°","GIF"].map((format) => <button key={format} style={toolButton}><Download size={15}/>{format}</button>)}</div>
              <button style={{ ...primaryButton, width: "100%", justifyContent: "center", marginTop: 18 }}>Publicar en Marketplace</button>
            </div>}
          </section>

          <aside style={panel}>
            <h3 style={{ marginTop: 0 }}>Configuración automática</h3>
            {["Auto Fix","Auto Weight","Auto Rig","Auto Export","Shrinkwrap","Surface Deform","Transfer Vertex Groups","Generar LOD","Bake PBR","Comprimir texturas"].map((setting, index) => <label key={setting} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 0", borderBottom: "1px solid #211b29" }}><span>{setting}</span><input type="checkbox" defaultChecked={index !== 1 || true}/></label>)}
            <h3>Estado</h3>
            <div style={{ padding: 14, background: "#100c14", borderRadius: 14, color: "#c9bfd3", lineHeight: 1.5 }}>{message}</div>
            <div style={{ marginTop: 14, color: "#91899b", fontSize: 13 }}>Progreso general: {progress}%</div>
          </aside>
        </div>
      </div>
      <style jsx>{`@media (max-width: 850px){.creator-grid{grid-template-columns:1fr!important}}`}</style>
    </main>
  );
}

function Field({ label: text, children }: { label: string; children: React.ReactNode }) { return <label><span style={label}>{text}</span>{children}</label>; }
const card: React.CSSProperties = { background: "rgba(19,14,24,.86)", border: "1px solid #2a2133", borderRadius: 18, padding: 16, display: "grid", gap: 6 };
const panel: React.CSSProperties = { background: "rgba(13,10,17,.91)", border: "1px solid #2d2337", borderRadius: 22, padding: "clamp(16px,3vw,26px)", boxShadow: "0 24px 80px rgba(0,0,0,.28)" };
const primaryButton: React.CSSProperties = { border: 0, borderRadius: 14, padding: "13px 18px", background: "linear-gradient(135deg,#7c3aed,#a855f7)", color: "white", fontWeight: 800, display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" };
const tabButton: React.CSSProperties = { border: "1px solid #33273e", background: "#100c14", color: "#aaa2b2", padding: "11px 15px", borderRadius: 12, whiteSpace: "nowrap", cursor: "pointer" };
const activeTab: React.CSSProperties = { background: "#2c1742", borderColor: "#8351c6", color: "white" };
const title: React.CSSProperties = { display: "flex", alignItems: "center", gap: 10, marginTop: 0 };
const label: React.CSSProperties = { display: "block", color: "#aaa1b4", fontSize: 13, margin: "13px 0 7px" };
const input: React.CSSProperties = { width: "100%", boxSizing: "border-box", background: "#0d0a10", border: "1px solid #33283e", borderRadius: 12, color: "white", padding: "12px 13px", outline: "none" };
const dropzone: React.CSSProperties = { minHeight: 130, border: "1px dashed", borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8, color: "#aaa1b4", cursor: "pointer", background: "#0c0910" };
const formGrid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12, marginBottom: 18 };
const viewer: React.CSSProperties = { minHeight: 390, borderRadius: 18, background: "radial-gradient(circle,#2a1b3b,#09070b 65%)", border: "1px solid #31253b", display: "grid", placeItems: "center", color: "#b79ed1" };
const toolButton: React.CSSProperties = { border: "1px solid #3a2c46", background: "#16101c", color: "#d3cadb", borderRadius: 11, padding: "9px 11px", display: "inline-flex", gap: 6, alignItems: "center", cursor: "pointer" };
const successBox: React.CSSProperties = { display: "flex", gap: 14, alignItems: "center", padding: 18, background: "#132018", border: "1px solid #2c6640", borderRadius: 16, color: "#81e3a3", marginBottom: 16 };
