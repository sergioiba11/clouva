"use client";

import { useMemo, useState } from "react";
import { Activity, Box, CheckCircle2, CircleDashed, Download, ImagePlus, Play, RotateCcw, Settings2, Sparkles, Upload, UserRound, WandSparkles } from "lucide-react";
import { SmartTryOnViewer, type TryOnAdjustments } from "@/components/creator-studio/SmartTryOnViewer";
import { ReferenceAssetLibrary } from "@/components/creator-studio/ReferenceAssetLibrary";
import type { ReferenceAsset, ReferenceCategory } from "@/lib/creator-studio/reference-assets";

const pipeline = [
  "Subiendo GLB real", "Importando en Blender", "Alineando con clouva_base_v1", "Aplicando Shrinkwrap",
  "Transfiriendo Vertex Groups", "Transfiriendo pesos", "Vinculando Armature", "Corrigiendo clipping",
  "Prueba T-Pose", "Prueba Idle", "Prueba Walk", "Exportando GLB riggeado",
];

const categories = ["hoodie", "remera", "campera", "baggy", "zapatillas", "gorra", "cadena", "lentes", "mochila", "aros", "guantes", "pulseras", "anillos"];
const anchorByCategory: Record<string, string> = {
  hoodie: "Torso + brazos", remera: "Torso", campera: "Torso + brazos", baggy: "Cintura + piernas",
  zapatillas: "Pies", gorra: "Cabeza", cadena: "Cuello", lentes: "Ojos", mochila: "Espalda",
  aros: "Orejas", guantes: "Manos", pulseras: "Muñecas", anillos: "Dedos",
};

type Tab = "create" | "preview" | "process" | "publish";
type Fit = "Slim" | "Regular" | "Oversize";
type Pose = "T-Pose" | "Idle" | "Walk";
type View = "Frente" | "Lateral" | "Espalda";

const initialAdjustments: TryOnAdjustments = {
  scale: 100, length: 100, width: 100, x: 0, y: 0, rotation: 0, height: 0, distance: 8,
  sleeveLength: 100, legLength: 100, waistHeight: 50, neckSize: 50, hoodSize: 50,
};

