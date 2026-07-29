"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";
import type { Player, SocialLink } from "@/lib/players-data";

const SECTIONS = ["Identidad", "Presentación", "Imagen", "Links", "Instagram", "Privacidad y SEO"] as const;
type Section = (typeof SECTIONS)[number];

type InstagramConnection = {
  id: string;
  external_username: string | null;
  display_name: string | null;
  account_type: string | null;
  expires_at: string | null;
  status: string;
  connected_at: string | null;
  last_synced_at: string | null;
};

function parseLinks(value: unknown): SocialLink[] {
  return Array.isArray(value) ? value.filter((item): item is SocialLink => Boolean(item && typeof item === "object" && typeof (item as SocialLink).url === "string")) : [];
}

export default function PlayerEditorPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [player, setPlayer] = useState<Player | null>(null);
  const [connection, setConnection] = useState<InstagramConnection | null>(null);
  const [activeSection, setActiveSection] = useState<Section>("Identidad");
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [links, setLinks] = useState<SocialLink[]>([]);
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
    try {
      const [playerResponse, statusResponse] = await Promise.all([
        authenticatedFetch("/api/players/me"),
        authenticatedFetch("/api/integrations/instagram/status"),
      ]);
      const playerPayload = await readApiJson<{ player: Player | null }>(playerResponse);
      const statusPayload = await readApiJson<{ connection: InstagramConnection | null }>(statusResponse);
      if (!playerPayload.player) {
        router.replace("/onboarding/identity");
        return;
      }
      setPlayer(playerPayload.player);
      setDraft({ ...playerPayload.player });
      setLinks(parseLinks(playerPayload.player.social_links));
      setConnection(statusPayload.connection);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No se pudo cargar el editor.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [user]);

  const categories = useMemo(() => Array.isArray(draft.professional_categories) ? draft.professional_categories as string[] : [], [draft.professional_categories]);

  const update = (key: string, value: unknown) => setDraft((current) => ({ ...current, [key]: value }));

  const save = async (publicationAction?: "publish" | "unpublish") => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await authenticatedFetch("/api/players/me", {
        method: "PATCH",
        body: JSON.stringify({ ...draft, social_links: links, publication_action: publicationAction }),
      });
      const payload = await readApiJson<{ player: Player }>(response);
      setPlayer(payload.player);
      setDraft({ ...payload.player });
      setMessage(publicationAction === "publish" ? "Perfil publicado." : publicationAction === "unpublish" ? "Perfil despublicado." : "Borrador guardado.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No se pudo guardar.");
    } finally {
      setSaving(false);
    }
  };

  const connectInstagram = async () => {
    setSaving(true);
    setError(null);
    try {
      const response = await authenticatedFetch("/api/integrations/instagram/connect", {
        method: "POST",
        body: JSON.stringify({ returnPath: "/onboarding/instagram/select" }),
      });
      const payload = await readApiJson<{ authorizeUrl: string }>(response);
      window.location.assign(payload.authorizeUrl);
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : "No se pudo abrir Instagram.");
      setSaving(false);
    }
  };

  const syncInstagram = async () => {
    setSaving(true);
    setError(null);
    try {
      const response = await authenticatedFetch("/api/integrations/instagram/sync", { method: "POST" });
      const payload = await readApiJson<{ importSessionId: string }>(response);
      router.push(`/onboarding/instagram/select?importSession=${encodeURIComponent(payload.importSessionId)}`);
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "No se pudo actualizar Instagram.");
      setSaving(false);
    }
  };

  const disconnectInstagram = async () => {
    if (!window.confirm("¿Desconectar Instagram? Tu perfil publicado y los medios confirmados se conservan.")) return;
    setSaving(true);
    setError(null);
    try {
      const response = await authenticatedFetch("/api/integrations/instagram/disconnect", { method: "DELETE" });
      await readApiJson(response);
      setConnection(null);
      setMessage("Instagram fue desconectado.");
    } catch (disconnectError) {
      setError(disconnectError instanceof Error ? disconnectError.message : "No se pudo desconectar Instagram.");
    } finally {
      setSaving(false);
    }
  };

  const addLink = () => setLinks((current) => [...current, { platform: "website", label: "", url: "", is_visible: true, display_order: current.length }]);
  const updateLink = (index: number, changes: Partial<SocialLink>) => setLinks((current) => current.map((link, itemIndex) => itemIndex === index ? { ...link, ...changes } : link));
  const removeLink = (index: number) => setLinks((current) => current.filter((_, itemIndex) => itemIndex !== index));

  if (loading || !player) {
    return <main className="min-h-screen bg-[#05040a] px-4 py-10 text-white"><div className="mx-auto h-[70vh] max-w-6xl animate-pulse rounded-[2rem] bg-white/[0.04]" /></main>;
  }

  return (
    <main className="min-h-screen bg-[#05040a] text-white">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#05040a]/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-violet-300/70">Editor del Player</p>
            <h1 className="font-semibold">{player.display_name}</h1>
          </div>
          <div className="flex gap-2">
            <button onClick={() => void save()} disabled={saving} className="rounded-xl border border-white/15 px-4 py-2 text-sm">Guardar borrador</button>
            <button onClick={() => router.push(`/${player.slug}`)} className="hidden rounded-xl border border-white/15 px-4 py-2 text-sm sm:block">Vista previa</button>
            {player.is_published ? <button onClick={() => void save("unpublish")} disabled={saving} className="rounded-xl bg-white/10 px-4 py-2 text-sm">Despublicar</button> : <button onClick={() => void save("publish")} disabled={saving} className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold">Publicar</button>}
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[220px_minmax(0,1fr)_340px]">
        <nav className="flex gap-2 overflow-x-auto lg:flex-col">
          {SECTIONS.map((section) => <button key={section} onClick={() => setActiveSection(section)} className={`shrink-0 rounded-xl px-4 py-3 text-left text-sm transition ${activeSection === section ? "bg-violet-600 text-white" : "border border-white/10 bg-white/[0.025] text-white/55 hover:text-white"}`}>{section}</button>)}
        </nav>

        <section className="rounded-[2rem] border border-white/10 bg-[#0b0913] p-5 sm:p-7">
          {activeSection === "Identidad" ? <div className="space-y-4">
            <Field label="Nombre artístico" value={String(draft.display_name || "")} onChange={(value) => update("display_name", value)} />
            <Field label="Usuario" value={String(draft.username || "")} onChange={(value) => update("username", value.replace(/^@/, ""))} prefix="@" />
            <Field label="URL pública" value={String(draft.slug || "")} onChange={(value) => update("slug", value)} prefix="clouva.com.ar/" />
            <div><Label>Categorías profesionales</Label><div className="flex flex-wrap gap-2">{categories.map((category) => <button key={category} onClick={() => update("professional_categories", categories.filter((item) => item !== category))} className="rounded-full border border-violet-400/30 bg-violet-500/10 px-3 py-1.5 text-xs">{category} ×</button>)}<button onClick={() => { const value = window.prompt("Nueva categoría"); if (value?.trim()) update("professional_categories", [...categories, value.trim()]); }} className="rounded-full border border-dashed border-white/20 px-3 py-1.5 text-xs text-white/45">+ Agregar</button></div></div>
            <Field label="Ubicación" value={String(draft.location || "")} onChange={(value) => update("location", value)} />
            <Field label="Origen" value={String(draft.origin || "")} onChange={(value) => update("origin", value)} />
          </div> : null}

          {activeSection === "Presentación" ? <div className="space-y-4">
            <Field label="Frase principal" value={String(draft.tagline || "")} onChange={(value) => update("tagline", value)} />
            <TextArea label="Biografía corta" value={String(draft.short_bio || "")} onChange={(value) => update("short_bio", value)} rows={4} />
            <TextArea label="Presentación completa" value={String(draft.long_bio || "")} onChange={(value) => update("long_bio", value)} rows={10} />
            <Field label="Frase secundaria" value={String(draft.secondary_tagline || "")} onChange={(value) => update("secondary_tagline", value)} />
          </div> : null}

          {activeSection === "Imagen" ? <div className="space-y-4">
            <Field label="URL de foto" value={String(draft.profile_image_url || "")} onChange={(value) => update("profile_image_url", value)} />
            <Field label="URL de portada" value={String(draft.cover_url || "")} onChange={(value) => update("cover_url", value)} />
            <p className="rounded-xl border border-white/10 bg-white/[0.025] p-4 text-sm leading-6 text-white/45">Las imágenes importadas desde Instagram se copian al almacenamiento público de CLOUVA. La carga manual de archivos utiliza este mismo módulo de medios.</p>
          </div> : null}

          {activeSection === "Links" ? <div className="space-y-3">
            {links.map((link, index) => <div key={index} className="grid gap-2 rounded-2xl border border-white/10 p-4 sm:grid-cols-[140px_1fr_auto]">
              <select value={link.platform} onChange={(event) => updateLink(index, { platform: event.target.value })} className="rounded-xl border border-white/10 bg-black/30 px-3 py-2"><option value="instagram">Instagram</option><option value="spotify">Spotify</option><option value="youtube">YouTube</option><option value="tiktok">TikTok</option><option value="website">Sitio web</option><option value="contact">Contacto</option></select>
              <input value={link.url} onChange={(event) => updateLink(index, { url: event.target.value })} placeholder="https://..." className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 outline-none focus:border-violet-400/60" />
              <button onClick={() => removeLink(index)} className="rounded-xl border border-red-400/20 px-3 py-2 text-red-300">Quitar</button>
            </div>)}
            <button onClick={addLink} className="rounded-xl border border-dashed border-white/20 px-4 py-3 text-sm text-white/50">+ Agregar link</button>
          </div> : null}

          {activeSection === "Instagram" ? <div className="space-y-4">
            {connection ? <div className="rounded-2xl border border-violet-400/25 bg-violet-500/10 p-5"><p className="text-xs uppercase tracking-[0.2em] text-violet-300/70">Instagram conectado</p><p className="mt-2 text-xl font-semibold">@{connection.external_username || connection.display_name || "instagram"}</p><p className="mt-1 text-sm text-white/45">{connection.account_type || "Cuenta profesional"} · Estado: {connection.status}</p><div className="mt-5 flex flex-wrap gap-2"><button onClick={() => void syncInstagram()} disabled={saving} className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold">Importar nuevas publicaciones</button><button onClick={() => void connectInstagram()} disabled={saving} className="rounded-xl border border-white/15 px-4 py-2 text-sm">Reconectar</button><button onClick={() => void disconnectInstagram()} disabled={saving} className="rounded-xl border border-red-400/20 px-4 py-2 text-sm text-red-300">Desconectar</button></div></div> : <div className="rounded-2xl border border-dashed border-white/15 p-6 text-center"><p className="text-white/55">Instagram todavía no está conectado.</p><button onClick={() => void connectInstagram()} disabled={saving} className="mt-4 rounded-xl bg-gradient-to-r from-fuchsia-600 to-violet-600 px-5 py-3 font-semibold">Conectar Instagram</button></div>}
          </div> : null}

          {activeSection === "Privacidad y SEO" ? <div className="space-y-4">
            <div><Label>Visibilidad</Label><select value={String(draft.privacy_status || "public")} onChange={(event) => update("privacy_status", event.target.value)} className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3"><option value="public">Público e indexable</option><option value="unlisted">Público sin indexar</option><option value="private">Privado</option></select></div>
            <Field label="Título SEO" value={String(draft.seo_title || "")} onChange={(value) => update("seo_title", value)} />
            <TextArea label="Descripción SEO" value={String(draft.seo_description || "")} onChange={(value) => update("seo_description", value)} rows={4} />
            <Field label="Título al compartir" value={String(draft.share_title || "")} onChange={(value) => update("share_title", value)} />
            <TextArea label="Descripción al compartir" value={String(draft.share_description || "")} onChange={(value) => update("share_description", value)} rows={3} />
          </div> : null}

          {error ? <p className="mt-5 rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">{error}</p> : null}
          {message ? <p className="mt-5 rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-3 text-sm text-emerald-200">{message}</p> : null}
        </section>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <p className="mb-3 text-xs uppercase tracking-[0.2em] text-white/35">Preview móvil</p>
          <div className="mx-auto max-w-[340px] overflow-hidden rounded-[2.4rem] border-[6px] border-[#17131f] bg-[#07060b] shadow-2xl">
            <div className="relative h-40 bg-gradient-to-br from-violet-900/50 to-black">{draft.cover_url ? <img src={String(draft.cover_url)} alt="" className="h-full w-full object-cover" /> : null}<div className="absolute inset-0 bg-gradient-to-t from-[#07060b] to-transparent" /></div>
            <div className="relative px-5 pb-6">{draft.profile_image_url ? <img src={String(draft.profile_image_url)} alt="" className="-mt-10 h-20 w-20 rounded-2xl border-4 border-[#07060b] object-cover" /> : <div className="-mt-10 flex h-20 w-20 items-center justify-center rounded-2xl border-4 border-[#07060b] bg-violet-500/20 text-2xl font-semibold">{String(draft.display_name || "C").charAt(0)}</div>}<h2 className="mt-4 text-xl font-bold">{String(draft.display_name || "Tu Player")}</h2>{draft.username ? <p className="text-xs text-white/40">@{String(draft.username)}</p> : null}<p className="mt-3 text-sm leading-6 text-white/60">{String(draft.short_bio || draft.tagline || "Tu presentación aparecerá acá.")}</p><div className="mt-4 flex flex-wrap gap-1">{categories.slice(0, 4).map((category) => <span key={category} className="rounded-full bg-violet-500/10 px-2 py-1 text-[10px] text-violet-200">{category}</span>)}</div></div>
          </div>
        </aside>
      </div>
    </main>
  );
}

function Label({ children }: { children: React.ReactNode }) { return <label className="mb-2 block text-xs uppercase tracking-[0.18em] text-white/40">{children}</label>; }
function Field({ label, value, onChange, prefix }: { label: string; value: string; onChange: (value: string) => void; prefix?: string }) { return <div><Label>{label}</Label><div className="flex overflow-hidden rounded-xl border border-white/10 bg-black/30 focus-within:border-violet-400/60">{prefix ? <span className="border-r border-white/10 px-3 py-3 text-sm text-white/35">{prefix}</span> : null}<input value={value} onChange={(event) => onChange(event.target.value)} className="min-w-0 flex-1 bg-transparent px-4 py-3 outline-none" /></div></div>; }
function TextArea({ label, value, onChange, rows }: { label: string; value: string; onChange: (value: string) => void; rows: number }) { return <div><Label>{label}</Label><textarea rows={rows} value={value} onChange={(event) => onChange(event.target.value)} className="w-full resize-y rounded-xl border border-white/10 bg-black/30 px-4 py-3 outline-none focus:border-violet-400/60" /></div>; }
