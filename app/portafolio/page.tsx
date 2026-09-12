import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowUpRight,
  Blocks,
  Bot,
  Box,
  Braces,
  Cloud,
  Database,
  Github,
  Layers3,
  Music2,
  Sparkles,
  WalletCards,
} from "lucide-react";
import styles from "./portfolio.module.css";

export const metadata: Metadata = {
  title: "Sergio Ibañez — Product Builder | CLOUVA",
  description:
    "Portfolio de producto, desarrollo asistido por IA, diseño, cloud y experiencias 3D construido dentro del ecosistema CLOUVA.",
};

const projects = [
  {
    number: "01",
    eyebrow: "PRODUCT · PLATFORM",
    title: "CLOUVA",
    description:
      "Una plataforma creativa para artistas que conecta identidad, música, herramientas de IA, commerce, economía interna, 3D y espacios de trabajo en un mismo ecosistema.",
    result: "Producto vivo, modular y en evolución continua.",
    tags: ["Next.js", "React", "TypeScript", "Supabase", "Google Cloud"],
    icon: Sparkles,
    visual: "universe",
  },
  {
    number: "02",
    eyebrow: "FINTECH · SYSTEM DESIGN",
    title: "Mi Flow",
    description:
      "Sistema interno de valor diseñado alrededor de una arquitectura explícita: backing, emisión, ledger y FLOW disponible, integrado al producto sin duplicar la capa de pagos reales.",
    result: "Modelo financiero separado de Mercado Pago y del saldo bancario real.",
    tags: ["Ledger", "PostgreSQL", "Supabase", "Mercado Pago", "Architecture"],
    icon: WalletCards,
    visual: "flow",
  },
  {
    number: "03",
    eyebrow: "3D · CREATOR TOOLS",
    title: "Creator Studio",
    description:
      "Pipeline de creación 3D para avatar, ropa y accesorios con assets GLB, análisis de prendas, landmarks corporales, fitting y preparación de flujo Blender → Unreal.",
    result: "Base técnica para vestir avatares y preparar prendas para simulación avanzada.",
    tags: ["GLB", "Blender", "Three.js", "React Three Fiber", "Unreal pipeline"],
    icon: Box,
    visual: "creator",
  },
  {
    number: "04",
    eyebrow: "INTERNAL TOOLS · CLOUD",
    title: "Asset Explorer",
    description:
      "Herramienta interna para administrar cientos o miles de assets desde una sola interfaz, manteniendo Google Cloud Storage, Supabase y public/ como orígenes compatibles.",
    result: "Administración visual, selección múltiple, categorías y protección de assets usados.",
    tags: ["GCS", "Supabase", "Next.js", "Admin UX", "Asset management"],
    icon: Layers3,
    visual: "assets",
  },
  {
    number: "05",
    eyebrow: "AI · PRODUCT WORKFLOW",
    title: "CLOUVA AI",
    description:
      "Capa de asistencia integrada al producto para transformar intención en acciones, creación de contenido, análisis y herramientas con contexto del ecosistema CLOUVA.",
    result: "IA tratada como parte de la arquitectura del producto, no como un chat aislado.",
    tags: ["Gemini", "Tool calling", "Multimodal", "Product AI", "Automation"],
    icon: Bot,
    visual: "ai",
  },
  {
    number: "06",
    eyebrow: "IDENTITY · MUSIC",
    title: "Player & Music",
    description:
      "Identidad pública para artistas conectada con experiencia musical, perfiles, presencia visual y servicios externos como YouTube y Spotify dentro de la interfaz principal.",
    result: "Una identidad de artista que funciona como producto, perfil y punto de entrada al ecosistema.",
    tags: ["OAuth", "YouTube", "Spotify", "Identity", "Responsive UI"],
    icon: Music2,
    visual: "player",
  },
];

