"use client";

import Link from "next/link";
import {
  BarChart3,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Home,
  List,
  Menu,
  UserRound,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { IgluAvailabilityRule, IgluCalendarEvent, IgluPublicPlayer } from "@/lib/server/iglu/public-app";
import styles from "./IgluFunctional.module.css";

const PACK_ROOT =
  "https://storage.googleapis.com/clouva-generated-media/admin-assets/brand/clouva-logo/shared/other";
const BACKGROUND = `${PACK_ROOT}/06_background_base_musical_iglu.png`;
const LOGO = `${PACK_ROOT}/02_logo_iglu_records_neon_hielo.png`;

const WEEKDAYS = ["LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB", "DOM"];
const IGLU_HOME = "/lamatrix/estudios/eliglurecords";
const IGLU_RESERVE = `${IGLU_HOME}/reservar`;

function monthLabel(date: Date) {
  return new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric" }).format(date).toUpperCase();
}

function fullDayLabel(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long" })
    .format(new Date(year, month - 1, day))
    .toUpperCase();
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

function durationLabel(startAt: string, endAt: string) {
  const minutes = Math.max(0, Math.round((new Date(endAt).getTime() - new Date(startAt).getTime()) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

function kindLabel(kind: IgluCalendarEvent["kind"]) {
  if (kind === "show") return "Show";
  if (kind === "session") return "Sesión";
  if (kind === "occupied") return "Ocupado";
  return "Evento";
}

function statusClass(kind: IgluCalendarEvent["kind"] | "available") {
  if (kind === "show") return styles.statusShow;
  if (kind === "session") return styles.statusSession;
  if (kind === "occupied") return styles.statusOccupied;
  if (kind === "available") return styles.statusAvailable;
  return styles.statusEvent;
}

function minutes(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function hhmm(value: number) {
  const normalized = ((value % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

function wallToIso(dayKey: string, time: string, timeZone: string) {
  const [year, month, day] = dayKey.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  let guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  for (let index = 0; index < 4; index += 1) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(guess);
    const part = (type: string) => Number(parts.find((entry) => entry.type === type)?.value || "0");
    const actual = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"));
    const desired = Date.UTC(year, month - 1, day, hour, minute, 0);
    const delta = desired - actual;
    if (!delta) break;
    guess = new Date(guess.getTime() + delta);
  }
  return guess.toISOString();
}

function ruleContains(rule: IgluAvailabilityRule, minute: number, durationMinutes: number) {
  const start = minutes(rule.startLocal);
  let end = minutes(rule.endLocal);
  let candidate = minute;
  if (end <= start) end += 1440;
  if (candidate < start && end > 1440) candidate += 1440;
  return candidate >= start && candidate + durationMinutes <= end;
}

function availableTimes(args: {
  selected: string;
  playerId: string;
  rules: IgluAvailabilityRule[];
  events: IgluCalendarEvent[];
  timezone: string;
}) {
  const { selected, playerId, rules, events, timezone } = args;
  const [year, month, day] = selected.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
  const studioPositive = rules.filter((rule) => rule.playerId == null && rule.isAvailable && rule.weekday === weekday);
  const playerPositive = playerId === "all"
    ? []
    : rules.filter((rule) => rule.playerId === playerId && rule.isAvailable && rule.weekday === weekday);
  const studioNegative = rules.filter((rule) => rule.playerId == null && !rule.isAvailable && rule.weekday === weekday);
  const playerNegative = playerId === "all"
    ? []
    : rules.filter((rule) => rule.playerId === playerId && !rule.isAvailable && rule.weekday === weekday);

  let source: IgluAvailabilityRule[] = [];
  if (playerId === "all") source = studioPositive;
  else if (playerPositive.length) source = playerPositive;
  else source = studioPositive;

  if (!source.length) return [] as string[];

  const durationMinutes = 60;
  const candidates = new Set<string>();
  for (const rule of source) {
    const start = minutes(rule.startLocal);
    let end = minutes(rule.endLocal);
    if (end <= start) end += 1440;
    for (let current = start; current + durationMinutes <= end; current += 30) {
      if (current >= 1440) break;
      if (playerId !== "all" && studioPositive.length && !studioPositive.some((studioRule) => ruleContains(studioRule, current, durationMinutes))) continue;
      if (studioNegative.some((block) => ruleContains(block, current, durationMinutes))) continue;
      if (playerNegative.some((block) => ruleContains(block, current, durationMinutes))) continue;
      candidates.add(hhmm(current));
    }
  }

  return [...candidates].filter((time) => {
    const start = new Date(wallToIso(selected, time, timezone)).getTime();
    const end = start + durationMinutes * 60_000;
    return !events.some((event) => {
      const relevant = playerId === "all"
        ? event.playerId == null
        : event.playerId == null || event.playerIds.includes(playerId);
      if (!relevant) return false;
      const eventStart = new Date(event.startAt).getTime();
      const eventEnd = new Date(event.endAt).getTime();
      return eventStart < end && eventEnd > start;
    });
  }).sort();
}

export function IgluUnifiedCalendar({
  players,
  events,
  availabilityRules,
  timezone,
  bookingEnabled,
  studioId,
}: {
  players: IgluPublicPlayer[];
  events: IgluCalendarEvent[];
  availabilityRules: IgluAvailabilityRule[];
  timezone: string;
  bookingEnabled: boolean;
  studioId: string;
}) {
  const router = useRouter();
  const todayKey = dateKey(new Date());
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selected, setSelected] = useState(todayKey);
  const [playerId, setPlayerId] = useState<string>("all");
  const [preview, setPreview] = useState<IgluCalendarEvent | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => router.refresh(), 250);
    };

    const channel = supabase
      .channel(`iglu-public-calendar-${studioId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "bookings", filter: `studio_id=eq.${studioId}` }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "agenda_events" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "agenda_availability_rules" }, scheduleRefresh)
      .subscribe();

    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      void supabase.removeChannel(channel);
    };
  }, [router, studioId]);

  const filteredEvents = useMemo(
    () => events.filter((event) => playerId === "all" || event.playerId == null || event.playerIds.includes(playerId)),
    [events, playerId],
  );

  const eventMap = useMemo(() => {
    const map = new Map<string, IgluCalendarEvent[]>();
    for (const event of filteredEvents) {
      const key = eventDateKey(event.startAt, timezone);
      map.set(key, [...(map.get(key) || []), event]);
    }
    return map;
  }, [filteredEvents, timezone]);

  const availableByDay = useMemo(() => {
    const map = new Map<string, string[]>();
    const year = month.getFullYear();
    const monthIndex = month.getMonth();
    const count = new Date(year, monthIndex + 1, 0).getDate();
    for (let day = 1; day <= count; day += 1) {
      const key = dateKey(new Date(year, monthIndex, day));
      const values = availableTimes({
        selected: key,
        playerId,
        rules: availabilityRules,
        events: filteredEvents,
        timezone,
      });
      if (values.length) map.set(key, values);
    }
    return map;
  }, [availabilityRules, filteredEvents, month, playerId, timezone]);

  const days = useMemo(() => {
    const year = month.getFullYear();
    const monthIndex = month.getMonth();
    const first = new Date(year, monthIndex, 1);
    const firstMondayIndex = (first.getDay() + 6) % 7;
    const count = new Date(year, monthIndex + 1, 0).getDate();
    const cells: Array<{ date: Date | null; key: string | null }> = [];
    for (let index = 0; index < firstMondayIndex; index += 1) cells.push({ date: null, key: null });
    for (let day = 1; day <= count; day += 1) {
      const date = new Date(year, monthIndex, day);
      cells.push({ date, key: dateKey(date) });
    }
    while (cells.length % 7) cells.push({ date: null, key: null });
    return cells;
  }, [month]);

  const selectedEvents = useMemo(
    () => (eventMap.get(selected) || []).sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime()),
    [eventMap, selected],
  );
  const selectedAvailable = availableByDay.get(selected) || [];
  const selectedPlayer = players.find((player) => player.id === playerId) || null;

  const scheduleRows = useMemo(() => {
    const eventRows = selectedEvents.map((event) => ({
      key: `event-${event.id}-${event.startAt}`,
      time: timeLabel(event.startAt, timezone),
      sort: new Date(event.startAt).getTime(),
      kind: event.kind as IgluCalendarEvent["kind"] | "available",
      event,
    }));
    const availableRows = selectedAvailable.map((time) => ({
      key: `available-${selected}-${time}-${playerId}`,
      time,
      sort: new Date(wallToIso(selected, time, timezone)).getTime(),
      kind: "available" as const,
      event: null,
    }));
    return [...eventRows, ...availableRows].sort((a, b) => a.sort - b.sort);
  }, [playerId, selected, selectedAvailable, selectedEvents, timezone]);

  const inlinePreview = preview || selectedEvents.find((event) => event.public) || selectedEvents[0] || null;

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
    <div className={styles.calendarRoot}>
      <div className={styles.calendarBackdrop} style={{ backgroundImage: `url("${BACKGROUND}")` }} aria-hidden="true" />
      <main className={styles.calendarShell}>
        <div className={styles.calendarTop}>
          <Link className={styles.calendarRoundButton} href={IGLU_HOME} aria-label="Volver al IGLÚ">
            <ChevronLeft size={21} />
          </Link>
          <div className={styles.calendarBrand}>
            <img src={LOGO} alt="IGLÚ Records" />
          </div>
          <div className={styles.calendarTopActions}>
            <button className={styles.calendarRoundButton} type="button" aria-label="Menú"><Menu size={21} /></button>
          </div>
        </div>

        <header className={styles.calendarTitleBlock}>
          <h1>RESERVAS</h1>
          <p>ESTUDIO · PLAYERS · SHOWS</p>
        </header>

        <section className={`${styles.glassPanel} ${styles.calendarPanel}`}>
          <div className={styles.calendarMonthBar}>
            <button className={styles.monthArrow} type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Mes anterior">
              <ChevronLeft />
            </button>
            <strong>{monthLabel(month)}</strong>
            <button className={styles.monthArrow} type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Mes siguiente">
              <ChevronRight />
            </button>
          </div>

          <div className={styles.calendarWeek}>
            {WEEKDAYS.map((weekday) => <span key={weekday}>{weekday}</span>)}
          </div>

          <div className={styles.calendarGrid}>
            {days.map((cell, index) => {
              if (!cell.date || !cell.key) return <div className={styles.calendarBlank} key={`blank-${index}`} />;
              const dayEvents = eventMap.get(cell.key) || [];
              const dayAvailable = availableByDay.get(cell.key) || [];
              return (
                <button
                  key={cell.key}
                  type="button"
                  className={[
                    styles.calendarCell,
                    selected === cell.key ? styles.calendarCellSelected : "",
                    todayKey === cell.key ? styles.calendarCellToday : "",
                  ].filter(Boolean).join(" ")}
                  onClick={() => {
                    setSelected(cell.key!);
                    setPreview(dayEvents.find((event) => event.public) || dayEvents[0] || null);
                  }}
                  onPointerDown={(event) => startPress(event, dayEvents)}
                  onPointerUp={stopPress}
                  onPointerCancel={stopPress}
                  onPointerLeave={stopPress}
                  aria-label={`${cell.key}, ${dayEvents.length} eventos, ${dayAvailable.length} horarios disponibles`}
                >
                  <span className={styles.calendarCellNumber}>{cell.date.getDate()}</span>
                  <span className={styles.calendarCellDots}>
                    {dayAvailable.length ? <i className={`${styles.statusDot} ${styles.statusAvailable}`} /> : null}
                    {dayEvents.slice(0, 3).map((event) => (
                      <i className={`${styles.statusDot} ${statusClass(event.kind)}`} key={`${event.id}-${event.startAt}`} />
                    ))}
                  </span>
                </button>
              );
            })}
          </div>

          {inlinePreview ? (
            <div className={styles.inlinePreview}>
              <p className={styles.inlinePreviewType}>
                <i className={`${styles.statusDot} ${statusClass(inlinePreview.kind)}`} />
                {kindLabel(inlinePreview.kind)}
              </p>
              <h3>{inlinePreview.title}</h3>
              <p>{timeLabel(inlinePreview.startAt, timezone)}–{timeLabel(inlinePreview.endAt, timezone)} · {durationLabel(inlinePreview.startAt, inlinePreview.endAt)}</p>
              {inlinePreview.playerName ? <p>{inlinePreview.playerName}</p> : null}
              {inlinePreview.location ? <p>{inlinePreview.location}</p> : null}
            </div>
          ) : null}

          <div className={styles.calendarLegend}>
            <span><i className={`${styles.statusDot} ${styles.statusAvailable}`} />Disponible</span>
            <span><i className={`${styles.statusDot} ${styles.statusOccupied}`} />Ocupado</span>
            <span><i className={`${styles.statusDot} ${styles.statusShow}`} />Show</span>
            <span><i className={`${styles.statusDot} ${styles.statusSession}`} />Sesión</span>
          </div>
        </section>

        <section className={`${styles.glassPanel} ${styles.dayPanel}`}>
          <div className={styles.dayPanelHead}>
            <h2>{fullDayLabel(selected)}</h2>
            <span>{selectedAvailable.length ? `${selectedAvailable.length} horarios disponibles` : selectedEvents.length ? `${selectedEvents.length} eventos` : "Sin horarios publicados"}</span>
          </div>

          <div className={styles.playerRail} aria-label="Players con presencia en El Iglú">
            <button
              type="button"
              className={`${styles.playerBubble} ${playerId === "all" ? styles.playerBubbleActive : ""}`}
              onClick={() => setPlayerId("all")}
            >
              <span className={styles.playerBubbleAvatar}>⌂</span>
              <strong>Iglú</strong>
              <small>Todos</small>
            </button>
            {players.map((player) => (
              <button
                type="button"
                className={`${styles.playerBubble} ${playerId === player.id ? styles.playerBubbleActive : ""}`}
                onClick={() => setPlayerId(player.id)}
                key={player.id}
              >
                <span className={styles.playerBubbleAvatar}>
                  {player.avatar ? <img src={player.avatar} alt="" /> : player.displayName.slice(0, 1).toUpperCase()}
                  {player.isPro ? <span className={styles.proBadge}>PRO</span> : null}
                </span>
                <strong>{player.displayName}</strong>
                <small>{player.role || player.primaryRole || "Player"}</small>
              </button>
            ))}
          </div>

          <div className={styles.scheduleList}>
            {scheduleRows.map((row) => {
              if (row.kind === "available") {
                const query = new URLSearchParams({ date: selected, time: row.time });
                if (playerId !== "all") query.set("player", playerId);
                return (
                  <article className={styles.scheduleRow} key={row.key}>
                    <div className={styles.scheduleTime}><strong>{row.time}</strong><small>1 h</small></div>
                    <i className={`${styles.statusDot} ${styles.statusAvailable}`} />
                    <div className={styles.scheduleInfo}>
                      <strong>Disponible</strong>
                      <span>{selectedPlayer ? selectedPlayer.displayName : "Estudio Iglú"}</span>
                    </div>
                    <Link className={styles.scheduleAction} href={`${IGLU_RESERVE}?${query.toString()}`}>Reservar</Link>
                  </article>
                );
              }

              const event = row.event!;
              return (
                <article className={styles.scheduleRow} key={row.key}>
                  <div className={styles.scheduleTime}><strong>{row.time}</strong><small>{durationLabel(event.startAt, event.endAt)}</small></div>
                  <i className={`${styles.statusDot} ${statusClass(event.kind)}`} />
                  <div className={styles.scheduleInfo}>
                    <strong>{event.title}</strong>
                    <span>{kindLabel(event.kind)}{event.playerName ? ` · ${event.playerName}` : ""}{event.location ? ` · ${event.location}` : ""}</span>
                  </div>
                  {event.kind === "occupied" ? (
                    <span className={`${styles.scheduleAction} ${styles.scheduleActionMuted}`}>Ocupado</span>
                  ) : (
                    <button className={styles.scheduleAction} type="button" onClick={() => setPreview(event)}>Ver detalle</button>
                  )}
                </article>
              );
            })}

            {!scheduleRows.length ? (
              <div className={styles.empty}>
                No hay eventos ni disponibilidad publicada para {selectedPlayer ? selectedPlayer.displayName : "el IGLÚ"} ese día.
              </div>
            ) : null}
          </div>

          {!availabilityRules.length ? (
            <p className={styles.meta} style={{ marginTop: 12 }}>
              Las franjas “Disponible” aparecen únicamente cuando el Studio o el Player publica disponibilidad en la Agenda canónica de CLOUVA.
            </p>
          ) : null}
        </section>
      </main>

      <nav className={styles.igluBottomNav} aria-label="Navegación IGLÚ">
        <Link href={IGLU_HOME}><Home /><span>INICIO</span></Link>
        <Link href="/iglu/pagos-unicos"><List /><span>CARTA/MENU</span></Link>
        <Link className={styles.igluBottomCenter} href={IGLU_HOME}><CalendarDays /><span>IGLÚ</span></Link>
        <Link href="/iglu/sesiones"><BarChart3 /><span>SESIONES</span></Link>
        <Link href={`${IGLU_HOME}/perfil`}><UserRound /><span>PERFIL</span></Link>
      </nav>
    </div>
  );
}
