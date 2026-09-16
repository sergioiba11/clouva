"use client";

import { useEffect, useMemo, useState } from "react";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";
import type { Player, PlayerMusicConnection } from "@/lib/players-data";

const PROVIDERS = [
  ["spotify", "Spotify"],
  ["apple_music", "Apple Music"],
  ["youtube", "YouTube"],
  ["youtube_music", "YouTube Music"],
  ["soundcloud", "SoundCloud"],
] as const;

type Provider = (typeof PROVIDERS)[number][0];
type EditableConnection = {
  provider: Provider;
  connection_type: string;
  external_artist_id: string;
  external_uri: string;
  external_url: string;
  artist_name: string;
  artist_image_url: string;
  verification_status: string;
};

type IdentityPayload = {
  player: Player;
  musicConnections: PlayerMusicConnection[];
};

function toCsv(value: string[] | null | undefined) {
  return (value || []).join(", ");
}

function fromCsv(value: string) {
  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
}

function emptyConnection(provider: Provider): EditableConnection {
  return {
    provider,
    connection_type: "artist_profile",
    external_artist_id: "",
    external_uri: "",
    external_url: "",
    artist_name: "",
    artist_image_url: "",
    verification_status: "manual",
  };
}

function normalizeConnections(rows: PlayerMusicConnection[]) {
  const byProvider = new Map(rows.map((row) => [row.provider, row]));
  return Object.fromEntries(PROVIDERS.map(([provider]) => {
    const row = byProvider.get(provider);
    return [provider, row ? {
      provider,
      connection_type: row.connection_type || "artist_profile",
      external_artist_id: row.external_artist_id || "",
      external_uri: row.external_uri || "",
      external_url: row.external_url || "",
      artist_name: row.artist_name || "",
      artist_image_url: row.artist_image_url || "",
      verification_status: row.verification_status || "manual",
    } : emptyConnection(provider)];
  })) as Record<Provider, EditableConnection>;
}

