export type ClouvaAIMode = "chat" | "project";

export const CLOUVA_AI_MODE_STORAGE_KEY = "clouva.ai.preferred-mode.v1";
export const DEFAULT_CLOUVA_AI_MODE: ClouvaAIMode = "project";

export function normalizeClouvaAIMode(value: unknown): ClouvaAIMode {
  return value === "chat" || value === "project" ? value : DEFAULT_CLOUVA_AI_MODE;
}

export function endpointForClouvaAIMode(mode: ClouvaAIMode) {
  return mode === "project" ? "/api/clouva-ai/agent" : "/api/gemini";
}

export function projectAccessLabel(args: {
  state: "checking" | "connected" | "unavailable" | "signed_out";
  repository?: string | null;
  branch?: string | null;
  message?: string | null;
}) {
  if (args.state === "checking") return "Verificando acceso a GitHub…";
  if (args.state === "signed_out") return "Iniciá sesión para activar Proyecto";
  if (args.state === "unavailable") return args.message || "GitHub requiere reconexión";

  const repository = args.repository || "sergioiba11/clouva";
  const branch = args.branch || "main";
  return `GitHub conectado · ${repository} · ${branch}`;
}
