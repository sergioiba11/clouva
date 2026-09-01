"use client";

import type { SocialLink } from "@/lib/players-data";
import { SOCIAL_EDITOR_PLATFORMS, getSocialPlatformDefinition, normalizeSocialPlatform } from "@/lib/social-platforms";
import { SocialBrandIcon } from "@/components/public/SocialBrandIcon";

type Props = {
  links: SocialLink[];
  onChange: (links: SocialLink[]) => void;
};

function normalizeOrder(links: SocialLink[]) {
  return links.map((link, index) => ({ ...link, display_order: index }));
}

export function SocialLinksEditor({ links, onChange }: Props) {
  const add = () => onChange(normalizeOrder([...links, {
    platform: "website",
    label: "",
    username: "",
    url: "",
    is_visible: true,
    display_order: links.length,
  }]));

  const patch = (index: number, changes: Partial<SocialLink>) => {
    onChange(normalizeOrder(links.map((link, itemIndex) => itemIndex === index ? { ...link, ...changes } : link)));
  };

  const remove = (index: number) => onChange(normalizeOrder(links.filter((_, itemIndex) => itemIndex !== index)));

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= links.length) return;
    const next = [...links];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(normalizeOrder(next));
  };

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-4 text-sm leading-6 text-white/45">
        Estas son las redes que se muestran en tu Player. Podés ordenar, ocultar o completar el usuario sin cambiar la conexión autenticada de Instagram, Spotify o YouTube.
      </div>
      {links.map((link, index) => {
        const platform = normalizeSocialPlatform(link.platform);
        const definition = getSocialPlatformDefinition(platform);
        return (
          <div key={`${index}-${platform}`} className="rounded-2xl border border-white/10 p-4">
            <div className="grid gap-3 md:grid-cols-[170px_minmax(0,1fr)]">
              <label className="grid gap-2 text-xs text-white/45">
                Plataforma
                <span className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-3">
                  <SocialBrandIcon icon={definition.icon} className="h-4 w-4 shrink-0" />
                  <select
                    value={SOCIAL_EDITOR_PLATFORMS.some((item) => item.value === platform) ? platform : "website"}
                    onChange={(event) => patch(index, { platform: event.target.value })}
                    className="min-w-0 flex-1 bg-transparent py-2.5 outline-none"
                  >
                    {SOCIAL_EDITOR_PLATFORMS.map((item) => <option key={item.value} value={item.value} className="bg-[#0b0913]">{item.label}</option>)}
                  </select>
                </span>
              </label>
              <label className="grid gap-2 text-xs text-white/45">
                URL
                <input value={link.url} onChange={(event) => patch(index, { url: event.target.value })} placeholder="https://..." className="rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none focus:border-violet-400/60" />
              </label>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="grid gap-2 text-xs text-white/45">
                Usuario / handle
                <input value={link.username || ""} onChange={(event) => patch(index, { username: event.target.value })} placeholder="@usuario" className="rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none focus:border-violet-400/60" />
              </label>
              <label className="grid gap-2 text-xs text-white/45">
                Etiqueta personalizada
                <input value={link.label || ""} onChange={(event) => patch(index, { label: event.target.value })} placeholder={definition.label} className="rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none focus:border-violet-400/60" />
              </label>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => patch(index, { is_visible: link.is_visible === false })} className={`rounded-xl border px-3 py-2 text-xs ${link.is_visible === false ? "border-white/10 text-white/40" : "border-violet-400/30 bg-violet-500/10 text-violet-200"}`}>
                {link.is_visible === false ? "Oculto" : "Visible"}
              </button>
              <button type="button" onClick={() => move(index, -1)} disabled={index === 0} className="rounded-xl border border-white/10 px-3 py-2 text-xs text-white/55 disabled:opacity-25">Subir</button>
              <button type="button" onClick={() => move(index, 1)} disabled={index === links.length - 1} className="rounded-xl border border-white/10 px-3 py-2 text-xs text-white/55 disabled:opacity-25">Bajar</button>
              <span className="text-[10px] uppercase tracking-wider text-white/25">Orden {index + 1}</span>
              <button type="button" onClick={() => remove(index)} className="ml-auto rounded-xl border border-red-400/20 px-3 py-2 text-xs text-red-300">Quitar</button>
            </div>
          </div>
        );
      })}
      <button type="button" onClick={add} className="rounded-xl border border-dashed border-white/20 px-4 py-3 text-sm text-white/50">+ Agregar red o link</button>
    </div>
  );
}
