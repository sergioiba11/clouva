"use client";

import { useMemo, useState } from "react";
import {
  Boxes,
  Bug,
  CheckCircle2,
  CircleGauge,
  Coins,
  Gamepad2,
  Map,
  PackageCheck,
  Play,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  Store,
  Triangle,
  UploadCloud,
  WandSparkles,
} from "lucide-react";

type AssetKind = "Prenda" | "Accesorio" | "Escenario" | "Prop";
type WorldTarget = "CLOUVA Worlds" | "LIGLÚ" | "223 Social Club";

const validationItems = [
  { label: "Compatibilidad con clouva_base_v1", value: 96, detail: "Rig y escala detectados" },
  { label: "Ajuste al cuerpo", value: 91, detail: "Revisar distancia en torso" },
  { label: "Pesos de animación", value: 88, detail: "Hombros y cadera pendientes" },
  { label: "Optimización móvil", value: 94, detail: "Dentro del presupuesto Android" },
];

const scenarioTemplates = [
  { name: "El Iglú Records", type: "Estudio + ciudad", description: "Universo oficial de LIGLÚ con estudio, plazas, barbería y barrios." },
  { name: "223 Social Club", type: "Estudio de artista", description: "Lobby, estudio de grabación, living, sala de reuniones, escenario y eventos de Bless." },
  { name: "Escenario vacío", type: "Plantilla modular", description: "Base optimizada para que otro artista construya su propio universo." },
];

const debugTools = ["Wireframe", "Esqueleto", "Weight Paint", "Colisiones", "Normales", "Body Mask"];

