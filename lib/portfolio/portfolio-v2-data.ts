import type { PortfolioLocale, PortfolioStatus } from "@/lib/portfolio/portfolio-data";

export const PORTFOLIO_PROFILE_IMAGE = null as string | null;

export const PORTFOLIO_V2_COPY = {
  en: {
    groups: {
      primary: "Core product systems",
      secondary: "Supporting systems",
    },
    context: {
      problem: "PROBLEM",
      built: "WHAT I BUILT",
      system: "SYSTEM / STACK",
    },
    status: {
      title: "STATUS KEY",
      items: [
        ["LIVE", "Available or actively working"],
        ["IN DEVELOPMENT", "Currently being built / expanded"],
        ["PLANNED", "Defined in product roadmap"],
      ] as readonly (readonly [PortfolioStatus, string])[],
    },
    about: {
      index: "08 / ABOUT",
      eyebrow: "SERGIO IBAÑEZ",
      title: "The person behind the system.",
      role: "AI-Native Product Builder",
      location: "Buenos Aires, Argentina",
      body: "I design and build digital products by combining product thinking, interface design, AI-assisted development, cloud infrastructure and creative technology.",
      proof: "CLOUVA is the main working case: one evolving product where I define functionality, connect systems, validate implementations and iterate across product, design and technology.",
      roles: ["Product Builder", "Frontend", "Creative Technology", "AI Product", "Product Design", "Automation"],
    },
    opportunity: {
      eyebrow: "AVAILABLE FOR OPPORTUNITIES",
      title: "Frontend · Product · AI · Creative Technology",
      location: "Buenos Aires / Remote",
      modes: ["On-site", "Hybrid", "Remote"],
    },
    evidenceNote: "Repository evidence — not a fabricated UI screenshot",
    creatorEvidenceAlt: "Real Creator Studio body reference asset stored in the CLOUVA repository",
  },
  es: {
    groups: {
      primary: "Sistemas principales",
      secondary: "Sistemas de soporte",
    },
    context: {
      problem: "PROBLEMA",
      built: "QUÉ CONSTRUÍ",
      system: "SISTEMA / STACK",
    },
    status: {
      title: "ESTADOS",
      items: [
        ["LIVE", "Disponible o funcionando activamente"],
        ["IN DEVELOPMENT", "Actualmente en construcción / expansión"],
        ["PLANNED", "Definido en el roadmap de producto"],
      ] as readonly (readonly [PortfolioStatus, string])[],
    },
    about: {
      index: "08 / ABOUT",
      eyebrow: "SERGIO IBAÑEZ",
      title: "La persona detrás del sistema.",
      role: "AI-Native Product Builder",
      location: "Buenos Aires, Argentina",
      body: "Diseño y construyo productos digitales combinando pensamiento de producto, diseño de interfaces, desarrollo asistido por IA, infraestructura cloud y tecnología creativa.",
      proof: "CLOUVA es el caso de trabajo principal: un producto en evolución donde defino funcionalidades, conecto sistemas, valido implementaciones e itero entre producto, diseño y tecnología.",
      roles: ["Product Builder", "Frontend", "Creative Technology", "AI Product", "Product Design", "Automation"],
    },
    opportunity: {
      eyebrow: "DISPONIBLE PARA OPORTUNIDADES",
      title: "Frontend · Product · AI · Creative Technology",
      location: "Buenos Aires / Remoto",
      modes: ["Presencial", "Híbrido", "Remoto"],
    },
    evidenceNote: "Evidencia del repositorio — no es un screenshot de UI fabricado",
    creatorEvidenceAlt: "Asset real de referencia corporal de Creator Studio guardado en el repositorio CLOUVA",
  },
} as const satisfies Record<PortfolioLocale, unknown>;

