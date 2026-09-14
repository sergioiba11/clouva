"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Camera, ChevronLeft, Heart, Leaf, ScanSearch, Share2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import {
  EmptyEffectsNote,
  InfoCard,
  StrainEffectsWheel,
  type FlavorRecord,
  type StrainEffects,
  type StrainRecord,
  type TerpeneRecord,
} from "@/components/player-plus18/GeneticsUI";
import { supabase } from "@/lib/supabase";

type ExpandedPanel = "aroma" | "terpenes" | "profile" | "info" | null;

function heroBackground(slug: string) {
  if (slug === "pineapple") {
    return "radial-gradient(circle at 52% 13%, rgba(247,170,58,.32), transparent 22%), radial-gradient(circle at 12% 50%, rgba(79,150,74,.3), transparent 32%), radial-gradient(circle at 88% 62%, rgba(161,116,39,.18), transparent 30%), linear-gradient(180deg,#174329 0%,#082416 45%,#03130c 100%)";
  }
  return "radial-gradient(circle at 50% 12%, rgba(225,159,61,.24), transparent 22%), radial-gradient(circle at 16% 56%, rgba(75,146,73,.25), transparent 30%), linear-gradient(180deg,#123923 0%,#071f14 50%,#03120b 100%)";
}

export default function StrainDetailPage() {
  const params = useParams<{ slug: string }>();
  const slug = decodeURIComponent(params.slug);
  const { user } = useAuth();
  const [strain, setStrain] = useState<StrainRecord | null>(null);
  const [effects, setEffects] = useState<StrainEffects | null>(null);
  const [terpenes, setTerpenes] = useState<TerpeneRecord[]>([]);
  const [flavors, setFlavors] = useState<FlavorRecord[]>([]);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<ExpandedPanel>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      const strainResult = await supabase
        .from("cannabis_strains")
        .select("id,slug,name,subtitle,description,strain_type,hero_image,profile,tags,aromas,is_featured,is_published")
        .eq("slug", slug)
        .eq("is_published", true)
        .maybeSingle();

      if (strainResult.error || !strainResult.data) {
        if (!cancelled) {
          setError(strainResult.error?.message || "No encontramos esta genética.");
          setLoading(false);
        }
        return;
      }

      const current = strainResult.data as StrainRecord;
      const [effectsResult, terpenesResult, flavorsResult, favoriteResult] = await Promise.all([
        supabase.from("strain_effects").select("relaxation,creativity,energy,happiness,focus").eq("strain_id", current.id).maybeSingle(),
        supabase.from("strain_terpenes").select("id,terpene,description,aroma,relative_value").eq("strain_id", current.id).order("sort_order", { ascending: true }),
        supabase.from("strain_flavors").select("id,flavor,value").eq("strain_id", current.id).order("sort_order", { ascending: true }),
        user
          ? supabase.from("user_strain_favorites").select("strain_id").eq("user_id", user.id).eq("strain_id", current.id).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ]);

      if (user) {
        void supabase.from("user_strain_views").upsert(
          { user_id: user.id, strain_id: current.id, viewed_at: new Date().toISOString() },
          { onConflict: "user_id,strain_id" },
        );
      }

      if (!cancelled) {
        setStrain(current);
        setEffects((effectsResult.data ?? null) as StrainEffects | null);
        setTerpenes((terpenesResult.data ?? []) as TerpeneRecord[]);
        setFlavors((flavorsResult.data ?? []) as FlavorRecord[]);
        setSaved(Boolean(favoriteResult.data));
        setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [slug, user]);

  async function toggleFavorite() {
    if (!user || !strain || saving) return;
    setSaving(true);
    const next = !saved;
    setSaved(next);
    const result = next
      ? await supabase.from("user_strain_favorites").insert({ user_id: user.id, strain_id: strain.id })
      : await supabase.from("user_strain_favorites").delete().eq("user_id", user.id).eq("strain_id", strain.id);
    if (result.error) {
      setSaved(!next);
      setError(result.error.message);
    }
    setSaving(false);
  }

  const terpeneSummary = useMemo(
    () => terpenes.length ? terpenes.slice(0, 3).map((item) => item.terpene.toLowerCase()).join(", ") : "sin datos cargados",
    [terpenes],
  );
  const aromaSummary = strain?.aromas?.length ? strain.aromas.join(", ") : "sin datos cargados";
  const hasAnyEffect = effects ? Object.values(effects).some((value) => typeof value === "number") : false;

  if (loading) {
    return (
      <main className="min-h-[100dvh] bg-[#03130c] px-4 py-8">
        <div className="mx-auto max-w-6xl animate-pulse space-y-5">
          <div className="h-[62dvh] min-h-[520px] rounded-[34px] bg-white/5" />
          <div className="mx-auto aspect-square max-w-[430px] rounded-full bg-white/5" />
        </div>
      </main>
    );
  }

  if (!strain) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-[#03130c] px-5 text-white">
        <div className="max-w-md rounded-[28px] border border-white/10 bg-white/5 p-6">
          <h1 className="text-2xl font-semibold">Genética no encontrada</h1>
          <p className="mt-2 text-sm text-white/55">{error || "Esta ficha no está publicada."}</p>
          <Link href="/player/plus18/cocos" className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-amber-300 px-4 py-3 text-sm font-semibold text-[#152014]">
            <ChevronLeft className="h-4 w-4" /> Volver a Mis cocos
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-[100dvh] bg-[#02110b] text-white">
      <section className="relative min-h-[78dvh] overflow-hidden border-b border-white/5" style={{ background: heroBackground(strain.slug) }}>
        {strain.hero_image ? (
          <img src={strain.hero_image} alt={strain.name} className="absolute inset-0 h-full w-full object-cover opacity-75" />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-[#02110b]" />
        <div className="pointer-events-none absolute left-[-12%] top-[18%] h-80 w-80 rounded-full border-[48px] border-emerald-300/[0.035] blur-sm" />
        <div className="pointer-events-none absolute right-[-10%] top-[30%] h-72 w-72 rounded-full bg-amber-300/[0.055] blur-3xl" />

        <div className="relative mx-auto flex min-h-[78dvh] max-w-6xl flex-col px-4 pb-10 pt-[calc(env(safe-area-inset-top)+18px)] sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <Link href="/player/plus18/cocos" className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/12 bg-black/20 text-white/80 backdrop-blur-xl" aria-label="Volver">
              <ChevronLeft className="h-5 w-5" />
            </Link>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={toggleFavorite}
                disabled={saving}
                className={`inline-flex h-11 items-center gap-2 rounded-full border px-4 text-sm backdrop-blur-xl transition ${saved ? "border-amber-300/25 bg-amber-300/12 text-amber-200" : "border-white/12 bg-black/20 text-white/75"}`}
              >
                <Heart className={`h-4 w-4 ${saved ? "fill-current" : ""}`} /> {saved ? "Guardada" : "Guardar"}
              </button>
              <button
                type="button"
                onClick={() => navigator.share?.({ title: strain.name, url: window.location.href }).catch(() => undefined)}
                className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/12 bg-black/20 text-white/65 backdrop-blur-xl"
                aria-label="Compartir"
              >
                <Share2 className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="mx-auto mt-auto w-full max-w-3xl text-center">
            {!strain.hero_image ? (
              <div className="mx-auto mb-5 flex h-48 w-48 items-center justify-center rounded-full border border-amber-100/10 bg-[radial-gradient(circle,rgba(137,198,110,.28),rgba(4,28,16,.25)_65%,transparent_70%)] shadow-[0_0_80px_rgba(136,198,110,.12)] sm:h-64 sm:w-64">
                <Leaf className="h-28 w-28 text-[#a2cf83]/80 drop-shadow-[0_0_25px_rgba(162,207,131,.25)]" strokeWidth={0.9} />
              </div>
            ) : null}
            <p className="text-[10px] uppercase tracking-[0.34em] text-amber-100/70">Player +18 · Genetics</p>
            <h1 className="mt-3 font-serif text-5xl leading-none text-[#fff7e7] drop-shadow-[0_8px_30px_rgba(0,0,0,.35)] sm:text-7xl">{strain.name}</h1>
            <p className="mt-4 text-xs font-medium uppercase tracking-[0.35em] text-white/75 sm:text-sm">{strain.subtitle || strain.strain_type || "Genética"}</p>
            <div className="mx-auto mt-3 h-px w-10 bg-amber-300" />
            <p className="mt-4 text-[10px] uppercase tracking-[0.26em] text-white/55 sm:text-xs">{strain.tags?.join(" · ") || strain.profile || "Perfil comunitario"}</p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link href={`/player/plus18/escanear?strain=${encodeURIComponent(strain.slug)}`} className="inline-flex items-center gap-2 rounded-2xl bg-amber-300 px-5 py-3 text-sm font-semibold text-[#142014] shadow-[0_14px_50px_rgba(246,166,47,.2)]">
                <Camera className="h-4 w-4" /> Escanear este coco
              </Link>
              <Link href={`/player/plus18/escanear?strain=${encodeURIComponent(strain.slug)}&mode=compare`} className="inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-black/20 px-5 py-3 text-sm text-white/80 backdrop-blur-xl">
                <ScanSearch className="h-4 w-4" /> Comparar foto
              </Link>
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="grid gap-10 lg:grid-cols-[.9fr_1.1fr] lg:items-start">
          <div>
            <p className="text-center text-xs uppercase tracking-[0.28em] text-amber-200/55 lg:text-left">Perfil de efectos</p>
            <div className="mt-5"><StrainEffectsWheel effects={effects} /></div>
            {!hasAnyEffect ? <EmptyEffectsNote /> : null}
          </div>

          <div className="lg:pt-8">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <InfoCard title="Aroma" text={aromaSummary} kind="aroma" onClick={() => setExpanded(expanded === "aroma" ? null : "aroma")} />
              <InfoCard title="Terpenos" text={terpeneSummary} kind="terpenes" onClick={() => setExpanded(expanded === "terpenes" ? null : "terpenes")} />
              <InfoCard title="Perfil" text={strain.profile || "sin perfil cargado"} kind="profile" onClick={() => setExpanded(expanded === "profile" ? null : "profile")} />
              <InfoCard title="Uso informativo" text="Coincidencias visuales orientativas, no identificación genética exacta." kind="info" onClick={() => setExpanded(expanded === "info" ? null : "info")} />
            </div>

            {expanded ? (
              <div className="mt-4 rounded-[28px] border border-amber-100/12 bg-white/[0.045] p-5 backdrop-blur-2xl">
                {expanded === "aroma" ? (
                  <>
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-200/70">Aroma</p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {(strain.aromas?.length ? strain.aromas : ["Sin datos"]).map((aroma) => <span key={aroma} className="rounded-full border border-amber-200/15 bg-amber-300/8 px-3 py-2 text-sm text-white/75">{aroma}</span>)}
                    </div>
                    {flavors.length ? <p className="mt-4 text-sm text-white/45">Perfil sensorial: {flavors.map((item) => item.flavor).join(" · ")}</p> : null}
                  </>
                ) : null}
                {expanded === "terpenes" ? (
                  <>
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-200/70">Terpenos</p>
                    <div className="mt-4 space-y-3">
                      {terpenes.length ? terpenes.map((item) => (
                        <div key={item.id} className="rounded-2xl border border-white/8 bg-black/15 p-4">
                          <div className="flex items-center justify-between gap-3">
                            <strong className="text-white/90">{item.terpene}</strong>
                            {item.relative_value != null ? <span className="text-xs text-amber-300">{item.relative_value}</span> : null}
                          </div>
                          {item.aroma ? <p className="mt-1 text-xs text-[#9dce83]">Aroma: {item.aroma}</p> : null}
                          {item.description ? <p className="mt-2 text-sm leading-6 text-white/50">{item.description}</p> : null}
                        </div>
                      )) : <p className="text-sm text-white/50">No hay terpenos cargados para esta ficha.</p>}
                    </div>
                  </>
                ) : null}
                {expanded === "profile" ? (
                  <>
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-200/70">Perfil</p>
                    <p className="mt-3 text-lg text-white/80">{strain.profile || "Sin perfil cargado"}</p>
                    {flavors.length ? <div className="mt-4 flex flex-wrap gap-2">{flavors.map((item) => <span key={item.id} className="rounded-full bg-white/6 px-3 py-2 text-xs text-white/60">{item.flavor}{item.value != null ? ` · ${item.value}` : ""}</span>)}</div> : null}
                  </>
                ) : null}
                {expanded === "info" ? (
                  <>
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-200/70">Uso informativo</p>
                    <p className="mt-3 text-sm leading-6 text-white/58">La apariencia de un cogollo no alcanza para confirmar su genética. CLOUVA usa la foto original y la mejora visual como apoyo para encontrar similitudes, describir rasgos visibles y ordenar referencias.</p>
                  </>
                ) : null}
              </div>
            ) : null}

            {strain.description ? (
              <div className="mt-6 rounded-[28px] border border-white/8 bg-black/15 p-5">
                <div className="flex items-center gap-2 text-amber-200/70"><Leaf className="h-4 w-4" /><span className="text-xs uppercase tracking-[0.22em]">Data comunitaria</span></div>
                <p className="mt-3 text-sm leading-7 text-white/55">{strain.description}</p>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </main>
  );
}
