"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/auth-provider";

type StylePreset = { id: string; label: string; prompt: string; artStyle: "realistic" | "cartoon" };

const STYLES: StylePreset[] = [
  {
    id: "streetwear",
    label: "Streetwear oscuro",
    prompt:
      "A stylized 3D character, young person wearing an oversized black hoodie and black cargo pants with straps and chains, dark streetwear aesthetic, full body, T-pose, clean topology, video game character model",
    artStyle: "cartoon",
  },
  {
    id: "futurista",
    label: "Futurista",
    prompt:
      "A stylized 3D character wearing sleek futuristic techwear clothing, cyberpunk streetwear, glowing accents, full body, T-pose, clean topology, video game character model",
    artStyle: "cartoon",
  },
  {
    id: "deportivo",
    label: "Urbano deportivo",
    prompt:
      "A stylized 3D character wearing an athletic tracksuit and sneakers, urban sporty streetwear look, full body, T-pose, clean topology, video game character model",
    artStyle: "cartoon",
  },
  {
    id: "realista",
    label: "Realista",
    prompt:
      "A realistic 3D character, young person wearing a black hoodie and dark pants, full body, T-pose, clean topology, game-ready character model",
    artStyle: "realistic",
  },
];

type Phase = "idle" | "preview" | "refining" | "saving" | "done" | "error";

export default function AvatarIaPage() {
  const { user } = useAuth();
  const [styleId, setStyleId] = useState(STYLES[0].id);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);

  const poll = async (taskId: string): Promise<{ status: string; model_urls?: { glb?: string }; task_error?: { message?: string } }> => {
    while (true) {
      await new Promise((r) => setTimeout(r, 4000));
      const res = await fetch(`/api/meshy/status?taskId=${taskId}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (typeof data.progress === "number") setProgress(data.progress);
      if (data.status === "SUCCEEDED" || data.status === "FAILED" || data.status === "EXPIRED") return data;
    }
  };

  const generate = async () => {
    const style = STYLES.find((s) => s.id === styleId)!;
    setErrorMsg(null);
    setResultUrl(null);
    setProgress(0);
    try {
      setPhase("preview");
      const createRes = await fetch("/api/meshy/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: style.prompt, artStyle: style.artStyle }),
      });
      const created = await createRes.json();
      if (created.error) throw new Error(created.error);
      const previewResult = await poll(created.taskId);
      if (previewResult.status !== "SUCCEEDED") throw new Error(previewResult.task_error?.message || "Falló el boceto 3D");

      setPhase("refining");
      setProgress(0);
      const refineRes = await fetch("/api/meshy/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "refine", previewTaskId: created.taskId }),
      });
      const refined = await refineRes.json();
      if (refined.error) throw new Error(refined.error);
      const refineResult = await poll(refined.taskId);
      if (refineResult.status !== "SUCCEEDED" || !refineResult.model_urls?.glb) {
        throw new Error(refineResult.task_error?.message || "Falló el texturizado");
      }

      const glbUrl = refineResult.model_urls.glb;
      setResultUrl(glbUrl);

      if (user) {
        setPhase("saving");
        const { supabase } = await import("@/lib/supabase");
        await supabase.from("profiles").update({ avatar_3d_url: glbUrl }).eq("id", user.id);
      }
      setPhase("done");
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : "Error desconocido");
      setPhase("error");
    }
  };

  const busy = phase === "preview" || phase === "refining" || phase === "saving";

  return (
    <div className="space-y-5">
      <section className="panel rounded-3xl border border-white/10 p-5">
        <h1 className="text-2xl font-semibold">Avatar con IA</h1>
        <p className="text-sm text-white/70">Elegí un estilo y Meshy genera tu personaje 3D — tarda entre 1 y 3 minutos.</p>
      </section>

      <section className="panel rounded-3xl border border-[#8f7cff]/20 p-5">
        <h2 className="mb-3 text-sm uppercase tracking-[0.15em] text-white/70">Estilo</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {STYLES.map((s) => (
            <button
              key={s.id}
              onClick={() => setStyleId(s.id)}
              disabled={busy}
              className={`rounded-2xl border p-3 text-left text-sm transition ${
                styleId === s.id ? "border-[#8f7cff] bg-[#8f7cff]/15" : "border-white/10 hover:border-white/30"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        <button
          onClick={generate}
          disabled={busy}
          className="mt-5 rounded-full bg-[#8f7cff] px-5 py-2.5 text-sm font-medium text-black disabled:opacity-60"
        >
          {phase === "idle" && "Generar personaje"}
          {phase === "preview" && `Generando boceto 3D… ${progress}%`}
          {phase === "refining" && `Aplicando textura… ${progress}%`}
          {phase === "saving" && "Guardando en tu perfil…"}
          {phase === "done" && "Generar otro"}
          {phase === "error" && "Reintentar"}
        </button>

        {errorMsg ? <p className="mt-3 text-sm text-rose-400">{errorMsg}</p> : null}

        {resultUrl ? (
          <div className="mt-6">
            <model-viewer
              src={resultUrl}
              alt="Personaje generado por IA"
              camera-controls
              auto-rotate
              style={{ width: "100%", height: "360px", borderRadius: "1rem" }}
            />
            {phase === "done" ? <p className="mt-2 text-sm text-emerald-300">Guardado en tu perfil ✓</p> : null}
          </div>
        ) : null}
      </section>

      <Link href="/mi-flow/avatar" className="inline-block text-sm text-white/60 underline">
        Volver al editor de avatar
      </Link>
    </div>
  );
}
