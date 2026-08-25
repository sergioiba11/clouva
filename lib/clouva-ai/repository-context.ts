// Repository-context gathering for CLOUVA AI's GitHub-aware mode — moved out
// of app/api/clouva-ai/agent/route.ts so the canonical Orchestrator
// (app/api/clouva-ai/chat/route.ts) can reuse the exact same logic instead
// of a second copy. agent/route.ts imports this too; nothing here changed
// behavior, just where it lives.

import { getRepositoryStatus, listRepositoryFiles, readRepositoryFile } from "@/lib/clouva-ai/github";

export type RepositoryFile = { path: string; content: string };
export type RepositoryContext = {
  scope: "status" | "explicit" | "broad";
  status: unknown;
  tree: string[];
  files: RepositoryFile[];
  coverageAreas: string[];
};

const BROAD_REVIEW_GROUPS: Array<{ area: string; patterns: RegExp[] }> = [
  {
    area: "visión y documentación",
    patterns: [/^docs\/CLOUVA_VISION\.md$/, /^docs\/CLOUVA_PROJECT_AUDIT\.md$/, /^README\.md$/],
  },
  {
    area: "configuración y deploy",
    patterns: [/^package\.json$/, /^next\.config\./, /^\.env\.example$/, /^scripts\/prepare-clouva-model\.mjs$/],
  },
  {
    area: "identidad y permisos",
    patterns: [/^components\/auth-provider\.tsx$/, /^lib\/auth\.ts$/, /supabase\/migrations\/.*role/i],
  },
  {
    area: "home e identidad inmersiva",
    patterns: [/^components\/clouva\/AvatarScene\.tsx$/, /^components\/clouva\/MinimalNavigation\.tsx$/, /^app\/layout\.tsx$/],
  },
  {
    area: "perfil y comunidad",
    patterns: [/^app\/u\/\[username\]\/page\.tsx$/, /^app\/mi-flow\/page\.tsx$/, /follow/i],
  },
  {
    area: "avatar e inventario 3D",
    patterns: [/^components\/avatar-engine\/AvatarModelViewer\.tsx$/, /^components\/avatar-engine\/OutfitPreview\.tsx$/, /^lib\/avatar-engine\//],
  },
  {
    area: "Creator Studio",
    patterns: [
      /^components\/creator-studio\/CreatorStudio\.tsx$/,
      /^components\/creator-studio\/SmartTryOnViewer\.tsx$/,
      /^components\/creator-studio\/CreatorStudioV2Panel\.tsx$/,
    ],
  },
  {
    area: "pipeline Blender",
    patterns: [/^app\/api\/creator-studio\/blender\/route\.ts$/, /^worker\/garment-rig\/app\.py$/, /^worker\/garment-rig\/rig_garment\.py$/],
  },
  {
    area: "tienda y economía",
    patterns: [/^app\/tienda\//, /^app\/catalogo\//, /^lib\/store-/, /editable_store\.sql$/],
  },
  { area: "música", patterns: [/spotify/i, /music/i] },
  {
    area: "Trébol y Gemini",
    patterns: [/^app\/api\/gemini\/route\.ts$/, /^app\/api\/clouva-ai\/agent\/route\.ts$/, /^app\/api\/clouva-ai\/chat\/route\.ts$/],
  },
];

function explicitPaths(message: string) {
  const matches = message.match(
    /(?:app|components|lib|pages|src|public|supabase|scripts|worker|workers|types|hooks|config|docs)\/[A-Za-z0-9_./@\[\]-]+\.[A-Za-z0-9]+|package\.json|README\.md|Dockerfile|\.env\.example/g,
  );
  return Array.from(new Set(matches ?? [])).slice(0, 8);
}

function wantsBroadReview(message: string) {
  return /(todo el proyecto|proyecto completo|revis[áa] el proyecto|analiz[áa] el proyecto|c[oó]mo avanzar|arquitectura|auditor[ií]a|estado general|visi[oó]n|roadmap|prioridades|investigaci[oó]n)/i.test(
    message,
  );
}

function isReadableSource(path: string, size: number) {
  return (
    size <= 150_000 &&
    /\.(ts|tsx|js|jsx|mjs|json|md|sql|py)$/i.test(path) &&
    !/(node_modules|\.next|package-lock\.json|public\/.*\.(glb|gltf|png|jpg|jpeg|webp|mp3|wav))/i.test(path)
  );
}

function chooseBroadReviewPaths(files: Array<{ path: string; size: number }>) {
  const available = files.filter(({ path, size }) => isReadableSource(path, size));
  const selected: string[] = [];
  const coverageAreas: string[] = [];

  for (const group of BROAD_REVIEW_GROUPS) {
    const match = group.patterns.map((pattern) => available.find((file) => pattern.test(file.path))).find(Boolean);
    if (match && !selected.includes(match.path)) {
      selected.push(match.path);
      coverageAreas.push(group.area);
    }
  }

  const required = ["docs/CLOUVA_VISION.md", "docs/CLOUVA_PROJECT_AUDIT.md", "package.json", "README.md"];
  for (const path of required) {
    if (available.some((file) => file.path === path) && !selected.includes(path)) {
      selected.unshift(path);
    }
  }

  return { paths: selected.slice(0, 14), coverageAreas };
}

async function readFiles(paths: string[], limit: number) {
  return Promise.all(
    paths.map(async (path): Promise<RepositoryFile> => {
      try {
        const file = await readRepositoryFile(path);
        return { path: file.path, content: file.content.slice(0, limit) };
      } catch (error) {
        return { path, content: `[No se pudo leer: ${error instanceof Error ? error.message : "error desconocido"}]` };
      }
    }),
  );
}

export async function buildRepositoryContext(message: string): Promise<RepositoryContext> {
  const status = await getRepositoryStatus();
  const paths = explicitPaths(message);

  if (paths.length) {
    return {
      scope: "explicit",
      status,
      tree: paths,
      files: await readFiles(paths, 30_000),
      coverageAreas: ["archivos solicitados explícitamente"],
    };
  }

  if (!wantsBroadReview(message)) {
    return { scope: "status", status, tree: [], files: [], coverageAreas: ["estado del repositorio"] };
  }

  const listing = await listRepositoryFiles();
  const selection = chooseBroadReviewPaths(listing.files);

  return {
    scope: "broad",
    status,
    tree: listing.files.map((item) => item.path).slice(0, 600),
    files: await readFiles(selection.paths, 14_000),
    coverageAreas: selection.coverageAreas,
  };
}

export function deterministicRepositoryFallback(context: RepositoryContext) {
  const reviewed = context.files.map((file) => `- ${file.path}`).join("\n");
  return `La lectura real de GitHub terminó, pero Gemini no produjo el informe.\n\nAlcance real: ${context.scope}.\nÁreas cubiertas: ${context.coverageAreas.join(", ") || "sin áreas adicionales"}.\n\nArchivos leídos:\n${reviewed || "- Ningún archivo; solamente estado del repositorio."}\n\nReintentá con una pregunta más acotada o pedí continuar por un área concreta. No se modificó ningún archivo.`;
}
