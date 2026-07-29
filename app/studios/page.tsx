"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AvatarPlaceholder, PublicShell } from "@/components/public/PublicShell";
import type { StudioRow } from "@/lib/players-data";

export default function StudiosDirectoryPage() {
  const [studios, setStudios] = useState<StudioRow[] | null>(null);

  useEffect(() => {
    void (async () => {
      const { supabase } = await import("@/lib/supabase");
      const { data } = await supabase
        .from("studios")
        .select("id,slug,name,logo_url,cover_url,description,city,country")
        .order("name");
      setStudios((data ?? []) as StudioRow[]);
    })();
  }, []);

  return (
    <PublicShell brand="ESTUDIOS" navLinks={[{ label: "La Matrix", href: "/matrix" }, { label: "Players", href: "/players" }]}>
      <section className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
        <h1 className="text-3xl font-semibold">Estudios</h1>
        <p className="mt-2 text-white/60">Estudios, sellos, colectivos y espacios creativos.</p>

        {studios === null ? (
          <p className="mt-8 text-sm text-white/50">Cargando...</p>
        ) : studios.length === 0 ? (
          <p className="mt-8 text-sm text-white/50">Todavía no hay estudios publicados.</p>
        ) : (
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {studios.map((studio) => (
              <Link
                key={studio.id}
                href={`/studios/${studio.slug}`}
                className="group rounded-3xl border border-white/10 bg-white/[0.03] p-5 transition hover:-translate-y-1 hover:border-[#8f7cff]/50"
              >
                {studio.cover_url ? (
                  <img src={studio.cover_url} alt={studio.name} className="h-32 w-full rounded-2xl object-cover" />
                ) : (
                  <AvatarPlaceholder label={studio.name} className="h-32 w-full rounded-2xl text-3xl" />
                )}
                <h2 className="mt-4 text-lg font-semibold">{studio.name}</h2>
                <p className="text-sm text-white/50">{[studio.city, studio.country].filter(Boolean).join(", ")}</p>
                {studio.description ? <p className="mt-2 text-sm text-white/60 line-clamp-2">{studio.description}</p> : null}
              </Link>
            ))}
          </div>
        )}
      </section>
    </PublicShell>
  );
}
