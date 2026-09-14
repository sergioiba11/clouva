"use client";

import Link from "next/link";
import { ChevronRight, Citrus, FlaskConical, Heart, Info, Leaf, Sparkles, Zap } from "lucide-react";

export type StrainRecord = {
  id: string;
  slug: string;
  name: string;
  subtitle: string | null;
  description: string | null;
  strain_type: string | null;
  hero_image: string | null;
  profile: string | null;
  tags: string[] | null;
  aromas: string[] | null;
  is_featured: boolean;
  is_published: boolean;
};

export type StrainEffects = {
  relaxation: number | null;
  creativity: number | null;
  energy: number | null;
  happiness: number | null;
  focus: number | null;
};

export type TerpeneRecord = {
  id: string;
  terpene: string;
  description: string | null;
  aroma: string | null;
  relative_value: number | null;
};

export type FlavorRecord = {
  id: string;
  flavor: string;
  value: number | null;
};

function fallbackBackground(slug: string) {
  if (slug === "pineapple") {
    return "radial-gradient(circle at 52% 18%, rgba(245,166,52,.38), transparent 24%), radial-gradient(circle at 20% 45%, rgba(72,153,78,.28), transparent 35%), linear-gradient(155deg,#163b25 0%,#071d13 48%,#02100b 100%)";
  }
  return "radial-gradient(circle at 50% 14%, rgba(132,184,96,.24), transparent 30%), linear-gradient(155deg,#123522 0%,#061b12 55%,#02100b 100%)";
}

export function StrainCard({ strain, saved = false }: { strain: StrainRecord; saved?: boolean }) {
  return (
    <Link
      href={`/player/plus18/cocos/${encodeURIComponent(strain.slug)}`}
      className="group relative min-h-[240px] overflow-hidden rounded-[28px] border border-white/10 bg-[#0a2418] shadow-[0_24px_80px_rgba(0,0,0,.22)] transition duration-300 hover:-translate-y-1 hover:border-amber-200/25"
    >
      <div className="absolute inset-0" style={{ background: fallbackBackground(strain.slug) }} />
      {strain.hero_image ? (
        <img
          src={strain.hero_image}
          alt={strain.name}
          className="absolute inset-0 h-full w-full object-cover opacity-80 transition duration-500 group-hover:scale-[1.03]"
        />
      ) : null}
      <div className="absolute inset-0 bg-gradient-to-t from-[#020d08] via-[#03140c]/30 to-transparent" />
      <div className="absolute left-5 top-5 flex items-center gap-2 rounded-full border border-white/10 bg-black/25 px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] text-white/65 backdrop-blur-xl">
        <Leaf className="h-3.5 w-3.5 text-amber-300" />
        {strain.strain_type || "Genética"}
      </div>
      {saved ? (
        <span className="absolute right-5 top-5 rounded-full border border-amber-200/20 bg-amber-300/10 p-2 text-amber-300 backdrop-blur-xl" aria-label="Guardada">
          <Heart className="h-4 w-4 fill-current" />
        </span>
      ) : null}
      <div className="absolute inset-x-0 bottom-0 p-5">
        <p className="text-xs uppercase tracking-[0.24em] text-amber-200/70">{strain.subtitle || "Perfil visual"}</p>
        <h2 className="mt-1 font-serif text-3xl text-[#fff8e8]">{strain.name}</h2>
        <p className="mt-2 line-clamp-1 text-sm text-white/55">{strain.profile || strain.tags?.join(" · ") || "Explorar ficha"}</p>
      </div>
    </Link>
  );
}

function polarToCartesian(cx: number, cy: number, radius: number, angle: number) {
  const radians = ((angle - 90) * Math.PI) / 180;
  return { x: cx + radius * Math.cos(radians), y: cy + radius * Math.sin(radians) };
}

