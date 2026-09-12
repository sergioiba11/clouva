import { VISUAL_ASSETS } from "@/lib/visual-assets";

export type PortfolioLocale = "en" | "es";
export type PortfolioStatus = "LIVE" | "IN DEVELOPMENT" | "PLANNED";

export type PortfolioProject = {
  id: string;
  status: PortfolioStatus;
  route?: string;
  routeLabel?: string;
  tags: string[];
  media?: string;
  mediaAlt?: string;
  title: string;
  eyebrow: string;
  summary: string;
  result: string;
  bullets: string[];
  architecture?: string[];
};

export const PORTFOLIO_LINKS = {
  github: "https://github.com/sergioiba11",
  source: "https://github.com/sergioiba11/clouva",
  clouva: "https://clouva.com.ar",
  cv: null as string | null,
  linkedin: null as string | null,
  email: null as string | null,
};

export const PORTFOLIO_ASSETS = {
  hero: VISUAL_ASSETS["public-landing-hero-01"],
  player: VISUAL_ASSETS["player-public-profile-cover-01"],
  market: VISUAL_ASSETS["landing-card-store-01"],
  matrix: VISUAL_ASSETS["matrix-network-master-01"],
  homeMobile: VISUAL_ASSETS["home-mobile-hero-01"],
  rapafernalia: "/assets/rapafernalia/rapafernalia-logo-oficial-transparente.png",
  trebol: "/assets/clouva-ai/trebol-mascot.png",
};

export const stackGroups = [
  { key: "frontend", items: ["Next.js 15", "React 19", "TypeScript", "CSS Modules", "Tailwind CSS"] },
  { key: "backend", items: ["Next.js APIs", "Supabase", "PostgreSQL", "Supabase Auth"] },
  { key: "cloud", items: ["Google Cloud", "Cloud Run", "Google Cloud Storage", "Cloudflare"] },
  { key: "ai", items: ["Gemini", "AI tool integration", "Multimodal workflows", "Action confirmations"] },
  { key: "threeD", items: ["Blender", "GLB", "Three.js", "React Three Fiber", "Unreal pipeline"] },
  { key: "integrations", items: ["OAuth", "YouTube", "Spotify", "Mercado Pago", "External APIs"] },
  { key: "tools", items: ["GitHub", "Git", "AI-assisted development", "Product prototyping"] },
] as const;

export const systemDomains = [
  { id: "identity", nodes: ["Player", "Public identity", "Music integrations"] },
  { id: "money", nodes: ["Mi Flow", "Ledger", "Mercado Pago boundary"] },
  { id: "creation", nodes: ["CLOUVA AI", "Creator Studio", "3D pipeline"] },
  { id: "commerce", nodes: ["Market", "Mi Spot", "Creator Commerce"] },
  { id: "infra", nodes: ["Supabase", "Google Cloud", "GitHub"] },
] as const;

