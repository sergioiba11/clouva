"use client";

import Link from "next/link";
import { CheckCircle2, ExternalLink, Loader2, Save, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";
import type { Player, PlayerMusicConnection } from "@/lib/players-data";

type ConnectionDraft = {
  provider: "apple_music" | "youtube_music" | "soundcloud";
  external_url: string;
  external_artist_id: string;
  external_uri: string;
  artist_name: string;
  artist_image_url: string;
};

const PROVIDERS: Array<{ value: ConnectionDraft["provider"]; label: string; placeholder: string }> = [
  { value: "apple_music", label: "Apple Music", placeholder: "https://music.apple.com/..." },
  { value: "youtube_music", label: "YouTube Music", placeholder: "https://music.youtube.com/..." },
  { value: "soundcloud", label: "SoundCloud", placeholder: "https://soundcloud.com/..." },
];

const EMPTY_CONNECTION: ConnectionDraft = {
  provider: "apple_music",
  external_url: "",
  external_artist_id: "",
  external_uri: "",
  artist_name: "",
  artist_image_url: "",
};

function listText(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").join(", ") : "";
}

function parseList(value: string) {
  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))].slice(0, 20);
}

export default function PublicIdentityEditorPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [player, setPlayer] = useState<Player | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [connections, setConnections] = useState<PlayerMusicConnection[]>([]);
  const [connectionDraft, setConnectionDraft] = useState<ConnectionDraft>(EMPTY_CONNECTION);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [authLoading, router, user]);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const [playerResponse, connectionsResponse] = await Promise.all([
        authenticatedFetch("/api/players/me"),
        authenticatedFetch("/api/players/music-connections"),
      ]);
      const playerPayload = await readApiJson<{ player: Player | null }>(playerResponse);
      const connectionsPayload = await readApiJson<{ connections: PlayerMusicConnection[] }>(connectionsResponse);
      if (!playerPayload.player) throw new Error("No pudimos resolver tu Player.");
      setPlayer(playerPayload.player);
      setDraft({ ...playerPayload.player });
      setConnections(connectionsPayload.connections || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No se pudo cargar la identidad pública.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading && user) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user?.id]);

  const update = (key: string, value: unknown) => setDraft((current) => ({ ...current, [key]: value }));

  const saveIdentity = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await authenticatedFetch("/api/players/me", {
        method: "PATCH",
        body: JSON.stringify({
          primary_role: draft.primary_role,
          public_identity_label: draft.public_identity_label,
          schema_job_title: draft.schema_job_title,
          country: draft.country,
          birth_place: draft.birth_place,
          origin: draft.origin,
          location: draft.location,
          alternate_names: draft.alternate_names,
          genres: draft.genres,
          disciplines: draft.disciplines,
          professional_categories: draft.professional_categories,
          seo_title: draft.seo_title,
          seo_description: draft.seo_description,
          share_title: draft.share_title,
          share_description: draft.share_description,
          og_image_url: draft.og_image_url,
        }),
      });
      const payload = await readApiJson<{ player: Player }>(response);
      setPlayer(payload.player);
      setDraft({ ...payload.player });
      setMessage("Identidad pública y Knowledge Graph actualizados.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No se pudo guardar la identidad pública.");
    } finally {
      setSaving(false);
    }
  };

  const saveConnection = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await authenticatedFetch("/api/players/music-connections", {
        method: "POST",
        body: JSON.stringify(connectionDraft),
      });
      await readApiJson(response);
      setConnectionDraft(EMPTY_CONNECTION);
      await load();
      setMessage("Plataforma musical conectada a la identidad pública.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No se pudo conectar la plataforma.");
    } finally {
      setSaving(false);
    }
  };

  const removeConnection = async (provider: string) => {
    setSaving(true);
    setError(null);
    try {
      const response = await authenticatedFetch(`/api/players/music-connections?provider=${encodeURIComponent(provider)}`, { method: "DELETE" });
      await readApiJson(response);
      await load();
      setMessage("Plataforma quitada de la identidad pública.");
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "No se pudo quitar la plataforma.");
    } finally {
      setSaving(false);
    }
  };

  const personId = player ? `https://clouva.com.ar/${player.slug}#person` : "";
  const sameAsPreview = useMemo(() => {
    const urls = [
      ...(connections.map((connection) => connection.external_url).filter(Boolean) as string[]),
      typeof draft.spotify_profile_url === "string" ? draft.spotify_profile_url : "",
      typeof draft.youtube_channel_url === "string" ? draft.youtube_channel_url : "",
    ];
    return [...new Set(urls.filter(Boolean))];
  }, [connections, draft.spotify_profile_url, draft.youtube_channel_url]);

  if (loading) return <main className="grid min-h-[70vh] place-items-center text-white"><Loader2 className="animate-spin text-violet-300" /></main>;
  if (!player) return <main className="mx-auto max-w-3xl p-6 text-white"><p className="rounded-2xl border border-red-400/20 bg-red-500/10 p-4 text-red-200">{error || "No pudimos cargar tu Player."}</p></main>;

  return (
    <main className="px-4 py-6 text-white sm:px-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-violet-300/75">PLAYER · IDENTIDAD PÚBLICA</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight">SEO / AEO / Knowledge Graph</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/50">Controlá cómo buscadores y asistentes entienden tu identidad sin separar tu Player ni crear otra entidad.</p>
          </div>
          <button type="button" onClick={() => void saveIdentity()} disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold disabled:opacity-50">{saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Guardar identidad</button>
        </header>

        <section className="rounded-[2rem] border border-white/10 bg-[#0b0913] p-5 sm:p-7">
          <h2 className="text-lg font-bold">Entidad canónica</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Etiqueta pública" value={String(draft.public_identity_label || "")} onChange={(value) => update("public_identity_label", value)} placeholder="Artista argentino" />
            <Field label="Rol visible" value={String(draft.primary_role || "")} onChange={(value) => update("primary_role", value)} placeholder="Artista argentino" />
            <Field label="Ocupación semántica" value={String(draft.schema_job_title || "")} onChange={(value) => update("schema_job_title", value)} placeholder="Artista musical" />
            <Field label="País" value={String(draft.country || "")} onChange={(value) => update("country", value)} placeholder="Argentina" />
            <Field label="Lugar de nacimiento" value={String(draft.birth_place || "")} onChange={(value) => update("birth_place", value)} placeholder="Zapala, Neuquén, Argentina" />
            <Field label="Origen" value={String(draft.origin || "")} onChange={(value) => update("origin", value)} placeholder="Zapala, Neuquén · La 180" />
            <Field label="Ubicación pública" value={String(draft.location || "")} onChange={(value) => update("location", value)} placeholder="Zapala, Neuquén, Argentina" />
            <Field label="Nombres artísticos anteriores" value={listText(draft.alternate_names)} onChange={(value) => update("alternate_names", parseList(value))} placeholder="Clover, Clover.nlb" />
          </div>
          <div className="mt-5 rounded-2xl border border-violet-400/15 bg-violet-500/[0.06] p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-violet-300/70">ID permanente de persona</p>
            <code className="mt-2 block break-all text-sm text-violet-100">{personId}</code>
          </div>
        </section>

        <section className="rounded-[2rem] border border-white/10 bg-[#0b0913] p-5 sm:p-7">
          <h2 className="text-lg font-bold">Contexto artístico</h2>
          <p className="mt-1 text-sm text-white/45">No se completa solo: estos datos alimentan el Person schema únicamente cuando vos los definís.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <Field label="Géneros" value={listText(draft.genres)} onChange={(value) => update("genres", parseList(value))} placeholder="Separados por comas" />
            <Field label="Disciplinas" value={listText(draft.disciplines)} onChange={(value) => update("disciplines", parseList(value))} placeholder="Separadas por comas" />
            <Field label="Categorías profesionales" value={listText(draft.professional_categories)} onChange={(value) => update("professional_categories", parseList(value))} placeholder="Separadas por comas" />
          </div>
        </section>

        <section className="rounded-[2rem] border border-white/10 bg-[#0b0913] p-5 sm:p-7">
          <h2 className="text-lg font-bold">SEO y compartir</h2>
          <div className="mt-4 grid gap-4">
            <Field label="Título SEO" value={String(draft.seo_title || "")} onChange={(value) => update("seo_title", value)} />
            <TextArea label="Descripción SEO" value={String(draft.seo_description || "")} onChange={(value) => update("seo_description", value)} rows={3} />
            <Field label="Título al compartir" value={String(draft.share_title || "")} onChange={(value) => update("share_title", value)} />
            <TextArea label="Descripción al compartir" value={String(draft.share_description || "")} onChange={(value) => update("share_description", value)} rows={3} />
            <Field label="Imagen OG" value={String(draft.og_image_url || "")} onChange={(value) => update("og_image_url", value)} placeholder="https://..." />
          </div>
        </section>

        <section className="rounded-[2rem] border border-white/10 bg-[#0b0913] p-5 sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h2 className="text-lg font-bold">Plataformas musicales · sameAs</h2><p className="mt-1 text-sm text-white/45">Spotify y YouTube usan sus conectores oficiales. Apple Music, YouTube Music y SoundCloud se enlazan acá.</p></div>
            <div className="flex gap-2"><Link href="/profile/spotify-artist" className="rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-white/70">Spotify</Link><Link href="/profile/edit?section=youtube" className="rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-white/70">YouTube</Link></div>
          </div>

          <div className="mt-5 grid gap-3">
            {connections.length ? connections.map((connection) => {
              const manual = ["apple_music", "youtube_music", "soundcloud"].includes(connection.provider);
              return <div key={connection.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.025] p-4"><CheckCircle2 size={17} className="text-emerald-300" /><div className="min-w-0 flex-1"><p className="text-sm font-semibold">{connection.provider.replaceAll("_", " ")}</p><p className="truncate text-xs text-white/40">{connection.artist_name || connection.external_url || "Conexión registrada"}</p></div>{connection.external_url ? <a href={connection.external_url} target="_blank" rel="noreferrer" className="rounded-lg border border-white/10 p-2 text-white/50"><ExternalLink size={14} /></a> : null}{manual ? <button type="button" onClick={() => void removeConnection(connection.provider)} disabled={saving} className="rounded-lg border border-red-400/20 p-2 text-red-300"><Trash2 size={14} /></button> : null}</div>;
            }) : <p className="rounded-2xl border border-dashed border-white/10 p-4 text-sm text-white/40">Todavía no hay conexiones musicales registradas.</p>}
          </div>

          <div className="mt-6 border-t border-white/10 pt-5">
            <h3 className="text-sm font-semibold">Conectar plataforma musical</h3>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="grid gap-2 text-xs text-white/45">Proveedor<select value={connectionDraft.provider} onChange={(event) => setConnectionDraft((current) => ({ ...current, provider: event.target.value as ConnectionDraft["provider"] }))} className="rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-sm text-white outline-none">{PROVIDERS.map((provider) => <option key={provider.value} value={provider.value} className="bg-[#0b0913]">{provider.label}</option>)}</select></label>
              <Field label="URL pública" value={connectionDraft.external_url} onChange={(value) => setConnectionDraft((current) => ({ ...current, external_url: value }))} placeholder={PROVIDERS.find((item) => item.value === connectionDraft.provider)?.placeholder} />
              <Field label="Nombre en la plataforma" value={connectionDraft.artist_name} onChange={(value) => setConnectionDraft((current) => ({ ...current, artist_name: value }))} placeholder={player.display_name} />
              <Field label="External artist ID" value={connectionDraft.external_artist_id} onChange={(value) => setConnectionDraft((current) => ({ ...current, external_artist_id: value }))} placeholder="Opcional" />
              <Field label="External URI" value={connectionDraft.external_uri} onChange={(value) => setConnectionDraft((current) => ({ ...current, external_uri: value }))} placeholder="Opcional" />
              <Field label="Imagen externa" value={connectionDraft.artist_image_url} onChange={(value) => setConnectionDraft((current) => ({ ...current, artist_image_url: value }))} placeholder="Opcional" />
            </div>
            <button type="button" onClick={() => void saveConnection()} disabled={saving || !connectionDraft.external_url.trim()} className="mt-4 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-black disabled:opacity-40">Guardar plataforma</button>
          </div>

          {sameAsPreview.length ? <div className="mt-6 rounded-2xl border border-white/10 bg-black/20 p-4"><p className="text-xs uppercase tracking-[0.18em] text-white/35">sameAs actual</p><div className="mt-3 space-y-1">{sameAsPreview.map((url) => <p key={url} className="break-all text-xs text-white/50">{url}</p>)}</div></div> : null}
        </section>

        {message ? <p className="rounded-xl border border-emerald-400/20 bg-emerald-500/10 p-4 text-sm text-emerald-200">{message}</p> : null}
        {error ? <p className="rounded-xl border border-red-400/20 bg-red-500/10 p-4 text-sm text-red-200">{error}</p> : null}
      </div>
    </main>
  );
}

function Label({ children }: { children: React.ReactNode }) { return <span className="text-xs font-semibold uppercase tracking-[0.16em] text-white/40">{children}</span>; }
function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) { return <label className="grid gap-2"><Label>{label}</Label><input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm outline-none focus:border-violet-400/60" /></label>; }
function TextArea({ label, value, onChange, rows }: { label: string; value: string; onChange: (value: string) => void; rows: number }) { return <label className="grid gap-2"><Label>{label}</Label><textarea rows={rows} value={value} onChange={(event) => onChange(event.target.value)} className="w-full resize-y rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm outline-none focus:border-violet-400/60" /></label>; }
