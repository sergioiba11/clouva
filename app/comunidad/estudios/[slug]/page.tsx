"use client";
import { useEffect, useState, useCallback } from "react";
import { MainFooter, MainNav } from "@/components/layout";
import { useAuth } from "@/components/auth-provider";
import { PlayerCard } from "@/components/community/player-card";
import { SocialLinks } from "@/components/community/social-links";
import { StudioAdminPanel } from "@/components/community/studio-admin-panel";
import {
  getStudioPermission,
  parseSocialLinks,
  studioMemberSelect,
  type CommunityEvent,
  type CommunityProject,
  type Studio,
  type StudioMember,
} from "@/lib/community-data";

export default function StudioPage({ params }: { params: Promise<{ slug: string }> }) {
  const { user } = useAuth();
  const [slug, setSlug] = useState("");
  const [studio, setStudio] = useState<Studio | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [members, setMembers] = useState<StudioMember[]>([]);
  const [projects, setProjects] = useState<CommunityProject[]>([]);
  const [events, setEvents] = useState<CommunityEvent[]>([]);
  const [followerCount, setFollowerCount] = useState(0);
  const [isFollowing, setIsFollowing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [permission, setPermission] = useState<"owner" | "admin" | "none">("none");

  useEffect(() => {
    void params.then((v) => setSlug(v.slug));
  }, [params]);

  const load = useCallback(async () => {
    if (!slug) return;
    const { supabase } = await import("@/lib/supabase");
    const { data } = await supabase.from("studios").select("*").eq("slug", slug).maybeSingle();
    if (!data) {
      setNotFound(true);
      return;
    }
    const studioRow = data as Studio;
    setStudio(studioRow);

    const [{ data: membersData }, { data: projectsData }, { data: eventsData }, { count: followers }] = await Promise.all([
      supabase.from("studio_members").select(studioMemberSelect).eq("studio_id", studioRow.id).eq("status", "active"),
      supabase.from("community_projects").select("*").eq("studio_id", studioRow.id).order("release_date", { ascending: false }),
      supabase.from("community_events").select("*").eq("studio_id", studioRow.id).order("starts_at", { ascending: false }),
      supabase.from("studio_follows").select("*", { count: "exact", head: true }).eq("studio_id", studioRow.id),
    ]);
    setMembers((membersData ?? []) as StudioMember[]);
    setProjects((projectsData ?? []) as CommunityProject[]);
    setEvents((eventsData ?? []) as CommunityEvent[]);
    setFollowerCount(followers ?? 0);

    if (user) {
      const { data: f } = await supabase
        .from("studio_follows")
        .select("follower_id")
        .eq("follower_id", user.id)
        .eq("studio_id", studioRow.id)
        .maybeSingle();
      setIsFollowing(!!f);
      setPermission(await getStudioPermission(supabase, studioRow, user.id));
    } else {
      setIsFollowing(false);
      setPermission("none");
    }
  }, [slug, user]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleFollow = async () => {
    if (!user || !studio || busy) return;
    setBusy(true);
    const { supabase } = await import("@/lib/supabase");
    if (isFollowing) {
      await supabase.from("studio_follows").delete().eq("follower_id", user.id).eq("studio_id", studio.id);
    } else {
      await supabase.from("studio_follows").insert({ follower_id: user.id, studio_id: studio.id });
    }
    setBusy(false);
    void load();
  };

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
      <main>
        <MainNav />
        <section className="mx-auto max-w-4xl px-4 py-16">
          <p className="text-white/60">No encontramos ese estudio.</p>
        </section>
        <MainFooter />
      </main>
    );
  }

  if (!studio) {
    return (
      <main>
        <MainNav />
        <section className="mx-auto max-w-4xl px-4 py-16">
          <p className="text-white/60">Cargando...</p>
        </section>
        <MainFooter />
      </main>
    );
  }

  const upcomingEvents = events.filter((e) => new Date(e.starts_at) >= new Date());
  const pastEvents = events.filter((e) => new Date(e.starts_at) < new Date());
  const socialLinks = parseSocialLinks(studio.social_links);

  return (
    <main>
      <MainNav />
      <section className="mx-auto max-w-5xl px-4 py-8 sm:py-10">
        <div className="panel overflow-hidden rounded-3xl">
          <div className="relative aspect-[21/9] bg-white/[0.04]">
            {studio.cover_url ? (
              <img src={studio.cover_url} alt={studio.name} className="h-full w-full object-cover" />
            ) : null}
            {studio.logo_url ? (
              <img
                src={studio.logo_url}
                alt={`${studio.name} logo`}
                className="absolute bottom-4 left-4 h-20 w-20 rounded-2xl border border-white/20 bg-black/50 object-cover"
              />
            ) : null}
          </div>
          <div className="p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h1 className="text-3xl font-semibold">{studio.name}</h1>
                <p className="mt-1 text-sm text-white/50">
                  {[studio.city, studio.country].filter(Boolean).join(", ")}
                  {studio.founded_year ? ` · desde ${studio.founded_year}` : ""}
                </p>
              </div>
              <div className="flex gap-2">
                {user ? (
                  <button
                    onClick={toggleFollow}
                    disabled={busy}
                    className={`rounded-full px-4 py-2 text-sm font-medium ${isFollowing ? "border border-white/20" : "bg-[#8f7cff] text-black"}`}
                  >
                    {isFollowing ? "Siguiendo" : "Seguir"}
                  </button>
                ) : null}
                <button onClick={share} className="rounded-full border border-white/20 px-4 py-2 text-sm font-medium">
                  Compartir
                </button>
              </div>
            </div>

            {studio.description ? <p className="mt-4 text-sm text-white/70">{studio.description}</p> : null}

            <div className="mt-4 flex flex-wrap gap-4 text-xs text-white/50">
              <span>{members.length} integrantes</span>
              <span>{projects.length} proyectos</span>
              <span>{followerCount} seguidores</span>
              {studio.website_url ? (
                <a href={studio.website_url} target="_blank" rel="noreferrer" className="text-[#95d8ff]">
                  Sitio web
                </a>
              ) : null}
            </div>

            {socialLinks.length > 0 ? (
              <div className="mt-4">
                <SocialLinks links={socialLinks} />
              </div>
            ) : null}
          </div>
        </div>

        {permission !== "none" ? (
          <div className="mt-6">
            <StudioAdminPanel studio={studio} members={members} onChange={load} />
          </div>
        ) : null}

        <div className="mt-8">
          <h2 className="text-xl font-semibold">Integrantes</h2>
          {members.length === 0 ? (
            <p className="mt-3 text-sm text-white/50">Todavía no hay integrantes cargados.</p>
          ) : (
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {members.map((member) =>
                member.profiles?.username ? (
                  <PlayerCard
                    key={member.id}
                    username={member.profiles.username}
                    name={member.profiles.full_name || member.profiles.display_name || `@${member.profiles.username}`}
                    avatarUrl={member.profiles.avatar_url}
                    role={member.role}
                    city={member.profiles.city}
                  />
                ) : null,
              )}
            </div>
          )}
        </div>

        {projects.length > 0 ? (
          <div className="mt-8">
            <h2 className="text-xl font-semibold">Proyectos</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {projects.map((project) => (
                <div key={project.id} className="panel overflow-hidden rounded-2xl">
                  <div className="aspect-square bg-white/[0.04]">
                    {project.cover_url ? (
                      <img src={project.cover_url} alt={project.title} className="h-full w-full object-cover" />
                    ) : null}
                  </div>
                  <div className="p-4">
                    <h3 className="font-medium">{project.title}</h3>
                    {project.release_date ? <p className="mt-1 text-xs text-white/45">{project.release_date}</p> : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {(upcomingEvents.length > 0 || pastEvents.length > 0) ? (
          <div className="mt-8">
            <h2 className="text-xl font-semibold">Eventos</h2>
            {upcomingEvents.length > 0 ? (
              <div className="mt-4">
                <p className="text-xs uppercase tracking-[0.2em] text-white/45">Próximos</p>
                <div className="mt-2 space-y-2">
                  {upcomingEvents.map((event) => (
                    <div key={event.id} className="panel rounded-2xl p-4">
                      <p className="font-medium">{event.title}</p>
                      <p className="mt-1 text-xs text-white/50">
                        {new Date(event.starts_at).toLocaleDateString("es-AR")}
                        {event.city ? ` · ${event.city}` : ""}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {pastEvents.length > 0 ? (
              <div className="mt-4">
                <p className="text-xs uppercase tracking-[0.2em] text-white/45">Anteriores</p>
                <div className="mt-2 space-y-2 opacity-70">
                  {pastEvents.map((event) => (
                    <div key={event.id} className="panel rounded-2xl p-4">
                      <p className="font-medium">{event.title}</p>
                      <p className="mt-1 text-xs text-white/50">{new Date(event.starts_at).toLocaleDateString("es-AR")}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
      <MainFooter />
    </main>
  );
}