export function CreatorStudio() {
  const [category, setCategory] = useState("hoodie");
  const [tab, setTab] = useState<Tab>("create");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("Listo para cargar una referencia real");
  const [fit, setFit] = useState<Fit>("Regular");
  const [pose, setPose] = useState<Pose>("Idle");
  const [view, setView] = useState<View>("Frente");
  const [background, setBackground] = useState("#120b1f");
  const [showBody, setShowBody] = useState(true);
  const [garmentOnly, setGarmentOnly] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [adjustments, setAdjustments] = useState<TryOnAdjustments>(initialAdjustments);
  const [referenceAsset, setReferenceAsset] = useState<ReferenceAsset | null>(null);
  const [referenceModelUrl, setReferenceModelUrl] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);

  const currentStep = useMemo(() => Math.min(Math.floor((progress / 100) * pipeline.length), pipeline.length - 1), [progress]);
  const updateAdjustment = (key: keyof TryOnAdjustments, value: number) => setAdjustments((current) => ({ ...current, [key]: value }));

  function resetPreview() {
    setFit("Regular"); setPose("Idle"); setView("Frente"); setRotation(0); setZoom(1);
    setShowBody(true); setGarmentOnly(false); setAdjustments(initialAdjustments);
  }

  function resetProject() {
    setReferenceAsset(null); setReferenceModelUrl(null); setResultUrl(null); setProgress(0);
    resetPreview(); setTab("create"); setMessage("Nuevo proyecto creado");
  }

  async function rigReference() {
    if (!referenceAsset) return;
    setRunning(true); setTab("process"); setProgress(5); setMessage("Subiendo el GLB real al Blender Worker…");
    const timer = window.setInterval(() => setProgress((value) => Math.min(value + 4, 88)), 700);
    try {
      const form = new FormData();
      form.set("file", referenceAsset.file, referenceAsset.fileName);
      form.set("payload", JSON.stringify({
        category, rig: "clouva_base_v1", autoFix: true, autoWeight: true, autoExport: true,
        targetPolycount: 25000, maxFileSizeMb: 18, textureResolution: 2048, formats: ["glb"],
        previewSettings: { fit, pose, view, adjustments }, referenceAssetName: referenceAsset.name,
      }));
      const response = await fetch("/api/creator-studio/blender", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Falló el auto rig");
      setProgress(100);
      setResultUrl(data.resultUrl ?? null);
      if (data.mock) {
        setMessage("El botón de Auto Rig ya funciona y envía el GLB real. Falta conectar BLENDER_WORKER_URL en Vercel para que Railway ejecute Blender.");
      } else {
        setMessage(`Auto Rig iniciado: ${data.jobId}. Blender está transfiriendo pesos y vinculando la prenda al rig CLOUVA.`);
      }
      setTab("publish");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo riggear la referencia");
    } finally {
      window.clearInterval(timer);
      setRunning(false);
    }
  }

  return (
    <main style={{ minHeight: "100dvh", background: "radial-gradient(circle at 20% 0%,#271045 0,#0b0711 38%,#050507 100%)", color: "white", padding: 22, fontFamily: "Inter,system-ui,sans-serif" }}>
      <div style={{ maxWidth: 1440, margin: "0 auto" }}>
        <header style={{ display: "flex", justifyContent: "space-between", gap: 18, alignItems: "center", marginBottom: 22, flexWrap: "wrap" }}>
          <div><div style={{ display: "flex", alignItems: "center", gap: 10, color: "#c4a7ff", fontWeight: 800 }}><WandSparkles size={18}/> CLOUVA</div><h1 style={{ margin: "5px 0 3px", fontSize: "clamp(28px,5vw,52px)" }}>Creator Studio</h1><p style={{ margin: 0, color: "#aaa3b5" }}>GLB real → ajustar → Auto Rig con Blender → probar animaciones → Marketplace</p></div>
          <button onClick={resetProject} style={primaryButton}><Sparkles size={18}/> Nuevo modelo</button>
        </header>

        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12, marginBottom: 18 }}>
          {[{label:"Referencias",value:referenceAsset?"1":"0",icon:<Box/>},{label:"Procesando",value:running?"1":"0",icon:<Activity/>},{label:"Listos",value:resultUrl?"1":"0",icon:<CheckCircle2/>},{label:"Errores",value:"0",icon:<CircleDashed/>}].map((item)=><div key={item.label} style={card}><div style={{color:"#bda2ff"}}>{item.icon}</div><strong style={{fontSize:26}}>{item.value}</strong><span style={{color:"#9e97a8"}}>{item.label}</span></div>)}
        </section>

        <nav style={{ display: "flex", gap: 8, overflowX: "auto", marginBottom: 16 }}>
          {(["create","preview","process","publish"] as const).map((item,index)=><button key={item} onClick={()=>setTab(item)} style={{...tabButton,...(tab===item?activeTab:{})}}>{index+1}. {item==="create"?"Referencia":item==="preview"?"Probar en mi avatar":item==="process"?"Auto Rig Blender":"Resultado"}</button>)}
        </nav>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.5fr) minmax(280px,.7fr)", gap: 16 }} className="creator-grid">
          <section style={{ ...panel, minHeight: 620 }}>
            {tab === "create" && <div>
              <h2 style={title}><ImagePlus/> Biblioteca de referencias GLB</h2>
              <div style={formGrid}><Field label="Categoría"><select value={category} onChange={(event)=>setCategory(event.target.value)} style={input}>{categories.map((item)=><option key={item}>{item}</option>)}</select></Field><Field label="Zona automática"><div style={readonlyField}>{anchorByCategory[category]}</div></Field><Field label="Costo del visor"><div style={readonlyField}>0 créditos</div></Field></div>
              <ReferenceAssetLibrary selectedAssetId={referenceAsset?.id ?? null} onCategoryChange={(value:ReferenceCategory)=>setCategory(value)} onSelect={(asset,url)=>{setReferenceAsset(asset);setReferenceModelUrl(url);if(asset)setMessage(`${asset.name} listo para probar y riggear.`);}}/>
              <button disabled={!referenceAsset} onClick={()=>setTab("preview")} style={{...primaryButton,width:"100%",justifyContent:"center",marginTop:14,opacity:referenceAsset?1:.5}}><UserRound/> Probar GLB en mi avatar</button>
            </div>}

            {tab === "preview" && <div>
              <h2 style={title}><UserRound/> Ajustar referencia antes del rig</h2>
              <div style={{ display:"grid",gridTemplateColumns:"minmax(0,1.2fr) minmax(250px,.8fr)",gap:16 }} className="preview-grid">
                <div><div style={{...smartViewer,background}}><SmartTryOnViewer category={category} fit={fit} pose={pose} view={view} background={background} showBody={showBody} garmentOnly={garmentOnly} adjustments={{...adjustments,rotation:adjustments.rotation+rotation,scale:adjustments.scale*zoom}} referenceModelUrl={referenceModelUrl} onReferenceStatus={setMessage}/><div style={viewerBadge}>{referenceAsset?`${referenceAsset.name} · referencia sin rig`:"Sin GLB"}</div></div>
                <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:12}}>{(["Frente","Lateral","Espalda"] as View[]).map((item)=><button key={item} onClick={()=>setView(item)} style={{...toolButton,...(view===item?activeTool:{})}}>{item}</button>)}{(["T-Pose","Idle","Walk"] as Pose[]).map((item)=><button key={item} onClick={()=>setPose(item)} style={{...toolButton,...(pose===item?activeTool:{})}}>{item}</button>)}</div>
                <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:8}}><button onClick={()=>setRotation((v)=>v-45)} style={toolButton}>↶ Rotar</button><button onClick={()=>setRotation((v)=>v+45)} style={toolButton}>Rotar ↷</button><button onClick={()=>setZoom((v)=>Math.min(2,v+.1))} style={toolButton}>Zoom +</button><button onClick={()=>setZoom((v)=>Math.max(.35,v-.1))} style={toolButton}>Zoom −</button><button onClick={()=>setShowBody((v)=>!v)} style={toolButton}>{showBody?"Ocultar cuerpo":"Mostrar cuerpo"}</button><button onClick={resetPreview} style={toolButton}><RotateCcw size={15}/> Reiniciar</button></div></div>
                <div><Field label="Ajuste"><select value={fit} onChange={(event)=>setFit(event.target.value as Fit)} style={input}><option>Slim</option><option>Regular</option><option>Oversize</option></select></Field><Field label="Fondo"><input type="color" value={background} onChange={(event)=>setBackground(event.target.value)} style={{...input,height:46,padding:5}}/></Field><Range label="Escala" value={adjustments.scale} min={25} max={300} onChange={(v)=>updateAdjustment("scale",v)}/><Range label="Largo / altura" value={adjustments.length} min={35} max={240} onChange={(v)=>updateAdjustment("length",v)}/><Range label="Ancho" value={adjustments.width} min={35} max={240} onChange={(v)=>updateAdjustment("width",v)}/><Range label="Posición X" value={adjustments.x} min={-150} max={150} onChange={(v)=>updateAdjustment("x",v)}/><Range label="Posición Y" value={adjustments.y} min={-150} max={150} onChange={(v)=>updateAdjustment("y",v)}/><Range label="Rotación" value={adjustments.rotation} min={-180} max={180} onChange={(v)=>updateAdjustment("rotation",v)}/><Range label="Altura" value={adjustments.height} min={-100} max={100} onChange={(v)=>updateAdjustment("height",v)}/><Range label="Profundidad" value={adjustments.distance} min={-40} max={60} onChange={(v)=>updateAdjustment("distance",v)}/></div>
              </div>
              <div style={notice}>La referencia todavía es estática. Tocá Auto Rig para que Blender transfiera pesos, Vertex Groups y Armature desde clouva_base_v1.</div>
              <button disabled={running||!referenceAsset} onClick={rigReference} style={{...primaryButton,width:"100%",justifyContent:"center",marginTop:14,opacity:referenceAsset?1:.5}}><Settings2/> {running?"Riggeando…":"Auto Rig: ajustar y vincular al avatar"}</button>
            </div>}

            {tab === "process" && <div><h2 style={title}><Settings2/> Auto Rig con Blender Worker</h2><div style={{height:10,background:"#211a29",borderRadius:99,overflow:"hidden",marginBottom:18}}><div style={{width:`${progress}%`,height:"100%",background:"linear-gradient(90deg,#7c3aed,#d8b4fe)",transition:"width .2s"}}/></div><div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:8}}>{pipeline.map((step,index)=><div key={step} style={{display:"flex",alignItems:"center",gap:10,padding:11,borderRadius:12,background:index<currentStep?"#17251e":index===currentStep?"#261b35":"#110e15",color:index<=currentStep?"white":"#736d7b"}}>{index<currentStep?<CheckCircle2 color="#65d894" size={18}/>:<CircleDashed size={18}/>} {step}</div>)}</div></div>}

            {tab === "publish" && <div><h2 style={title}><Download/> Resultado del Auto Rig</h2><div style={successBox}><CheckCircle2 size={42}/><div><strong>{resultUrl?"Referencia riggeada":"Auto Rig preparado"}</strong><p style={{margin:"5px 0 0",color:"#b8c9bd"}}>{message}</p></div></div>{resultUrl?<a href={resultUrl} style={{...primaryButton,textDecoration:"none"}}><Download size={16}/> Descargar GLB riggeado</a>:<button onClick={()=>setTab("preview")} style={primaryButton}><Play size={16}/> Volver al ajuste</button>}</div>}
          </section>

          <aside style={panel}><h3 style={{marginTop:0}}>Configuración automática</h3>{["Auto Fix","Auto Weight","Auto Rig","Shrinkwrap","Surface Deform","Transfer Vertex Groups","Pruebas T-Pose / Idle / Walk"].map((setting)=><label key={setting} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"11px 0",borderBottom:"1px solid #211b29"}}><span>{setting}</span><input type="checkbox" defaultChecked/></label>)}<h3>Estado</h3><div style={{padding:14,background:"#100c14",borderRadius:14,color:"#c9bfd3",lineHeight:1.5}}>{message}</div><div style={{marginTop:14,color:"#91899b",fontSize:13}}>Progreso general: {progress}%</div><Info title="Referencia activa" value={referenceAsset?.name??"Ninguna"}/><Info title="Anclaje detectado" value={anchorByCategory[category]}/></aside>
        </div>
      </div>
      <style jsx>{`@media(max-width:850px){.creator-grid,.preview-grid{grid-template-columns:1fr!important}}`}</style>
    </main>
  );
}