const commonProjects = {
  clouva: {
    id: "clouva",
    status: "LIVE" as PortfolioStatus,
    route: "/",
    tags: ["Next.js", "React", "TypeScript", "Supabase", "Google Cloud"],
    media: PORTFOLIO_ASSETS.hero,
  },
  home: {
    id: "home",
    status: "LIVE" as PortfolioStatus,
    route: "/",
    tags: ["Responsive UI", "Shared navigation", "Product shell"],
    media: PORTFOLIO_ASSETS.homeMobile,
  },
  player: {
    id: "player",
    status: "LIVE" as PortfolioStatus,
    route: "/players",
    tags: ["Identity", "OAuth", "YouTube", "Spotify", "Responsive UI"],
    media: PORTFOLIO_ASSETS.player,
  },
  flow: {
    id: "flow",
    status: "IN DEVELOPMENT" as PortfolioStatus,
    route: "/mi-flow",
    tags: ["Ledger", "Backing", "Supabase", "PostgreSQL", "Mercado Pago"],
    architecture: ["BACKING", "EMISSION", "LEDGER", "AVAILABLE FLOW"],
  },
  creator: {
    id: "creator",
    status: "IN DEVELOPMENT" as PortfolioStatus,
    route: "/crear",
    tags: ["GLB", "Blender", "Landmarks", "Fitting", "Unreal pipeline"],
    architecture: ["GARMENT", "ANALYSIS", "VALIDATION", "FIT", "RIG", "EXPORT", "UNREAL"],
  },
  assets: {
    id: "assets",
    status: "LIVE" as PortfolioStatus,
    tags: ["GCS", "Supabase", "public/", "Admin UX", "Asset management"],
  },
  ai: {
    id: "ai",
    status: "IN DEVELOPMENT" as PortfolioStatus,
    tags: ["Gemini", "Tool calling", "Multimodal", "Context", "Confirmations"],
    media: PORTFOLIO_ASSETS.trebol,
  },
  commerce: {
    id: "commerce",
    status: "IN DEVELOPMENT" as PortfolioStatus,
    route: "/market",
    tags: ["Market", "Products", "Services", "Merch", "Creator Commerce"],
    media: PORTFOLIO_ASSETS.market,
  },
  brand: {
    id: "brand",
    status: "LIVE" as PortfolioStatus,
    tags: ["CLOUVA", "Iglú Records", "223 Social Club", "Rapafernalia", "Gama Kedak"],
    media: PORTFOLIO_ASSETS.rapafernalia,
  },
};

