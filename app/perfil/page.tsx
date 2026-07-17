"use client";

import { MainNav } from "@/components/layout";
import { useAuth } from "@/components/auth-provider";
import { useActiveAvatarStore } from "@/lib/avatar-engine/active-avatar-store";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const EMPTY_FORM = {
  clouva_id: "",
  username: "",
  bio: "",
  accent_color: "#8f7cff",
  full_name: "",
  phone: "",
  spotify_url: "",
};

export default function PerfilPage() {
  const { user, profile, role, loading: authLoading, hydrationReady, profileReady } = useAuth();
  const router = useRouter();
  const activeAvatar = useActiveAvatarStore((state) => state.avatar);
  const loadActiveAvatar = useActiveAvatarStore((state) => state.loadActiveAvatar);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saved, setSaved] = useState(false);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);

  useEffect(() => {
    if (!hydrationReady || authLoading || !profileReady) return;
    if (!user) router.replace(`/login?error=${encodeURIComponent("Tu sesión venció. Iniciá sesión nuevamente.")}`);
  }, [authLoading, hydrationReady, profileReady, router, user]);

  useEffect(() => {
    if (!user) return;
    void loadActiveAvatar(user.id);

    let cancelled = false;
    setProfileLoading(true);
    setProfileError(null);

    void (async () => {
      try {
        const { supabase } = await import("@/lib/supabase");
        const { data, error } = await supabase
          .from("profiles")
          .select("clouva_id,username,bio,accent_color,full_name,phone,spotify_url")
          .eq("id", user.id)
          .maybeSingle();

        if (error) throw error;
        if (cancelled) return;

        setForm({
          clouva_id: data?.clouva_id ?? "",
          username: data?.username ?? "",
          bio: data?.bio ?? "",
          accent_color: data?.accent_color ?? "#8f7cff",
          full_name: data?.full_name ?? profile?.full_name ?? profile?.display_name ?? "",
          phone: data?.phone ?? "",
          spotify_url: data?.spotify_url ?? "",
        });
      } catch (error) {
        if (!cancelled) setProfileError(error instanceof Error ? error.message : "No se pudo cargar el perfil.");
      } finally {
        if (!cancelled) setProfileLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadActiveAvatar, profile?.display_name, profile?.full_name, user]);

  const save = async () => {
    if (!user) return;
    setSaved(false);
    setProfileError(null);
    const { supabase } = await import("@/lib/supabase");
    const { error } = await supabase.from("profiles").update(form).eq("id", user.id);
    if (error) {
      setProfileError(error.message);
      return;
    }
    setSaved(true);
  };

  const publicUrl = form.username ? `https://clouva.com.ar/u/${form.username}` : "";
  const avatarUrl = useMemo(
    () => activeAvatar.modelUrl || profile?.avatar_3d_url || null,
    [activeAvatar.modelUrl, profile?.avatar_3d_url],
  );

  const waitingForAuth = !hydrationReady || authLoading || !profileReady;
  if (waitingForAuth || (!user && hydrationReady)) {
    return (
      <main>
        <MainNav />
        <section className="mx-auto flex min-h-[60vh] w-full max-w-4xl items-center justify-center px-4 py-8">
          <div className="text-center">
            <div className="mx-auto mb-4 h-9 w-9 animate-spin rounded-full border-2 border-white/20 border-t-violet-400" />
            <p className="text-white/70">Cargando tu sesión y tu perfil…</p>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main>
      <MainNav />
      <section className="mx-auto w-full max-w-4xl px-4 py-6 sm:py-8">
        <div className="panel rounded-3xl p-4 sm:p-6">
          <h1 className="text-2xl font-semibold">Perfil</h1>

          {profileError ? (
            <div className="mt-4 rounded-2xl border border-rose-400/25 bg-rose-400/10 p-3 text-sm text-rose-200">
              {profileError}
            </div>
          ) : null}

          <div className="mt-4 flex flex-col items-center gap-4 sm:flex-row sm:items-start">
            <div className="w-full max-w-[200px] sm:max-w-[180px]">
              {avatarUrl ? (
                <model-viewer
                  src={avatarUrl}
                  alt="Tu avatar 3D"
                  camera-controls
                  auto-rotate
                  style={{ width: "100%", height: "200px", borderRadius: "1rem" }}
                />
              ) : (
                <div className="grid h-[200px] w-full place-items-center rounded-2xl border border-dashed border-white/20 text-center text-xs text-white/50">
                  Sin avatar 3D todavía
                </div>
              )}
            </div>
            <div className="flex-1">
              <p className="text-sm text-white/70">Tu avatar 3D y tu foto de perfil se administran desde Mi Flow.</p>
              <Link href="/mi-flow/avatar" className="mt-2 inline-block rounded-full border border-[#8f7cff]/40 px-4 py-2 text-sm">
                {avatarUrl ? "Editar avatar 3D" : "Crear avatar 3D"}
              </Link>
            </div>
          </div>

          {profileLoading ? (
            <p className="mt-6 text-sm text-white/55">Cargando los datos de tu perfil…</p>
          ) : (
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                Nombre
                <input className="mt-1 w-full rounded-xl border border-white/20 bg-transparent px-3 py-2" value={form.full_name} onChange={(event) => setForm((value) => ({ ...value, full_name: event.target.value }))} />
              </label>
              <label className="text-sm">
                Teléfono
                <input className="mt-1 w-full rounded-xl border border-white/20 bg-transparent px-3 py-2" value={form.phone} onChange={(event) => setForm((value) => ({ ...value, phone: event.target.value }))} />
              </label>
              <label className="text-sm">
                Username público
                <input className="mt-1 w-full rounded-xl border border-white/20 bg-transparent px-3 py-2" value={form.username} onChange={(event) => setForm((value) => ({ ...value, username: event.target.value.toLowerCase() }))} />
              </label>
              <label className="text-sm">
                Bio corta
                <input className="mt-1 w-full rounded-xl border border-white/20 bg-transparent px-3 py-2" value={form.bio} onChange={(event) => setForm((value) => ({ ...value, bio: event.target.value }))} />
              </label>
              <label className="text-sm sm:col-span-2">
                Link de Spotify (canción, álbum o playlist)
                <input placeholder="https://open.spotify.com/track/..." className="mt-1 w-full rounded-xl border border-white/20 bg-transparent px-3 py-2" value={form.spotify_url} onChange={(event) => setForm((value) => ({ ...value, spotify_url: event.target.value }))} />
              </label>
              <label className="text-sm">
                Accent color
                <input type="color" className="mt-1 h-10 w-full rounded-xl border border-white/20 bg-transparent p-1" value={form.accent_color} onChange={(event) => setForm((value) => ({ ...value, accent_color: event.target.value }))} />
              </label>
              <div className="text-sm">CLOUVA ID: <span className="text-white/70">{form.clouva_id || "pendiente"}</span></div>
              <div className="text-sm">Rol: <span className="rounded-full border border-white/20 px-2 py-0.5 text-xs">{role}</span></div>
              {publicUrl ? <div><img alt="QR" className="h-24 w-24" src={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(publicUrl)}`} /></div> : null}
            </div>
          )}

          <div className="mt-6 flex gap-2">
            <button onClick={() => void save()} disabled={profileLoading} className="rounded-full bg-[#8f7cff]/25 px-4 py-2 text-sm disabled:opacity-50">Guardar</button>
            <Link href="/perfil/configuracion" className="rounded-full border border-white/20 px-4 py-2 text-sm">Configuración</Link>
          </div>
          {saved ? <p className="mt-3 text-sm text-emerald-300">Perfil actualizado.</p> : null}
        </div>
      </section>
    </main>
  );
}
