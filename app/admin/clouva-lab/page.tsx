"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  Eye,
  History,
  LoaderCircle,
  MonitorSmartphone,
  Palette,
  RotateCcw,
  Save,
  Send,
  SlidersHorizontal,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { MobileHomeDashboard } from "@/components/clouva/MobileHomeDashboard";
import {
  DEFAULT_MOBILE_HOME_CONFIG,
  sanitizeMobileHomeConfig,
  type MobileHomeConfig,
  type MobileHomeSectionKey,
} from "@/lib/clouva-lab/mobile-home-config";

type VersionRow = {
  id: string;
  version_number: number;
  status: "published" | "restored" | "imported";
  source_version: number | null;
  note: string | null;
  created_at: string;
  created_by: string | null;
};

type UiPage = {
  id: string;
  slug: string;
  name: string;
  route: string;
  platform: string;
  draft_config: MobileHomeConfig;
  published_config: MobileHomeConfig;
  draft_revision: number;
  published_version: number;
  updated_at: string;
  published_at: string | null;
  versions: VersionRow[];
};

const WIDTHS = [360, 390, 412] as const;
const ROUTES = [
  "/mi-flow/avatar",
  "/matrix",
  "/creator-studio",
  "/mi-flow/music",
  "/tienda",
  "/perfil",
  "/studios/iglu",
] as const;

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm text-white/75">
      <span className="font-semibold text-white/85">{label}</span>
      {children}
      {hint ? <small className="text-xs leading-5 text-white/38">{hint}</small> : null}
    </label>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`min-h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-white outline-none transition focus:border-violet-400/55 focus:ring-2 focus:ring-violet-500/15 ${props.className ?? ""}`} />;
}

function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`min-h-24 w-full resize-y rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none transition focus:border-violet-400/55 focus:ring-2 focus:ring-violet-500/15 ${props.className ?? ""}`} />;
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`min-h-11 w-full rounded-xl border border-white/10 bg-[#0b0914] px-3 text-sm text-white outline-none transition focus:border-violet-400/55 ${props.className ?? ""}`} />;
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/25 px-3 text-left text-sm text-white/75">
      <span>{label}</span>
      <span className={`relative h-6 w-11 rounded-full transition ${checked ? "bg-violet-500" : "bg-white/12"}`}>
        <span className={`absolute top-1 h-4 w-4 rounded-full bg-white transition ${checked ? "left-6" : "left-1"}`} />
      </span>
    </button>
  );
}

function SectionPanel({ icon, title, description, children, open = false }: { icon: React.ReactNode; title: string; description: string; children: React.ReactNode; open?: boolean }) {
  return (
    <details open={open} className="group overflow-hidden rounded-2xl border border-white/10 bg-white/[0.025]">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-4">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-violet-500/10 text-violet-200">{icon}</span>
        <span className="min-w-0 flex-1">
          <strong className="block text-sm text-white">{title}</strong>
          <small className="block truncate text-xs text-white/38">{description}</small>
        </span>
        <ChevronDown className="h-4 w-4 text-white/35 transition group-open:rotate-180" />
      </summary>
      <div className="grid gap-4 border-t border-white/8 p-4">{children}</div>
    </details>
  );
}

