import type { TrebolRuntimeContext } from "./agent/types";

export type ClouvaPageElement = {
  id: string;
  label: string;
  purpose?: string;
  action?: string;
  kind?: string;
  metadata?: Record<string, unknown>;
};

export type ClouvaPageContext = {
  section: string;
  title: string;
  description: string;
  entity?: {
    type: string;
    id?: string;
    label?: string;
  };
  elements: ClouvaPageElement[];
  actions: string[];
  concepts: string[];
  state?: Record<string, unknown>;
};

export type ClouvaViewerContext = {
  role?: string;
  onboardingStatus?: string;
  experience: "new" | "onboarding" | "existing" | "advanced";
  displayName?: string;
  player?: {
    id: string;
    slug: string;
    displayName: string;
  };
  connectedServices: string[];
};

export type ClouvaPageContextRegistration = Partial<Omit<ClouvaPageContext, "elements" | "actions" | "concepts">> & {
  id: string;
  elements?: ClouvaPageElement[];
  actions?: string[];
  concepts?: string[];
};

type RouteDefinition = {
  match: (pathname: string) => boolean;
  context: ClouvaPageContext;
};

const HOME_CONTEXT: ClouvaPageContext = {
  section: "Inicio",
  title: "Inicio",
  description: "Es la entrada personal a CLOUVA: identidad, Avatar, Mundos, Mi Flow, Mi Spot, creación y accesos principales.",
  elements: [
    { id: "avatar", label: "Entrar a mi Avatar", purpose: "Abrir y trabajar la identidad 3D activa del Player.", action: "Abrir el Avatar activo" },
    { id: "worlds", label: "Explorar Mundos", purpose: "Entrar a experiencias y universos conectados con la identidad CLOUVA.", action: "Explorar Mundos" },
    { id: "mi-flow", label: "Mi Flow", purpose: "Acceder a la economía y los FLOWS del usuario dentro de CLOUVA.", action: "Abrir Mi Flow" },
    { id: "mi-spot", label: "Mi Spot", purpose: "Entrar a los espacios, negocios, estudios, clubes o marcas vinculados al Player.", action: "Abrir Mi Spot" },
    { id: "vip", label: "CLOUVA VIP", purpose: "Acceder a funciones y capacidades VIP de CLOUVA.", action: "Ver funciones VIP" },
  ],
  actions: ["Entrar al Avatar", "Explorar Mundos", "Abrir Mi Flow", "Entrar a Mi Spot", "Crear dentro de CLOUVA"],
  concepts: ["Player", "Avatar", "Mundos", "FLOWS", "Mi Spot", "CLOUVA VIP"],
};

const PLAYER_CONTEXT: ClouvaPageContext = {
  section: "Player",
  title: "Player",
  description: "Es la identidad pública dentro de CLOUVA: perfil, música, conocimiento, proyectos, conexiones, contenido y presencia del Player.",
  elements: [],
  actions: ["Ver identidad", "Explorar contenido", "Conectar con el Player"],
  concepts: ["Player", "identidad pública", "música", "conocimiento", "proyectos", "conexiones"],
};

