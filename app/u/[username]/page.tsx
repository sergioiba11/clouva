"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MainFooter, MainNav } from "@/components/layout";
import { useAuth } from "@/components/auth-provider";
import { spotifyEmbedUrl } from "@/lib/spotify";
import { SocialLinks } from "@/components/community/social-links";
import { ExternalLinkButtons } from "@/components/community/link-buttons";
import { AchievementsRow, type AchievementStats } from "@/components/community/achievements-row";
import {
  parseSocialLinks,
  type CommunityEvent,
  type CommunityGalleryItem,
  type CommunityProject,
} from "@/lib/community-data";

type PublicProfile = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  avatar_3d_url: string | null;
  is_vip: boolean | null;
  clouva_id: string | null;
  username: string | null;
  bio: string | null;
  spotify_url: string | null;
  accent_color: string | null;
  city: string | null;
  email: string | null;
  social_links: unknown;
  created_at: string | null;
};

export default function Page({ params }: { params: Promise<{ username: string }> }) {
  const { user } = useAuth();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [p, setP] = useState<PublicProfile | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [followersCount, setFollowersCount] = useState(0);
  const [isFollowing, setIsFollowing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [projects, setProjects] = useState<CommunityProject[]>([]);
  const [gallery, setGallery] = useState<CommunityGalleryItem[]>([]);
  const [events, setEvents] = useState<CommunityEvent[]>([]);
  const [collaborations, setCollaborations] = useState(0);

  useEffect(() => {
    void params.then((v) => setUsername(v.username));
  }, [params]);

  const load = async () => {
    if (!username) return;
    const { supabase } = await import("@/lib/supabase");
    const { data } = await supabase
      .from("profiles")
      .select("id,full_name,avatar_url,avatar_3d_url,is_vip,clouva_id,username,bio,spotify_url,accent_color,city,email,social_links,created_at")
      .eq("username", username)
      .maybeSingle();
    if (!data) {
      setNotFound(true);
      return;
    }

    const { data: player } = await supabase
      .from("players")
      .select("slug,is_published,publication_status")
      .eq("owner_user_id", data.id)
      .maybeSingle();
    const playerPublished = player?.is_published === true || player?.publication_status === "published";
    if (player?.slug && playerPublished) {
      router.replace(`/${encodeURIComponent(player.slug)}`);
      return;
    }

    setP(data as PublicProfile);

    const [
      { count },
      { data: projectsData },
      { data: galleryData },
      { data: eventsData },
      { count: collabCount },
    ] = await Promise.all([
      supabase.from("follows").select("*", { count: "exact", head: true }).eq("followed_id", data.id),
      supabase.from("community_projects").select("*").eq("owner_profile_id", data.id).order("release_date", { ascending: false }),
      supabase.from("community_gallery_items").select("*").eq("owner_profile_id", data.id).order("sort_order", { ascending: true }),
      supabase.from("community_events").select("*").eq("owner_profile_id", data.id).order("starts_at", { ascending: false }),
      supabase.from("studio_members").select("*", { count: "exact", head: true }).eq("profile_id", data.id),
    ]);
    setFollowersCount(count ?? 0);
    setProjects((projectsData ?? []) as CommunityProject[]);
    setGallery((galleryData ?? []) as CommunityGalleryItem[]);
    setEvents((eventsData ?? []) as CommunityEvent[]);
    setCollaborations(collabCount ?? 0);

    if (user) {
      const { data: f } = await supabase.from("follows").select("follower_id").eq("follower_id", user.id).eq("followed_id", data.id).maybeSingle();
      setIsFollowing(!!f);
    }
  };

  useEffect(() => {
    void load();
  }, [username, user]);

  const toggleFollow = async () => {
    if (!user || !p || busy) return;
    setBusy(true);
    const { supabase } = await import("@/lib/supabase");
    if (isFollowing) {
      await supabase.from("follows").delete().eq("follower_id", user.id).eq("followed_id", p.id);
    } else {
      await supabase.from("follows").insert({ follower_id: user.id, followed_id: p.id });
    }
    setBusy(false);
    void load();
  };

  const embedUrl = spotifyEmbedUrl(p?.spotify_url);
  const socialLinks = p ? parseSocialLinks(p.social_links) : [];
  const upcomingEvents = events.filter((e) => new Date(e.starts_at) >= new Date());
  const pastEvents = events.filter((e) => new Date(e.starts_at) < new Date());
  const aniosActivo = p?.created_at ? Math.max(0, new Date().getFullYear() - new Date(p.created_at).getFullYear()) : 0;
  const achievementStats: AchievementStats = {
    temasPublicados: projects.length,
    aniosActivo,
    seguidores: followersCount,
    colaboraciones: collaborations,
  };

  return (
    <main>
      <MainNav />
      <section className="mx-auto max-w-4xl px-4 py-8 sm:py-10">
        {notFound ? (
          <p className="text-white/60">No encontramos ese perfil.</p>
        ) : !p ? (
          <p>Cargando...</p>
        ) : (
          <div className="space-y-5">
            <div className="panel rounded-3xl border p-4 sm:p-6" style={{ borderColor: `${p.accent_color ?? "#8f7cff"}66` }}>
              <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
                <div className="w-full max-w-[220px]">
                  {p.avatar_3d_url ? (
                    <model-viewer
                      src={p.avatar_3d_url}
                      alt={p.full_name ?? "Avatar"}
                      camera-controls
                      auto-rotate
                      style={{ width: "100%", height: "220px", borderRadius: "1rem" }}
                    />
                  ) : p.avatar_url ? (
                    <img src={p.avatar_url} alt={p.full_name ?? "Avatar"} className="h-[220px] w-full rounded-2xl object-cover" />
                  ) : (
                    <div className="grid h-[220px] w-full place-items-center rounded-2xl border border-dashed border-white/20 text-sm text-white/40">Sin avatar</div>
                  )}
                </div>
                <div className="flex-1">
                  <h1 className="text-2xl font-semibold">{p.full_name || `@${p.username}`}</h1>
                  <p className="text-sm text-white/50">@{p.username}{p.city ? ` · ${p.city}` : ""}</p>
                  <p className="mt-1 text-xs text-white/40">{p.clouva_id}</p>
                  {p.bio ? <p className="mt-3 text-sm text-white/70">{p.bio}</p> : null}
                  {p.is_vip ? <p className="mt-2 text-amber-300">VIP</p> : null}
                  <p className="mt-3 text-xs text-white/50">{followersCount} seguidores</p>
                  {socialLinks.length > 0 ? (
                    <div className="mt-3">
                      <SocialLinks links={socialLinks} />
                    </div>
                  ) : null}
                  {user && user.id !== p.id ? (
                    <button
                      onClick={toggleFollow}
                      disabled={busy}
                      className={`mt-3 rounded-full px-4 py-2 text-sm font-medium ${isFollowing ? "border border-white/20" : "bg-[#8f7cff] text-black"}`}
                    >
                      {isFollowing ? "Siguiendo" : "Seguir"}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>

            {embedUrl ? (
              <div className="panel overflow-hidden rounded-3xl">
                <iframe src={embedUrl} width="100%" height="152" style={{ border: "none" }} allow="encrypted-media" loading="lazy" />
              </div>
            ) : null}

            <AchievementsRow stats={achievementStats} />

            {projects.length > 0 ? (
              <div>
                <h2 className="text-lg font-semibold">Proyectos</h2>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  {projects.map((project) => (
                    <div key={project.id} className="panel overflow-hidden rounded-2xl">
                      {project.cover_url ? (
                        <div className="aspect-video bg-white/[0.04]">
                          <img src={project.cover_url} alt={project.title} className="h-full w-full object-cover" />
                        </div>
                      ) : null}
                      <div className="p-4">
                        <h3 className="font-medium">{project.title}</h3>
                        {project.release_date ? <p className="mt-1 text-xs text-white/45">{project.release_date}</p> : null}
                        {project.description ? <p className="mt-2 text-sm text-white/60">{project.description}</p> : null}
                        <ExternalLinkButtons project={project} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {gallery.length > 0 ? (
              <div>
                <h2 className="text-lg font-semibold">Galería</h2>
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {gallery.map((item) => (
                    <div key={item.id} className="aspect-square overflow-hidden rounded-2xl bg-white/[0.04]">
                      {item.media_type === "video" ? (
                        <video src={item.media_url} className="h-full w-full object-cover" controls />
                      ) : (
                        <img src={item.media_url} alt={item.caption ?? ""} className="h-full w-full object-cover" />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {upcomingEvents.length > 0 || pastEvents.length > 0 ? (
              <div>
                <h2 className="text-lg font-semibold">Eventos</h2>
                {upcomingEvents.length > 0 ? (
                  <div className="mt-3 space-y-2">
                    <p className="text-xs uppercase tracking-[0.15em] text-white/45">Próximos</p>
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
                ) : null}
                {pastEvents.length > 0 ? (
                  <div className="mt-3 space-y-2 opacity-70">
                    <p className="text-xs uppercase tracking-[0.15em] text-white/45">Anteriores</p>
                    {pastEvents.map((event) => (
                      <div key={event.id} className="panel rounded-2xl p-4">
                        <p className="font-medium">{event.title}</p>
                        <p className="mt-1 text-xs text-white/50">{new Date(event.starts_at).toLocaleDateString("es-AR")}</p>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {p.email ? (
              <div className="panel rounded-2xl p-4">
                <h2 className="text-sm font-semibold">Contacto</h2>
                <a href={`mailto:${p.email}`} className="mt-1 inline-block text-sm text-[#95d8ff]">
                  {p.email}
                </a>
              </div>
            ) : null}
          </div>
        )}
      </section>
      <MainFooter />
    </main>
  );
}
