"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AvatarPlaceholder, PublicShell } from "@/components/public/PublicShell";
import { studioPlayersSelect, type StudioPlayer, type StudioRow } from "@/lib/players-data";
import { parseSocialLinks, type CommunityProject } from "@/lib/community-data";

export default function StudioProfilePage({ params }: { params: Promise<{ slug: string }> }) {
  const [slug, setSlug] = useState("");
  const [studio, setStudio] = useState<(StudioRow & { social_links: unknown; website_url: string | null }) | null>(null);
  const [players, setPlayers] = useState<StudioPlayer[]>([]);
  const [projects, setProjects] = useState<CommunityProject[]>([]);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    void params.then((v) => setSlug(v.slug));
  }, [params]);

  useEffect(() => {
    if (!slug) return;
    void (async () => {
      const { supabase } = await import("@/lib/supabase");
      const { data } = await supabase.from("studios").select("*").eq("slug", slug).maybeSingle();
      if (!data) {
        setNotFound(true);
        return;
      }
      setStudio(data as StudioRow & { social_links: unknown; website_url: string | null });

      const [{ data: playerLinks }, { data: projectRows }] = await Promise.all([
        supabase.from("player_studios").select(studioPlayersSelect).eq("studio_id", data.id).eq("is_visible", true).order("display_order"),
        supabase.from("community_projects").select("*").eq("studio_id", data.id).eq("is_published", true).order("release_date", { ascending: false }),
      ]);
      setPlayers((playerLinks ?? []) as unknown as StudioPlayer[]);
      setProjects((projectRows ?? []) as CommunityProject[]);
    })();
  }, [slug]);

  const share = async () => {
    const url = window.location.href;
    if (navigator.share) {
      await navigator.share({ title: studio?.name, url }).catch(() => {});
    } else {
      await navigator.clipboard.writeText(url);
    }
  };

  if (notFound) {
    return (
      <PublicShell brand="ESTUDIOS" navLinks={[{ label: "La Matrix", href: "/matrix" }]}>
        <section className="mx-auto max-w-3xl px-4 py-20 text-center text-white/60">No encontramos ese estudio.</section>
      </PublicShell>
    );
  }

  if (!studio) {
    return (
      <PublicShell brand="ESTUDIOS">
        <section className="mx-auto max-w-3xl px-4 py-20 text-center text-white/50">Cargando...</section>
      </PublicShell>
    );
  }

  const socialLinks = parseSocialLinks(studio.social_links);

  return (
    <PublicShell
      brand={studio.name}
      brandHref={`/studios/${studio.slug}`}
      navLinks={[
        { label: "Players", href: `/studios/${studio.slug}#players` },
        { label: "Proyectos", href: `/studios/${studio.slug}#proyectos` },
      ]}
    >
      <section className="relative">
        <div className="relative h-64 w-full bg-white/[0.03] sm:h-80">
          {studio.cover_url ? (
            <img src={studio.cover_url} alt={studio.name} className="h-full w-full object-cover" />
          ) : (
            <AvatarPlaceholder label={studio.name} className="h-full w-full text-7xl" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-[#07060b] via-[#07060b]/40 to-transparent" />
        </div>
        <div className="mx-auto max-w-5xl px-4 pb-6 sm:px-6">
          <div className="-mt-14 flex flex-wrap items-end justify-between gap-4">
            <div className="flex items-end gap-4">
              {studio.logo_url ? (
                <img src={studio.logo_url} alt={studio.name} className="h-24 w-24 rounded-2xl border-4 border-[#07060b] object-cover" />
              ) : (
                <AvatarPlaceholder label={studio.name} className="h-24 w-24 rounded-2xl border-4 border-[#07060b] text-3xl" />
              )}
              <div>
                <h1 className="text-3xl font-bold">{studio.name}</h1>
                <p className="text-sm text-white/50">{[studio.city, studio.country].filter(Boolean).join(", ")}</p>
              </div>
            </div>
            <button onClick={share} className="rounded-full border border-white/20 px-4 py-2 text-sm font-medium">
              Compartir
            </button>
          </div>
        </div>
      </section>

      {studio.description ? (
        <section className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
          <p className="max-w-2xl text-sm leading-relaxed text-white/70">{studio.description}</p>
          {socialLinks.length > 0 || studio.website_url ? (
            <div className="mt-4 flex flex-wrap gap-3 text-sm">
              {studio.website_url ? (
                <a href={studio.website_url} target="_blank" rel="noreferrer" className="text-[#95d8ff]">
                  Sitio web
                </a>
              ) : null}
              {socialLinks.map((link) => (
                <a key={link.url} href={link.url} target="_blank" rel="noreferrer" className="text-[#95d8ff] capitalize">
                  {link.platform}
                </a>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      <section id="players" className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <h2 className="text-xl font-semibold">Players</h2>
        {players.length === 0 ? (
          <p className="mt-3 text-sm text-white/50">Todavía no hay Players cargados.</p>
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {players.map((entry, i) =>
              entry.player ? (
                <Link
                  key={i}
                  href={`/players/${entry.player.slug}`}
                  className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 transition hover:border-[#8f7cff]/50"
                >
                  {entry.player.profile_image_url ? (
                    <img src={entry.player.profile_image_url} alt={entry.player.display_name} className="h-12 w-12 rounded-xl object-cover" />
                  ) : (
                    <AvatarPlaceholder label={entry.player.display_name} className="h-12 w-12 rounded-xl" />
                  )}
                  <div>
                    <p className="font-medium">{entry.player.display_name}</p>
                    <p className="text-xs text-white/50">{entry.role || entry.player.primary_role}</p>
                  </div>
                </Link>
              ) : null,
            )}
          </div>
        )}
      </section>

      {projects.length > 0 ? (
        <section id="proyectos" className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
          <h2 className="text-xl font-semibold">Proyectos</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => (
              <div key={project.id} className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
                <div className="aspect-square bg-white/[0.04]">
                  {project.cover_url ? <img src={project.cover_url} alt={project.title} className="h-full w-full object-cover" /> : null}
                </div>
                <div className="p-4">
                  <h3 className="font-medium">{project.title}</h3>
                  {project.release_date ? <p className="mt-1 text-xs text-white/45">{project.release_date}</p> : null}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </PublicShell>
  );
}
