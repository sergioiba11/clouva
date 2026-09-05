import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Rapafernalia — Tienda oficial en CLOUVA",
  description: "Rapafernalia en la Matrix de CLOUVA. Parafernalia, accesorios y cultura urbana.",
  alternates: { canonical: "https://clouva.com.ar/rapafernalia" },
  openGraph: {
    title: "Rapafernalia — CLOUVA",
    description: "Tienda oficial de Rapafernalia dentro de la Matrix de CLOUVA.",
    url: "https://clouva.com.ar/rapafernalia",
    images: [{ url: "/assets/rapafernalia/rapafernalia-logo-oficial.png" }],
  },
};

const categories = [
  { name: "Papeles", detail: "Clásicos, celulosa y formatos seleccionados" },
  { name: "Filtros & tips", detail: "Tips y complementos para armar" },
  { name: "Accesorios", detail: "Herramientas y parafernalia" },
  { name: "Novedades", detail: "Lo nuevo que entra a Rapafernalia" },
];

export default function RapafernaliaPage() {
  return (
    <main className="rapa-page">
      <div className="rapa-grid" aria-hidden="true" />
      <div className="rapa-orb rapa-orb-a" aria-hidden="true" />
      <div className="rapa-orb rapa-orb-b" aria-hidden="true" />

      <header className="rapa-shell rapa-header">
        <Link href="/" className="rapa-matrix-link" aria-label="Volver a CLOUVA">
          <span className="rapa-dot" />
          <span>CLOUVA / MATRIX</span>
        </Link>
        <span className="rapa-public-badge">PÁGINA PÚBLICA</span>
      </header>

      <section className="rapa-shell rapa-hero">
        <div className="rapa-logo-stage">
          <div className="rapa-logo-glow" aria-hidden="true" />
          <img
            className="rapa-logo"
            src="/assets/rapafernalia/rapafernalia-logo-oficial-transparente.png"
            alt="Rapafernalia"
          />
        </div>

        <div className="rapa-hero-copy">
          <p className="rapa-eyebrow">TIENDA OFICIAL · CLOUVA</p>
          <h1>Rapafernalia</h1>
          <p className="rapa-lead">
            Parafernalia, accesorios y cultura urbana dentro de la Matrix de CLOUVA.
          </p>
          <p className="rapa-note">
            Este es el espacio público oficial de Rapafernalia. El catálogo se publica con stock real a medida que los productos ingresan a la tienda.
          </p>

          <div className="rapa-actions">
            <a href="#catalogo" className="rapa-button rapa-button-primary">
              Explorar catálogo
            </a>
            <Link href="/" className="rapa-button rapa-button-ghost">
              Entrar a CLOUVA
            </Link>
          </div>

          <div className="rapa-address-card">
            <span className="rapa-address-label">LINK OFICIAL</span>
            <strong>clouva.com.ar/rapafernalia</strong>
          </div>
        </div>
      </section>

      <section className="rapa-shell rapa-strip" aria-label="Identidad de la tienda">
        <div>
          <span>01</span>
          <strong>Rapafernalia</strong>
          <small>Identidad propia</small>
        </div>
        <div>
          <span>02</span>
          <strong>Matrix</strong>
          <small>Página pública CLOUVA</small>
        </div>
        <div>
          <span>03</span>
          <strong>Stock real</strong>
          <small>Catálogo sin productos inventados</small>
        </div>
      </section>

      <section id="catalogo" className="rapa-shell rapa-catalog">
        <div className="rapa-section-heading">
          <p>CATÁLOGO</p>
          <h2>Entrá por categoría</h2>
          <span>La estructura ya queda preparada para conectar los productos reales de Rapafernalia.</span>
        </div>

        <div className="rapa-categories">
          {categories.map((category, index) => (
            <article className="rapa-category" key={category.name}>
              <span className="rapa-category-index">0{index + 1}</span>
              <div>
                <h3>{category.name}</h3>
                <p>{category.detail}</p>
              </div>
              <span className="rapa-arrow" aria-hidden="true">↗</span>
            </article>
          ))}
        </div>
      </section>

      <section className="rapa-shell rapa-stock-panel">
        <div className="rapa-live-dot" aria-hidden="true" />
        <div>
          <p className="rapa-stock-kicker">PRODUCTOS DISPONIBLES</p>
          <h2>El escaparate se alimenta del inventario real.</h2>
          <p>
            No mostramos precios ni unidades ficticias. Cuando el catálogo de Rapafernalia quede conectado al inventario, los productos públicos aparecen acá con su disponibilidad real.
          </p>
        </div>
        <div className="rapa-stock-status">
          <span>ESTADO</span>
          <strong>Preparado para catálogo</strong>
        </div>
      </section>

      <footer className="rapa-shell rapa-footer">
        <div>
          <strong>RAPAFERNALIA</strong>
          <span>× CLOUVA MATRIX</span>
        </div>
        <Link href="/">clouva.com.ar</Link>
      </footer>

      <style>{`
        .rapa-page {
          --violet: #9d24ff;
          --violet-soft: #c788ff;
          --ink: #050308;
          position: relative;
          min-height: 100svh;
          overflow: hidden;
          color: #fff;
          background:
            radial-gradient(circle at 50% 8%, rgba(153, 31, 255, .18), transparent 34rem),
            radial-gradient(circle at 8% 70%, rgba(101, 20, 190, .12), transparent 32rem),
            linear-gradient(180deg, #07040c 0%, #030205 60%, #050208 100%);
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        .rapa-grid {
          position: absolute;
          inset: 0;
          pointer-events: none;
          opacity: .16;
          background-image:
            linear-gradient(rgba(255,255,255,.045) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,.045) 1px, transparent 1px);
          background-size: 42px 42px;
          mask-image: linear-gradient(to bottom, black, transparent 72%);
        }
        .rapa-orb { position: absolute; border-radius: 999px; filter: blur(110px); pointer-events: none; }
        .rapa-orb-a { width: 280px; height: 280px; background: rgba(142,0,255,.18); top: 180px; right: -120px; }
        .rapa-orb-b { width: 220px; height: 220px; background: rgba(95,0,170,.12); top: 900px; left: -100px; }
        .rapa-shell { position: relative; z-index: 1; width: min(100% - 36px, 1120px); margin-inline: auto; box-sizing: border-box; }
        .rapa-header { min-height: 84px; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding-right: 138px; }
        .rapa-matrix-link { display: inline-flex; align-items: center; gap: 9px; color: rgba(255,255,255,.82); text-decoration: none; font-size: 11px; font-weight: 800; letter-spacing: .14em; }
        .rapa-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--violet); box-shadow: 0 0 18px var(--violet); }
        .rapa-public-badge { font-size: 9px; font-weight: 800; letter-spacing: .14em; color: rgba(255,255,255,.38); white-space: nowrap; }
        .rapa-hero { min-height: 620px; display: grid; grid-template-columns: minmax(320px, .92fr) minmax(320px, 1.08fr); align-items: center; gap: clamp(34px, 7vw, 90px); padding: 38px 0 70px; }
        .rapa-logo-stage { position: relative; display: grid; place-items: center; min-height: 470px; }
        .rapa-logo-glow { position: absolute; width: 68%; aspect-ratio: 1; border-radius: 50%; background: rgba(139,28,240,.26); filter: blur(72px); }
        .rapa-logo { position: relative; display: block; width: min(100%, 500px); height: auto; object-fit: contain; filter: drop-shadow(0 32px 54px rgba(0,0,0,.55)) drop-shadow(0 0 28px rgba(156,36,255,.16)); }
        .rapa-hero-copy { max-width: 560px; }
        .rapa-eyebrow { margin: 0 0 16px; color: var(--violet-soft); font-size: 10px; font-weight: 900; letter-spacing: .21em; }
        .rapa-hero h1 { margin: 0; font-family: Anton, Impact, sans-serif; font-size: clamp(54px, 8vw, 102px); line-height: .9; letter-spacing: .005em; text-transform: uppercase; font-weight: 400; }
        .rapa-lead { margin: 26px 0 0; max-width: 500px; font-size: clamp(18px, 2.2vw, 27px); line-height: 1.24; font-weight: 700; color: rgba(255,255,255,.92); }
        .rapa-note { margin: 18px 0 0; max-width: 510px; font-size: 13px; line-height: 1.7; color: rgba(255,255,255,.5); }
        .rapa-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 28px; }
        .rapa-button { min-height: 46px; display: inline-flex; align-items: center; justify-content: center; padding: 0 18px; border-radius: 999px; text-decoration: none; font-size: 11px; font-weight: 850; letter-spacing: .08em; transition: transform .2s ease, border-color .2s ease, background .2s ease; }
        .rapa-button:hover { transform: translateY(-2px); }
        .rapa-button-primary { background: #fff; color: #08050b; }
        .rapa-button-ghost { border: 1px solid rgba(255,255,255,.15); color: #fff; background: rgba(255,255,255,.035); }
        .rapa-address-card { margin-top: 34px; padding: 15px 0 0; border-top: 1px solid rgba(255,255,255,.09); display: flex; flex-direction: column; gap: 5px; }
        .rapa-address-label { color: rgba(255,255,255,.3); font-size: 8px; font-weight: 900; letter-spacing: .18em; }
        .rapa-address-card strong { font-size: 13px; letter-spacing: .01em; color: rgba(255,255,255,.82); }
        .rapa-strip { display: grid; grid-template-columns: repeat(3,1fr); border-top: 1px solid rgba(255,255,255,.09); border-bottom: 1px solid rgba(255,255,255,.09); }
        .rapa-strip > div { min-height: 116px; display: grid; grid-template-columns: 30px 1fr; grid-template-rows: auto auto; align-content: center; column-gap: 12px; padding: 18px 24px; border-right: 1px solid rgba(255,255,255,.08); }
        .rapa-strip > div:last-child { border-right: 0; }
        .rapa-strip span { grid-row: 1 / 3; color: var(--violet-soft); font-size: 10px; font-weight: 900; letter-spacing: .12em; }
        .rapa-strip strong { font-size: 14px; }
        .rapa-strip small { margin-top: 5px; color: rgba(255,255,255,.36); font-size: 10px; }
        .rapa-catalog { padding: 92px 0 52px; }
        .rapa-section-heading { max-width: 720px; margin-bottom: 34px; }
        .rapa-section-heading > p, .rapa-stock-kicker { margin: 0 0 11px; color: var(--violet-soft); font-size: 9px; font-weight: 900; letter-spacing: .2em; }
        .rapa-section-heading h2, .rapa-stock-panel h2 { margin: 0; font-size: clamp(30px, 4.4vw, 55px); line-height: 1; letter-spacing: -.035em; }
        .rapa-section-heading > span { display: block; max-width: 570px; margin-top: 14px; color: rgba(255,255,255,.42); font-size: 12px; line-height: 1.65; }
        .rapa-categories { display: grid; grid-template-columns: repeat(2,1fr); gap: 12px; }
        .rapa-category { min-height: 145px; display: grid; grid-template-columns: 34px 1fr auto; align-items: start; gap: 10px; border: 1px solid rgba(255,255,255,.09); border-radius: 22px; padding: 23px; background: linear-gradient(135deg, rgba(255,255,255,.045), rgba(255,255,255,.014)); box-shadow: inset 0 1px rgba(255,255,255,.035); }
        .rapa-category-index { color: var(--violet-soft); font-size: 9px; font-weight: 900; letter-spacing: .12em; }
        .rapa-category h3 { margin: 0; font-size: 18px; }
        .rapa-category p { margin: 9px 0 0; color: rgba(255,255,255,.38); font-size: 11px; line-height: 1.5; }
        .rapa-arrow { color: rgba(255,255,255,.25); font-size: 18px; }
        .rapa-stock-panel { margin-top: 38px; margin-bottom: 86px; display: grid; grid-template-columns: 20px minmax(0,1fr) auto; gap: 22px; align-items: center; padding: 32px; border: 1px solid rgba(166,74,255,.2); border-radius: 26px; background: radial-gradient(circle at 85% 0%, rgba(148,28,255,.12), transparent 45%), rgba(255,255,255,.025); }
        .rapa-live-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--violet); box-shadow: 0 0 18px var(--violet); align-self: start; margin-top: 5px; }
        .rapa-stock-panel h2 { font-size: clamp(24px, 3.2vw, 40px); }
        .rapa-stock-panel p:not(.rapa-stock-kicker) { max-width: 670px; margin: 14px 0 0; color: rgba(255,255,255,.42); font-size: 12px; line-height: 1.65; }
        .rapa-stock-status { min-width: 165px; padding-left: 20px; border-left: 1px solid rgba(255,255,255,.09); }
        .rapa-stock-status span { display: block; color: rgba(255,255,255,.28); font-size: 8px; font-weight: 900; letter-spacing: .16em; }
        .rapa-stock-status strong { display: block; margin-top: 8px; color: #d8b3ff; font-size: 11px; }
        .rapa-footer { min-height: 130px; display: flex; align-items: center; justify-content: space-between; gap: 20px; border-top: 1px solid rgba(255,255,255,.08); padding-bottom: 42px; }
        .rapa-footer > div { display: flex; align-items: baseline; gap: 10px; }
        .rapa-footer strong { font-size: 12px; letter-spacing: .08em; }
        .rapa-footer span, .rapa-footer a { color: rgba(255,255,255,.3); font-size: 9px; letter-spacing: .1em; text-decoration: none; }
        @media (max-width: 760px) {
          .rapa-shell { width: min(100% - 30px, 620px); }
          .rapa-header { min-height: 72px; padding-right: 124px; }
          .rapa-public-badge { display: none; }
          .rapa-matrix-link { font-size: 9px; }
          .rapa-hero { min-height: auto; grid-template-columns: 1fr; gap: 4px; padding: 22px 0 66px; }
          .rapa-logo-stage { min-height: 0; }
          .rapa-logo { width: min(94vw, 450px); }
          .rapa-hero-copy { margin-top: -14px; text-align: left; }
          .rapa-hero h1 { font-size: clamp(54px, 17vw, 78px); }
          .rapa-lead { margin-top: 20px; font-size: 19px; }
          .rapa-note { font-size: 12px; }
          .rapa-actions { display: grid; grid-template-columns: 1fr; }
          .rapa-button { width: 100%; box-sizing: border-box; }
          .rapa-strip { grid-template-columns: 1fr; }
          .rapa-strip > div { min-height: 88px; border-right: 0; border-bottom: 1px solid rgba(255,255,255,.08); padding: 14px 10px; }
          .rapa-strip > div:last-child { border-bottom: 0; }
          .rapa-catalog { padding-top: 68px; }
          .rapa-categories { grid-template-columns: 1fr; }
          .rapa-category { min-height: 125px; border-radius: 18px; padding: 20px; }
          .rapa-stock-panel { grid-template-columns: 14px 1fr; padding: 24px 20px; margin-bottom: 62px; }
          .rapa-stock-status { grid-column: 2; min-width: 0; padding: 16px 0 0; border-left: 0; border-top: 1px solid rgba(255,255,255,.08); }
          .rapa-footer { min-height: 110px; align-items: flex-start; flex-direction: column; justify-content: center; }
        }
      `}</style>
    </main>
  );
}