const stack = [
  { label: "Frontend", value: "Next.js 15 · React 19 · TypeScript", icon: Braces },
  { label: "Data", value: "Supabase · PostgreSQL · Auth", icon: Database },
  { label: "Cloud", value: "Google Cloud · Cloud Run · GCS", icon: Cloud },
  { label: "3D", value: "Blender · GLB · Three.js · R3F", icon: Box },
  { label: "Product", value: "UI/UX · Architecture · Design Systems", icon: Blocks },
  { label: "AI", value: "Gemini · multimodal · tool workflows", icon: Bot },
];

const workflow = [
  ["01", "Defino el problema", "Primero fijo el objetivo, el flujo y las restricciones del sistema."],
  ["02", "Diseño la arquitectura", "Separo datos, interfaz, servicios, estados y dependencias antes de tocar producción."],
  ["03", "Construyo con IA", "Uso IA como acelerador para código, diseño, investigación, debugging y documentación."],
  ["04", "Pruebo e itero", "Valido el comportamiento real, detecto errores y refino la implementación sobre la arquitectura existente."],
];

export default function PortfolioPage() {
  return (
    <main className={styles.page}>
      <div className={styles.noise} aria-hidden="true" />

      <header className={styles.header}>
        <Link href="/" className={styles.brand} aria-label="Volver a CLOUVA">
          <span className={styles.brandMark}>C</span>
          <span>
            <strong>CLOUVA</strong>
            <small>PORTFOLIO</small>
          </span>
        </Link>

        <nav className={styles.nav} aria-label="Portfolio">
          <a href="#proyectos">Proyectos</a>
          <a href="#stack">Stack</a>
          <a href="#proceso">Proceso</a>
          <a href="#contacto">Contacto</a>
        </nav>

        <a
          className={styles.headerGithub}
          href="https://github.com/sergioiba11/clouva"
          target="_blank"
          rel="noreferrer"
        >
          <Github size={16} />
          GitHub
        </a>
      </header>

      <section className={styles.hero}>
        <div className={styles.heroGlow} aria-hidden="true" />
        <div className={styles.heroGrid} aria-hidden="true" />

        <div className={styles.heroCopy}>
          <p className={styles.kicker}>
            <span /> PRODUCT BUILDER · AI-ASSISTED DEVELOPMENT · DESIGN
          </p>
          <h1>
            Construyo productos digitales donde <em>diseño, IA, cloud y 3D</em> se encuentran.
          </h1>
          <p className={styles.heroLead}>
            Soy Sergio Ibañez. Diseño sistemas, experiencias y herramientas digitales desde la idea hasta una implementación real, usando IA como acelerador dentro de un proceso de producto completo.
          </p>
          <div className={styles.heroActions}>
            <a href="#proyectos" className={styles.primaryButton}>
              Ver proyectos <ArrowUpRight size={17} />
            </a>
            <a
              href="https://github.com/sergioiba11/clouva"
              target="_blank"
              rel="noreferrer"
              className={styles.secondaryButton}
            >
              <Github size={17} /> Código real
            </a>
          </div>
        </div>

        <aside className={styles.heroPanel} aria-label="Perfil profesional">
          <div className={styles.statusLine}>
            <span className={styles.statusDot} />
            Disponible para oportunidades
          </div>
          <div className={styles.identityCard}>
            <span className={styles.identityEyebrow}>CURRENT BUILD</span>
            <strong>CLOUVA</strong>
            <p>Creative ecosystem for artists</p>
          </div>
          <div className={styles.heroMetrics}>
            <div>
              <strong>Full-stack</strong>
              <span>product thinking</span>
            </div>
            <div>
              <strong>AI-native</strong>
              <span>workflow</span>
            </div>
            <div>
              <strong>Cloud</strong>
              <span>architecture</span>
            </div>
            <div>
              <strong>3D</strong>
              <span>creator pipeline</span>
            </div>
          </div>
        </aside>
      </section>

      <section className={styles.marquee} aria-label="Áreas de trabajo">
        <span>PRODUCT DESIGN</span><i />
        <span>FRONTEND</span><i />
        <span>AI SYSTEMS</span><i />
        <span>CLOUD</span><i />
        <span>3D TOOLS</span><i />
        <span>AUTOMATION</span>
      </section>

      <section id="proyectos" className={styles.section}>
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.sectionIndex}>01 / WORK</span>
            <h2>Proyectos seleccionados</h2>
          </div>
          <p>
            Sistemas construidos dentro de CLOUVA. Cada módulo resuelve una parte distinta del producto y convive con una arquitectura compartida.
          </p>
        </div>

        <div className={styles.projectsGrid}>
          {projects.map((project) => {
            const Icon = project.icon;
            return (
              <article className={styles.projectCard} key={project.title}>
                <div className={`${styles.projectVisual} ${styles[project.visual]}`}>
                  <div className={styles.visualOrb} />
                  <Icon size={38} strokeWidth={1.25} />
                  <span>{project.number}</span>
                </div>
                <div className={styles.projectBody}>
                  <span className={styles.projectEyebrow}>{project.eyebrow}</span>
                  <h3>{project.title}</h3>
                  <p>{project.description}</p>
                  <div className={styles.projectResult}>{project.result}</div>
                  <div className={styles.tags}>
                    {project.tags.map((tag) => <span key={tag}>{tag}</span>)}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section id="stack" className={`${styles.section} ${styles.stackSection}`}>
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.sectionIndex}>02 / STACK</span>
            <h2>Tecnología que uso</h2>
          </div>
          <p>
            El stack surge de necesidades reales del producto: interfaz, datos, identidad, almacenamiento, servicios, IA y experiencias 3D.
          </p>
        </div>

        <div className={styles.stackGrid}>
          {stack.map((item) => {
            const Icon = item.icon;
            return (
              <div className={styles.stackCard} key={item.label}>
                <Icon size={20} />
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            );
          })}
        </div>

        <div className={styles.architecture}>
          <div className={styles.archHeader}>
            <span>PRODUCT ARCHITECTURE</span>
            <span>clouva.com.ar</span>
          </div>
          <div className={styles.archFlow}>
            <div><small>CLIENT</small><strong>Next.js / React</strong></div>
            <span>→</span>
            <div><small>APPLICATION</small><strong>API + Services</strong></div>
            <span>→</span>
            <div><small>DATA</small><strong>Supabase / Postgres</strong></div>
            <span>+</span>
            <div><small>INFRA</small><strong>Google Cloud</strong></div>
          </div>
        </div>
      </section>

      <section id="proceso" className={styles.section}>
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.sectionIndex}>03 / PROCESS</span>
            <h2>Cómo construyo con IA</h2>
          </div>
          <p>
            La IA acelera la ejecución. La dirección del producto, las decisiones, las pruebas y la integración del sistema forman parte del proceso de construcción.
          </p>
        </div>

        <div className={styles.workflowGrid}>
          {workflow.map(([number, title, description]) => (
            <article key={number} className={styles.workflowCard}>
              <span>{number}</span>
              <h3>{title}</h3>
              <p>{description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.aboutSection}>
        <div className={styles.aboutLabel}>ABOUT</div>
        <div className={styles.aboutCopy}>
          <h2>No me especializo en una sola pantalla. Construyo el sistema que la hace posible.</h2>
          <p>
            Trabajo cruzando producto, frontend, diseño, infraestructura, automatización y herramientas creativas. CLOUVA es el laboratorio donde esas capas se conectan en un producto real.
          </p>
        </div>
      </section>

      <section id="contacto" className={styles.contact}>
        <span className={styles.sectionIndex}>04 / CONTACT</span>
        <h2>¿Construimos algo?</h2>
        <p>Buenos Aires, Argentina · presencial / híbrido / remoto</p>
        <div className={styles.contactActions}>
          <a href="https://github.com/sergioiba11" target="_blank" rel="noreferrer">
            <Github size={18} /> GitHub <ArrowUpRight size={16} />
          </a>
          <Link href="/">
            <Sparkles size={18} /> Abrir CLOUVA <ArrowUpRight size={16} />
          </Link>
        </div>
      </section>

      <footer className={styles.footer}>
        <span>© 2026 Sergio Ibañez</span>
        <span>Built inside CLOUVA</span>
      </footer>
    </main>
  );
}
