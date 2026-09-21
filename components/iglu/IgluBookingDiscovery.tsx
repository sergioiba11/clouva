"use client";

import Link from "next/link";
import {
  BarChart3,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Home,
  List,
  MapPin,
  UserRound,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { IgluAvailabilityRule, IgluCalendarEvent, IgluPublicPlayer } from "@/lib/server/iglu/public-app";
import styles from "./IgluFunctional.module.css";

type Service = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  price_type: string;
  price: number | null;
  currency: string;
  duration_minutes: number | null;
};

type MePlayer = {
  id?: string;
  location?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

type NearbyProducer = {
  id: string;
  slug: string;
  displayName: string;
  primaryRole: string | null;
  disciplines: string[];
  location: string | null;
  latitude: number | null;
  longitude: number | null;
  avatar: string | null;
  isVerified: boolean;
  isPro: boolean;
  bookingEnabled: boolean;
  hasAvailability: boolean;
  distanceKm: number | null;
  zoneMatch: boolean;
};

const PACK_ROOT =
  "https://storage.googleapis.com/clouva-generated-media/admin-assets/brand/clouva-logo/shared/other";
const BACKGROUND = `${PACK_ROOT}/06_background_base_musical_iglu.png`;
const LOGO = `${PACK_ROOT}/02_logo_iglu_records_neon_hielo.png`;
const IGLU_HOME = "/lamatrix/estudios/eliglurecords";

const WEEKDAYS = ["LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB", "DOM"];

function producerLike(player: IgluPublicPlayer) {
  const values = [player.role, player.primaryRole, ...player.disciplines].filter(Boolean).map((value) => String(value).toLowerCase());
  return values.some((value) => value.includes("productor") || value.includes("producer") || value.includes("beatmaker") || value.includes("engineer") || value.includes("ingeniero"));
}

function dateKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function monthLabel(date: Date) {
  return new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric" }).format(date).toUpperCase();
}

function dateKeyInZone(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

function wallToIso(dayKey: string, hhmm: string, timeZone: string) {
  const [year, month, day] = dayKey.split("-").map(Number);
  const [hour, minute] = hhmm.split(":").map(Number);
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
    const value = (type: string) => Number(parts.find((part) => part.type === type)?.value || "0");
    const actual = Date.UTC(value("year"), value("month") - 1, value("day"), value("hour"), value("minute"), value("second"));
    const desired = Date.UTC(year, month - 1, day, hour, minute, 0);
    const delta = desired - actual;
    if (!delta) break;
    guess = new Date(guess.getTime() + delta);
  }
  return guess.toISOString();
}

function minutes(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function hhmm(value: number) {
  const normalized = ((value % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

function ruleContains(rule: IgluAvailabilityRule, minute: number, durationMinutes: number) {
  const start = minutes(rule.startLocal);
  let end = minutes(rule.endLocal);
  let candidate = minute;
  if (end <= start) end += 1440;
  if (candidate < start && end > 1440) candidate += 1440;
  return candidate >= start && candidate + durationMinutes <= end;
}

function formatMoney(value: number | null, currency: string) {
  if (value == null) return "Consultar";
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: currency || "ARS", maximumFractionDigits: 0 }).format(value);
}

function buildSlots(args: {
  dayKey: string;
  playerId: string;
  durationMinutes: number;
  rules: IgluAvailabilityRule[];
  events: IgluCalendarEvent[];
  timezone: string;
}) {
  const { dayKey, playerId, durationMinutes, rules, events, timezone } = args;
  const [year, month, day] = dayKey.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
  const studioPositive = rules.filter((rule) => rule.playerId == null && rule.isAvailable && rule.weekday === weekday);
  const playerPositive = rules.filter((rule) => rule.playerId === playerId && rule.isAvailable && rule.weekday === weekday);
  const studioNegative = rules.filter((rule) => rule.playerId == null && !rule.isAvailable && rule.weekday === weekday);
  const playerNegative = rules.filter((rule) => rule.playerId === playerId && !rule.isAvailable && rule.weekday === weekday);
  const source = playerPositive.length ? playerPositive : studioPositive;
  if (!source.length) return [] as string[];

  const candidates = new Set<string>();
  for (const rule of source) {
    const start = minutes(rule.startLocal);
    let end = minutes(rule.endLocal);
    if (end <= start) end += 1440;
    for (let current = start; current + durationMinutes <= end; current += 30) {
      if (current >= 1440) break;
      if (studioPositive.length && !studioPositive.some((studioRule) => ruleContains(studioRule, current, durationMinutes))) continue;
      if (studioNegative.some((block) => ruleContains(block, current, durationMinutes))) continue;
      if (playerNegative.some((block) => ruleContains(block, current, durationMinutes))) continue;
      candidates.add(hhmm(current));
    }
  }

  return [...candidates].filter((time) => {
    const start = new Date(wallToIso(dayKey, time, timezone)).getTime();
    const end = start + durationMinutes * 60_000;
    return !events.some((event) => {
      if (event.playerId != null && event.playerId !== playerId) return false;
      if (dateKeyInZone(event.startAt, timezone) !== dayKey) return false;
      const eventStart = new Date(event.startAt).getTime();
      const eventEnd = new Date(event.endAt).getTime();
      return eventStart < end && eventEnd > start;
    });
  }).sort();
}

export function IgluBookingDiscovery({
  studioId,
  players,
  services,
  events,
  availabilityRules,
  bookingEnabled,
  timezone,
  initialDate,
  initialTime,
  initialPlayerId,
}: {
  studioId: string;
  players: IgluPublicPlayer[];
  services: Service[];
  events: IgluCalendarEvent[];
  availabilityRules: IgluAvailabilityRule[];
  bookingEnabled: boolean;
  timezone: string;
  initialDate?: string | null;
  initialTime?: string | null;
  initialPlayerId?: string | null;
}) {
  const today = dateKey(new Date());
  const validInitialPlayer = initialPlayerId && players.some((player) => player.id === initialPlayerId) ? initialPlayerId : null;
  const producerPlayers = useMemo(() => {
    const producers = players.filter(producerLike);
    return producers.length ? producers : players;
  }, [players]);

  const [me, setMe] = useState<MePlayer | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [nearby, setNearby] = useState<NearbyProducer[]>([]);
  const [nearbyLoading, setNearbyLoading] = useState(true);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(validInitialPlayer);
  const [serviceId, setServiceId] = useState(services[0]?.id || "");
  const [selectedDate, setSelectedDate] = useState(initialDate && /^\d{4}-\d{2}-\d{2}$/.test(initialDate) ? initialDate : today);
  const [slot, setSlot] = useState(initialTime && /^\d{2}:\d{2}$/.test(initialTime) ? initialTime : "");
  const [month, setMonth] = useState(() => {
    const [year, monthNumber] = selectedDate.split("-").map(Number);
    return new Date(year, monthNumber - 1, 1);
  });
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/players/me", { cache: "no-store", credentials: "include" })
      .then(async (response) => {
        if (response.status === 401) {
          setAuthRequired(true);
          return null;
        }
        if (!response.ok) return null;
        const payload = await response.json() as { player?: MePlayer | null };
        const player = payload.player || null;
        setMe(player);
        return player;
      })
      .then(async (player) => {
        const params = new URLSearchParams();
        if (typeof player?.latitude === "number") params.set("lat", String(player.latitude));
        if (typeof player?.longitude === "number") params.set("lon", String(player.longitude));
        if (player?.location) params.set("zone", player.location);
        const response = await fetch(`/api/iglu/reservas/producers?${params.toString()}`, { cache: "no-store" });
        const payload = await response.json().catch(() => ({})) as { producers?: NearbyProducer[] };
        setNearby(response.ok ? payload.producers || [] : []);
        setNearbyLoading(false);
      })
      .catch(() => setNearbyLoading(false));
  }, []);

  useEffect(() => {
    if (selectedPlayerId) return;
    const nearestBookable = nearby.find((producer) => players.some((player) => player.id === producer.id));
    if (nearestBookable) {
      setSelectedPlayerId(nearestBookable.id);
      return;
    }
    if (producerPlayers[0]?.id) setSelectedPlayerId(producerPlayers[0].id);
  }, [nearby, players, producerPlayers, selectedPlayerId]);

  const selectedService = services.find((service) => service.id === serviceId) || null;
  const selectedPlayer = players.find((player) => player.id === selectedPlayerId) || null;
  const duration = Math.max(15, selectedService?.duration_minutes || 60);

  const availableSlots = useMemo(() => {
    if (!selectedPlayerId) return [] as string[];
    return buildSlots({
      dayKey: selectedDate,
      playerId: selectedPlayerId,
      durationMinutes: duration,
      rules: availabilityRules,
      events,
      timezone,
    });
  }, [availabilityRules, duration, events, selectedDate, selectedPlayerId, timezone]);

  useEffect(() => {
    if (slot && !availableSlots.includes(slot)) setSlot("");
  }, [availableSlots, slot]);

  const eventDays = useMemo(() => {
    const set = new Set(events.map((event) => dateKeyInZone(event.startAt, timezone)));
    return set;
  }, [events, timezone]);

  const availableDays = useMemo(() => {
    const set = new Set<string>();
    if (!selectedPlayerId) return set;
    const year = month.getFullYear();
    const monthIndex = month.getMonth();
    const count = new Date(year, monthIndex + 1, 0).getDate();
    for (let day = 1; day <= count; day += 1) {
      const key = dateKey(new Date(year, monthIndex, day));
      if (buildSlots({ dayKey: key, playerId: selectedPlayerId, durationMinutes: duration, rules: availabilityRules, events, timezone }).length) set.add(key);
    }
    return set;
  }, [availabilityRules, duration, events, month, selectedPlayerId, timezone]);

  const calendarDays = useMemo(() => {
    const year = month.getFullYear();
    const monthIndex = month.getMonth();
    const first = new Date(year, monthIndex, 1);
    const firstMonday = (first.getDay() + 6) % 7;
    const count = new Date(year, monthIndex + 1, 0).getDate();
    const cells: Array<{ key: string | null; day: number | null }> = [];
    for (let index = 0; index < firstMonday; index += 1) cells.push({ key: null, day: null });
    for (let day = 1; day <= count; day += 1) {
      const date = new Date(year, monthIndex, day);
      cells.push({ key: dateKey(date), day });
    }
    while (cells.length % 7) cells.push({ key: null, day: null });
    return cells;
  }, [month]);

  const inStudio = new Set(players.map((player) => player.id));
  const nearest = nearby[0] || null;
  const others = nearby.slice(1, 9);

  async function confirmBooking() {
    if (!selectedPlayerId || !selectedService || !slot) return;
    setWorking(true);
    setMessage(null);
    const scheduledAt = wallToIso(selectedDate, slot, timezone);
    const response = await fetch(`/api/studios/${studioId}/bookings`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        serviceId: selectedService.id,
        playerId: selectedPlayerId,
        scheduledAt,
        durationMinutes: duration,
      }),
    });
    const payload = await response.json().catch(() => ({})) as { error?: string; initPoint?: string | null };
    if (!response.ok) {
      if (response.status === 401) setAuthRequired(true);
      setMessage(payload.error || "No se pudo crear la reserva.");
      setWorking(false);
      return;
    }
    if (payload.initPoint) {
      window.location.assign(payload.initPoint);
      return;
    }
    setMessage("Reserva creada. El horario quedó bloqueado en la Agenda del IGLÚ y del Player.");
    setWorking(false);
  }

  function quickDate(offsetDays: number) {
    const date = new Date();
    date.setDate(date.getDate() + offsetDays);
    const key = dateKey(date);
    setSelectedDate(key);
    setMonth(new Date(date.getFullYear(), date.getMonth(), 1));
  }

  return (
    <div className={styles.calendarRoot}>
      <div className={styles.calendarBackdrop} style={{ backgroundImage: `url("${BACKGROUND}")` }} aria-hidden="true" />
      <main className={styles.calendarShell}>
        <div className={styles.calendarTop}>
          <Link className={styles.calendarRoundButton} href={IGLU_HOME} aria-label="Volver al IGLÚ"><ChevronLeft size={21} /></Link>
          <div className={styles.calendarBrand}><img src={LOGO} alt="IGLÚ Records" /></div>
          <Link className={styles.calendarRoundButton} href={`${IGLU_HOME}/agenda`} aria-label="Calendario completo"><CalendarDays size={20} /></Link>
        </div>

        <header className={styles.calendarTitleBlock}>
          <h1>RESERVAR SESIÓN</h1>
          <p>ZONA · PLAYER · FECHA · HORARIO</p>
        </header>

        <section className={`${styles.glassPanel} ${styles.nearbyPanel}`}>
          <div className={styles.bookingZoneBar}>
            <div>
              <span>TU ZONA</span>
              <strong>{me?.location || "Ubicación no configurada"}</strong>
            </div>
            <Link href="/profile/edit">CAMBIAR</Link>
          </div>

          <div className={styles.sectionHead}>
            <h2>Recomendado para vos</h2>
            <span>{nearbyLoading ? "Buscando…" : nearest?.distanceKm != null ? `${nearest.distanceKm.toFixed(1)} km` : "según datos reales"}</span>
          </div>

          {nearest ? (
            <article className={styles.nearbyHero}>
              <div className={styles.nearbyHeroAvatar}>
                {nearest.avatar ? <img src={nearest.avatar} alt="" /> : <span className={styles.avatarFallback}>{nearest.displayName.slice(0, 1)}</span>}
              </div>
              <div>
                <h3>{nearest.displayName} {nearest.isPro ? <span className={styles.chip}>PRO PLAYER</span> : null}</h3>
                <p>{nearest.location || "Ubicación no publicada"}{nearest.distanceKm != null ? ` · ${nearest.distanceKm.toFixed(1)} km` : ""}</p>
                <div className={styles.chips}>
                  {[nearest.primaryRole, ...nearest.disciplines].filter(Boolean).slice(0, 4).map((label) => <span className={styles.chip} key={String(label)}>{label}</span>)}
                </div>
              </div>
              {inStudio.has(nearest.id) ? (
                <button className={styles.scheduleAction} type="button" onClick={() => setSelectedPlayerId(nearest.id)}>Elegir</button>
              ) : (
                <Link className={styles.scheduleAction} href={`/${nearest.slug}`}>Ver Player</Link>
              )}
            </article>
          ) : !nearbyLoading ? (
            <div className={styles.empty}>No hay productores públicos con datos suficientes para recomendar en tu zona.</div>
          ) : null}

          {others.length ? (
            <>
              <div className={styles.sectionHead} style={{ marginTop: 16 }}><h2>Otros productores</h2><span>{others.length} visibles</span></div>
              <div className={styles.nearbyList}>
                {others.map((producer) => (
                  <article className={styles.nearbyRow} key={producer.id}>
                    {producer.avatar ? <img src={producer.avatar} alt="" /> : <span className={styles.nearbyAvatarFallback}>{producer.displayName.slice(0, 1)}</span>}
                    <div>
                      <p className={styles.cardTitle}>{producer.displayName} {producer.isPro ? <span className={styles.chip}>PRO</span> : null}</p>
                      <p className={styles.meta}>{producer.location || "Ubicación no publicada"}{producer.distanceKm != null ? ` · ${producer.distanceKm.toFixed(1)} km` : ""}</p>
                    </div>
                    {inStudio.has(producer.id) ? (
                      <button className={styles.scheduleAction} type="button" onClick={() => setSelectedPlayerId(producer.id)}>Elegir</button>
                    ) : (
                      <Link className={styles.scheduleAction} href={`/${producer.slug}`}>Ver</Link>
                    )}
                  </article>
                ))}
              </div>
            </>
          ) : null}
        </section>

        <section className={`${styles.glassPanel} ${styles.dayPanel}`}>
          <div className={styles.sectionHead}><h2>Player para la sesión</h2><span>{selectedPlayer?.displayName || "Elegí uno"}</span></div>
          <div className={styles.playerRail}>
            {producerPlayers.map((player) => (
              <button
                type="button"
                key={player.id}
                className={`${styles.playerBubble} ${selectedPlayerId === player.id ? styles.playerBubbleActive : ""}`}
                onClick={() => setSelectedPlayerId(player.id)}
              >
                <span className={styles.playerBubbleAvatar}>
                  {player.avatar ? <img src={player.avatar} alt="" /> : player.displayName.slice(0, 1)}
                  {player.isPro ? <span className={styles.proBadge}>PRO</span> : null}
                </span>
                <strong>{player.displayName}</strong>
                <small>{player.role || player.primaryRole || "Player"}</small>
              </button>
            ))}
          </div>
          {!producerPlayers.length ? <div className={styles.empty}>El IGLÚ no tiene todavía un Player productor publicado para recibir reservas.</div> : null}
        </section>

        <section className={`${styles.glassPanel} ${styles.calendarPanel}`} style={{ marginTop: 14 }}>
          <div className={styles.calendarMonthBar}>
            <button className={styles.monthArrow} type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft /></button>
            <strong>{monthLabel(month)}</strong>
            <button className={styles.monthArrow} type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight /></button>
          </div>

          <div className={styles.chips} style={{ padding: "12px 12px 0", justifyContent: "center" }}>
            <button type="button" className={styles.chip} onClick={() => quickDate(0)}>HOY</button>
            <button type="button" className={styles.chip} onClick={() => quickDate(1)}>MAÑANA</button>
            <button type="button" className={styles.chip} onClick={() => quickDate(7)}>ESTA SEMANA</button>
          </div>

          <div className={styles.calendarWeek}>
            {WEEKDAYS.map((weekday) => <span key={weekday}>{weekday}</span>)}
          </div>
          <div className={styles.calendarGrid}>
            {calendarDays.map((cell, index) => {
              if (!cell.key || cell.day == null) return <div className={styles.calendarBlank} key={`blank-${index}`} />;
              const isPast = cell.key < today;
              return (
                <button
                  type="button"
                  key={cell.key}
                  disabled={isPast}
                  className={[
                    styles.calendarCell,
                    selectedDate === cell.key ? styles.calendarCellSelected : "",
                    cell.key === today ? styles.calendarCellToday : "",
                  ].filter(Boolean).join(" ")}
                  style={isPast ? { opacity: .28 } : undefined}
                  onClick={() => setSelectedDate(cell.key!)}
                >
                  <span className={styles.calendarCellNumber}>{cell.day}</span>
                  <span className={styles.calendarCellDots}>
                    {availableDays.has(cell.key) ? <i className={`${styles.statusDot} ${styles.statusAvailable}`} /> : null}
                    {eventDays.has(cell.key) ? <i className={`${styles.statusDot} ${styles.statusOccupied}`} /> : null}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section className={`${styles.glassPanel} ${styles.dayPanel}`}>
          <div className={styles.dayPanelHead}>
            <h2>{selectedDate}</h2>
            <span>{availableSlots.length ? `${availableSlots.length} horarios disponibles` : "Sin horarios publicados"}</span>
          </div>

          {!bookingEnabled ? <div className={styles.notice}>La Agenda del IGLÚ todavía no tiene reservas públicas habilitadas. El calendario sigue mostrando datos reales, pero no confirma turnos hasta que el Studio lo active.</div> : null}
          {!services.length ? <div className={styles.empty}>El IGLÚ todavía no publicó un servicio real con CTA “reservar”.</div> : (
            <div className={styles.form}>
              <select className={styles.select} value={serviceId} onChange={(event) => setServiceId(event.target.value)}>
                {services.map((service) => <option value={service.id} key={service.id}>{service.name} · {formatMoney(service.price, service.currency)}</option>)}
              </select>
              <div className={styles.chips}>
                {availableSlots.map((time) => (
                  <button
                    type="button"
                    key={time}
                    className={styles.chip}
                    onClick={() => setSlot(time)}
                    style={{
                      borderColor: slot === time ? "rgba(210,244,255,.85)" : undefined,
                      background: slot === time ? "rgba(61,168,230,.22)" : undefined,
                    }}
                  >
                    {time}
                  </button>
                ))}
              </div>
              {!availableSlots.length ? <div className={styles.empty}>No hay horarios publicados para ese Player en esa fecha. Probá otro día o Player.</div> : null}
            </div>
          )}

          {selectedPlayer && selectedService && slot ? (
            <div className={styles.card} style={{ marginTop: 14, padding: 14 }}>
              <p className={styles.eyebrow}>RESUMEN</p>
              <p className={styles.cardTitle} style={{ marginTop: 8 }}>{selectedPlayer.displayName}</p>
              <p className={styles.meta}>{selectedService.name} · {selectedDate} · {slot} · {duration} min · {formatMoney(selectedService.price, selectedService.currency)}</p>
              {authRequired ? (
                <Link className={styles.primaryButton} style={{ marginTop: 14, width: "100%" }} href="/login">Iniciar sesión para reservar →</Link>
              ) : (
                <button
                  type="button"
                  className={styles.primaryButton}
                  style={{ marginTop: 14, width: "100%" }}
                  disabled={working || !bookingEnabled}
                  onClick={() => void confirmBooking()}
                >
                  {working ? "Confirmando…" : "CONFIRMAR RESERVA →"}
                </button>
              )}
              {message ? <p className={message.startsWith("Reserva creada") ? styles.meta : styles.error}>{message}</p> : null}
            </div>
          ) : null}
        </section>

        <div className={styles.notice} style={{ marginTop: 14 }}>
          <MapPin size={14} style={{ display: "inline", marginRight: 6 }} />
          La cercanía solo se calcula cuando ambos Players tienen coordenadas guardadas. Si falta ubicación, el orden usa zona, disponibilidad pública y estado PRO real; nunca inventa distancia.
        </div>
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