const ROUTES: RouteDefinition[] = [
  { match: (pathname) => pathname === "/", context: HOME_CONTEXT },
  {
    match: (pathname) => pathname === "/mi-flow" || pathname.startsWith("/mi-flow/"),
    context: {
      section: "Mi Flow",
      title: "Mi Flow",
      description: "Es la capa económica personal de CLOUVA: FLOWS, movimientos, ingresos, billetera y herramientas conectadas con la economía del Player.",
      elements: [],
      actions: ["Ver FLOWS", "Revisar movimientos", "Usar herramientas de Mi Flow"],
      concepts: ["FLOWS", "billetera", "movimientos", "ingresos"],
    },
  },
  {
    match: (pathname) => pathname === "/crear" || pathname.startsWith("/crear/") || pathname === "/creator-studio" || pathname.startsWith("/creator-studio/"),
    context: {
      section: "Crear",
      title: "Crear",
      description: "Es la puerta creativa de CLOUVA: imagen, video, CLOUVA AI, Creator Studio 3D, Avatar, ropa, accesorios y herramientas creativas.",
      elements: [],
      actions: ["Crear contenido visual", "Abrir Creator Studio 3D", "Trabajar el Avatar", "Crear ropa o accesorios"],
      concepts: ["Creator", "Creator Studio", "Avatar", "assets 3D", "media"],
    },
  },
  {
    match: (pathname) => pathname === "/mi-spot" || pathname.startsWith("/mi-spot/"),
    context: {
      section: "Mi Spot",
      title: "Mi Spot",
      description: "Es el centro de espacios del Player: Estudios, Negocios, Spots, Clubes y Marcas con sus módulos de identidad, operación, productos y herramientas.",
      elements: [],
      actions: ["Abrir un espacio", "Crear un espacio", "Administrar módulos y operación"],
      concepts: ["Spot", "Estudio", "Negocio", "Club", "Marca", "módulos"],
    },
  },
  {
    match: (pathname) => pathname === "/market" || pathname.startsWith("/market/") || pathname === "/catalogo" || pathname.startsWith("/catalogo/"),
    context: {
      section: "Market",
      title: "Market",
      description: "Es la capa de descubrimiento y comercio de CLOUVA para productos, servicios, merch y objetos vinculados a Players y Spots.",
      elements: [],
      actions: ["Explorar productos", "Abrir un producto", "Ir al Player o Spot relacionado"],
      concepts: ["Market", "productos", "servicios", "merch", "Player", "Spot"],
    },
  },
  {
    match: (pathname) => pathname === "/agenda" || pathname.startsWith("/agenda/"),
    context: {
      section: "Agenda",
      title: "Agenda",
      description: "Es la agenda conectada de CLOUVA para disponibilidad, encuentros, sesiones, proyectos y eventos entre Players y espacios.",
      elements: [],
      actions: ["Ver agenda", "Coordinar disponibilidad", "Gestionar conexiones"],
      concepts: ["Agenda", "disponibilidad", "eventos", "Players", "Studios"],
    },
  },
  {
    match: (pathname) => pathname === "/player" || pathname.startsWith("/player/") || pathname.startsWith("/players/"),
    context: PLAYER_CONTEXT,
  },
  {
    match: (pathname) => pathname.startsWith("/studio-dashboard/") || pathname.startsWith("/studios/"),
    context: {
      section: "Studio",
      title: "Studio",
      description: "Es un espacio de CLOUVA conectado con Players, identidad, miembros, proyectos, agenda, servicios y herramientas operativas.",
      elements: [],
      actions: ["Ver identidad del Studio", "Trabajar con Players", "Gestionar herramientas del Studio"],
      concepts: ["Studio", "Players", "miembros", "proyectos", "servicios"],
    },
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanText(value: unknown, limit = 240): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/\s+/g, " ").trim();
  return text ? text.slice(0, limit) : undefined;
}

