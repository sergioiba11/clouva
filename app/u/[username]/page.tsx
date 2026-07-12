"use client";
import { useEffect, useState } from "react";
import { MainFooter, MainNav } from "@/components/layout";
import { useAuth } from "@/components/auth-provider";
import { spotifyEmbedUrl } from "@/lib/spotify";

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
};

export default function Page({ params }: { params: Promise<{ username: string }> }) {
  const { user } = useAuth();
  const [username, setUsername] = useState("");
  const [p, setP] = useState<PublicProfile | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [followersCount, setFollowersCount] = useState(0);
  const [isFollowing, setIsFollowing] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void params.then((v) => setUsername(v.username));
  }, [params]);

  const load = async () => {
    if (!username) return;
    const { supabase } = await import("@/lib/supabase");
    const { data } = await supabase
      .from("profiles")
      .select("id,full_name,avatar_url,avatar_3d_url,is_vip,clouva_id,username,bio,spotify_url,accent_color")
      .eq("username", username)
      .maybeSingle();
    if (!data) {
      setNotFound(true);
      return;
    }
    setP(data as PublicProfile);

    const { count } = await supabase.from("follows").select("*", { count: "exact", head: true }).eq("followed_id", data.id);
    setFollowersCount(count ?? 0);

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
                  <p className="text-sm text-white/50">@{p.username}</p>
                  <p className="mt-1 text-xs text-white/40">{p.clouva_id}</p>
                  {p.bio ? <p className="mt-3 text-sm text-white/70">{p.bio}</p> : null}
                  {p.is_vip ? <p className="mt-2 text-amber-300">VIP</p> : null}
                  <p className="mt-3 text-xs text-white/50">{followersCount} seguidores</p>
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
          </div>
        )}
      </section>
      <MainFooter />
    </main>
  );
}