function arcPath(cx: number, cy: number, radius: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(cx, cy, radius, endAngle);
  const end = polarToCartesian(cx, cy, radius, startAngle);
  const largeArc = endAngle - startAngle <= 180 ? "0" : "1";
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 0 ${end.x} ${end.y}`;
}

export function StrainEffectsWheel({ effects }: { effects: StrainEffects | null }) {
  const items = [
    { key: "relaxation", label: "Relajación", value: effects?.relaxation ?? null, icon: "✦", accent: "#f6a62f" },
    { key: "creativity", label: "Creatividad", value: effects?.creativity ?? null, icon: "◌", accent: "#f6a62f" },
    { key: "energy", label: "Energía", value: effects?.energy ?? null, icon: "ϟ", accent: "#8ae58b" },
    { key: "happiness", label: "Felicidad", value: effects?.happiness ?? null, icon: "☺", accent: "#f6a62f" },
    { key: "focus", label: "Concentración", value: effects?.focus ?? null, icon: "◎", accent: "#8ae58b" },
  ] as const;

  return (
    <section className="mx-auto w-full max-w-[430px]">
      <div className="relative aspect-square w-full rounded-full border border-amber-100/15 bg-[radial-gradient(circle_at_center,rgba(10,44,27,.96)_0%,rgba(3,25,15,.9)_56%,rgba(2,15,9,.96)_100%)] shadow-[0_0_80px_rgba(245,166,47,.08)]">
        <svg className="absolute inset-0 h-full w-full -rotate-[18deg]" viewBox="0 0 320 320" aria-hidden="true">
          {items.map((item, index) => {
            const start = index * 72 + 5;
            const end = start + 62;
            const normalized = item.value == null ? 0 : Math.max(0, Math.min(10, item.value)) / 10;
            const progressEnd = start + 62 * normalized;
            return (
              <g key={item.key}>
                <path d={arcPath(160, 160, 132, start, end)} fill="none" stroke="rgba(255,255,255,.12)" strokeWidth="17" strokeLinecap="round" />
                {normalized > 0 ? (
                  <path d={arcPath(160, 160, 132, start, progressEnd)} fill="none" stroke={item.accent} strokeWidth="17" strokeLinecap="round" />
                ) : null}
              </g>
            );
          })}
          <circle cx="160" cy="160" r="86" fill="rgba(3,22,13,.92)" stroke="rgba(255,235,194,.18)" />
        </svg>

        <div className="absolute left-1/2 top-1/2 flex h-[43%] w-[43%] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full border border-amber-100/10 bg-[#051b10]/85 text-center backdrop-blur-xl">
          <Leaf className="mb-2 h-8 w-8 text-[#9ac879]" strokeWidth={1.4} />
          <span className="text-[9px] uppercase leading-[1.55] tracking-[0.28em] text-white/75">Buenas<br />ideas<br />naturalmente</span>
          <span className="mt-2 h-px w-7 bg-amber-300/80" />
        </div>

        {items.map((item, index) => {
          const angle = -90 + index * 72;
          const radius = 38;
          const x = 50 + Math.cos((angle * Math.PI) / 180) * radius;
          const y = 50 + Math.sin((angle * Math.PI) / 180) * radius;
          return (
            <div key={item.key} className="absolute w-[29%] -translate-x-1/2 -translate-y-1/2 text-center" style={{ left: `${x}%`, top: `${y}%` }}>
              <div className="text-lg" style={{ color: item.accent }}>{item.icon}</div>
              <p className="mt-0.5 text-[10px] font-medium leading-tight text-white/88 sm:text-xs">{item.label}</p>
              <p className="mt-1 text-sm font-semibold" style={{ color: item.accent }}>{item.value == null ? "—" : `${item.value}/10`}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function InfoCard({
  title,
  text,
  kind,
  onClick,
}: {
  title: string;
  text: string;
  kind: "aroma" | "terpenes" | "profile" | "info";
  onClick?: () => void;
}) {
  const icon = kind === "aroma"
    ? <Citrus className="h-7 w-7" />
    : kind === "terpenes"
      ? <FlaskConical className="h-7 w-7" />
      : kind === "profile"
        ? <Sparkles className="h-7 w-7" />
        : <Info className="h-7 w-7" />;

  const content = (
    <>
      <span className="text-amber-300">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-100/70">{title}</span>
        <span className="mt-1 block line-clamp-2 text-sm leading-5 text-white/72">{text}</span>
      </span>
      {onClick ? <ChevronRight className="h-5 w-5 shrink-0 text-white/35" /> : null}
    </>
  );

  const className = "flex min-h-[106px] items-center gap-3 rounded-[24px] border border-amber-100/12 bg-white/[0.045] p-4 text-left shadow-[inset_0_1px_0_rgba(255,255,255,.04)] backdrop-blur-xl transition hover:border-amber-200/25 hover:bg-white/[0.065]";

  return onClick ? (
    <button type="button" onClick={onClick} className={className}>{content}</button>
  ) : (
    <div className={className}>{content}</div>
  );
}

export function EmptyEffectsNote() {
  return (
    <div className="mt-3 flex items-start gap-2 rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 text-xs leading-5 text-white/45">
      <Zap className="mt-0.5 h-4 w-4 shrink-0 text-amber-300/70" />
      Los valores sin data aparecen como “—”. CLOUVA no inventa puntuaciones para completar la rueda.
    </div>
  );
}