export const PROJECT_V2_DETAILS = {
  clouva: {
    en: {
      problem: "Creative identity, tools, money, commerce and 3D usually live in separate products.",
      built: "A shared ecosystem where those domains connect through one product architecture.",
      system: "Next.js · React · TypeScript · Supabase · Google Cloud",
    },
    es: {
      problem: "Identidad creativa, herramientas, dinero, commerce y 3D suelen vivir en productos separados.",
      built: "Un ecosistema compartido donde esos dominios se conectan mediante una misma arquitectura.",
      system: "Next.js · React · TypeScript · Supabase · Google Cloud",
    },
  },
  home: {
    en: {
      problem: "The ecosystem needs one clear entry point without flattening every domain into the same interface.",
      built: "A responsive product shell connecting Player, Mi Flow, Create, Mi Spot and Market.",
      system: "React · shared navigation · responsive product states",
    },
    es: {
      problem: "El ecosistema necesita un punto de entrada claro sin convertir todos los dominios en la misma interfaz.",
      built: "Un shell responsive que conecta Player, Mi Flow, Create, Mi Spot y Market.",
      system: "React · navegación compartida · estados responsive de producto",
    },
  },
  player: {
    en: {
      problem: "Artist identity needs to be more than an account page or a static bio link.",
      built: "A public product surface with profile, visual presence, music and external integrations.",
      system: "Public routes · OAuth · YouTube read integration · Spotify-connected UX",
    },
    es: {
      problem: "La identidad artística necesita ser más que una cuenta o un link de bio estático.",
      built: "Una superficie pública de producto con perfil, presencia visual, música e integraciones.",
      system: "Rutas públicas · OAuth · YouTube read integration · experiencia conectada con Spotify",
    },
  },
  flow: {
    en: {
      problem: "Internal value cannot be mixed loosely with real-money payment state.",
      built: "A canonical backing → emission → ledger → available FLOW model with explicit boundaries.",
      system: "Supabase · PostgreSQL · ledger rules · Mercado Pago payment boundary",
    },
    es: {
      problem: "El valor interno no puede mezclarse libremente con el estado de pagos de dinero real.",
      built: "Un modelo canónico backing → emisión → ledger → FLOW disponible con límites explícitos.",
      system: "Supabase · PostgreSQL · reglas ledger · límite con Mercado Pago",
    },
  },
  creator: {
    en: {
      problem: "Garments and avatars need measurable, repeatable preparation before a real-time 3D pipeline.",
      built: "A garment analysis and fitting pipeline using GLB assets, landmarks, measurements and Blender processing.",
      system: "GLB · landmarks · measurements · fitting · Blender · Unreal pipeline",
    },
    es: {
      problem: "Las prendas y avatares necesitan preparación medible y repetible antes de un pipeline 3D en tiempo real.",
      built: "Un pipeline de análisis y fitting con GLB, landmarks, medidas y procesamiento en Blender.",
      system: "GLB · landmarks · medidas · fitting · Blender · pipeline Unreal",
    },
  },
  ai: {
    en: {
      problem: "AI inside a product needs context, tools and action boundaries—not only chat output.",
      built: "An AI control layer designed around context, tool execution, multimodal inputs and confirmations.",
      system: "Gemini · context · tool calling · multimodal workflows · confirmations",
    },
    es: {
      problem: "La IA dentro de un producto necesita contexto, tools y límites de acción, no solo respuestas de chat.",
      built: "Una capa de control de IA basada en contexto, ejecución de tools, entradas multimodales y confirmaciones.",
      system: "Gemini · contexto · tool calling · flujos multimodales · confirmaciones",
    },
  },
  assets: {
    en: {
      problem: "Large asset libraries become difficult to manage while canonical storage sources must remain intact.",
      built: "Internal tooling for managing product assets without replacing GCS, Supabase or public/.",
      system: "Google Cloud Storage · Supabase · public/ · admin tooling",
    },
    es: {
      problem: "Las bibliotecas grandes son difíciles de administrar cuando las fuentes canónicas deben mantenerse intactas.",
      built: "Herramienta interna para administrar assets sin reemplazar GCS, Supabase ni public/.",
      system: "Google Cloud Storage · Supabase · public/ · admin tooling",
    },
  },
  commerce: {
    en: {
      problem: "Products, services, merch and creator businesses should connect to identity instead of living as a separate storefront.",
      built: "A commerce layer connected to the same player, studio and product model.",
      system: "Market · products · services · merch · creator commerce",
    },
    es: {
      problem: "Productos, servicios, merch y negocios de creators deben conectarse con la identidad y no vivir como tienda separada.",
      built: "Una capa de commerce conectada al mismo modelo de players, studios y productos.",
      system: "Market · productos · servicios · merch · creator commerce",
    },
  },
  brand: {
    en: {
      problem: "Creative identities become hard to reuse when brand assets remain isolated files.",
      built: "A reusable visual asset layer for CLOUVA and connected creative brands.",
      system: "Canonical assets · product surfaces · reusable brand material",
    },
    es: {
      problem: "Las identidades creativas son difíciles de reutilizar cuando los assets quedan como archivos aislados.",
      built: "Una capa reutilizable de assets visuales para CLOUVA y marcas creativas conectadas.",
      system: "Assets canónicos · superficies de producto · material reutilizable de marca",
    },
  },
} as const;

export const PROJECT_PRIMARY_IDS = new Set(["clouva", "home", "player", "flow", "creator", "ai"]);

export const PROJECT_ARCHITECTURE_OVERRIDES: Partial<Record<string, readonly string[]>> = {
  creator: ["GARMENT", "ANALYSIS", "VALIDATION", "FIT", "RIG", "EXPORT", "UNREAL"],
  ai: ["USER INTENT", "CLOUVA AI", "CONTEXT", "TOOLS", "CONFIRMATION", "ACTION"],
  assets: ["GCS", "SUPABASE", "PUBLIC/", "MULTI-SELECT", "USAGE GUARDS"],
};

export const PROJECT_MEDIA_OVERRIDES: Partial<Record<string, { src: string; mode: "cover" | "contain"; altKey?: "creatorEvidenceAlt" }>> = {
  creator: { src: "/reference/male-front.png", mode: "contain", altKey: "creatorEvidenceAlt" },
  ai: { src: "/assets/clouva-ai/trebol-mascot.png", mode: "contain" },
  brand: { src: "/assets/rapafernalia/rapafernalia-logo-oficial-transparente.png", mode: "contain" },
};