export function PublicIdentityKnowledgeGraphPanel() {
  const [player, setPlayer] = useState<Player | null>(null);
  const [identity, setIdentity] = useState<Record<string, string>>({});
  const [connections, setConnections] = useState<Record<Provider, EditableConnection>>(() => normalizeConnections([]));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await authenticatedFetch("/api/players/public-identity");
      const payload = await readApiJson<IdentityPayload>(response);
      setPlayer(payload.player);
      setIdentity({
        seo_title: payload.player.seo_title || "",
        seo_description: payload.player.seo_description || "",
        share_title: payload.player.share_title || "",
        share_description: payload.player.share_description || "",
        og_image_url: payload.player.og_image_url || "",
        alternate_names: toCsv(payload.player.alternate_names),
        genres: toCsv(payload.player.genres),
        disciplines: toCsv(payload.player.disciplines),
        professional_categories: toCsv(payload.player.professional_categories),
        country: payload.player.country || "",
        origin: payload.player.origin || "",
        birth_place: payload.player.birth_place || "",
        schema_job_title: payload.player.schema_job_title || "",
        public_identity_label: payload.player.public_identity_label || "",
      });
      setConnections(normalizeConnections(payload.musicConnections));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No se pudo cargar la identidad pública.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const canonical = useMemo(() => player ? `https://clouva.com.ar/${player.slug}` : "", [player]);

  const updateIdentity = (key: string, value: string) => {
    setIdentity((current) => ({ ...current, [key]: value }));
  };

  const updateConnection = (provider: Provider, key: keyof EditableConnection, value: string) => {
    setConnections((current) => ({
      ...current,
      [provider]: { ...current[provider], [key]: value },
    }));
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await authenticatedFetch("/api/players/public-identity", {
        method: "PATCH",
        body: JSON.stringify({
          identity: {
            seo_title: identity.seo_title,
            seo_description: identity.seo_description,
            share_title: identity.share_title,
            share_description: identity.share_description,
            og_image_url: identity.og_image_url,
            alternate_names: fromCsv(identity.alternate_names || ""),
            genres: fromCsv(identity.genres || ""),
            disciplines: fromCsv(identity.disciplines || ""),
            professional_categories: fromCsv(identity.professional_categories || ""),
            country: identity.country,
            origin: identity.origin,
            birth_place: identity.birth_place,
            schema_job_title: identity.schema_job_title,
            public_identity_label: identity.public_identity_label,
          },
          music_connections: PROVIDERS.map(([provider]) => connections[provider]),
        }),
      });
      const payload = await readApiJson<IdentityPayload>(response);
      setPlayer(payload.player);
      setConnections(normalizeConnections(payload.musicConnections));
      setMessage("Identidad pública y conexiones actualizadas.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No se pudo guardar la identidad pública.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <section className="mx-auto max-w-7xl px-4 pb-10 text-white sm:px-6"><div className="h-40 animate-pulse rounded-[2rem] border border-white/10 bg-white/[0.025]" /></section>;
  }

  if (!player) return null;

  return (
    <section id="identidad-publica-seo" className="mx-auto max-w-7xl px-4 pb-12 text-white sm:px-6">
      <div className="rounded-[2rem] border border-violet-400/20 bg-[#0b0913] p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-300/70">Identidad pública · SEO · Knowledge Graph</p>
            <h2 className="mt-2 text-2xl font-bold">Entidad canónica del Player</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-white/50">Estos datos alimentan la página pública, metadata y JSON-LD del mismo Player. No crean otra identidad.</p>
          </div>
          <button type="button" onClick={() => void save()} disabled={saving} className="rounded-xl bg-violet-600 px-5 py-3 text-sm font-semibold disabled:opacity-50">{saving ? "Guardando…" : "Guardar identidad"}</button>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <ReadOnlyField label="Canonical" value={canonical} />
          <ReadOnlyField label="Ubicación pública" value={player.location || "Sin definir"} hint="Se edita en la sección Identidad de este mismo editor." />
          <Field label="Etiqueta pública" value={identity.public_identity_label || ""} onChange={(value) => updateIdentity("public_identity_label", value)} placeholder="Artista argentino" />
          <Field label="Profesión schema.org" value={identity.schema_job_title || ""} onChange={(value) => updateIdentity("schema_job_title", value)} placeholder="Artista musical" />
          <Field label="País" value={identity.country || ""} onChange={(value) => updateIdentity("country", value)} placeholder="Argentina" />
          <Field label="Lugar de nacimiento" value={identity.birth_place || ""} onChange={(value) => updateIdentity("birth_place", value)} placeholder="Zapala, Neuquén, Argentina" />
          <Field label="Origen" value={identity.origin || ""} onChange={(value) => updateIdentity("origin", value)} placeholder="Zapala, Neuquén · La 180" />
          <Field label="Nombres artísticos anteriores" value={identity.alternate_names || ""} onChange={(value) => updateIdentity("alternate_names", value)} placeholder="Clover, Clover.nlb" hint="Separados por coma. Se publican como alternateName de la misma Person." />
          <Field label="Géneros" value={identity.genres || ""} onChange={(value) => updateIdentity("genres", value)} placeholder="Solo datos confirmados, separados por coma" />
          <Field label="Disciplinas" value={identity.disciplines || ""} onChange={(value) => updateIdentity("disciplines", value)} placeholder="Separadas por coma" />
          <Field label="Categorías profesionales" value={identity.professional_categories || ""} onChange={(value) => updateIdentity("professional_categories", value)} placeholder="Separadas por coma" />
          <Field label="OG image" value={identity.og_image_url || ""} onChange={(value) => updateIdentity("og_image_url", value)} placeholder="https://…" />
        </div>

        <div className="mt-7 border-t border-white/10 pt-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-300/70">SEO y compartir</p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Field label="Título SEO" value={identity.seo_title || ""} onChange={(value) => updateIdentity("seo_title", value)} />
            <Field label="Título al compartir" value={identity.share_title || ""} onChange={(value) => updateIdentity("share_title", value)} />
            <TextArea label="Descripción SEO" value={identity.seo_description || ""} onChange={(value) => updateIdentity("seo_description", value)} />
            <TextArea label="Descripción al compartir" value={identity.share_description || ""} onChange={(value) => updateIdentity("share_description", value)} />
          </div>
        </div>

        <div className="mt-7 border-t border-white/10 pt-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-300/70">Conexiones musicales oficiales</p>
          <p className="mt-2 text-sm leading-6 text-white/45">Las URLs guardadas acá alimentan <code className="text-violet-200">player_music_connections</code> y el <code className="text-violet-200">sameAs</code> del Knowledge Graph.</p>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {PROVIDERS.map(([provider, label]) => {
              const connection = connections[provider];
              return (
                <article key={provider} className="rounded-2xl border border-white/10 bg-black/25 p-4">
                  <div className="flex items-center justify-between gap-3"><h3 className="font-semibold">{label}</h3><span className="text-[10px] uppercase tracking-[0.16em] text-white/35">{connection.external_url ? "Conectado" : "Sin URL"}</span></div>
                  <div className="mt-4 space-y-3">
                    <Field label="URL oficial" value={connection.external_url} onChange={(value) => updateConnection(provider, "external_url", value)} placeholder="https://…" />
                    <Field label="Artist ID" value={connection.external_artist_id} onChange={(value) => updateConnection(provider, "external_artist_id", value)} />
                    <Field label="URI externa" value={connection.external_uri} onChange={(value) => updateConnection(provider, "external_uri", value)} />
                    <Field label="Nombre en la plataforma" value={connection.artist_name} onChange={(value) => updateConnection(provider, "artist_name", value)} />
                    <Field label="Imagen del artista" value={connection.artist_image_url} onChange={(value) => updateConnection(provider, "artist_image_url", value)} placeholder="https://…" />
                  </div>
                </article>
              );
            })}
          </div>
        </div>

        {error ? <p className="mt-5 rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">{error}</p> : null}
        {message ? <p className="mt-5 rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-3 text-sm text-emerald-200">{message}</p> : null}
      </div>
    </section>
  );
}

function Field({ label, value, onChange, placeholder, hint }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; hint?: string }) {
  return <label className="block"><span className="mb-2 block text-xs uppercase tracking-[0.16em] text-white/40">{label}</span><input value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm outline-none placeholder:text-white/20 focus:border-violet-400/60" />{hint ? <small className="mt-1.5 block text-[11px] leading-5 text-white/35">{hint}</small> : null}</label>;
}

function TextArea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="block"><span className="mb-2 block text-xs uppercase tracking-[0.16em] text-white/40">{label}</span><textarea rows={4} value={value} onChange={(event) => onChange(event.target.value)} className="w-full resize-y rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm outline-none focus:border-violet-400/60" /></label>;
}

function ReadOnlyField({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return <div><span className="mb-2 block text-xs uppercase tracking-[0.16em] text-white/40">{label}</span><div className="rounded-xl border border-white/10 bg-white/[0.025] px-4 py-3 text-sm text-white/70">{value}</div>{hint ? <small className="mt-1.5 block text-[11px] leading-5 text-white/35">{hint}</small> : null}</div>;
}
