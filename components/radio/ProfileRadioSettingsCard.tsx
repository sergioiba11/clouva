"use client";

import Link from "next/link";
import { ExternalLink, Loader2, RadioTower, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { RadioOwnerKind } from "@/lib/radio/types";
import { supabase } from "@/lib/supabase";

type ProfileRadioSettingsCardProps = {
  ownerKind: RadioOwnerKind;
  ownerId: string;
  profileName: string;
  publicAlias?: string | null;
  className?: string;
};

type RadioSettingsRow = {
  id: string;
  station_name: string;
  tagline: string | null;
  stream_url: string | null;
  artwork_url: string | null;
  kick_channel_url: string | null;
  podcast_rss_url: string | null;
  is_enabled: boolean;
  is_public: boolean;
};

type RadioDraft = {
  stationName: string;
  tagline: string;
  streamUrl: string;
  artworkUrl: string;
  kickChannelUrl: string;
  podcastRssUrl: string;
  enabled: boolean;
  isPublic: boolean;
};

function getOwnerColumn(ownerKind: RadioOwnerKind) {
  if (ownerKind === "player") return "player_id";
  if (ownerKind === "studio") return "studio_id";
  return "space_id";
}

function draftFromRow(row: RadioSettingsRow | null, profileName: string): RadioDraft {
  return {
    stationName: row?.station_name || `${profileName} Radio`,
    tagline: row?.tagline || "",
    streamUrl: row?.stream_url || "",
    artworkUrl: row?.artwork_url || "",
    kickChannelUrl: row?.kick_channel_url || "",
    podcastRssUrl: row?.podcast_rss_url || "",
    enabled: row?.is_enabled ?? false,
    isPublic: row?.is_public ?? false,
  };
}

export function ProfileRadioSettingsCard({
  ownerKind,
  ownerId,
  profileName,
  publicAlias,
  className = "",
}: ProfileRadioSettingsCardProps) {
  const [rowId, setRowId] = useState<string | null>(null);
  const [draft, setDraft] = useState<RadioDraft>(() => draftFromRow(null, profileName));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const ownerColumn = useMemo(() => getOwnerColumn(ownerKind), [ownerKind]);
  const publicHref = publicAlias ? `/${publicAlias}/radio` : null;

  useEffect(() => {
    let cancelled = false;

    async function loadSettings() {
      setLoading(true);
      setError(null);
      setSaved(false);
      try {
        const { data, error: queryError } = await supabase
          .from("profile_radio_settings")
          .select("id,station_name,tagline,stream_url,artwork_url,kick_channel_url,podcast_rss_url,is_enabled,is_public")
          .eq(ownerColumn, ownerId)
          .maybeSingle();

        if (queryError) throw queryError;
        if (cancelled) return;

        const row = (data as RadioSettingsRow | null) ?? null;
        setRowId(row?.id ?? null);
        setDraft(draftFromRow(row, profileName));
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "No se pudo cargar la configuración de Radio.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadSettings();
    return () => {
      cancelled = true;
    };
  }, [ownerColumn, ownerId, profileName]);

  async function persist(nextDraft: RadioDraft) {
    setSaving(true);
    setSaved(false);
    setError(null);

    const normalizedStationName = nextDraft.stationName.trim() || `${profileName} Radio`;
    const normalizedPublic = nextDraft.enabled && nextDraft.isPublic;
    const payload = {
      station_name: normalizedStationName,
      tagline: nextDraft.tagline.trim() || null,
      stream_url: nextDraft.streamUrl.trim() || null,
      artwork_url: nextDraft.artworkUrl.trim() || null,
      kick_channel_url: nextDraft.kickChannelUrl.trim() || null,
      podcast_rss_url: nextDraft.podcastRssUrl.trim() || null,
      is_enabled: nextDraft.enabled,
      is_public: normalizedPublic,
      [ownerColumn]: ownerId,
    };

    try {
      const query = rowId
        ? supabase
            .from("profile_radio_settings")
            .update(payload)
            .eq("id", rowId)
            .select("id,station_name,tagline,stream_url,artwork_url,kick_channel_url,podcast_rss_url,is_enabled,is_public")
            .single()
        : supabase
            .from("profile_radio_settings")
            .insert(payload)
            .select("id,station_name,tagline,stream_url,artwork_url,kick_channel_url,podcast_rss_url,is_enabled,is_public")
            .single();

      const { data, error: writeError } = await query;
      if (writeError) throw writeError;

      const row = data as RadioSettingsRow;
      setRowId(row.id);
      setDraft(draftFromRow(row, profileName));
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo guardar la configuración de Radio.");
    } finally {
      setSaving(false);
    }
  }

  async function activate() {
    const nextDraft = { ...draft, enabled: true, isPublic: false };
    setDraft(nextDraft);
    await persist(nextDraft);
  }

  if (loading) {
    return (
      <section className={`rounded-2xl border border-white/10 bg-black/20 p-4 ${className}`}>
        <span className="inline-flex items-center gap-2 text-sm text-white/45"><Loader2 size={15} className="animate-spin" /> Cargando Radio…</span>
      </section>
    );
  }

  if (!rowId && !draft.enabled) {
    return (
      <section className={`rounded-2xl border border-white/10 bg-black/20 p-4 ${className}`}>
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-violet-200/65">Herramienta del perfil</p>
            <h2 className="mt-1 flex items-center gap-2 text-base font-semibold"><RadioTower size={17} /> Radio</h2>
            <p className="mt-1 max-w-xl text-sm leading-relaxed text-white/50">Activá una estación continua asociada a este perfil. La señal pública se publica solamente cuando vos lo decidas.</p>
          </div>
          <button type="button" onClick={() => void activate()} disabled={saving} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white disabled:opacity-50">
            {saving ? <Loader2 size={15} className="animate-spin" /> : <RadioTower size={15} />} Activar mi radio
          </button>
        </div>
        {error ? <p className="mt-3 text-sm text-rose-200">{error}</p> : null}
      </section>
    );
  }

  return (
    <section className={`rounded-2xl border border-white/10 bg-black/20 p-4 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-violet-200/65">Herramienta del perfil</p>
          <h2 className="mt-1 flex items-center gap-2 text-base font-semibold"><RadioTower size={17} /> Radio</h2>
          <p className="mt-1 text-sm text-white/45">Una sola estación para este perfil, conectada al Radio Core compartido de CLOUVA.</p>
        </div>
        {publicHref && draft.enabled && draft.isPublic ? (
          <Link href={publicHref} target="_blank" className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-white/10 px-3 text-xs font-semibold text-white/70 transition hover:text-white">
            Ver radio <ExternalLink size={13} />
          </Link>
        ) : null}
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2">
        <label className="text-xs text-white/55">
          Nombre visible
          <input value={draft.stationName} onChange={(event) => setDraft((current) => ({ ...current, stationName: event.target.value }))} className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-white outline-none focus:border-violet-300/45" placeholder={`${profileName} Radio`} />
        </label>
        <label className="text-xs text-white/55">
          Tagline
          <input value={draft.tagline} onChange={(event) => setDraft((current) => ({ ...current, tagline: event.target.value }))} className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-white outline-none focus:border-violet-300/45" placeholder="Identidad de la estación" />
        </label>
        <label className="text-xs text-white/55 md:col-span-2">
          Stream URL
          <input type="url" value={draft.streamUrl} onChange={(event) => setDraft((current) => ({ ...current, streamUrl: event.target.value }))} className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-white outline-none focus:border-violet-300/45" placeholder="https://…" />
          <span className="mt-1 block text-[11px] text-white/30">URL pública apta para reproducción directa de audio.</span>
        </label>
        <label className="text-xs text-white/55 md:col-span-2">
          Artwork URL
          <input type="url" value={draft.artworkUrl} onChange={(event) => setDraft((current) => ({ ...current, artworkUrl: event.target.value }))} className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-white outline-none focus:border-violet-300/45" placeholder="https://…" />
        </label>
        <label className="text-xs text-white/55 md:col-span-2">
          Kick channel URL
          <input type="url" value={draft.kickChannelUrl} onChange={(event) => setDraft((current) => ({ ...current, kickChannelUrl: event.target.value }))} className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-white outline-none focus:border-violet-300/45" placeholder="https://kick.com/…" />
          <span className="mt-1 block text-[11px] text-white/30">CLOUVA consulta este canal para mostrar EN VIVO solamente cuando Kick confirma una transmisión activa.</span>
        </label>
        <label className="text-xs text-white/55 md:col-span-2">
          Podcast URL / RSS
          <input type="url" value={draft.podcastRssUrl} onChange={(event) => setDraft((current) => ({ ...current, podcastRssUrl: event.target.value }))} className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-white outline-none focus:border-violet-300/45" placeholder="https://…" />
        </label>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="flex cursor-pointer items-center justify-between rounded-xl border border-white/10 bg-white/[0.025] p-3 text-sm">
          <span><strong className="block font-semibold">Radio activa</strong><small className="text-white/35">Habilita la capability para este perfil.</small></span>
          <input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft((current) => ({ ...current, enabled: event.target.checked, isPublic: event.target.checked ? current.isPublic : false }))} className="h-4 w-4 accent-violet-500" />
        </label>
        <label className="flex cursor-pointer items-center justify-between rounded-xl border border-white/10 bg-white/[0.025] p-3 text-sm">
          <span><strong className="block font-semibold">Radio publicada</strong><small className="text-white/35">Permite escucharla desde la URL pública.</small></span>
          <input type="checkbox" checked={draft.isPublic} disabled={!draft.enabled} onChange={(event) => setDraft((current) => ({ ...current, isPublic: event.target.checked }))} className="h-4 w-4 accent-violet-500 disabled:opacity-30" />
        </label>
      </div>

      {error ? <p className="mt-3 text-sm text-rose-200">{error}</p> : null}
      {saved ? <p className="mt-3 text-sm text-emerald-200">Configuración de Radio guardada.</p> : null}

      <button type="button" onClick={() => void persist(draft)} disabled={saving} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white disabled:opacity-50">
        {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Guardar Radio
      </button>
    </section>
  );
}