export function CreatorStudioV2Panel() {
  const [assetKind, setAssetKind] = useState<AssetKind>("Prenda");
  const [target, setTarget] = useState<WorldTarget>("CLOUVA Worlds");
  const [selectedScenario, setSelectedScenario] = useState("El Iglú Records");
  const [enabledTools, setEnabledTools] = useState<string[]>(["Colisiones", "Body Mask"]);
  const [simulating, setSimulating] = useState(false);
  const [status, setStatus] = useState("Listo para validar el asset actual");

  const score = useMemo(
    () => Math.round(validationItems.reduce((sum, item) => sum + item.value, 0) / validationItems.length),
    [],
  );

  function toggleTool(tool: string) {
    setEnabledTools((current) => current.includes(tool) ? current.filter((item) => item !== tool) : [...current, tool]);
  }

  async function simulate() {
    setSimulating(true);
    setStatus("Probando T-Pose, Idle, Walk, Run y Jump…");
    await new Promise((resolve) => setTimeout(resolve, 900));
    setStatus("Simulación terminada: se detectaron 2 zonas para revisar antes de publicar");
    setSimulating(false);
  }

  return (
    <section style={section}>
      <div style={container}>
        <header style={header}>
          <div>
            <div style={eyebrow}><WandSparkles size={17}/> CREATOR STUDIO V2</div>
            <h2 style={heading}>De un objeto 3D a un asset listo para el juego</h2>
            <p style={subtitle}>Validá ropa, accesorios y escenarios; optimizalos y sincronizalos con la app, el Marketplace y CLOUVA Worlds en Unreal Engine 5.</p>
          </div>
          <div style={scoreCard}>
            <CircleGauge size={26}/>
            <div><strong style={{ fontSize: 28 }}>{score}%</strong><span style={muted}> compatibilidad</span></div>
          </div>
        </header>

        <div style={topGrid}>
          <article style={panel}>
            <h3 style={title}><ScanSearch/> Validación automática</h3>
            <div style={{ display: "grid", gap: 10 }}>
              {validationItems.map((item) => (
                <div key={item.label} style={validationRow}>
                  <div style={{ minWidth: 0 }}>
                    <strong>{item.label}</strong>
                    <div style={muted}>{item.detail}</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                    <div style={progressTrack}><div style={{ ...progressFill, width: `${item.value}%` }}/></div>
                    <strong>{item.value}%</strong>
                  </div>
                </div>
              ))}
            </div>
            <div style={notice}><ShieldCheck size={18}/> El modelo no se publica automáticamente: primero debe superar rig, clipping, LOD, texturas y animaciones.</div>
          </article>

          <article style={panel}>
            <h3 style={title}><Bug/> Herramientas de depuración</h3>
            <div style={chipGrid}>
              {debugTools.map((tool) => {
                const active = enabledTools.includes(tool);
                return <button key={tool} onClick={() => toggleTool(tool)} style={{ ...chip, ...(active ? activeChip : {}) }}>{active ? <CheckCircle2 size={15}/> : <Triangle size={15}/>} {tool}</button>;
              })}
            </div>
            <button onClick={simulate} disabled={simulating} style={primaryButton}><Play size={17}/>{simulating ? "Simulando…" : "Probar animaciones completas"}</button>
            <div style={statusBox}>{status}</div>
          </article>
        </div>

        <div style={worldGrid}>
          <article style={{ ...panel, gridColumn: "span 2" }} className="world-main">
            <h3 style={title}><Gamepad2/> CLOUVA Worlds — juego en Unreal Engine 5</h3>
            <p style={copy}>La app y el juego comparten la misma cuenta, avatar, inventario, música, compras y contenido. El Creator Studio prepara los assets y el juego los consume mediante la API de CLOUVA Worlds.</p>
            <div style={flow}>
              {["Creator Studio", "Blender Worker", "Supabase / Marketplace", "CLOUVA Worlds API", "Unreal Engine 5"].map((step, index) => (
                <div key={step} style={flowItem}><span style={flowNumber}>{index + 1}</span>{step}</div>
              ))}
            </div>
            <div style={featureGrid}>
              <Feature icon={<Boxes/>} title="Mismo inventario" text="La ropa comprada en la app aparece en el personaje del juego." />
              <Feature icon={<Map/>} title="Mundos de artistas" text="Cada artista puede tener escenarios, estudio, merch, música y comunidad." />
              <Feature icon={<Store/>} title="Economía conectada" text="Ventas, entradas, objetos y experiencias se sincronizan con el Marketplace." />
              <Feature icon={<PackageCheck/>} title="Assets optimizados" text="LOD, PBR, colisiones y formatos preparados para Android y Unreal." />
            </div>
          </article>

          <article style={panel}>
            <h3 style={title}><Map/> Escenarios</h3>
            <label style={label}>Tipo de contenido</label>
            <select value={assetKind} onChange={(event) => setAssetKind(event.target.value as AssetKind)} style={input}>
              <option>Prenda</option><option>Accesorio</option><option>Escenario</option><option>Prop</option>
            </select>
            <label style={label}>Universo de destino</label>
            <select value={target} onChange={(event) => setTarget(event.target.value as WorldTarget)} style={input}>
              <option>CLOUVA Worlds</option><option>LIGLÚ</option><option>223 Social Club</option>
            </select>
            <div style={{ display: "grid", gap: 9, marginTop: 14 }}>
              {scenarioTemplates.map((scenario) => (
                <button key={scenario.name} onClick={() => setSelectedScenario(scenario.name)} style={{ ...scenarioButton, ...(selectedScenario === scenario.name ? selectedScenarioStyle : {}) }}>
                  <strong>{scenario.name}</strong><span>{scenario.type}</span><small>{scenario.description}</small>
                </button>
              ))}
            </div>
          </article>
        </div>

        <div style={bottomGrid}>
          <article style={panel}>
            <h3 style={title}><Coins/> Costos antes de generar</h3>
            <div style={costRow}><span>Vista previa local</span><strong>0 créditos</strong></div>
            <div style={costRow}><span>Generación Meshy alta calidad</span><strong>Se consulta por API</strong></div>
            <div style={costRow}><span>Optimización Blender</span><strong>Incluida</strong></div>
            <p style={muted}>Nunca mostrar “polígonos” como costo. Los polígonos son calidad técnica; los créditos son el precio real para el usuario.</p>
          </article>

          <article style={panel}>
            <h3 style={title}><UploadCloud/> Publicación conectada</h3>
            <div style={publishGrid}>
              {["App CLOUVA", "Marketplace", "Perfil del artista", "CLOUVA Worlds", target].map((place) => <div key={place} style={publishItem}><CheckCircle2 size={16}/>{place}</div>)}
            </div>
            <button style={primaryButton}><Sparkles size={17}/> Preparar {assetKind.toLowerCase()} para publicar</button>
          </article>
        </div>
      </div>
      <style jsx>{`
        @media (max-width: 900px) {
          .world-main { grid-column: span 1 !important; }
        }
      `}</style>
    </section>
  );
}

function Feature({ icon, title: featureTitle, text }: { icon: React.ReactNode; title: string; text: string }) {
  return <div style={feature}><div style={{ color: "#b78cff" }}>{icon}</div><strong>{featureTitle}</strong><span style={muted}>{text}</span></div>;
}

