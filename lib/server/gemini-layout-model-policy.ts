import "server-only";

export type GeminiLayoutWorkload = "classification" | "adaptive_layout" | "reference_precise";

export type GeminiLayoutModelPolicy = {
  model: string;
  temperature: number;
  timeoutMs: number;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
};

function envModel(name: string, fallback: string) {
  const value = process.env[name]?.trim();
  return value || fallback;
}

// Central policy for the Studio/Player layout engine. The defaults intentionally
// keep cheap classification/adaptive work on Flash-Lite while reserving Pro for
// the expensive geometry extraction path. Environment overrides let production
// move model versions without touching the rendering contract.
const POLICY: Record<GeminiLayoutWorkload, GeminiLayoutModelPolicy> = {
  classification: {
    model: envModel("CLOUVA_GEMINI_LAYOUT_CLASSIFICATION_MODEL", "gemini-3.1-flash-lite"),
    temperature: 0.2,
    timeoutMs: 45_000,
    inputPricePerMillion: 0.25,
    outputPricePerMillion: 1.5,
  },
  adaptive_layout: {
    model: envModel("CLOUVA_GEMINI_LAYOUT_ADAPTIVE_MODEL", "gemini-3.1-flash-lite"),
    temperature: 0.4,
    timeoutMs: 45_000,
    inputPricePerMillion: 0.25,
    outputPricePerMillion: 1.5,
  },
  reference_precise: {
    model: envModel("CLOUVA_GEMINI_LAYOUT_PRECISE_MODEL", "gemini-3.1-pro-preview"),
    temperature: 0.15,
    timeoutMs: 90_000,
    inputPricePerMillion: 2,
    outputPricePerMillion: 12,
  },
};

export function getGeminiLayoutModelPolicy(workload: GeminiLayoutWorkload): GeminiLayoutModelPolicy {
  return POLICY[workload];
}

export const CLOUVA_LAYOUT_MODEL_IDS = Array.from(new Set(Object.values(POLICY).map((entry) => entry.model)));