export default function ClouvaLabPage() {
  const { session } = useAuth();
  const token = session?.access_token ?? null;
  const [pages, setPages] = useState<UiPage[]>([]);
  const [selectedSlug, setSelectedSlug] = useState("mobile-home");
  const [draft, setDraft] = useState<MobileHomeConfig>(DEFAULT_MOBILE_HOME_CONFIG);
  const [previewWidth, setPreviewWidth] = useState<(typeof WIDTHS)[number]>(390);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<"save" | "publish" | "restore" | null>(null);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [publishNote, setPublishNote] = useState("");

  const selectedPage = useMemo(() => pages.find((page) => page.slug === selectedSlug) ?? null, [pages, selectedSlug]);

  const load = useCallback(async (keepLocalDraft = false) => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/clouva-lab/pages", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "No se pudo cargar CLOUVA Lab");
      const nextPages = (payload.pages ?? []) as UiPage[];
      setPages(nextPages);
      const nextSelected = nextPages.find((page) => page.slug === selectedSlug) ?? nextPages[0] ?? null;
      if (nextSelected && !keepLocalDraft) {
        setSelectedSlug(nextSelected.slug);
        setDraft(sanitizeMobileHomeConfig(nextSelected.draft_config));
        setDirty(false);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  }, [selectedSlug, token]);

  useEffect(() => {
    void load();
  }, [load]);

  function edit(update: (current: MobileHomeConfig) => MobileHomeConfig) {
    setDraft((current) => sanitizeMobileHomeConfig(update(current)));
    setDirty(true);
    setMessage(null);
  }

  async function saveDraft(silent = false) {
    if (!token || !selectedPage) return false;
    setWorking("save");
    setError(null);
    if (!silent) setMessage(null);
    try {
      const response = await fetch(`/api/admin/clouva-lab/pages/${selectedPage.slug}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ config: draft }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "No se pudo guardar el borrador");
      setDirty(false);
      if (!silent) setMessage("Borrador guardado. La app pública todavía no cambió.");
      await load(true);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Error desconocido");
      return false;
    } finally {
      setWorking(null);
    }
  }

  async function publish() {
    if (!token || !selectedPage) return;
    setError(null);
    setMessage(null);
    if (dirty) {
      const saved = await saveDraft(true);
      if (!saved) return;
    }
    setWorking("publish");
    try {
      const response = await fetch(`/api/admin/clouva-lab/pages/${selectedPage.slug}/publish`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ note: publishNote }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "No se pudo publicar");
      setPublishNote("");
      setMessage(`Publicado como versión ${payload.publication?.version ?? "nueva"}. La Home ya puede leerla sin deploy.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Error desconocido");
    } finally {
      setWorking(null);
    }
  }

  async function restore(version: number) {
    if (!token || !selectedPage) return;
    if (!window.confirm(`¿Restaurar la versión ${version}? Se publicará como una versión nueva.`)) return;
    setWorking("restore");
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/clouva-lab/pages/${selectedPage.slug}/restore`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ version }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "No se pudo restaurar");
      setMessage(`Versión ${version} restaurada y publicada como versión ${payload.restoration?.version}.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Error desconocido");
    } finally {
      setWorking(null);
    }
  }

  function moveSection(section: MobileHomeSectionKey, direction: -1 | 1) {
    edit((current) => {
      const sections = [...current.sections];
      const index = sections.indexOf(section);
      const destination = index + direction;
      if (index < 0 || destination < 0 || destination >= sections.length) return current;
      [sections[index], sections[destination]] = [sections[destination], sections[index]];
      return { ...current, sections };
    });
  }

  if (loading && pages.length === 0) {
    return <div className="flex min-h-[50vh] items-center justify-center gap-3 text-white/55"><LoaderCircle className="h-5 w-5 animate-spin" /> Cargando CLOUVA Lab...</div>;
  }

  return (
    <div className="space-y-5 pb-16">
      <header className="overflow-hidden rounded-3xl border border-violet-400/20 bg-[radial-gradient(circle_at_top_right,rgba(124,58,237,0.30),transparent_44%),linear-gradient(145deg,rgba(8,8,16,0.99),rgba(20,10,38,0.98))] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.35)] md:p-7">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-violet-300/20 bg-violet-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-violet-200">
              <Sparkles className="h-4 w-4" /> Editor interno sin deploy
            </div>
            <h1 className="text-3xl font-black tracking-tight text-white md:text-4xl">CLOUVA LAB</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/62 md:text-base">
              Editá la interfaz con componentes controlados, revisá el borrador en tamaños reales, publicá cuando esté bien y volvé a una versión anterior sin tocar código.
            </p>
          </div>
          <div className="grid min-w-[250px] gap-2 sm:grid-cols-2 xl:grid-cols-1">
            <div className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3">
              <small className="text-white/38">Estado</small>
              <div className="mt-1 flex items-center gap-2 font-bold text-white">
                <span className={`h-2.5 w-2.5 rounded-full ${dirty ? "bg-amber-400" : "bg-emerald-400"}`} />
                {dirty ? "Borrador sin guardar" : "Borrador guardado"}
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3">
              <small className="text-white/38">Publicada</small>
              <div className="mt-1 font-bold text-white">Versión {selectedPage?.published_version ?? 0}</div>
            </div>
          </div>
        </div>
      </header>

      {error ? <div className="flex items-start gap-3 rounded-2xl border border-red-400/25 bg-red-500/10 p-4 text-sm text-red-100"><TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" /> {error}</div> : null}
      {message ? <div className="flex items-start gap-3 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-4 text-sm text-emerald-100"><Check className="mt-0.5 h-5 w-5 shrink-0" /> {message}</div> : null}

      <section className="grid gap-4 rounded-3xl border border-white/10 bg-white/[0.025] p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <Field label="Página">
          <Select value={selectedSlug} onChange={(event) => {
            const page = pages.find((candidate) => candidate.slug === event.target.value);
            if (!page) return;
            setSelectedSlug(page.slug);
            setDraft(sanitizeMobileHomeConfig(page.draft_config));
            setDirty(false);
          }}>
            {pages.map((page) => <option key={page.id} value={page.slug}>{page.name} · {page.platform}</option>)}
          </Select>
        </Field>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => {
            if (!selectedPage) return;
            setDraft(sanitizeMobileHomeConfig(selectedPage.published_config));
            setDirty(true);
            setMessage("Cargaste la versión publicada en el editor. Guardá para convertirla en borrador.");
          }} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-semibold text-white hover:bg-white/10">
            <RotateCcw className="h-4 w-4" /> Reiniciar al publicado
          </button>
          <button type="button" onClick={() => void saveDraft()} disabled={!dirty || working !== null} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-violet-300/20 bg-violet-500/15 px-4 text-sm font-bold text-violet-100 hover:bg-violet-500/25 disabled:opacity-40">
            {working === "save" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Guardar borrador
          </button>
        </div>
      </section>

      <div className="grid gap-5 2xl:grid-cols-[minmax(360px,0.82fr)_minmax(520px,1.18fr)]">
        <section className="space-y-3">
          <SectionPanel icon={<SlidersHorizontal className="h-4 w-4" />} title="Header" description="Marca, campana y avatar visual" open>
            <Field label="Texto del logo"><Input value={draft.header.logoText} onChange={(event) => edit((current) => ({ ...current, header: { ...current.header, logoText: event.target.value } }))} /></Field>
            <Field label="Avatar visual del header" hint="URL interna o HTTPS. No usa la foto real del Player."><Input value={draft.header.brandAvatarUrl} onChange={(event) => edit((current) => ({ ...current, header: { ...current.header, brandAvatarUrl: event.target.value } }))} /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Toggle label="Mostrar avatar" checked={draft.header.showBrandAvatar} onChange={(checked) => edit((current) => ({ ...current, header: { ...current.header, showBrandAvatar: checked } }))} />
              <Toggle label="Punto de notificación" checked={draft.header.showNotificationDot} onChange={(checked) => edit((current) => ({ ...current, header: { ...current.header, showNotificationDot: checked } }))} />
            </div>
          </SectionPanel>

          <SectionPanel icon={<Eye className="h-4 w-4" />} title="Hero principal" description="Textos, imagen, tamaño y acciones" open>
            <Field label="Texto pequeño"><Input value={draft.hero.eyebrow} onChange={(event) => edit((current) => ({ ...current, hero: { ...current.hero, eyebrow: event.target.value } }))} /></Field>
            <Field label="Título" hint="Usá Enter para decidir los saltos de línea."><Textarea value={draft.hero.title} onChange={(event) => edit((current) => ({ ...current, hero: { ...current.hero, title: event.target.value } }))} /></Field>
            <Field label="Subtítulo"><Input value={draft.hero.subtitle} onChange={(event) => edit((current) => ({ ...current, hero: { ...current.hero, subtitle: event.target.value } }))} /></Field>
            <Field label="Imagen del hero"><Input value={draft.hero.imageUrl} onChange={(event) => edit((current) => ({ ...current, hero: { ...current.hero, imageUrl: event.target.value } }))} /></Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={`Altura · ${draft.hero.height}px`}><Input type="range" min={240} max={620} value={draft.hero.height} onChange={(event) => edit((current) => ({ ...current, hero: { ...current.hero, height: Number(event.target.value) } }))} /></Field>
              <Field label={`Ancho texto · ${draft.hero.textWidth}%`}><Input type="range" min={38} max={75} value={draft.hero.textWidth} onChange={(event) => edit((current) => ({ ...current, hero: { ...current.hero, textWidth: Number(event.target.value) } }))} /></Field>
              <Field label={`Margen izquierdo · ${draft.hero.contentPaddingLeft}px`}><Input type="range" min={8} max={48} value={draft.hero.contentPaddingLeft} onChange={(event) => edit((current) => ({ ...current, hero: { ...current.hero, contentPaddingLeft: Number(event.target.value) } }))} /></Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Botón principal"><Input value={draft.hero.primaryLabel} onChange={(event) => edit((current) => ({ ...current, hero: { ...current.hero, primaryLabel: event.target.value } }))} /></Field>
              <Field label="Destino"><Select value={draft.hero.primaryHref} onChange={(event) => edit((current) => ({ ...current, hero: { ...current.hero, primaryHref: event.target.value } }))}>{ROUTES.map((route) => <option key={route}>{route}</option>)}</Select></Field>
              <Field label="Botón secundario"><Input value={draft.hero.secondaryLabel} onChange={(event) => edit((current) => ({ ...current, hero: { ...current.hero, secondaryLabel: event.target.value } }))} /></Field>
              <Field label="Destino"><Select value={draft.hero.secondaryHref} onChange={(event) => edit((current) => ({ ...current, hero: { ...current.hero, secondaryHref: event.target.value } }))}>{ROUTES.map((route) => <option key={route}>{route}</option>)}</Select></Field>
            </div>
          </SectionPanel>

          <SectionPanel icon={<MonitorSmartphone className="h-4 w-4" />} title="Reproductor" description="Portada, textos y estado visual">
            <Toggle label="Mostrar reproductor" checked={draft.music.visible} onChange={(checked) => edit((current) => ({ ...current, music: { ...current.music, visible: checked } }))} />
            <Field label="Portada"><Input value={draft.music.coverUrl} onChange={(event) => edit((current) => ({ ...current, music: { ...current.music, coverUrl: event.target.value } }))} /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Título"><Input value={draft.music.title} onChange={(event) => edit((current) => ({ ...current, music: { ...current.music, title: event.target.value } }))} /></Field>
              <Field label="Artista"><Input value={draft.music.artist} onChange={(event) => edit((current) => ({ ...current, music: { ...current.music, artist: event.target.value } }))} /></Field>
              <Field label="Tiempo actual"><Input value={draft.music.currentTime} onChange={(event) => edit((current) => ({ ...current, music: { ...current.music, currentTime: event.target.value } }))} /></Field>
              <Field label="Duración"><Input value={draft.music.duration} onChange={(event) => edit((current) => ({ ...current, music: { ...current.music, duration: event.target.value } }))} /></Field>
            </div>
            <Field label={`Progreso · ${draft.music.progress}%`}><Input type="range" min={0} max={100} value={draft.music.progress} onChange={(event) => edit((current) => ({ ...current, music: { ...current.music, progress: Number(event.target.value) } }))} /></Field>
          </SectionPanel>

          <SectionPanel icon={<Sparkles className="h-4 w-4" />} title="Tarjetas" description="Continuar creando y acceso al Iglú">
            {(["continue", "iglu"] as const).map((cardKey) => {
              const card = draft.cards[cardKey];
              return (
                <div key={cardKey} className="grid gap-3 rounded-2xl border border-white/8 bg-black/20 p-3">
                  <Toggle label={cardKey === "continue" ? "Mostrar Continuar creando" : "Mostrar Entrar al Iglú"} checked={card.visible} onChange={(checked) => edit((current) => ({ ...current, cards: { ...current.cards, [cardKey]: { ...current.cards[cardKey], visible: checked } } }))} />
                  <Field label="Título"><Textarea value={card.title} onChange={(event) => edit((current) => ({ ...current, cards: { ...current.cards, [cardKey]: { ...current.cards[cardKey], title: event.target.value } } }))} /></Field>
                  <Field label="Descripción"><Textarea value={card.body} onChange={(event) => edit((current) => ({ ...current, cards: { ...current.cards, [cardKey]: { ...current.cards[cardKey], body: event.target.value } } }))} /></Field>
                  <Field label="Imagen"><Input value={card.imageUrl} onChange={(event) => edit((current) => ({ ...current, cards: { ...current.cards, [cardKey]: { ...current.cards[cardKey], imageUrl: event.target.value } } }))} /></Field>
                  <Field label="Destino"><Select value={card.href} onChange={(event) => edit((current) => ({ ...current, cards: { ...current.cards, [cardKey]: { ...current.cards[cardKey], href: event.target.value } } }))}>{ROUTES.map((route) => <option key={route}>{route}</option>)}</Select></Field>
                </div>
              );
            })}
          </SectionPanel>

          <SectionPanel icon={<Palette className="h-4 w-4" />} title="Diseño" description="Paleta, espacios, curvas y orden">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Fondo"><Input type="color" value={draft.theme.backgroundColor} onChange={(event) => edit((current) => ({ ...current, theme: { ...current.theme, backgroundColor: event.target.value } }))} /></Field>
              <Field label="Acento"><Input type="color" value={draft.theme.accentColor} onChange={(event) => edit((current) => ({ ...current, theme: { ...current.theme, accentColor: event.target.value } }))} /></Field>
              <Field label="Acento secundario"><Input type="color" value={draft.theme.accentSecondary} onChange={(event) => edit((current) => ({ ...current, theme: { ...current.theme, accentSecondary: event.target.value } }))} /></Field>
              <Field label="Borde"><Input value={draft.theme.borderColor} onChange={(event) => edit((current) => ({ ...current, theme: { ...current.theme, borderColor: event.target.value } }))} /></Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={`Padding · ${draft.theme.pagePadding}px`}><Input type="range" min={8} max={28} value={draft.theme.pagePadding} onChange={(event) => edit((current) => ({ ...current, theme: { ...current.theme, pagePadding: Number(event.target.value) } }))} /></Field>
              <Field label={`Separación · ${draft.theme.sectionGap}px`}><Input type="range" min={4} max={32} value={draft.theme.sectionGap} onChange={(event) => edit((current) => ({ ...current, theme: { ...current.theme, sectionGap: Number(event.target.value) } }))} /></Field>
              <Field label={`Curvas · ${draft.theme.radius}px`}><Input type="range" min={8} max={36} value={draft.theme.radius} onChange={(event) => edit((current) => ({ ...current, theme: { ...current.theme, radius: Number(event.target.value) } }))} /></Field>
            </div>
            <div className="grid gap-2">
              <span className="text-sm font-semibold text-white/85">Orden de secciones</span>
              {draft.sections.map((section, index) => (
                <div key={section} className="flex min-h-11 items-center gap-3 rounded-xl border border-white/10 bg-black/25 px-3">
                  <span className="flex-1 text-sm capitalize text-white">{section === "features" ? "Tarjetas" : section === "music" ? "Reproductor" : "Hero"}</span>
                  <button type="button" disabled={index === 0} onClick={() => moveSection(section, -1)} className="grid h-8 w-8 place-items-center rounded-lg bg-white/5 text-white/65 disabled:opacity-20"><ArrowUp className="h-4 w-4" /></button>
                  <button type="button" disabled={index === draft.sections.length - 1} onClick={() => moveSection(section, 1)} className="grid h-8 w-8 place-items-center rounded-lg bg-white/5 text-white/65 disabled:opacity-20"><ArrowDown className="h-4 w-4" /></button>
                </div>
              ))}
            </div>
          </SectionPanel>
        </section>

        <section className="min-w-0 space-y-4 2xl:sticky 2xl:top-4 2xl:self-start">
          <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.025] p-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2 font-bold text-white"><Eye className="h-4 w-4 text-violet-300" /> Vista previa real</div>
              <p className="mt-1 text-xs text-white/38">Usa el mismo componente de producción con el borrador local.</p>
            </div>
            <div className="flex gap-1 rounded-xl border border-white/10 bg-black/25 p-1">
              {WIDTHS.map((width) => <button key={width} type="button" onClick={() => setPreviewWidth(width)} className={`min-h-9 rounded-lg px-3 text-xs font-bold ${previewWidth === width ? "bg-violet-500 text-white" : "text-white/50 hover:bg-white/5"}`}>{width}px</button>)}
            </div>
          </div>

          <div className="overflow-auto rounded-3xl border border-white/10 bg-[linear-gradient(135deg,#111019,#050507)] p-3 sm:p-5">
            <div className="mx-auto overflow-hidden rounded-[2.2rem] border-[6px] border-[#24232d] bg-black shadow-[0_28px_90px_rgba(0,0,0,0.6)]" style={{ width: previewWidth, maxWidth: "100%" }}>
              <MobileHomeDashboard configOverride={draft} previewMode />
            </div>
          </div>

          <section className="rounded-3xl border border-violet-300/15 bg-[linear-gradient(145deg,rgba(20,11,38,0.98),rgba(8,7,15,0.98))] p-4 md:p-5">
            <div className="flex items-center gap-2 text-lg font-black text-white"><Send className="h-5 w-5 text-violet-300" /> Publicar</div>
            <p className="mt-2 text-sm leading-6 text-white/50">Publicar copia el borrador validado a producción y crea una versión recuperable. No ejecuta Cloud Build.</p>
            <Textarea className="mt-4 min-h-20" placeholder="Nota de esta versión, por ejemplo: hero más bajo y nuevo fondo" value={publishNote} onChange={(event) => setPublishNote(event.target.value)} />
            <button type="button" onClick={() => void publish()} disabled={working !== null} className="mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-violet-600 px-5 font-black text-white shadow-[0_0_30px_rgba(124,58,237,0.3)] hover:bg-violet-500 disabled:opacity-50">
              {working === "publish" ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />} Publicar versión
            </button>
          </section>

          <section className="rounded-3xl border border-white/10 bg-white/[0.025] p-4 md:p-5">
            <div className="flex items-center gap-2 text-lg font-black text-white"><History className="h-5 w-5 text-violet-300" /> Versiones</div>
            <div className="mt-4 space-y-2">
              {(selectedPage?.versions ?? []).map((version) => (
                <div key={version.id} className="grid gap-3 rounded-2xl border border-white/8 bg-black/20 p-3 sm:grid-cols-[1fr_auto] sm:items-center">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="text-white">Versión {version.version_number}</strong>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${version.status === "restored" ? "bg-amber-400/10 text-amber-200" : version.status === "imported" ? "bg-sky-400/10 text-sky-200" : "bg-emerald-400/10 text-emerald-200"}`}>{version.status}</span>
                    </div>
                    <p className="mt-1 text-xs text-white/42">{version.note || "Sin nota"} · {new Date(version.created_at).toLocaleString("es-AR")}</p>
                  </div>
                  <button type="button" onClick={() => void restore(version.version_number)} disabled={working !== null || version.version_number === selectedPage?.published_version} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 text-xs font-bold text-white hover:bg-white/10 disabled:opacity-30">
                    <RotateCcw className="h-4 w-4" /> Restaurar
                  </button>
                </div>
              ))}
            </div>
          </section>
        </section>
      </div>
    </div>
  );
}