function fallbackTitle(pathname: string): string {
  const segment = pathname.split("/").filter(Boolean).at(-1);
  if (!segment) return "Inicio";
  return segment
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function mergeElements(...groups: Array<ClouvaPageElement[] | undefined>): ClouvaPageElement[] {
  const merged = new Map<string, ClouvaPageElement>();
  for (const group of groups) {
    for (const item of group ?? []) {
      const label = cleanText(item.label, 140);
      if (!label) continue;
      const id = cleanText(item.id, 120) || label.toLowerCase().replace(/[^a-z0-9áéíóúüñ]+/gi, "-").slice(0, 100);
      const key = `${id}:${label.toLowerCase()}`;
      merged.set(key, {
        id,
        label,
        purpose: cleanText(item.purpose, 300),
        action: cleanText(item.action, 240),
        kind: cleanText(item.kind, 80),
        metadata: isRecord(item.metadata) ? item.metadata : undefined,
      });
      if (merged.size >= 20) break;
    }
    if (merged.size >= 20) break;
  }
  return Array.from(merged.values());
}

function registeredContext(value: unknown): Partial<ClouvaPageContext> {
  if (!isRecord(value)) return {};
  const merged: Partial<ClouvaPageContext> = {};
  const elementGroups: ClouvaPageElement[][] = [];
  const actions: string[] = [];
  const concepts: string[] = [];

  for (const entry of Object.values(value)) {
    if (!isRecord(entry)) continue;
    merged.section = cleanText(entry.section, 120) ?? merged.section;
    merged.title = cleanText(entry.title, 160) ?? merged.title;
    merged.description = cleanText(entry.description, 600) ?? merged.description;
    if (isRecord(entry.entity)) {
      const type = cleanText(entry.entity.type, 80);
      if (type) {
        merged.entity = {
          type,
          id: cleanText(entry.entity.id, 160),
          label: cleanText(entry.entity.label, 180),
        };
      }
    }
    if (Array.isArray(entry.elements)) elementGroups.push(entry.elements as ClouvaPageElement[]);
    if (Array.isArray(entry.actions)) actions.push(...entry.actions.map((item) => cleanText(item, 180)).filter((item): item is string => Boolean(item)));
    if (Array.isArray(entry.concepts)) concepts.push(...entry.concepts.map((item) => cleanText(item, 120)).filter((item): item is string => Boolean(item)));
    if (isRecord(entry.state)) merged.state = { ...(merged.state ?? {}), ...entry.state };
  }

  merged.elements = mergeElements(...elementGroups);
  merged.actions = Array.from(new Set(actions)).slice(0, 20);
  merged.concepts = Array.from(new Set(concepts)).slice(0, 20);
  return merged;
}

export function resolveClouvaPageContext(args: {
  pathname: string;
  playerSlug?: string | null;
  registered?: Record<string, unknown>;
  visibleElements?: ClouvaPageElement[];
}): ClouvaPageContext {
  const pathname = args.pathname || "/";
  const routeContext = args.playerSlug && pathname === `/${args.playerSlug}`
    ? PLAYER_CONTEXT
    : ROUTES.find((route) => route.match(pathname))?.context;
  const base: ClouvaPageContext = routeContext ?? {
    section: fallbackTitle(pathname),
    title: fallbackTitle(pathname),
    description: "Es la pantalla actual de CLOUVA. Trébol usa los elementos visibles y el contexto registrado por esta sección para explicarla sin inventar funciones.",
    elements: [],
    actions: [],
    concepts: [],
  };
  const registered = registeredContext(args.registered);

  return {
    section: registered.section ?? base.section,
    title: registered.title ?? base.title,
    description: registered.description ?? base.description,
    entity: registered.entity ?? base.entity,
    elements: mergeElements(base.elements, registered.elements, args.visibleElements),
    actions: Array.from(new Set([...(registered.actions ?? []), ...base.actions])).slice(0, 20),
    concepts: Array.from(new Set([...(registered.concepts ?? []), ...base.concepts])).slice(0, 20),
    state: registered.state ?? base.state,
  };
}

function visible(element: HTMLElement): boolean {
  if (element.hidden || element.getAttribute("aria-hidden") === "true") return false;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  if (typeof window !== "undefined") {
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
  }
  return true;
}

export function collectVisibleTrebolElements(root?: Document | HTMLElement): ClouvaPageElement[] {
  if (typeof document === "undefined" || typeof HTMLElement === "undefined") return [];
  const source = root ?? document;
  const nodes = Array.from(source.querySelectorAll<HTMLElement>("[data-trebol-id], a[href], button, [role='button']"));
  const result: ClouvaPageElement[] = [];
  const seen = new Set<string>();

  for (const element of nodes) {
    if (element.closest("[data-trebol-ui]") || !visible(element)) continue;
    const label = cleanText(
      element.dataset.trebolLabel
        ?? element.getAttribute("aria-label")
        ?? element.innerText,
      140,
    );
    if (!label) continue;
    const href = element instanceof HTMLAnchorElement ? element.getAttribute("href") ?? undefined : undefined;
    const id = cleanText(element.dataset.trebolId, 120)
      ?? cleanText(element.id, 120)
      ?? `${element.tagName.toLowerCase()}-${href ?? label}`.toLowerCase().replace(/[^a-z0-9áéíóúüñ]+/gi, "-").slice(0, 120);
    const key = `${id}:${label.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      id,
      label,
      purpose: cleanText(element.dataset.trebolPurpose, 300),
      action: cleanText(element.dataset.trebolAction, 240)
        ?? (href ? `Navegar a ${href}` : `Activar ${label}`),
      kind: element.tagName.toLowerCase(),
      metadata: href ? { href } : undefined,
    });
    if (result.length >= 18) break;
  }

  return result;
}

export function trebolContextualGreeting(
  page: ClouvaPageContext,
  viewer: ClouvaViewerContext,
): string {
  const player = viewer.player?.displayName;
  const activePlayer = player ? ` Tenés activo el Player ${player}.` : "";
  const keyActions = page.elements.slice(0, 4).map((item) => item.label);
  const actions = keyActions.length ? ` Desde acá podés usar ${keyActions.join(", ")}.` : "";

  if (viewer.experience === "new" || viewer.experience === "onboarding") {
    return `Bienvenido a CLOUVA. Estás en ${page.title}. ${page.description}${activePlayer}${actions} Podés preguntarme cómo usar esta pantalla o señalar cualquier elemento y te explico qué hace.`;
  }

  return `Estás en ${page.title}.${activePlayer} ${page.description} Podés preguntarme qué podés hacer acá o señalar cualquier elemento de la pantalla.`;
}

export function pageContextFromRuntime(context: TrebolRuntimeContext): ClouvaPageContext | null {
  const pageScope = context.scopes.page;
  const runtime = isRecord(pageScope) && isRecord(pageScope.runtime) ? pageScope.runtime : null;
  if (!runtime) return null;
  const section = cleanText(runtime.section, 120);
  const title = cleanText(runtime.title, 160);
  const description = cleanText(runtime.description, 600);
  if (!section || !title || !description) return null;
  return {
    section,
    title,
    description,
    entity: isRecord(runtime.entity) && cleanText(runtime.entity.type, 80)
      ? {
          type: cleanText(runtime.entity.type, 80) as string,
          id: cleanText(runtime.entity.id, 160),
          label: cleanText(runtime.entity.label, 180),
        }
      : undefined,
    elements: Array.isArray(runtime.elements) ? runtime.elements as ClouvaPageElement[] : [],
    actions: Array.isArray(runtime.actions) ? runtime.actions.filter((item): item is string => typeof item === "string") : [],
    concepts: Array.isArray(runtime.concepts) ? runtime.concepts.filter((item): item is string => typeof item === "string") : [],
    state: isRecord(runtime.state) ? runtime.state : undefined,
  };
}
