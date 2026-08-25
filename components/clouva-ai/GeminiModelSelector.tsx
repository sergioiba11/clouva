"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Loader2, RefreshCw, Sparkles } from "lucide-react";

type ModelOption = {
  id: string;
  name: string;
  description: string;
  inputTokenLimit: number | null;
  outputTokenLimit: number | null;
};

type ModelsPayload = {
  models?: ModelOption[];
  defaultModel?: string;
  error?: string;
};

const COOKIE_NAME = "clouva_gemini_model";
const STORAGE_KEY = "clouva.ai.gemini-model.v1";

function saveModel(model: string) {
  window.localStorage.setItem(STORAGE_KEY, model);
  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(model)}; path=/; max-age=31536000; samesite=lax`;
}

export function GeminiModelSelector() {
  const [models, setModels] = useState<ModelOption[]>([]);
  const [selected, setSelected] = useState("");
  const [defaultModel, setDefaultModel] = useState("gemini-3.5-flash");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadModels() {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/clouva-ai/models", { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as ModelsPayload;
      if (!response.ok) throw new Error(payload.error ?? "No se pudieron cargar los modelos.");

      const available = payload.models ?? [];
      const configuredDefault = payload.defaultModel ?? "gemini-3.5-flash";
      const saved = window.localStorage.getItem(STORAGE_KEY);
      const next =
        saved && available.some((model) => model.id === saved)
          ? saved
          : available.some((model) => model.id === configuredDefault)
            ? configuredDefault
            : available[0]?.id ?? configuredDefault;

      setModels(available);
      setDefaultModel(configuredDefault);
      setSelected(next);
      saveModel(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudieron cargar los modelos.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadModels();
  }, []);

  const current = useMemo(
    () => models.find((model) => model.id === selected),
    [models, selected],
  );

  return (
    <div className="group relative flex min-w-0 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.045] p-1.5 transition hover:border-violet-400/35">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-violet-500/15 text-violet-300">
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
      </span>

      <div className="relative min-w-0 flex-1">
        <span className="pointer-events-none block truncate pr-5 text-[9px] font-bold uppercase tracking-[0.16em] text-white/35">
          Modelo
        </span>
        <select
          value={selected}
          onChange={(event) => {
            setSelected(event.target.value);
            saveModel(event.target.value);
          }}
          disabled={loading || models.length === 0}
          aria-label="Modelo de inteligencia artificial"
          className="block w-full appearance-none truncate bg-transparent pr-6 text-[11px] font-medium text-white/80 outline-none disabled:opacity-50"
          title={current?.description || current?.name || selected}
        >
          {models.length === 0 ? (
            <option value={defaultModel}>{defaultModel}</option>
          ) : (
            models.map((model) => (
              <option key={model.id} value={model.id} className="bg-zinc-950">
                {model.name}
              </option>
            ))
          )}
        </select>
        <ChevronDown className="pointer-events-none absolute bottom-0.5 right-1 h-3 w-3 text-white/35" />
      </div>

      <button
        type="button"
        onClick={() => void loadModels()}
        disabled={loading}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white/35 transition hover:bg-white/5 hover:text-white disabled:opacity-40"
        aria-label="Actualizar modelos"
      >
        <RefreshCw className="h-3.5 w-3.5" />
      </button>

      {error && (
        <p className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-64 rounded-xl border border-red-400/25 bg-[#160b12] px-3 py-2 text-xs text-red-200 shadow-2xl">
          {error}
        </p>
      )}
    </div>
  );
}
