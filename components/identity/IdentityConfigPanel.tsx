"use client";

import { useEffect, useMemo, useState } from "react";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type IdentityKind = "player" | "studio";
type NavStyle = "pill" | "bar";
type Radius = "none" | "small" | "medium" | "large";

type IdentitySection = { type?: string; [key: string]: unknown };

export type IdentityLayoutConfig = {
  mode?: "reference_layout" | "adaptive_layout";
  layout_kind?: "template" | "precise";
  sections?: IdentitySection[];
  precise_sections?: IdentitySection[];
  page_style?: {
    theme?: "dark" | "light" | "mixed";
    palette?: {
      background?: string;
      surface?: string;
      text?: string;
      muted_text?: string;
      accent?: string;
      border?: string;
    } | null;
    radius?: Radius;
    nav_style?: NavStyle;
    header_overlay?: boolean;
  } | null;
  [key: string]: unknown;
};

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

const SECTION_LABEL: Record<string, string> = {
  hero: "Portada",
  about: "Sobre",
  pillars: "Pilares",
  gallery: "Galería",
  roster: "Players",
  services: "Servicios",
  membership: "Membresías",
  music: "Música",
  contact: "Contacto",
};

const PRESETS: Array<{
  id: string;
  label: string;
  accent: string;
  nav: NavStyle;
  radius: Radius;
  overlay: boolean;
}> = [
  { id: "clouva", label: "CLOUVA", accent: "#8f7cff", nav: "pill", radius: "medium", overlay: false },
  { id: "minimal", label: "Minimal", accent: "#d8d8df", nav: "bar", radius: "small", overlay: false },
  { id: "cinematic", label: "Cinematic", accent: "#b58cff", nav: "bar", radius: "none", overlay: true },
  { id: "neon", label: "Neon", accent: "#7cf7ff", nav: "pill", radius: "large", overlay: false },
];

function pageStyle(config: IdentityLayoutConfig) {
  return config.page_style ?? {};
}

function mergePageStyle(config: IdentityLayoutConfig, patch: NonNullable<IdentityLayoutConfig["page_style"]>): IdentityLayoutConfig {
  const current = pageStyle(config);
  return {
    ...config,
    page_style: {
      ...current,
      ...patch,
      palette: patch.palette ? { ...(current.palette ?? {}), ...patch.palette } : current.palette,
    },
  };
}

