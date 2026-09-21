"use client";

import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { PointerEvent, useMemo, useRef, useState } from "react";
import type { IgluAvailabilityRule, IgluCalendarEvent, IgluPublicPlayer } from "@/lib/server/iglu/public-app";
import styles from "./IgluFunctional.module.css";

const WEEKDAYS = ["LUN","MAR","MIÉ","JUE","VIE","SÁB","DOM"];

function monthLabel(date: Date) {
  return new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric" }).format(date).toUpperCase();
}

function dateKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function eventDateKey(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

function timeLabel(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("es-AR", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}

function kindLabel(kind: IgluCalendarEvent["kind"]) {
  if (kind === "show") return "Show";
  if (kind === "session") return "Sesión";
  if (kind === "occupied") return "Ocupado";
  return "Evento";
}

function dotClass(kind: IgluCalendarEvent["kind"]) {
  if (kind === "show") return styles.dotShow;
  if (kind === "session") return styles.dotSession;
  if (kind === "occupied") return styles.dotOccupied;
  return styles.dotEvent;
}

export function IgluUnifiedCalendar({
  players,
  events,
  availabilityRules,
  timezone,
  bookingEnabled,
}: {
  players: IgluPublicPlayer[];
  events: IgluCalendarEvent[];
  availabilityRules: IgluAvailabilityRule[];
  timezone: string;
  bookingEnabled: boolean;
}) {
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selected, setSelected] = useState(() => dateKey(new Date()));
  const [playerId, setPlayerId] = useState<string>("all");
  const [preview, setPreview] = useState<IgluCalendarEvent | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const filteredEvents = useMemo(() => events.filter((event) => playerId === "all" || event.playerId === playerId), [events, playerId]);
  const eventMap = useMemo(() => {
    const map = new Map<string, IgluCalendarEvent[]>();
    for (const event of filteredEvents) {
      const key = eventDateKey(event.startAt, timezone);
      map.set(key, [...(map.get(key) || []), event]);
    }
    return map;
  }, [filteredEvents, timezone]);

  const days = useMemo(() => {
    const year = month.getFullYear();
    const monthIndex = month.getMonth();
    const first = new Date(year, monthIndex, 1);
    const firstMondayIndex = (first.getDay() + 6) % 7;
    const count = new Date(year, monthIndex + 1, 0).getDate();
    const cells: Array<{ date: Date | null; key: string | null }> = [];
    for (let i = 0; i < firstMondayIndex; i += 1) cells.push({ date: null, key: null });
    for (let day = 1; day <= count; day += 1) {
      const date = new Date(year, monthIndex, day);
      cells.push({ date, key: dateKey(date) });
    }
    while (cells.length % 7) cells.push({ date: null, key: null });
    return cells;
  }, [month]);

  const selectedEvents = eventMap.get(selected) || [];
  const selectedDate = new Date(`${selected}T12:00:00`);
  const selectedWeekday = selectedDate.getDay();
  const hasPublishedAvailability = availabilityRules.some((rule) => rule.isAvailable && rule.weekday === selectedWeekday);

  function stopPress() {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = null;
  }

  function startPress(event: PointerEvent<HTMLButtonElement>, dayEvents: IgluCalendarEvent[]) {
    stopPress();
    if (!dayEvents.length) return;
    pressTimer.current = setTimeout(() => {
      setPreview(dayEvents[0]);
      if (navigator.vibrate) navigator.vibrate(20);
    }, 460);
    if (event.pointerType === "mouse") event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  return (
    <div className={styles.root}>
      <main className={styles.shell}>
        <Link className={styles.back} href="/lamatrix/estudios/eliglurecords">← Volver al IGLÚ</Link>
        <header className={styles.header}>
          <p className={styles.eyebrow}>IGLÚ RECORDS · AGENDA</p>
          <h1 className={styles.title}>RESERVAS</h1>
          <p className={styles.subtitle}>Agenda unificada del Studio y sus Players. Los eventos privados bloquean disponibilidad sin exponer su contenido.</p>
        </header>

        <section className={styles.section}>
          <div className={styles.sectionHead}><h2>Filtrar Player</h2><span>{players.length} vinculados</span></div>
          <div className={styles.chips}>
            <button type="button" className={styles.chip} onClick={() => setPlayerId("all")} style={{ borderColor: playerId === "all" ? "rgba(136,219,255,.8)" : undefined }}>IGLÚ / TODOS</button>
            {players.map((player) => <button type="button" key={player.id} className={styles.chip} onClick={() => setPlayerId(player.id)} style={{ borderColor: playerId === player.id ? "rgba(136,219,255,.8)" : undefined }}>{player.displayName}</button>)}
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <button type="button" className={styles.secondaryButton} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>←</button>
            <h2>{monthLabel(month)}</h2>
            <button type="button" className={styles.secondaryButton} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>→</button>
          </div>

          <div className={styles.calendar}>
            {WEEKDAYS.map((weekday) => <div className={styles.weekday} key={weekday}>{weekday}</div>)}
            {days.map((cell, index) => {
              if (!cell.date || !cell.key) return <div key={`blank-${index}`} />;
              const dayEvents = eventMap.get(cell.key) || [];
              return (
                <button
                  key={cell.key}
                  type="button"
                  className={`${styles.day} ${selected === cell.key ? styles.dayActive : ""}`}
                  onClick={() => {
                    setSelected(cell.key!);
                    if (preview) setPreview(null);
                  }}
                  onPointerDown={(event) => startPress(event, dayEvents)}
                  onPointerUp={stopPress}
                  onPointerCancel={stopPress}
                  onPointerLeave={stopPress}
                  aria-label={`${cell.key}, ${dayEvents.length} eventos`}
                >
                  {cell.date.getDate()}
                  {dayEvents.length ? <span className={styles.dots}>{dayEvents.slice(0, 4).map((event) => <i className={`${styles.dot} ${dotClass(event.kind)}`} key={`${event.id}-${event.startAt}`} />)}</span> : null}
                </button>
              );
            })}
          </div>

          <div className={styles.legend}>
            <span><i style={{ background: "#74e9a6" }} />Disponible publicado</span>
            <span><i style={{ background: "#ff6171" }} />Ocupado</span>
            <span><i style={{ background: "#3da7ff" }} />Sesión</span>
            <span><i style={{ background: "#b867ff" }} />Show</span>
          </div>
          <p className={styles.meta}>Mantené apretada una fecha con evento para ver una preview sin salir del calendario.</p>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHead}><h2>{selected}</h2><span>{selectedEvents.length ? `${selectedEvents.length} eventos` : hasPublishedAvailability ? "Disponibilidad publicada" : "Sin actividad pública"}</span></div>
          <div className={styles.grid}>
            {selectedEvents.map((event) => (
              <article className={styles.card} key={`${event.id}-${event.startAt}`}>
                <div className={styles.eventRow}>
                  <div className={styles.eventTime}>{timeLabel(event.startAt, timezone)}</div>
                  <div>
                    <p className={styles.cardTitle}>{event.title}</p>
                    <p className={styles.meta}>{kindLabel(event.kind)} · {timeLabel(event.startAt, timezone)}–{timeLabel(event.endAt, timezone)}{event.playerName ? ` · ${event.playerName}` : ""}{event.location ? ` · ${event.location}` : ""}</p>
                  </div>
                </div>
              </article>
            ))}
            {!selectedEvents.length && hasPublishedAvailability ? <div className={styles.empty}>No hay eventos que ocupen esta fecha y existe disponibilidad publicada. Abrí Reservar sesión para elegir un horario real.</div> : null}
            {!selectedEvents.length && !hasPublishedAvailability ? <div className={styles.empty}>No hay eventos públicos ni franjas de disponibilidad publicadas para este día.</div> : null}
          </div>
        </section>

        <div className={styles.bottomActions}>
          <Link className={bookingEnabled ? styles.primaryButton : styles.secondaryButton} style={{ width: "100%" }} href="/lamatrix/estudios/eliglurecords/reservar">
            <CalendarDays size={16} /> {bookingEnabled ? "Reservar sesión" : "Ver Players y disponibilidad"}
          </Link>
        </div>

        {preview ? (
          <div className={styles.preview} role="dialog" aria-live="polite">
            <p className={styles.eyebrow}>{kindLabel(preview.kind)}</p>
            <strong>{preview.title}</strong>
            <p>{timeLabel(preview.startAt, timezone)}–{timeLabel(preview.endAt, timezone)}{preview.playerName ? ` · ${preview.playerName}` : ""}</p>
            {preview.location ? <p>{preview.location}</p> : null}
            <button type="button" className={styles.secondaryButton} style={{ marginTop: 12 }} onClick={() => setPreview(null)}>Cerrar</button>
          </div>
        ) : null}
      </main>
    </div>
  );
}