const section: React.CSSProperties = { background: "#050507", color: "white", padding: "0 22px 48px", fontFamily: "Inter, system-ui, sans-serif" };
const container: React.CSSProperties = { maxWidth: 1440, margin: "0 auto", paddingTop: 4 };
const header: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 18, flexWrap: "wrap", marginBottom: 16 };
const eyebrow: React.CSSProperties = { color: "#b78cff", display: "flex", alignItems: "center", gap: 8, fontWeight: 800, letterSpacing: 1.2 };
const heading: React.CSSProperties = { fontSize: "clamp(24px,4vw,42px)", margin: "7px 0" };
const subtitle: React.CSSProperties = { color: "#aaa3b5", maxWidth: 850, margin: 0, lineHeight: 1.55 };
const scoreCard: React.CSSProperties = { display: "flex", alignItems: "center", gap: 12, border: "1px solid #513575", background: "linear-gradient(135deg,#21102f,#100b16)", borderRadius: 18, padding: "13px 17px", color: "#c9a8ff" };
const topGrid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 14, marginBottom: 14 };
const worldGrid: React.CSSProperties = { display: "grid", gridTemplateColumns: "minmax(0,2fr) minmax(290px,1fr)", gap: 14, marginBottom: 14 };
const bottomGrid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 14 };
const panel: React.CSSProperties = { background: "rgba(14,10,18,.96)", border: "1px solid #30243a", borderRadius: 22, padding: "clamp(16px,3vw,24px)", boxShadow: "0 20px 70px rgba(0,0,0,.25)" };
const title: React.CSSProperties = { display: "flex", alignItems: "center", gap: 9, margin: "0 0 14px" };
const muted: React.CSSProperties = { color: "#9f97a9", fontSize: 13, lineHeight: 1.45 };
const validationRow: React.CSSProperties = { display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 14, alignItems: "center", background: "#0d0911", border: "1px solid #251d2d", borderRadius: 14, padding: 12 };
const progressTrack: React.CSSProperties = { width: 88, height: 7, borderRadius: 99, background: "#251b30", overflow: "hidden" };
const progressFill: React.CSSProperties = { height: "100%", borderRadius: 99, background: "linear-gradient(90deg,#7c3aed,#c084fc)" };
const notice: React.CSSProperties = { marginTop: 12, display: "flex", gap: 9, alignItems: "center", padding: 12, borderRadius: 13, background: "#112019", border: "1px solid #28513a", color: "#9ee7b8", fontSize: 13 };
const chipGrid: React.CSSProperties = { display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 };
const chip: React.CSSProperties = { border: "1px solid #3a2c46", background: "#141018", color: "#bcb4c5", borderRadius: 11, padding: "9px 11px", display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" };
const activeChip: React.CSSProperties = { borderColor: "#9365da", background: "#332047", color: "white" };
const primaryButton: React.CSSProperties = { width: "100%", justifyContent: "center", border: 0, borderRadius: 14, padding: "12px 15px", background: "linear-gradient(135deg,#7c3aed,#a855f7)", color: "white", fontWeight: 800, display: "flex", alignItems: "center", gap: 8, cursor: "pointer" };
const statusBox: React.CSSProperties = { marginTop: 10, borderRadius: 12, padding: 11, background: "#0d0911", color: "#b9afc2", fontSize: 13 };
const copy: React.CSSProperties = { color: "#b1a9ba", lineHeight: 1.55 };
const flow: React.CSSProperties = { display: "flex", flexWrap: "wrap", gap: 8, margin: "16px 0" };
const flowItem: React.CSSProperties = { display: "flex", alignItems: "center", gap: 7, padding: "9px 11px", borderRadius: 12, border: "1px solid #352741", background: "#110d16", color: "#d2c8dc", fontSize: 13 };
const flowNumber: React.CSSProperties = { width: 22, height: 22, display: "grid", placeItems: "center", borderRadius: 99, background: "#6731a9", color: "white", fontWeight: 800 };
const featureGrid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10 };
const feature: React.CSSProperties = { display: "grid", gap: 7, padding: 13, borderRadius: 14, border: "1px solid #2a2033", background: "#0d0a10" };
const label: React.CSSProperties = { display: "block", color: "#a79dad", fontSize: 13, margin: "11px 0 6px" };
const input: React.CSSProperties = { width: "100%", boxSizing: "border-box", background: "#0b080e", border: "1px solid #382a44", borderRadius: 12, color: "white", padding: "11px 12px" };
const scenarioButton: React.CSSProperties = { textAlign: "left", display: "grid", gap: 3, border: "1px solid #2d2237", background: "#0d0a10", borderRadius: 13, padding: 11, color: "#d6cddd", cursor: "pointer" };
const selectedScenarioStyle: React.CSSProperties = { borderColor: "#8658c5", background: "#28183a" };
const costRow: React.CSSProperties = { display: "flex", justifyContent: "space-between", gap: 14, borderBottom: "1px solid #241c2c", padding: "10px 0" };
const publishGrid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 8, marginBottom: 14 };
const publishItem: React.CSSProperties = { display: "flex", alignItems: "center", gap: 7, padding: 10, borderRadius: 11, background: "#102018", border: "1px solid #28513a", color: "#91e3ae", fontSize: 13 };
