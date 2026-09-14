"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Camera, CheckCircle2, ChevronLeft, ExternalLink, ImageUp, Leaf, LoaderCircle, ScanLine, Search, Sparkles, TriangleAlert } from "lucide-react";
import { ChangeEvent, FormEvent, Suspense, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { supabase } from "@/lib/supabase";

type Match = { slug: string; name: string; similarity: number; reasons: string[] };
type ScanResult = {
  scanId: string;
  originalUrl: string;
  enhancedUrl: string | null;
  enhancementError: string | null;
  summary: string;
  features: Array<{ label: string; value: string }>;
  targetComparison: Match | null;
  matches: Match[];
  webGrounded: boolean;
  references: Array<{ url: string; title: string }>;
};

type TargetStrain = { slug: string; name: string; subtitle: string | null };

function ScannerExperience() {
  const searchParams = useSearchParams();
  const targetSlug = searchParams.get("strain")?.trim() || "";
  const { session } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [target, setTarget] = useState<TargetStrain | null>(null);
  const [useWeb, setUseWeb] = useState(true);
  const [status, setStatus] = useState<"idle" | "uploading" | "enhancing" | "matching" | "done">("idle");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!targetSlug) {
      setTarget(null);
      return;
    }
    let cancelled = false;
    void supabase
      .from("cannabis_strains")
      .select("slug,name,subtitle")
      .eq("slug", targetSlug)
      .eq("is_published", true)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setTarget((data as TargetStrain | null) ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [targetSlug]);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const next = URL.createObjectURL(file);
    setPreviewUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);

  function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    setFile(selected);
    setResult(null);
    setError("");
    setStatus("idle");
  }

  async function runScan(event: FormEvent) {
    event.preventDefault();
    if (!file || !session?.access_token) return;
    setError("");
    setResult(null);
    setStatus("uploading");

    const timers: number[] = [];
    timers.push(window.setTimeout(() => setStatus((current) => current === "uploading" ? "enhancing" : current), 650));
    timers.push(window.setTimeout(() => setStatus((current) => current === "enhancing" ? "matching" : current), 4500));

    try {
      const form = new FormData();
      form.append("image", file);
      if (targetSlug) form.append("targetSlug", targetSlug);
      form.append("useWeb", useWeb ? "true" : "false");
      const response = await fetch("/api/player/plus18/scan", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: form,
      });
      const data = (await response.json().catch(() => ({}))) as ScanResult & { error?: string };
      if (!response.ok) throw new Error(data.error || "No se pudo completar el análisis.");
      setResult(data);
      setStatus("done");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo completar el análisis.");
      setStatus("idle");
    } finally {
      timers.forEach((timer) => window.clearTimeout(timer));
    }
  }

  const statusText = status === "uploading"
    ? "Preparando la foto original…"
    : status === "enhancing"
      ? "Mejorando detalle sin cambiar el coco…"
      : status === "matching"
        ? "Comparando rasgos visuales…"
        : "";

  return (
    <main className="relative min-h-[100dvh] overflow-hidden bg-[#02110b] px-4 pb-12 pt-[calc(env(safe-area-inset-top)+18px)] text-white sm:px-6">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_80%_0%,rgba(246,166,47,.15),transparent_25%),radial-gradient(circle_at_10%_36%,rgba(82,157,78,.18),transparent_30%),linear-gradient(180deg,#082518_0%,#03150d_48%,#02100a_100%)]" />
      <div className="relative mx-auto max-w-6xl">
        <header className="flex items-center justify-between gap-3">
          <Link href={targetSlug ? `/player/plus18/cocos/${encodeURIComponent(targetSlug)}` : "/player/plus18/cocos"} className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/12 bg-black/20 text-white/75 backdrop-blur-xl" aria-label="Volver">
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-[0.28em] text-amber-200/65">Player +18 · Scanner</p>
            {target ? <p className="mt-1 text-sm text-white/70">Comparando con <strong>{target.name}</strong></p> : <p className="mt-1 text-sm text-white/55">Buscar coincidencias</p>}
          </div>
        </header>

        <div className="mt-7 grid gap-6 lg:grid-cols-[.9fr_1.1fr]">
          <form onSubmit={runScan} className="rounded-[32px] border border-white/10 bg-black/18 p-5 backdrop-blur-2xl sm:p-6">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-300/10 text-amber-300"><ScanLine className="h-5 w-5" /></div>
              <div>
                <h1 className="text-2xl font-semibold">Escanear coco</h1>
                <p className="text-sm text-white/48">Original + mejora fiel + matching visual</p>
              </div>
            </div>

            <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={selectFile} className="sr-only" />

            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="relative mt-6 flex aspect-[4/5] w-full items-center justify-center overflow-hidden rounded-[28px] border border-dashed border-amber-100/20 bg-[radial-gradient(circle_at_center,rgba(50,112,61,.2),transparent_55%),rgba(255,255,255,.025)]"
            >
              {previewUrl ? (
                <img src={previewUrl} alt="Foto seleccionada" className="absolute inset-0 h-full w-full object-cover" />
              ) : (
                <div className="text-center">
                  <Camera className="mx-auto h-10 w-10 text-amber-300" strokeWidth={1.4} />
                  <p className="mt-3 font-medium">Sacá una foto o elegí una imagen</p>
                  <p className="mt-1 text-xs text-white/40">JPG · PNG · WEBP · máximo 12 MB</p>
                </div>
              )}
              <div className="pointer-events-none absolute inset-[8%] rounded-[24px] border border-amber-200/25">
                <span className="absolute -left-px -top-px h-8 w-8 border-l-2 border-t-2 border-amber-300" />
                <span className="absolute -right-px -top-px h-8 w-8 border-r-2 border-t-2 border-amber-300" />
                <span className="absolute -bottom-px -left-px h-8 w-8 border-b-2 border-l-2 border-amber-300" />
                <span className="absolute -bottom-px -right-px h-8 w-8 border-b-2 border-r-2 border-amber-300" />
              </div>
            </button>

            <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-2xl border border-white/8 bg-white/[0.03] p-4">
              <input type="checkbox" checked={useWeb} onChange={(event) => setUseWeb(event.target.checked)} className="mt-0.5 h-4 w-4 accent-amber-300" />
              <span>
                <span className="block text-sm font-medium text-white/80">Apoyar con referencias web</span>
                <span className="mt-1 block text-xs leading-5 text-white/42">Gemini puede consultar contexto público; la foto sigue siendo una comparación visual, no un diagnóstico.</span>
              </span>
            </label>

            {error ? <div className="mt-4 flex gap-2 rounded-2xl border border-rose-300/15 bg-rose-300/8 p-4 text-sm text-rose-100"><TriangleAlert className="h-5 w-5 shrink-0" />{error}</div> : null}

            <button
              type="submit"
              disabled={!file || status !== "idle" && status !== "done"}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-amber-300 px-5 py-3.5 font-semibold text-[#142014] shadow-[0_14px_45px_rgba(246,166,47,.18)] disabled:cursor-not-allowed disabled:opacity-45"
            >
              {status !== "idle" && status !== "done" ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
              {status !== "idle" && status !== "done" ? statusText : target ? `Mejorar + comparar con ${target.name}` : "Mejorar + buscar coincidencias"}
            </button>
          </form>

          <section className="min-h-[520px] rounded-[32px] border border-white/10 bg-white/[0.025] p-5 backdrop-blur-xl sm:p-6">
            {!result && status === "idle" ? (
              <div className="flex min-h-[470px] flex-col items-center justify-center text-center">
                <div className="flex h-20 w-20 items-center justify-center rounded-full border border-amber-100/12 bg-amber-300/5"><Leaf className="h-9 w-9 text-[#9bcb7e]" strokeWidth={1.2} /></div>
                <h2 className="mt-5 text-2xl font-semibold">Vas a ver el coco mejor</h2>
                <p className="mt-2 max-w-md text-sm leading-6 text-white/45">CLOUVA guarda la original, genera una mejora de apoyo y compara ambas para reducir el riesgo de que la mejora invente detalles.</p>
              </div>
            ) : null}

            {!result && status !== "idle" && status !== "done" ? (
              <div className="flex min-h-[470px] flex-col items-center justify-center text-center">
                <div className="relative flex h-28 w-28 items-center justify-center rounded-full border border-amber-200/15 bg-[#082518]">
                  <LoaderCircle className="h-14 w-14 animate-spin text-amber-300" strokeWidth={1.2} />
                  <Leaf className="absolute h-7 w-7 text-[#96cf7b]" />
                </div>
                <h2 className="mt-6 text-xl font-semibold">{statusText}</h2>
                <p className="mt-2 text-sm text-white/42">No se altera la identidad visual a propósito; la mejora es auxiliar.</p>
              </div>
            ) : null}

            {result ? (
              <div>
                <div className="flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-amber-200/65"><CheckCircle2 className="h-4 w-4 text-[#8de28d]" /> Scan guardado</div>
                <h2 className="mt-2 text-2xl font-semibold">Coincidencias visuales</h2>

                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <figure className="overflow-hidden rounded-[24px] border border-white/10 bg-black/20">
                    <img src={result.originalUrl} alt="Foto original" className="aspect-square w-full object-cover" />
                    <figcaption className="px-4 py-3 text-xs uppercase tracking-[0.18em] text-white/45">Original</figcaption>
                  </figure>
                  <figure className="overflow-hidden rounded-[24px] border border-amber-200/15 bg-black/20">
                    {result.enhancedUrl ? <img src={result.enhancedUrl} alt="Mejora visual IA" className="aspect-square w-full object-cover" /> : <div className="flex aspect-square items-center justify-center p-5 text-center text-sm text-white/45">La mejora no estuvo disponible. El matching se hizo con la foto original.</div>}
                    <figcaption className="px-4 py-3 text-xs uppercase tracking-[0.18em] text-amber-200/60">Mejora IA · apoyo visual</figcaption>
                  </figure>
                </div>

                {result.enhancementError ? <p className="mt-3 rounded-2xl bg-amber-300/7 px-4 py-3 text-xs leading-5 text-amber-100/60">Mejora visual: {result.enhancementError}</p> : null}

                {result.summary ? <p className="mt-5 text-sm leading-6 text-white/55">{result.summary}</p> : null}

                {result.features.length ? (
                  <div className="mt-5 grid gap-2 sm:grid-cols-2">
                    {result.features.map((feature) => (
                      <div key={`${feature.label}-${feature.value}`} className="rounded-2xl border border-white/8 bg-white/[0.03] p-3">
                        <p className="text-[10px] uppercase tracking-[0.18em] text-amber-200/55">{feature.label}</p>
                        <p className="mt-1 text-sm text-white/72">{feature.value}</p>
                      </div>
                    ))}
                  </div>
                ) : null}

                {result.targetComparison ? (
                  <div className="mt-6 rounded-[26px] border border-amber-200/18 bg-amber-300/[0.055] p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.2em] text-amber-200/60">Comparación objetivo</p>
                        <h3 className="mt-1 text-xl font-semibold">{result.targetComparison.name}</h3>
                      </div>
                      <div className="text-right"><strong className="text-3xl text-amber-300">{result.targetComparison.similarity}%</strong><p className="text-[10px] uppercase tracking-[0.14em] text-white/35">similitud visual</p></div>
                    </div>
                    <ul className="mt-3 space-y-1 text-sm text-white/55">{result.targetComparison.reasons.map((reason) => <li key={reason}>· {reason}</li>)}</ul>
                  </div>
                ) : null}

                <div className="mt-6 space-y-3">
                  {result.matches.map((match) => (
                    <Link key={match.slug} href={`/player/plus18/cocos/${encodeURIComponent(match.slug)}`} className="flex items-center gap-4 rounded-[24px] border border-white/9 bg-white/[0.035] p-4 transition hover:border-amber-200/20 hover:bg-white/[0.055]">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#143923] text-[#98cf7c]"><Leaf className="h-5 w-5" /></div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-3"><strong className="truncate">{match.name}</strong><span className="font-semibold text-amber-300">{match.similarity}%</span></div>
                        <p className="mt-1 line-clamp-1 text-xs text-white/42">{match.reasons.join(" · ")}</p>
                      </div>
                    </Link>
                  ))}
                </div>

                {result.references.length ? (
                  <div className="mt-6 border-t border-white/8 pt-5">
                    <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-white/45"><Search className="h-4 w-4" /> Referencias web</div>
                    <div className="mt-3 flex flex-col gap-2">
                      {result.references.slice(0, 5).map((reference) => (
                        <a key={reference.url} href={reference.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm text-amber-100/60 hover:text-amber-200">
                          <ExternalLink className="h-3.5 w-3.5 shrink-0" /><span className="line-clamp-1">{reference.title}</span>
                        </a>
                      ))}
                    </div>
                  </div>
                ) : useWeb && result.webGrounded ? null : null}

                <button type="button" onClick={() => inputRef.current?.click()} className="mt-6 inline-flex items-center gap-2 rounded-2xl border border-white/12 px-4 py-3 text-sm text-white/70"><ImageUp className="h-4 w-4" /> Probar otra foto</button>
              </div>
            ) : null}
          </section>
        </div>
      </div>
    </main>
  );
}

export default function ScanPage() {
  return <Suspense fallback={<main className="min-h-[100dvh] bg-[#02110b]" />}><ScannerExperience /></Suspense>;
}
