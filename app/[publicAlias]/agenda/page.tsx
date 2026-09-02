import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, CalendarDays, Clock3, MapPin } from "lucide-react";
import { notFound } from "next/navigation";
import { PublicShell } from "@/components/public/PublicShell";
import { loadPublicAgendaByPlayer } from "@/lib/server/agenda";
import { resolvePlayerAlias } from "@/lib/server/public-identity-data";
import { createAdminSupabase } from "@/lib/server/supabase";
import { VISUAL_ASSETS } from "@/lib/visual-assets";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ publicAlias: string }> }): Promise<Metadata> {
  const { publicAlias } = await params;
  const result = await resolvePlayerAlias(publicAlias).catch(() => null);
  if (!result) return { title: "Agenda no encontrada — CLOUVA", robots: { index: false, follow: false } };
  return {
    title: `Agenda de ${result.player.display_name} — CLOUVA`,
    description: `Eventos, sesiones y fechas públicas de ${result.player.display_name}.`,
    alternates: { canonical: `https://clouva.com.ar/${result.canonicalAlias}/agenda` },
  };
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(value));
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export default async function PlayerPublicAgendaPage({ params }: { params: Promise<{ publicAlias: string }> }) {
  const { publicAlias } = await params;
  const result = await resolvePlayerAlias(publicAlias);
  if (!result) notFound();
  const publicAgenda = await loadPublicAgendaByPlayer({ admin: createAdminSupabase(), playerId: result.player.id });
  if (!publicAgenda) notFound();

  const player = result.player;
  const accent = result.layoutConfig?.page_style?.palette?.accent || player.accent_color || "#8f7cff";
  const navStyle = result.layoutConfig?.page_style?.nav_style ?? "pill";
  const cover = player.cover_url || player.hero_image_url || VISUAL_ASSETS["player-public-profile-cover-01"];

  return (
    <PublicShell
      brand="LA MATRIX"
      brandHref="/matrix"
      accent={accent}
      navStyle={navStyle}
      navLinks={[
        { label: "Player", href: `/${result.canonicalAlias}` },
        { label: "Agenda", href: `/${result.canonicalAlias}/agenda` },
        { label: "Players", href: "/players" },
        { label: "Estudios", href: "/studios" },
      ]}
    >
      <section className="relative isolate overflow-hidden border-b border-white/10">
        <div className="absolute inset-0 -z-30 bg-cover bg-center" style={{ backgroundImage: `url(${cover})` }} />
        <div className="absolute inset-0 -z-20 bg-[linear-gradient(90deg,#07060b_0%,rgba(7,6,11,.93)_44%,rgba(7,6,11,.45)_100%)]" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-t from-[#07060b] via-transparent to-transparent" />
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14">
          <Link href={`/${result.canonicalAlias}`} className="inline-flex items-center gap-2 text-xs font-semibold text-white/45 transition hover:text-white"><ArrowLeft size={14} /> Volver al Player</Link>
          <div className="mt-8 flex items-center gap-4">
            {player.profile_image_url ? <img src={player.profile_image_url} alt="" className="h-16 w-16 rounded-full border-2 border-[color:var(--public-accent)]/55 object-cover" /> : <span className="grid h-16 w-16 place-items-center rounded-full border-2 border-[color:var(--public-accent)]/55 bg-[color:var(--public-accent)]/15 text-2xl font-black">{player.display_name.charAt(0)}</span>}
            <div><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[color:var(--public-accent)]/75">PLAYER · AGENDA</p><h1 className="mt-1 text-4xl font-black tracking-[-0.05em] sm:text-5xl">{player.display_name}</h1>{player.username ? <p className="mt-1 text-sm text-white/40">@{player.username}</p> : null}</div>
          </div>
          <p className="mt-6 max-w-xl text-sm leading-6 text-white/55">Eventos, sesiones, lanzamientos y fechas que este Player decidió hacer públicas.</p>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <div className="flex items-end justify-between gap-4"><div><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[color:var(--public-accent)]/70">Próximas fechas</p><h2 className="mt-2 text-2xl font-black">Agenda pública</h2></div>{publicAgenda.agenda.booking_enabled ? <span className="rounded-full border border-[color:var(--public-accent)]/25 bg-[color:var(--public-accent)]/10 px-3 py-1.5 text-xs text-[color:var(--public-accent)]">Reservas habilitadas</span> : null}</div>

        {publicAgenda.events.length ? (
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {publicAgenda.events.map((event) => (
              <article key={event.id} className="rounded-2xl border border-white/10 bg-white/[0.025] p-5 transition hover:border-[color:var(--public-accent)]/35">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[color:var(--public-accent)]/70">{event.event_type}</p>
                <h3 className="mt-2 text-lg font-semibold">{event.title}</h3>
                <div className="mt-4 grid gap-2 text-xs text-white/48">
                  <p className="flex items-center gap-2"><CalendarDays size={14} /> {formatDate(event.start_at)}</p>
                  {!event.all_day ? <p className="flex items-center gap-2"><Clock3 size={14} /> {formatTime(event.start_at)} – {formatTime(event.end_at)}</p> : null}
                  {event.location_text ? <p className="flex items-center gap-2"><MapPin size={14} /> {event.location_text}</p> : null}
                </div>
                {event.description ? <p className="mt-4 text-sm leading-6 text-white/50">{event.description}</p> : null}
                {event.location_url ? <a href={event.location_url} target="_blank" rel="noreferrer" className="mt-4 inline-flex rounded-full border border-white/10 px-4 py-2 text-xs font-semibold text-[color:var(--public-accent)]">Abrir ubicación / link</a> : null}
              </article>
            ))}
          </div>
        ) : <div className="mt-6 rounded-2xl border border-dashed border-white/10 bg-white/[0.015] py-16 text-center"><CalendarDays className="mx-auto text-white/20" /><p className="mt-3 text-sm text-white/38">No hay fechas públicas próximas.</p></div>}
      </section>
    </PublicShell>
  );
}
