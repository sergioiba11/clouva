"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { useActiveAvatarStore } from "@/lib/avatar-engine/active-avatar-store";

type AvatarRecord = {
  id: string;
  name: string;
  status: string;
  model_url: string | null;
  preview_image_url: string | null;
  is_active: boolean;
  front_rotation_y: number | null;
  created_at: string;
  updated_at: string;
};

export function AvatarLibrary() {
  const { session } = useAuth();
  const setActiveAvatar = useActiveAvatarStore((state) => state.setActiveAvatar);
  const [avatars, setAvatars] = useState<AvatarRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchLibrary = async () => {
    if (!session?.access_token) return [] as AvatarRecord[];
    const response = await fetch("/api/avatar/library", {
      headers: { Authorization: `Bearer ${session.access_token}` },
      cache: "no-store",
    });
    const data = await response.json();
    if (!response.ok || data.error) throw new Error(data.error || "No se pudo cargar la biblioteca.");
    const next = data.avatars ?? [];
    setAvatars(next);
    return next as AvatarRecord[];
  };

  const refresh = async () => {
    if (!session?.access_token) return;
    setLoading(true);
    setError(null);
    try {
      const current = await fetchLibrary();
      if (current.some((avatar) => avatar.status === "generating")) {
        setSyncing(true);
        const syncResponse = await fetch("/api/avatar/sync", {
          method: "POST",
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const syncData = await syncResponse.json();
        if (!syncResponse.ok || syncData.error) throw new Error(syncData.error || "No se pudo actualizar la generación.");
        await fetchLibrary();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar la biblioteca.");
    } finally {
      setSyncing(false);
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [session?.access_token]);

  const activate = async (avatar: AvatarRecord) => {
    if (!session?.access_token || !avatar.model_url || avatar.status !== "ready") return;
    setActivatingId(avatar.id);
    setError(null);
    try {
      const response = await fetch("/api/avatar/library", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ avatarId: avatar.id }),
      });
      const data = await response.json();
      if (!response.ok || data.error) throw new Error(data.error || "No se pudo activar el avatar.");

      setActiveAvatar({
        id: data.avatar.id,
        source: "generated",
        modelUrl: data.avatar.model_url,
        fallbackUrl: null,
        status: "ready",
        frontRotationY: Number(data.avatar.front_rotation_y ?? 0),
        updatedAt: data.avatar.updated_at ?? new Date().toISOString(),
      });
      await fetchLibrary();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo activar el avatar.");
    } finally {
      setActivatingId(null);
    }
  };

  return (
    <section className="mt-8 rounded-[2rem] border border-white/10 bg-black/25 p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-violet-300/70">Biblioteca</p>
          <h2 className="mt-2 text-xl font-semibold text-white">Tus avatares</h2>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading || syncing}
          className="rounded-full border border-white/10 px-3 py-2 text-xs text-white/60 disabled:opacity-50"
        >
          {syncing ? "Revisando…" : "Actualizar"}
        </button>
      </div>

      {error ? <div className="mt-4 rounded-2xl border border-rose-400/25 bg-rose-400/10 p-3 text-sm text-rose-200">{error}</div> : null}
      {loading && avatars.length === 0 ? <p className="mt-5 text-sm text-white/45">Cargando avatares…</p> : null}
      {!loading && avatars.length === 0 ? <p className="mt-5 text-sm text-white/45">Todavía no hay generaciones guardadas.</p> : null}

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        {avatars.map((avatar) => {
          const ready = avatar.status === "ready" && Boolean(avatar.model_url);
          return (
            <article key={avatar.id} className={`overflow-hidden rounded-3xl border ${avatar.is_active ? "border-violet-400/70" : "border-white/10"} bg-white/[0.03]`}>
              <div className="aspect-square bg-black/30">
                {ready ? (
                  <model-viewer src={avatar.model_url ?? ""} alt={avatar.name} camera-controls auto-rotate style={{ width: "100%", height: "100%" }} />
                ) : avatar.preview_image_url ? (
                  <img src={avatar.preview_image_url} alt={avatar.name} className="h-full w-full object-contain" />
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-white/35">Sin vista previa</div>
                )}
              </div>

              <div className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-medium text-white">{avatar.name}</h3>
                    <p className="mt-1 text-xs text-white/45">
                      {avatar.status === "generating" ? "En proceso" : avatar.status === "ready" ? "Listo" : avatar.status === "failed" ? "Falló" : avatar.status}
                    </p>
                  </div>
                  {avatar.is_active ? <span className="rounded-full bg-violet-400/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-violet-200">Activo</span> : null}
                </div>

                {ready && !avatar.is_active ? (
                  <button
                    type="button"
                    onClick={() => void activate(avatar)}
                    disabled={activatingId === avatar.id}
                    className="mt-4 w-full rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-black disabled:opacity-50"
                  >
                    {activatingId === avatar.id ? "Activando…" : "Usar este avatar"}
                  </button>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