export const portfolioCopy = {
  en: {
    nav: { work: "Work", stack: "Stack", system: "System", process: "Process", journey: "Journey", contact: "Contact" },
    language: "Language",
    availability: "Available for opportunities",
    location: "Based in Buenos Aires, Argentina",
    hero: {
      role: "AI-Native Product Builder",
      subroles: ["Product Design", "Frontend", "Creative Technology", "AI Systems"],
      title: "I build digital products with AI, design and code.",
      lead: "I design, connect and evolve digital products end to end, using AI as part of the build workflow while keeping product direction, functional decisions, validation and execution grounded in the real system.",
      projects: "View projects",
      clouva: "View CLOUVA",
      github: "GitHub",
      contact: "Contact",
      cv: "Download CV",
    },
    caseStudy: {
      index: "01 / FLAGSHIP CASE STUDY",
      title: "CLOUVA — Creative Operating System",
      description: "A creative platform connecting digital identity, music, AI, creative tools, marketplace, internal economy, 3D, businesses and digital worlds inside one ecosystem.",
      rolesLabel: "ROLE",
      roles: ["Product Builder", "AI-assisted Developer", "Product Designer", "Creative Director"],
      stackLabel: "REAL STACK",
      architectureLabel: "SYSTEM ARCHITECTURE",
      architecture: ["User", "Next.js / React", "CLOUVA APIs", "Supabase / PostgreSQL", "Google Cloud Storage", "External Services", "AI / Payments / OAuth / 3D Workers"],
    },
    work: {
      index: "02 / PROJECT EXPLORER",
      title: "One product. Multiple connected systems.",
      intro: "Each module solves a different product problem while sharing identity, data, infrastructure and product rules.",
      open: "Open live surface",
      authenticated: "Authenticated surface",
      evidence: "Real CLOUVA visual asset",
      details: "System details",
      projects: [
        { ...commonProjects.clouva, eyebrow: "PRODUCT · PLATFORM", title: "CLOUVA", summary: "The core ecosystem where identity, creation, commerce, money, AI and 3D connect.", result: "A living product with shared architecture instead of isolated demos.", bullets: ["Public and authenticated experiences", "Shared product navigation", "Cloud-backed modular architecture"], mediaAlt: "Canonical CLOUVA visual system asset" },
        { ...commonProjects.home, eyebrow: "PRODUCT SHELL · RESPONSIVE", title: "CLOUVA Home", summary: "Desktop and mobile entry point connecting Player, Mi Flow, Create, Mi Spot and Market through a modular dashboard.", result: "A single product home that adapts to context and screen size.", bullets: ["Desktop/mobile split", "Reusable navigation", "Integrated music and AI entry points"], mediaAlt: "Canonical CLOUVA mobile home asset" },
        { ...commonProjects.player, eyebrow: "IDENTITY · MUSIC", title: "Player", summary: "Public artist identity with profile, visual presence, music and external integrations.", result: "Identity works as a product surface, not just an account page.", bullets: ["Public profile architecture", "YouTube read integration", "Spotify-connected product experience"], mediaAlt: "Canonical CLOUVA Player cover asset" },
        { ...commonProjects.flow, eyebrow: "MONEY · SYSTEM DESIGN", title: "Mi Flow", summary: "Internal value system built around an explicit backing → emission → ledger → available FLOW architecture. 1 FLOW uses USD 1 as a reference value.", result: "Internal value remains structurally separated from real-money payment rails.", bullets: ["No negative balance model", "Mercado Pago remains the real payment layer", "Ledger is the source of movement history"] },
        { ...commonProjects.creator, eyebrow: "3D · CREATOR TOOLS", title: "Creator Studio", summary: "3D pipeline for avatars, garments and accessories using GLB assets, body landmarks, measurements, fitting and Blender processing.", result: "A canonical pipeline aimed at reliable garment preparation for Unreal.", bullets: ["Garment analysis and validation", "Fit and rig preparation", "Unreal / Chaos Cloth path is still evolving"] },
        { ...commonProjects.assets, eyebrow: "INTERNAL TOOLS · CLOUD", title: "Asset Explorer", summary: "Admin tooling for managing assets across Google Cloud Storage, Supabase and public/ without replacing the existing asset system.", result: "Compact administration for large asset libraries with multi-select and usage protections.", bullets: ["Multiple canonical sources preserved", "Bulk selection", "Protection for assets used by product code"] },
        { ...commonProjects.ai, eyebrow: "AI · PRODUCT SYSTEM", title: "CLOUVA AI", summary: "AI layer designed around context, tools, confirmations and multimodal workflows instead of an isolated chatbot.", result: "AI is treated as product infrastructure and a control surface for the ecosystem.", bullets: ["Gemini integration", "Tool execution with confirmation boundaries", "Trébol voice layer remains under active development"], mediaAlt: "Official Trébol mascot asset used by CLOUVA AI" },
        { ...commonProjects.commerce, eyebrow: "COMMERCE · CREATOR ECONOMY", title: "Market / Commerce", summary: "Products, services, merch, stores and creator commerce connected to the same identity and business model.", result: "Commerce is designed as a native system rather than a separate storefront.", bullets: ["Physical and digital product concepts", "Studio and creator commerce", "Merch creation flows are evolving"], mediaAlt: "Canonical CLOUVA store visual asset" },
        { ...commonProjects.brand, eyebrow: "BRAND · VISUAL SYSTEM", title: "Brand / Visual System", summary: "Visual identities and assets managed across CLOUVA and connected creative brands.", result: "Brand work becomes reusable product material instead of isolated files.", bullets: ["CLOUVA", "Iglú Records / 223 Social Club / Gama Kedak", "Rapafernalia official asset present in the repo"], mediaAlt: "Official Rapafernalia logo asset from the CLOUVA repository" },
      ] satisfies PortfolioProject[],
    },
    gallery: {
      index: "03 / REAL EVIDENCE",
      title: "Real assets, not invented mockups.",
      intro: "The repository does not currently contain a canonical screenshot library, so this portfolio uses registered CLOUVA visual assets and direct live-product links instead of fabricating UI screenshots.",
      items: [
        { title: "CLOUVA public visual system", src: PORTFOLIO_ASSETS.hero, alt: "CLOUVA public landing visual system asset" },
        { title: "Player identity visual", src: PORTFOLIO_ASSETS.player, alt: "CLOUVA Player canonical cover asset" },
        { title: "Market visual system", src: PORTFOLIO_ASSETS.market, alt: "CLOUVA Market canonical visual asset" },
      ],
      enlarge: "Open image",
      close: "Close image",
    },
    stack: {
      index: "04 / TECH STACK",
      title: "Technology chosen by product needs.",
      intro: "No skill percentages and no invented years. These are technologies that are present in the actual CLOUVA repository or architecture.",
      labels: { frontend: "Frontend", backend: "Backend / Data", cloud: "Cloud", ai: "AI", threeD: "3D", integrations: "Integrations", tools: "Tools" },
    },
    thinking: {
      index: "05 / PRODUCT THINKING",
      title: "Decisions behind the screens.",
      intro: "The portfolio is not only about surfaces. These are recurring system decisions inside CLOUVA.",
      items: [
        ["Modular architecture", "Build on the existing system and keep responsibilities separated."],
        ["Reusable components", "Shared navigation and product shells reduce duplicated behavior."],
        ["Identity / commerce / wallet separation", "Different domains can connect without becoming the same system."],
        ["Canonical sources of truth", "Prefer explicit authoritative data over reconstructed state."],
        ["Public vs authenticated surfaces", "Recruiter-facing and user-facing experiences have different access contracts."],
        ["AI confirmation boundaries", "Actions with consequences require explicit confirmation paths."],
        ["Responsive by design", "Mobile and desktop are treated as product contexts, not just widths."],
        ["Integration-first", "External services connect through defined boundaries rather than replacing core domains."],
      ],
    },
    system: {
      index: "06 / INTERACTIVE SYSTEM MAP",
      title: "How CLOUVA connects.",
      intro: "Select a domain to inspect the responsibilities it owns inside the ecosystem.",
      center: "CLOUVA",
      domainLabels: { identity: "Identity", money: "Money", creation: "Creation", commerce: "Commerce", infra: "Infrastructure" },
    },
    process: {
      index: "07 / HOW I BUILD WITH AI",
      title: "AI accelerates the build. It does not replace product direction.",
      intro: "I use AI for research, architecture, implementation, debugging, documentation, design and testing while keeping the product direction, functional decisions, validation and execution connected to the real system.",
      steps: [
        ["01", "IDEA", "Define the problem, desired behavior and product constraints."],
        ["02", "SYSTEM DESIGN", "Map data, states, dependencies, boundaries and canonical sources."],
        ["03", "AI-ASSISTED IMPLEMENTATION", "Use AI to accelerate code, design, research and implementation work."],
        ["04", "TEST", "Validate the actual behavior instead of trusting generated output."],
        ["05", "DEBUG", "Trace failures across UI, data, APIs and infrastructure."],
        ["06", "ITERATION", "Refine the implementation without replacing the architecture unnecessarily."],
        ["07", "DEPLOY", "Ship through the existing production pipeline and verify the deployed result."],
      ],
    },
    journey: {
      index: "08 / BUILD LOG",
      title: "A product built in connected stages.",
      stages: ["FOUNDATION", "IDENTITY", "PLAYER", "MI FLOW", "CREATOR STUDIO", "AI", "MARKET", "CLOUD", "3D", "CURRENT BUILD"],
    },
    source: {
      index: "09 / PUBLIC SOURCE",
      title: "The code is public.",
      body: "CLOUVA is available as a public GitHub repository. The portfolio links to the real source without exposing secrets or private environment configuration.",
      cta: "View source",
    },
    contact: {
      index: "10 / CONTACT",
      title: "Let's build something.",
      body: "Open to product, frontend, AI-assisted development, creative technology and digital product opportunities.",
      github: "GitHub",
      clouva: "Open CLOUVA",
      note: "Public email and LinkedIn are intentionally not exposed until explicitly configured.",
    },
    footer: "Built inside CLOUVA · Buenos Aires, Argentina",
  },
  es: {
    nav: { work: "Proyectos", stack: "Stack", system: "Sistema", process: "Proceso", journey: "Evolución", contact: "Contacto" },
    language: "Idioma",
    availability: "Disponible para oportunidades",
    location: "Buenos Aires, Argentina",
    hero: {
      role: "AI-Native Product Builder",
      subroles: ["Product Design", "Frontend", "Creative Technology", "AI Systems"],
      title: "Construyo productos digitales con IA, diseño y código.",
      lead: "Diseño, conecto y evoluciono productos digitales de extremo a extremo, usando IA como parte del flujo de construcción y manteniendo la dirección del producto, las decisiones funcionales, la validación y la ejecución conectadas al sistema real.",
      projects: "Ver proyectos",
      clouva: "Ver CLOUVA",
      github: "GitHub",
      contact: "Contacto",
      cv: "Descargar CV",
    },
    caseStudy: {
      index: "01 / CASO PRINCIPAL",
      title: "CLOUVA — Creative Operating System",
      description: "Una plataforma creativa que conecta identidad digital, música, IA, herramientas creativas, marketplace, economía interna, 3D, negocios y mundos digitales dentro de un mismo ecosistema.",
      rolesLabel: "ROL",
      roles: ["Product Builder", "AI-assisted Developer", "Product Designer", "Creative Director"],
      stackLabel: "STACK REAL",
      architectureLabel: "ARQUITECTURA DEL SISTEMA",
      architecture: ["Usuario", "Next.js / React", "APIs CLOUVA", "Supabase / PostgreSQL", "Google Cloud Storage", "Servicios externos", "IA / Pagos / OAuth / Workers 3D"],
    },
    work: {
      index: "02 / PROJECT EXPLORER",
      title: "Un producto. Múltiples sistemas conectados.",
      intro: "Cada módulo resuelve un problema distinto y comparte identidad, datos, infraestructura y reglas de producto.",
      open: "Abrir superficie real",
      authenticated: "Superficie autenticada",
      evidence: "Asset visual real de CLOUVA",
      details: "Detalles del sistema",
      projects: [
        { ...commonProjects.clouva, eyebrow: "PRODUCT · PLATFORM", title: "CLOUVA", summary: "El ecosistema central donde se conectan identidad, creación, commerce, dinero, IA y 3D.", result: "Un producto vivo con arquitectura compartida en lugar de demos aisladas.", bullets: ["Experiencias públicas y autenticadas", "Navegación compartida", "Arquitectura modular sobre cloud"], mediaAlt: "Asset canónico del sistema visual de CLOUVA" },
        { ...commonProjects.home, eyebrow: "PRODUCT SHELL · RESPONSIVE", title: "CLOUVA Home", summary: "Punto de entrada desktop y mobile que conecta Player, Mi Flow, Create, Mi Spot y Market mediante un dashboard modular.", result: "Un único Home de producto que se adapta al contexto y a la pantalla.", bullets: ["Separación desktop/mobile", "Navegación reutilizable", "Entradas integradas a música e IA"], mediaAlt: "Asset canónico del Home mobile de CLOUVA" },
        { ...commonProjects.player, eyebrow: "IDENTITY · MUSIC", title: "Player", summary: "Identidad pública para artistas con perfil, presencia visual, música e integraciones externas.", result: "La identidad funciona como una superficie de producto, no solo como una cuenta.", bullets: ["Arquitectura de perfil público", "Integración read-only con YouTube", "Experiencia conectada con Spotify"], mediaAlt: "Asset canónico de portada Player" },
        { ...commonProjects.flow, eyebrow: "MONEY · SYSTEM DESIGN", title: "Mi Flow", summary: "Sistema interno de valor construido sobre una arquitectura explícita backing → emisión → ledger → FLOW disponible. 1 FLOW usa USD 1 como referencia.", result: "El valor interno se mantiene separado estructuralmente de los rieles de pago de dinero real.", bullets: ["Modelo sin saldo negativo", "Mercado Pago permanece como capa de pagos reales", "Ledger como fuente de historial de movimientos"] },
        { ...commonProjects.creator, eyebrow: "3D · CREATOR TOOLS", title: "Creator Studio", summary: "Pipeline 3D para avatares, prendas y accesorios con assets GLB, landmarks corporales, medidas, fitting y procesamiento en Blender.", result: "Pipeline canónico orientado a preparar prendas de forma confiable para Unreal.", bullets: ["Análisis y validación de prendas", "Preparación de fit y rig", "Ruta Unreal / Chaos Cloth todavía en evolución"] },
        { ...commonProjects.assets, eyebrow: "INTERNAL TOOLS · CLOUD", title: "Asset Explorer", summary: "Herramienta admin para gestionar assets entre Google Cloud Storage, Supabase y public/ sin reemplazar el sistema existente.", result: "Administración compacta para bibliotecas grandes con selección múltiple y protecciones de uso.", bullets: ["Se preservan múltiples fuentes canónicas", "Selección masiva", "Protección de assets usados por el producto"] },
        { ...commonProjects.ai, eyebrow: "AI · PRODUCT SYSTEM", title: "CLOUVA AI", summary: "Capa de IA diseñada alrededor de contexto, tools, confirmaciones y flujos multimodales, no como chatbot aislado.", result: "La IA se trata como infraestructura de producto y superficie de control del ecosistema.", bullets: ["Integración Gemini", "Ejecución de tools con límites de confirmación", "La capa de voz Trébol continúa en desarrollo"], mediaAlt: "Asset oficial de la mascota Trébol usada por CLOUVA AI" },
        { ...commonProjects.commerce, eyebrow: "COMMERCE · CREATOR ECONOMY", title: "Market / Commerce", summary: "Productos, servicios, merch, tiendas y creator commerce conectados a la misma identidad y modelo de negocio.", result: "Commerce está diseñado como sistema nativo y no como tienda separada.", bullets: ["Conceptos de productos físicos y digitales", "Commerce para Studios y creators", "Los flujos de creación de merch siguen evolucionando"], mediaAlt: "Asset canónico visual de tienda CLOUVA" },
        { ...commonProjects.brand, eyebrow: "BRAND · VISUAL SYSTEM", title: "Brand / Visual System", summary: "Identidades visuales y assets administrados entre CLOUVA y marcas creativas conectadas.", result: "El trabajo de marca pasa a ser material reutilizable de producto en lugar de archivos aislados.", bullets: ["CLOUVA", "Iglú Records / 223 Social Club / Gama Kedak", "Asset oficial de Rapafernalia presente en el repo"], mediaAlt: "Logo oficial de Rapafernalia presente en el repositorio CLOUVA" },
      ] satisfies PortfolioProject[],
    },
    gallery: {
      index: "03 / EVIDENCIA REAL",
      title: "Assets reales, no mockups inventados.",
      intro: "El repositorio no tiene actualmente una biblioteca canónica de screenshots, así que el portfolio usa assets visuales registrados de CLOUVA y links directos al producto real en lugar de fabricar capturas de interfaz.",
      items: [
        { title: "Sistema visual público de CLOUVA", src: PORTFOLIO_ASSETS.hero, alt: "Asset visual del landing público de CLOUVA" },
        { title: "Visual de identidad Player", src: PORTFOLIO_ASSETS.player, alt: "Asset canónico de portada del Player CLOUVA" },
        { title: "Sistema visual Market", src: PORTFOLIO_ASSETS.market, alt: "Asset visual canónico del Market CLOUVA" },
      ],
      enlarge: "Abrir imagen",
      close: "Cerrar imagen",
    },
    stack: {
      index: "04 / TECH STACK",
      title: "Tecnología elegida por necesidades del producto.",
      intro: "Sin porcentajes falsos de skills y sin años inventados. Son tecnologías presentes en el repositorio o arquitectura real de CLOUVA.",
      labels: { frontend: "Frontend", backend: "Backend / Data", cloud: "Cloud", ai: "IA", threeD: "3D", integrations: "Integraciones", tools: "Herramientas" },
    },
    thinking: {
      index: "05 / PRODUCT THINKING",
      title: "Decisiones detrás de las pantallas.",
      intro: "El portfolio no muestra solo superficies. Estas son decisiones recurrentes del sistema CLOUVA.",
      items: [
        ["Arquitectura modular", "Construir sobre el sistema existente y separar responsabilidades."],
        ["Componentes reutilizables", "Navegación y shells compartidos reducen comportamientos duplicados."],
        ["Separación identidad / commerce / wallet", "Los dominios se conectan sin convertirse en el mismo sistema."],
        ["Fuentes canónicas", "Preferir datos autoritativos explícitos antes que reconstruir estado."],
        ["Superficies públicas y autenticadas", "Recruiters y usuarios tienen contratos de acceso distintos."],
        ["Confirmación antes de acciones de IA", "Las acciones con consecuencias requieren límites de confirmación explícitos."],
        ["Responsive desde producto", "Mobile y desktop se tratan como contextos, no solo como anchos."],
        ["Arquitectura orientada a integraciones", "Los servicios externos se conectan por límites definidos sin reemplazar dominios centrales."],
      ],
    },
    system: {
      index: "06 / MAPA INTERACTIVO",
      title: "Cómo se conecta CLOUVA.",
      intro: "Seleccioná un dominio para inspeccionar las responsabilidades que posee dentro del ecosistema.",
      center: "CLOUVA",
      domainLabels: { identity: "Identidad", money: "Dinero", creation: "Creación", commerce: "Commerce", infra: "Infraestructura" },
    },
    process: {
      index: "07 / HOW I BUILD WITH AI",
      title: "La IA acelera la construcción. No reemplaza la dirección del producto.",
      intro: "Uso IA para investigación, arquitectura, implementación, debugging, documentación, diseño y testing, mientras mantengo la dirección del producto, decisiones funcionales, validación y ejecución conectadas al sistema real.",
      steps: [
        ["01", "IDEA", "Defino el problema, el comportamiento esperado y las restricciones."],
        ["02", "SYSTEM DESIGN", "Mapeo datos, estados, dependencias, límites y fuentes canónicas."],
        ["03", "AI-ASSISTED IMPLEMENTATION", "Uso IA para acelerar código, diseño, investigación e implementación."],
        ["04", "TEST", "Valido el comportamiento real en lugar de confiar en la salida generada."],
        ["05", "DEBUG", "Rastreo fallas entre interfaz, datos, APIs e infraestructura."],
        ["06", "ITERATION", "Refino la implementación sin reemplazar innecesariamente la arquitectura."],
        ["07", "DEPLOY", "Publico mediante el pipeline existente y verifico el resultado desplegado."],
      ],
    },
    journey: {
      index: "08 / BUILD LOG",
      title: "Un producto construido en etapas conectadas.",
      stages: ["FOUNDATION", "IDENTITY", "PLAYER", "MI FLOW", "CREATOR STUDIO", "AI", "MARKET", "CLOUD", "3D", "CURRENT BUILD"],
    },
    source: {
      index: "09 / CÓDIGO PÚBLICO",
      title: "El código es público.",
      body: "CLOUVA está disponible como repositorio público en GitHub. El portfolio enlaza al código real sin exponer secrets ni configuración privada de entorno.",
      cta: "Ver código",
    },
    contact: {
      index: "10 / CONTACTO",
      title: "Construyamos algo.",
      body: "Disponible para oportunidades de producto, frontend, desarrollo asistido por IA, creative technology y productos digitales.",
      github: "GitHub",
      clouva: "Abrir CLOUVA",
      note: "Email público y LinkedIn no se exponen hasta que estén configurados explícitamente.",
    },
    footer: "Construido dentro de CLOUVA · Buenos Aires, Argentina",
  },
} as const;
