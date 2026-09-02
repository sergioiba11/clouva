import Link from "next/link";
import { CalendarDays, Clock3, MapPin } from "lucide-react";

type PublicAgendaEvent = {
  title: string;
  description: string | null;
  event_type: string;
  start_at: string;
  end_at: string;
  event_timezone: string;
  all_day: boolean;
  status: string;
  location_type: string;
  location_text: string | null;
  location_url: string | null;
  recurrence_rule: string | null;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-AR", { weekday: "short", day: "numeric", month: "short" }).format(new Date(value));
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export function PublicAgendaSection({
  identityName,
  agendaHref,
  accent,
  events,
  bookingEnabled = false,
  compact = true,
  description = "Eventos, sesiones y fechas públicas de esta identidad.",
}: {
  identityName: string;
  agendaHref: string;
  accent: string;
  events: PublicAgendaEvent[];
  bookingEnabled?: boolean;
  compact?: boolean;
  description?: string;
}) {
  const visible = compact ? events.slice(0, 4) : events;
  return (
    <section id="agenda" className="border-t border-white/10 bg-[#07060b] text-white" style={{ "--public-accent": accent } as React.CSSProperties}>
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[color:var(--public-accent)]/75">Agenda de {identityName}</p>
            <h2 className="mt-2 text-2xl font-black tracking-[-0.035em]">Próximos flows</h2>
            <p className="mt-1 text-sm text-white/42">{description}</p>
          </div>
          {compact ? <Link href={agendaHref} className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.035] px-4 py-2 text-xs font-semibold transition hover:border-[color:var(--public-accent)]/45"><CalendarDays size={14} /> Ver Agenda</Link> : null}
        </div>

        {visible.length ? (
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {visible.map((event, index) => (
              <article key={`${event.start_at}-${event.title}-${index}`} className="rounded-2xl border border-white/10 bg-white/[0.025] p-4 transition hover:border-[color:var(--public-accent)]/35">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--public-accent)]/70">{event.event_type || "evento"}</p>
                <h3 className="mt-2 text-base font-semibold">{event.title}</h3>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-white/48">
                  <span className="inline-flex items-center gap-1.5"><CalendarDays size={13} /> {formatDate(event.start_at)}</span>
                  {!event.all_day ? <span className="inline-flex items-center gap-1.5"><Clock3 size={13} /> {formatTime(event.start_at)} – {formatTime(event.end_at)}</span> : null}
                  {event.location_text ? <span className="inline-flex items-center gap-1.5"><MapPin size={13} /> {event.location_text}</span> : null}
                </div>
                {event.description ? <p className="mt-3 line-clamp-2 text-xs leading-5 text-white/42">{event.description}</p> : null}
                {event.location_url ? <a href={event.location_url} target="_blank" rel="noreferrer" className="mt-3 inline-block text-xs font-semibold text-[color:var(--public-accent)]">Abrir link</a> : null}
              </article>
            ))}
          </div>
        ) : (
          <div className="mt-5 rounded-2xl border border-dashed border-white/10 bg-white/[0.015] px-5 py-10 text-center">
            <CalendarDays className="mx-auto text-white/20" />
            <p className="mt-3 text-sm text-white/38">No hay fechas públicas próximas.</p>
          </div>
        )}

        {bookingEnabled ? <p className="mt-4 text-xs text-white/35">Esta Agenda también tiene disponibilidad para reservas cuando el servicio correspondiente lo habilita.</p> : null}
      </div>
    </section>
  );
}
