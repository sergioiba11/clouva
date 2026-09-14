"use client";

import Link from "next/link";
import { Camera, Heart, Leaf, ScanSearch, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { StrainCard, type StrainRecord } from "@/components/player-plus18/GeneticsUI";
import { supabase } from "@/lib/supabase";

type ViewRow = { strain_id: string; viewed_at: string };

export default function MyCocosPage() {
  const { user } = useAuth();
  const [strains, setStrains] = useState<StrainRecord[]>([]);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      const strainQuery = await supabase
        .from("cannabis_strains")
        .select("id,slug,name,subtitle,description,strain_type,hero_image,profile,tags,aromas,is_featured,is_published")
        .eq("is_published", true)
        .order("is_featured", { ascending: false })
        .order("name", { ascending: true });

      if (strainQuery.error) {
        if (!cancelled) {
          setError(strainQuery.error.message);
          setLoading(false);
        }
        return;
      }

      const nextStrains = (strainQuery.data ?? []) as StrainRecord[];
      let nextFavorites = new Set<string>();
      let nextRecent: string[] = [];

      if (user) {
        const [favoritesResult, recentResult] = await Promise.all([
          supabase.from("user_strain_favorites").select("strain_id").eq("user_id", user.id),
          supabase
            .from("user_strain_views")
            .select("strain_id,viewed_at")
            .eq("user_id", user.id)
            .order("viewed_at", { ascending: false })
            .limit(8),
        ]);

        if (!favoritesResult.error) {
          nextFavorites = new Set((favoritesResult.data ?? []).map((row) => row.strain_id as string));
        }
        if (!recentResult.error) {
          nextRecent = ((recentResult.data ?? []) as ViewRow[]).map((row) => row.strain_id);
        }
      }

      if (!cancelled) {
        setStrains(nextStrains);
        setFavoriteIds(nextFavorites);
        setRecentIds(nextRecent);
        setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const saved = useMemo(() => strains.filter((strain) => favoriteIds.has(strain.id)), [favoriteIds, strains]);
  const recent = useMemo(
    () => recentIds.map((id) => strains.find((strain) => strain.id === id)).filter((strain): strain is StrainRecord => Boolean(strain)),
    [recentIds, strains],
  );
  const pineapple = strains.find((strain) => strain.slug === "pineapple") ?? null;

  return (
    <main className="relative min-h-[100dvh] overflow-hidden px-4 pb-10 pt-[calc(env(safe-area-inset-top)+24px)] sm:px-6">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_76%_4%,rgba(246,166,47,.18),transparent_26%),radial-gradient(circle_at_8%_22%,rgba(64,133,69,.22),transparent_32%),linear-gradient(180deg,#082518_0%,#03150d_36%,#02100a_100%)]" />
      <div className="pointer-events-none absolute -right-16 top-16 h-72 w-72 rounded-full border border-emerald-200/5 bg-emerald-400/5 blur-3xl" />

      <div className="relative mx-auto max-w-6xl">
        <header className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.3em] text-amber-200/70">
              <Leaf className="h-4 w-4" /> Player +18 · Genetics
            </div>
            <h1 className="mt-3 font-serif text-4xl text-[#fff7e6] sm:text-5xl">Mis cocos</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-white/55">Guardá genéticas, revisá tus scans y compará tus fotos con referencias visuales sin convertir la coincidencia en una identificación exacta.</p>
          </div>
          <Link href="/player/plus18/escanear" className="hidden items-center gap-2 rounded-2xl bg-amber-300 px-4 py-3 text-sm font-semibold text-[#172014] shadow-[0_12px_40px_rgba(246,166,47,.18)] sm:flex">
            <Camera className="h-4 w-4" /> Escanear
          </Link>
        </header>

        <section className="mt-8 overflow-hidden rounded-[32px] border border-amber-100/12 bg-white/[0.035] p-5 backdrop-blur-2xl sm:p-7">
          <div className="grid gap-6 lg:grid-cols-[1.1fr_.9fr] lg:items-center">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-amber-200/15 bg-amber-300/8 px-3 py-1.5 text-xs text-amber-100/75">
                <Sparkles className="h-4 w-4 text-amber-300" /> Tu acceso rápido
              </div>
              <h2 className="mt-4 text-2xl font-semibold sm:text-3xl">Foto → mejora visual → coincidencias</h2>
              <p className="mt-3 text-sm leading-6 text-white/55">La imagen mejorada se usa como apoyo junto con la original para leer mejor estructura, pistilos, tricomas y color sin reemplazar el coco real.</p>
              <div className="mt-5 flex flex-wrap gap-3">
                <Link href="/player/plus18/escanear" className="inline-flex items-center gap-2 rounded-2xl bg-amber-300 px-4 py-3 text-sm font-semibold text-[#172014]">
                  <ScanSearch className="h-4 w-4" /> Escanear un coco
                </Link>
                {pineapple ? (
                  <Link href="/player/plus18/cocos/pineapple" className="inline-flex items-center gap-2 rounded-2xl border border-white/12 bg-white/5 px-4 py-3 text-sm text-white/80">
                    <Leaf className="h-4 w-4 text-[#91cd7c]" /> Abrir Pineapple
                  </Link>
                ) : null}
              </div>
            </div>
            <div className="relative min-h-52 overflow-hidden rounded-[26px] border border-white/10 bg-[radial-gradient(circle_at_50%_20%,rgba(247,168,49,.34),transparent_24%),radial-gradient(circle_at_25%_65%,rgba(86,163,83,.3),transparent_34%),linear-gradient(145deg,#1e4d2d,#071a11_60%,#031009)]">
              <div className="absolute inset-0 opacity-30 [background-image:radial-gradient(circle_at_18%_20%,#fff_0_1px,transparent_1.5px),radial-gradient(circle_at_75%_32%,#ffd98d_0_1px,transparent_1.5px)] [background-size:44px_44px,61px_61px]" />
              <div className="absolute inset-0 flex items-center justify-center">
                <Leaf className="h-28 w-28 text-[#9cce7d]/65 drop-shadow-[0_0_30px_rgba(153,206,125,.22)]" strokeWidth={1} />
              </div>
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-amber-200/65">Player +18</p>
                <p className="mt-1 text-lg font-medium">Tu biblioteca viva de genéticas</p>
              </div>
            </div>
          </div>
        </section>

        {error ? <div className="mt-6 rounded-2xl border border-rose-300/15 bg-rose-300/8 p-4 text-sm text-rose-100">{error}</div> : null}

        <section className="mt-10">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-amber-200/60">Guardadas</p>
              <h2 className="mt-1 text-2xl font-semibold">Mis genéticas</h2>
            </div>
            <Heart className="h-5 w-5 text-amber-300" />
          </div>
          {loading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2].map((item) => <div key={item} className="h-60 animate-pulse rounded-[28px] border border-white/8 bg-white/5" />)}
            </div>
          ) : saved.length ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {saved.map((strain) => <StrainCard key={strain.id} strain={strain} saved />)}
            </div>
          ) : (
            <div className="rounded-[26px] border border-dashed border-white/12 bg-white/[0.025] p-6 text-sm leading-6 text-white/50">Todavía no guardaste genéticas. Abrí Pineapple o cualquier ficha y tocá <strong className="text-white/75">Guardar</strong>.</div>
          )}
        </section>

        {recent.length ? (
          <section className="mt-10">
            <p className="text-xs uppercase tracking-[0.24em] text-amber-200/60">Historial</p>
            <h2 className="mt-1 text-2xl font-semibold">Vistas recientemente</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {recent.slice(0, 6).map((strain) => <StrainCard key={strain.id} strain={strain} saved={favoriteIds.has(strain.id)} />)}
            </div>
          </section>
        ) : null}

        <section className="mt-10">
          <p className="text-xs uppercase tracking-[0.24em] text-amber-200/60">Biblioteca</p>
          <h2 className="mt-1 text-2xl font-semibold">Explorar genéticas</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {strains.map((strain) => <StrainCard key={strain.id} strain={strain} saved={favoriteIds.has(strain.id)} />)}
          </div>
        </section>
      </div>
    </main>
  );
}