function Field({label:text,children}:{label:string;children:React.ReactNode}){return <label><span style={label}>{text}</span>{children}</label>}
function Range({label:text,value,min,max,onChange}:{label:string;value:number;min:number;max:number;onChange:(value:number)=>void}){return <label style={{display:"block",marginBottom:12}}><span style={{...label,display:"flex",justifyContent:"space-between"}}><span>{text}</span><strong>{value}</strong></span><input type="range" min={min} max={max} value={value} onChange={(event)=>onChange(Number(event.target.value))} style={{width:"100%"}}/></label>}
function Info({title:infoTitle,value}:{title:string;value:string}){return <div style={{marginTop:10,padding:12,borderRadius:12,border:"1px solid #30243a",background:"#0e0a12"}}><strong style={{display:"block",marginBottom:6}}>{infoTitle}</strong><span style={{color:"#bda2ff"}}>{value}</span></div>}

const card:React.CSSProperties={background:"rgba(19,14,24,.86)",border:"1px solid #2a2133",borderRadius:18,padding:16,display:"grid",gap:6};
const panel:React.CSSProperties={background:"rgba(13,10,17,.91)",border:"1px solid #2d2337",borderRadius:22,padding:"clamp(16px,3vw,26px)",boxShadow:"0 24px 80px rgba(0,0,0,.28)"};
const primaryButton:React.CSSProperties={border:0,borderRadius:14,padding:"13px 18px",background:"linear-gradient(135deg,#7c3aed,#a855f7)",color:"white",fontWeight:800,display:"inline-flex",alignItems:"center",gap:8,cursor:"pointer"};
const tabButton:React.CSSProperties={border:"1px solid #33273e",background:"#100c14",color:"#aaa2b2",padding:"11px 15px",borderRadius:12,whiteSpace:"nowrap",cursor:"pointer"};
const activeTab:React.CSSProperties={background:"#2c1742",borderColor:"#8351c6",color:"white"};
const activeTool:React.CSSProperties={background:"#382050",borderColor:"#9b6ee8",color:"white"};
const title:React.CSSProperties={display:"flex",alignItems:"center",gap:10,marginTop:0};
const label:React.CSSProperties={display:"block",color:"#aaa1b4",fontSize:13,margin:"13px 0 7px"};
const input:React.CSSProperties={width:"100%",boxSizing:"border-box",background:"#0d0a10",border:"1px solid #33283e",borderRadius:12,color:"white",padding:"12px 13px",outline:"none"};
const readonlyField:React.CSSProperties={...input,color:"#cbb7ef",minHeight:44};
const formGrid:React.CSSProperties={display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:12,marginBottom:18};
const smartViewer:React.CSSProperties={minHeight:500,borderRadius:18,border:"1px solid #31253b",position:"relative",overflow:"hidden"};
const viewerBadge:React.CSSProperties={position:"absolute",left:14,bottom:14,padding:"7px 10px",borderRadius:99,background:"rgba(0,0,0,.55)",border:"1px solid rgba(255,255,255,.14)",fontSize:12,zIndex:5};
const toolButton:React.CSSProperties={border:"1px solid #3a2c46",background:"#16101c",color:"#d3cadb",borderRadius:11,padding:"9px 11px",display:"inline-flex",gap:6,alignItems:"center",cursor:"pointer"};
const notice:React.CSSProperties={marginTop:14,padding:12,borderRadius:12,background:"#16101c",border:"1px solid #3a2c46",color:"#cfc3db"};
const successBox:React.CSSProperties={display:"flex",gap:14,alignItems:"center",padding:18,background:"#132018",border:"1px solid #2c6640",borderRadius:16,color:"#81e3a3",marginBottom:16};
