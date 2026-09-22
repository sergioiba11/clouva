import Link from "next/link";
import { CalendarDays, ExternalLink, Images, MapPin, ScanLine, Sparkles } from "lucide-react";
import { PlayerOwnerActions } from "./PlayerOwnerActions";
import { PublicShell } from "./PublicShell";
import { parsePlayerSocialLinks, type Player, type PlayerMedia, type PlayerStudioAffiliation } from "@/lib/players-data";

function visibleImage(item: PlayerMedia) {
  return item.thumbnail_url || item.public_url || null;
}

export function MikeTattooPlayerView({
  player,
  affiliations,
  media,
  isVip,
}: {
  player: Player;
  affiliations: PlayerStudioAffiliation[];
  media: PlayerMedia[];
  isVip: boolean;
}) {
  const accent = player.accent_color || "#a970ff";
  const cover = player.cover_url || player.hero_image_url;
  const socials = parsePlayerSocialLinks(player.social_links);
  const categories = Array.from(new Set([
    ...(player.professional_categories || []),
    ...(player.disciplines || []),
    ...(player.primary_role ? [player.primary_role] : []),
  ])).filter(Boolean).slice(0, 8);
  const portfolio = media.filter((item) => Boolean(visibleImage(item))).slice(0, 9);
  const location = player.location || player.origin;
  const studio = affiliations.find((entry) => entry.is_primary && entry.studio)?.studio || affiliations.find((entry) => entry.studio)?.studio || null;

  return (
    <PublicShell
      brand={player.display_name}
      brandHref={"/" + player.slug}
      accent={accent}
      navStyle="bar"
      navLinks={[
        { label: "Inicio", href: "#inicio" },
        { label: "Tinta", href: "#tinta" },
        { label: "Flow", href: "#flow" },
        { label: "Contacto", href: "#contacto" },
      ]}
      footer={<span>{player.display_name} · Tattoo Flow · CLOUVA</span>}
    >
      <section id="inicio" className="relative isolate min-h-[76vh] overflow-hidden border-b border-white/[0.08]">
        {cover ? <img src={cover} alt="" className="absolute inset-0 -z-30 h-full w-full object-cover opacity-30" /> : null}
        <div className="absolute inset-0 -z-20 bg-[radial-gradient(circle_at_72%_28%,var(--public-accent),transparent_28rem)] opacity-20" />
        <div className="absolute inset-0 -z-20 bg-[linear-gradient(112deg,#050407_0%,rgba(5,4,7,.96)_42%,rgba(5,4,7,.42)_72%,#050407_100%)]" />
        <div className="pointer-events-none absolute inset-0 -z-10 opacity-[0.08] bg-[repeating-linear-gradient(0deg,transparent_0px,transparent_5px,#fff_6px)]" />

        <div className="mx-auto grid min-h-[76vh] max-w-7xl items-center gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[1.15fr_.85fr] lg:py-24">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-[color:var(--public-accent)]/35 bg-[color:var(--public-accent)]/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-[color:var(--public-accent)]">
                Tattoo / Sound / Player
              </span>
              {isVip ? <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/55">VIP</span> : null}
            </div>

            <p className="mt-8 text-[10px] font-bold uppercase tracking-[0.32em] text-white/35">Archivo vivo</p>
            <h1 className="mt-2 max-w-4xl text-6xl font-black uppercase leading-[0.82] tracking-[-0.075em] sm:text-8xl lg:text-[8.3rem]">
              {player.display_name}
            </h1>
            {player.tagline || player.short_bio ? <p className="mt-7 max-w-2xl text-lg font-medium leading-7 text-white/70 sm:text-xl">{player.tagline || player.short_bio}</p> : null}
            {player.long_bio ? <p className="mt-4 max-w-2xl text-sm leading-6 text-white/42">{player.long_bio}</p> : null}

            <div className="mt-7 flex flex-wrap gap-2">
              {categories.map((category) => (
                <span key={category} className="rounded-lg border border-white/[0.09] bg-black/35 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.13em] text-white/48">
                  {category}
                </span>
              ))}
            </div>

            <div className="mt-8 flex flex-wrap gap-3">
              <a href="#tinta" className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-bold text-black">
                <Images size={15} /> Ver tinta
              </a>
              <Link href={"/" + player.slug + "/agenda"} className="inline-flex items-center gap-2 rounded-full border border-[color:var(--public-accent)]/45 bg-[color:var(--public-accent)]/10 px-5 py-3 text-sm font-bold text-[color:var(--public-accent)]">
                <CalendarDays size={15} /> Turnos
              </Link>
            </div>

            <PlayerOwnerActions ownerUserId={player.owner_user_id} />

            <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-white/35">
              {location ? <span className="inline-flex items-center gap-1.5"><MapPin size={13} /> {location}</span> : null}
              {studio ? <span>{studio.public_name || studio.name}</span> : null}
            </div>
          </div>

          <div className="relative mx-auto w-full max-w-[460px]">
            <div className="absolute -inset-8 rounded-full bg-[color:var(--public-accent)]/15 blur-3xl" />
            <div className="relative aspect-[4/5] overflow-hidden rounded-[42px] border border-white/10 bg-[#0b0810] shadow-2xl">
              {player.profile_image_url ? (
                <img src={player.profile_image_url} alt={player.display_name} className="h-full w-full object-cover grayscale-[18%] contrast-110" />
              ) : (
                <div className="grid h-full place-items-center text-[9rem] font-black text-white/10">{player.display_name.charAt(0)}</div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent" />
              <div className="absolute inset-x-5 bottom-5 rounded-2xl border border-white/10 bg-black/55 p-4 backdrop-blur-xl">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-[color:var(--public-accent)]">Ink signature</p>
                    <p className="mt-1 text-sm font-semibold">{player.public_identity_label || player.primary_role || "Tattoo Artist"}</p>
                  </div>
                  <ScanLine size={20} className="text-[color:var(--public-accent)]" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="tinta" className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-24">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[color:var(--public-accent)]">Tinta / archivo</p>
            <h2 className="mt-2 text-4xl font-black uppercase tracking-[-0.045em] sm:text-6xl">Piezas que hablan</h2>
          </div>
          <p className="max-w-md text-sm leading-6 text-white/38">El portfolio usa el contenido real publicado por el Player. Cada pieza puede conservar nombre, historia y referencia.</p>
        </div>

        {portfolio.length ? (
          <div className="mt-9 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {portfolio.map((item, index) => {
              const image = visibleImage(item);
              return (
                <a
                  key={item.id}
                  href={item.source_url || image || "#"}
                  target={item.source_url ? "_blank" : undefined}
                  rel={item.source_url ? "noreferrer" : undefined}
                  className={"group relative overflow-hidden rounded-[26px] border border-white/[0.08] bg-white/[0.025] " + (index === 0 ? "col-span-2 row-span-2" : "")}
                >
                  <div className={index === 0 ? "aspect-square" : "aspect-[4/5]"}>
                    {image ? <img src={image} alt={item.caption || "Tattoo"} className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.035]" /> : null}
                  </div>
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-4 pt-14">
                    <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-[color:var(--public-accent)]">{item.origin || "archivo"}</p>
                    {item.caption ? <p className="mt-1 line-clamp-2 text-sm font-semibold text-white/85">{item.caption}</p> : null}
                  </div>
                </a>
              );
            })}
          </div>
        ) : (
          <div className="mt-9 rounded-[30px] border border-dashed border-white/10 bg-white/[0.02] p-10">
            <Images size={28} className="text-[color:var(--public-accent)]" />
            <h3 className="mt-4 text-xl font-semibold">El archivo se arma desde el Player.</h3>
            <p className="mt-2 max-w-xl text-sm leading-6 text-white/40">Cuando Mike publique fotos, diseños o trabajos terminados, aparecen acá sin duplicar el contenido.</p>
          </div>
        )}
      </section>

      <section id="flow" className="border-y border-white/[0.08] bg-white/[0.018]">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20">
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[color:var(--public-accent)]">Tattoo Flow</p>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            {[
              ["01", "IDEA", "Referencia, concepto, zona del cuerpo y estilo quedan dentro del mismo flujo."],
              ["02", "PIEZA", "Diseño, variantes y archivo visual viven conectados al Player y al Spot."],
              ["03", "TURNO", "Agenda, seguimiento y cobro se resuelven con las herramientas reales de CLOUVA."],
            ].map(([step, title, copy]) => (
              <article key={step} className="rounded-[26px] border border-white/[0.08] bg-black/25 p-6">
                <span className="text-xs font-black text-[color:var(--public-accent)]">{step}</span>
                <h3 className="mt-8 text-2xl font-black tracking-[-0.035em]">{title}</h3>
                <p className="mt-3 text-sm leading-6 text-white/40">{copy}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="contacto" className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="rounded-[34px] border border-[color:var(--public-accent)]/25 bg-[color:var(--public-accent)]/[0.055] p-6 sm:p-9">
          <div className="flex flex-col justify-between gap-7 md:flex-row md:items-end">
            <div>
              <span className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[color:var(--public-accent)]"><Sparkles size={13} /> Contacto</span>
              <h2 className="mt-3 text-3xl font-black uppercase tracking-[-0.04em] sm:text-5xl">Hablemos de la pieza.</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              {socials.map((social) => (
                <a key={social.platform + social.url} href={social.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/30 px-4 py-2.5 text-xs font-semibold text-white/65 transition hover:text-white">
                  {social.label || social.platform} <ExternalLink size={12} />
                </a>
              ))}
              {player.contact_email ? <a href={"mailto:" + player.contact_email} className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/30 px-4 py-2.5 text-xs font-semibold text-white/65 transition hover:text-white">Mail <ExternalLink size={12} /></a> : null}
            </div>
          </div>
        </div>
      </section>
    </PublicShell>
  );
}
