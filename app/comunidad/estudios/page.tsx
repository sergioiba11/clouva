"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { MainFooter, MainNav } from "@/components/layout";
import { StudioCard } from "@/components/community/studio-card";
import type { Studio } from "@/lib/community-data";

type StudioWithCounts = Studio & { memberCount: number; projectCount: number };

export default function EstudiosPage() {
  const [studios, setStudios] = useState<StudioWithCounts[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const { supabase } = await import("@/lib/supabase");
      const { data } = await supabase
        .from("studios")
        .select("*, studio_members(count), community_projects(count)")
        .order("created_at", { ascending: false });
      const rows = (data ?? []) as unknown as (Studio & {
        studio_members: { count: number }[];
        community_projects: { count: number }[];
      })[];
      setStudios(
        rows.map((row) => ({
          ...row,
          memberCount: row.studio_members?.[0]?.count ?? 0,
          projectCount: row.community_projects?.[0]?.count ?? 0,
        })),
      );
      setLoading(false);
    })();
  }, []);

  return (
    <main>
      <MainNav />
      <section className="mx-auto max-w-7xl px-4 py-14 md:px-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-4xl font-semibold">Estudios</h1>
            <p className="mt-2 text-sm text-white/60">Sellos, colectivos y comunidades creativas dentro de CLOUVA.</p>
          </div>
          <Link
            href="/comunidad/estudios/nuevo"
            className="rounded-full bg-[#8f7cff] px-5 py-2.5 text-sm font-medium text-black"
          >
            Crear estudio
          </Link>
        </div>

        {loading ? (
          <p className="mt-10 text-white/50">Cargando...</p>
        ) : studios.length === 0 ? (
          <p className="mt-10 text-white/50">Todavía no hay estudios creados.</p>
        ) : (
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {studios.map((studio) => (
              <StudioCard
                key={studio.id}
                studio={studio}
                memberCount={studio.memberCount}
                projectCount={studio.projectCount}
              />
            ))}
          </div>
        )}
      </section>
      <MainFooter />
    </main>
  );
}