export function IdentityConfigPanel({
  versionId,
  kind,
  layoutConfig,
  onSaved,
}: {
  versionId: string;
  kind: IdentityKind;
  layoutConfig: IdentityLayoutConfig;
  onSaved?: () => void | Promise<void>;
}) {
  const [draft, setDraft] = useState<IdentityLayoutConfig>(layoutConfig);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(layoutConfig);
    setMessage(null);
    setError(null);
  }, [layoutConfig, versionId]);

  const style = pageStyle(draft);
  const accent = style.palette?.accent || "#8f7cff";
  const pickerAccent = HEX_COLOR_RE.test(accent) ? accent : "#8f7cff";
  const sectionKey = draft.layout_kind === "precise" ? "precise_sections" : "sections";
  const sections = useMemo(() => (Array.isArray(draft[sectionKey]) ? (draft[sectionKey] as IdentitySection[]) : []), [draft, sectionKey]);

  const setAccent = (value: string) => {
    setDraft((current) => mergePageStyle(current, { palette: { accent: value } }));
  };

  const setNav = (value: NavStyle) => {
    setDraft((current) => mergePageStyle(current, { nav_style: value }));
  };

  const setRadius = (value: Radius) => {
    setDraft((current) => mergePageStyle(current, { radius: value }));
  };

  const setOverlay = (value: boolean) => {
    setDraft((current) => mergePageStyle(current, { header_overlay: value }));
  };

  const applyPreset = (preset: (typeof PRESETS)[number]) => {
    setDraft((current) => mergePageStyle(current, {
      palette: { accent: preset.accent },
      nav_style: preset.nav,
      radius: preset.radius,
      ...(kind === "studio" ? { header_overlay: preset.overlay } : {}),
    }));
  };

  const moveSection = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= sections.length) return;
    const next = [...sections];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    setDraft((current) => ({ ...current, [sectionKey]: next }));
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await authenticatedFetch(`/api/vip-profile/versions/${versionId}`, {
        method: "PATCH",
        body: JSON.stringify({ layout_config: draft }),
      });
      await readApiJson(response);
      setMessage("Configuración guardada en esta versión.");
      await onSaved?.();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No se pudo guardar la configuración.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-2xl border border-violet-400/20 bg-violet-500/[0.035] p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-violet-300/70">Configuración de identidad</p>
          <p className="mt-1 text-sm text-white/50">
            {kind === "studio" ? "Ajustá la web del Estudio sin perder el diseño generado." : "Ajustá la web pública del Player sin salir del creador."}
          </p>
        </div>
        <span className="rounded-full border border-white/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-white/35">
          {draft.layout_kind === "precise" ? "Precise" : "Template"}
        </span>
      </div>

      <div className="mt-5">
        <p className="mb-2 text-[10px] uppercase tracking-[0.18em] text-white/35">Presets</p>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => applyPreset(preset)}
              className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-white/65 transition hover:border-violet-400/40 hover:text-white"
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-2 block text-[10px] uppercase tracking-[0.18em] text-white/35">Color principal</span>
          <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 p-2">
            <input type="color" value={pickerAccent} onChange={(event) => setAccent(event.target.value)} className="h-9 w-12 cursor-pointer rounded-lg border-0 bg-transparent" />
            <input value={accent} onChange={(event) => setAccent(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm uppercase outline-none" maxLength={7} />
          </div>
        </label>

        <label className="block">
          <span className="mb-2 block text-[10px] uppercase tracking-[0.18em] text-white/35">Navegación</span>
          <select value={style.nav_style ?? "pill"} onChange={(event) => setNav(event.target.value as NavStyle)} className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-sm outline-none">
            <option value="pill">Cápsula</option>
            <option value="bar">Barra</option>
          </select>
        </label>

        <label className="block">
          <span className="mb-2 block text-[10px] uppercase tracking-[0.18em] text-white/35">Bordes</span>
          <select value={style.radius ?? "medium"} onChange={(event) => setRadius(event.target.value as Radius)} className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-sm outline-none">
            <option value="none">Rectos</option>
            <option value="small">Suaves</option>
            <option value="medium">Medios</option>
            <option value="large">Grandes</option>
          </select>
        </label>

        {kind === "studio" && draft.layout_kind === "precise" ? (
          <label className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-white/65">
            <input type="checkbox" checked={style.header_overlay === true} onChange={(event) => setOverlay(event.target.checked)} />
            Navegación sobre la portada
          </label>
        ) : null}
      </div>

      {kind === "studio" && sections.length > 1 ? (
        <div className="mt-5">
          <p className="mb-2 text-[10px] uppercase tracking-[0.18em] text-white/35">Orden de secciones</p>
          <div className="grid gap-2">
            {sections.map((section, index) => (
              <div key={`${section.type || "section"}-${index}`} className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5">
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-white/[0.04] text-[10px] text-white/35">{index + 1}</span>
                <span className="min-w-0 flex-1 text-sm text-white/65">{SECTION_LABEL[String(section.type || "")] || String(section.type || "Sección")}</span>
                <button type="button" disabled={index === 0} onClick={() => moveSection(index, -1)} className="rounded-lg border border-white/10 px-2 py-1 text-xs disabled:opacity-25">↑</button>
                <button type="button" disabled={index === sections.length - 1} onClick={() => moveSection(index, 1)} className="rounded-lg border border-white/10 px-2 py-1 text-xs disabled:opacity-25">↓</button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <button type="button" disabled={saving} onClick={() => void save()} className="rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold disabled:opacity-50">
          {saving ? "Guardando..." : "Guardar configuración"}
        </button>
        <button type="button" disabled={saving} onClick={() => setDraft(layoutConfig)} className="rounded-xl border border-white/15 px-4 py-2.5 text-sm text-white/55 disabled:opacity-50">
          Descartar cambios
        </button>
      </div>

      {error ? <p className="mt-3 rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-xs text-red-200">{error}</p> : null}
      {message ? <p className="mt-3 rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-3 text-xs text-emerald-200">{message}</p> : null}
    </section>
  );
}
