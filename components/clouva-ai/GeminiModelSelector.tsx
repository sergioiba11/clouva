"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Cpu, Loader2, RefreshCw } from "lucide-react";

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
      const response = await fetch("/api/clouva-ai/models", {
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => ({}))) as ModelsPayload;
      if (!response.ok) {
        throw new Error(payload.error ?? "No se pudieron cargar los modelos.");
      }

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
      setError(
        caught instanceof Error
          ? caught.message
          : "No se pudieron cargar los modelos.",
      );
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
    <section className="mx-auto w-full max-w-5xl shrink-0 px-4 pt-3 sm:px-6">
      <div className="rounded-2xl border border-violet-500/20 bg-zinc-950/95 p-3 shadow-lg shadow-violet-950/20">
        <div className="flex items-center gap-3">
          <div className="shrink-0 rounded-xl bg-violet-500/15 p-2 text-violet-300">
            <Cpu className="h-4 w-4" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-300">
                Modelo Gemini
              </p>
              {current && (
                <p className="max-w-[52%] truncate font-mono text-[10px] text-white/35">
                  {current.id}
                </p>
              )}
            </div>

            <div className="relative mt-1.5">
              <select
                value={selected}
                onChange={(event) => {
                  const value = event.target.value;
                  setSelected(value);
                  saveModel(value);
                }}
                disabled={loading || models.length === 0}
                className="w-full appearance-none rounded-xl border border-white/10 bg-black px-3 py-2 pr-9 text-xs text-white outline-none transition focus:border-violet-400/60 disabled:opacity-50"
              >
                {models.length === 0 ? (
                  <option value={defaultModel}>{defaultModel}</option>
                ) : (
                  models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name} — {model.id}
                    </option>
                  ))
                )}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/45" />
            </div>
          </div>

          <button
            type="button"
            onClick={() => void loadModels()}
            disabled={loading}
            className="shrink-0 rounded-full border border-white/10 p-2 text-white/55 transition hover:border-violet-400/50 hover:text-white disabled:opacity-40"
            aria-label="Actualizar modelos"
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
          </button>
        </div>

        {error && (
          <p className="mt-2 rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs text-red-200">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
