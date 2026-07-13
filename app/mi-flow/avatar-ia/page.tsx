"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/auth-provider";
import { useActiveAvatarStore } from "@/lib/avatar-engine/active-avatar-store";

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

const OFFICIAL_CHARACTERS = [
  {
    id: "male",
    label: "Personaje oficial — masculino",
    images: ["https://clouva.com.ar/reference/male-front.png", "https://clouva.com.ar/reference/male-back.png"],
  },
  {
    id: "female",
    label: "Personaje oficial — femenino",
    images: ["https://clouva.com.ar/reference/female-front.png", "https://clouva.com.ar/reference/female-back.png"],
  },
];

export default function AvatarIaPage() {
  const { user, session } = useAuth();
  const setActiveAvatar = useActiveAvatarStore((state) => state.setActiveAvatar);
  const [styleId, setStyleId] = useState(STYLES[0].id);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [officialBusy, setOfficialBusy] = useState<string | null>(null);
  const [officialResults, setOfficialResults] = useState<Record<string, string>>({});
  const [officialError, setOfficialError] = useState<Record<string, string>>({});
  const [officialStatus, setOfficialStatus] = useState<Record<string, string>>({});

  const pollMultiImage = async (taskId: string) => {
    while (true) {
      await new Promise((r) => setTimeout(r, 4000));
      const res = await fetch(`/api/meshy/status?taskId=${taskId}&kind=multi-image`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (data.status === "SUCCEEDED" || data.status === "FAILED" || data.status === "EXPIRED") return data;
    }
  };

  const generateOfficial = async (id: string, images: string[]) => {
    setOfficialBusy(id);
    setOfficialError((prev) => ({ ...prev, [id]: "" }));
    setOfficialStatus((prev) => ({ ...prev, [id]: "Enviando fotos a Meshy…" }));
    try {
      const createRes = await fetch("/api/meshy/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "multi-image", imageUrls: images }),
      });
      const created = await createRes.json().catch(() => null);
      if (!created) throw new Error(`Respuesta inválida del servidor (status ${createRes.status})`);
      if (created.error) throw new Error(created.error);
      if (!created.taskId) throw new Error("No se recibió taskId de Meshy");
      setOfficialStatus((prev) => ({ ...prev, [id]: `Tarea creada (${created.taskId.slice(0, 8)}…), generando modelo 3D…` }));
      const result = await pollMultiImage(created.taskId);
      if (result.status !== "SUCCEEDED" || !result.model_urls?.glb) {
        throw new Error(result.task_error?.message || `La tarea terminó con estado: ${result.status}`);
      }
      setOfficialResults((prev) => ({ ...prev, [id]: result.model_urls.glb }));
      setOfficialStatus((prev) => ({ ...prev, [id]: "Listo ✓" }));
    } catch (error) {
      setOfficialError((prev) => ({ ...prev, [id]: error instanceof Error ? error.message : "Error desconocido" }));
      setOfficialStatus((prev) => ({ ...prev, [id]: "" }));
    } finally {
      setOfficialBusy(null);
    }
  };

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
      if (!user || !session?.access_token) throw new Error("Tenés que iniciar sesión para guardar tu avatar");

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

      setPhase("saving");
      const finalizeRes = await fetch("/api/avatar/finalize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          modelUrl: refineResult.model_urls.glb,
          meshyTaskId: refined.taskId,
          name: `Avatar ${style.label}`,
        }),
      });
      const finalized = await finalizeRes.json();
      if (!finalizeRes.ok || finalized.error || !finalized.avatar?.model_url) {
        throw new Error(finalized.error || "No se pudo guardar el avatar");
      }

      const avatar = finalized.avatar;
      setResultUrl(avatar.model_url);
      setActiveAvatar({
        id: avatar.id,
        source: "generated",
        modelUrl: avatar.model_url,
        fallbackUrl: null,
        status: "ready",
        frontRotationY: Number(avatar.front_rotation_y ?? 0),
        updatedAt: avatar.updated_at ?? new Date().toISOString(),
      });
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

      <section className="panel rounded-3xl border border-emerald-400/30 p-5">
        <h2 className="mb-1 text-sm uppercase tracking-[0.15em] text-white/70">Personajes oficiales CLOUVA</h2>
        <p className="mb-4 text-xs text-white/50">Generados desde tus fotos de referencia reales (frente + espalda).</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {OFFICIAL_CHARACTERS.map((c) => (
            <div key={c.id} className="rounded-2xl border border-white/10 p-4">
              <p className="mb-3 text-sm font-medium">{c.label}</p>
              <button
                onClick={() => generateOfficial(c.id, c.images)}
                disabled={officialBusy === c.id}
                className="rounded-full bg-emerald-400/90 px-4 py-2 text-sm font-medium text-black disabled:opacity-60"
              >
                {officialBusy === c.id ? "Generando…" : officialResults[c.id] ? "Generar de nuevo" : "Generar"}
              </button>
              {officialStatus[c.id] ? <p className="mt-2 text-xs text-white/60">{officialStatus[c.id]}</p> : null}
              {officialError[c.id] ? <p className="mt-2 text-xs text-rose-400">Error: {officialError[c.id]}</p> : null}
              {officialResults[c.id] ? (
                <model-viewer
                  src={officialResults[c.id]}
                  alt={c.label}
                  camera-controls
                  auto-rotate
                  style={{ width: "100%", height: "260px", borderRadius: "1rem", marginTop: "12px" }}
                />
              ) : null}
            </div>
          ))}
        </div>
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
          {phase === "saving" && "Guardando en tu cuenta…"}
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
            {phase === "done" ? <p className="mt-2 text-sm text-emerald-300">Guardado y activado en tu cuenta ✓</p> : null}
          </div>
        ) : null}
      </section>

      <Link href="/mi-flow/avatar" className="inline-block text-sm text-white/60 underline">
        Volver al editor de avatar
      </Link>
    </div>
  );
}
