"use client";

import Link from "next/link";
import { CalendarDays, ChevronRight, MapPin } from "lucide-react";
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

function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number) {
  const toRad = (value: number) => value * Math.PI / 180;
  const r = 6371;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(x));
}

function dateKeyInZone(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

function wallToIso(dateKey: string, hhmm: string, timeZone: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour, minute] = hhmm.split(":").map(Number);
  let guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  for (let index = 0; index < 4; index += 1) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
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
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

function hhmm(value: number) {
  return `${String(Math.floor(value / 60) % 24).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function formatMoney(value: number | null, currency: string) {
  if (value == null) return "Consultar";
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: currency || "ARS", maximumFractionDigits: 0 }).format(value);
}

export function IgluBookingDiscovery({
  studioId,
  players,
  services,
  events,
  availabilityRules,
  bookingEnabled,
  timezone,
}: {
  studioId: string;
  players: IgluPublicPlayer[];
  services: Service[];
  events: IgluCalendarEvent[];
  availabilityRules: IgluAvailabilityRule[];
  bookingEnabled: boolean;
  timezone: string;
}) {
  const [me, setMe] = useState<MePlayer | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [serviceId, setServiceId] = useState(services[0]?.id || "");
  const [dateKey, setDateKey] = useState(() => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(tomorrow);
  });
  const [slot, setSlot] = useState("");
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/players/me", { cache: "no-store", credentials: "include" })
      .then(async (response) => {
        if (response.status === 401) {
          setAuthRequired(true);
          return;
        }
        if (!response.ok) return;
        const payload = await response.json() as { player?: MePlayer | null };
        setMe(payload.player || null);
      })
      .catch(() => undefined);
  }, []);

  const ranked = useMemo(() => {
    return players
      .filter((player) => !me?.id || player.id !== me.id)
      .map((player) => ({
        ...player,
        distance: typeof me?.latitude === "number" && typeof me?.longitude === "number" && typeof player.latitude === "number" && typeof player.longitude === "number"
          ? haversineKm(me.latitude, me.longitude, player.latitude, player.longitude)
          : null,
      }))
      .sort((a, b) => {
        if (a.distance != null && b.distance != null) return a.distance - b.distance;
        if (a.distance != null) return -1;
        if (b.distance != null) return 1;
        return a.displayName.localeCompare(b.displayName, "es");
      });
  }, [me, players]);

  useEffect(() => {
    if (!selectedPlayerId && ranked[0]?.id) setSelectedPlayerId(ranked[0].id);
  }, [ranked, selectedPlayerId]);

  const selectedService = services.find((service) => service.id === serviceId) || null;
  const selectedPlayer = ranked.find((player) => player.id === selectedPlayerId) || null;
  const duration = Math.max(15, selectedService?.duration_minutes || 60);

  const availableSlots = useMemo(() => {
    const midday = new Date(`${dateKey}T12:00:00`);
    const weekday = midday.getDay();
    const rules = availabilityRules.filter((rule) => rule.isAvailable && rule.weekday === weekday);
    if (!rules.length) return [] as string[];

    const candidates: string[] = [];
    for (const rule of rules) {
      const start = minutes(rule.startLocal);
      let end = minutes(rule.endLocal);
      if (end <= start) end += 24 * 60;
      for (let current = start; current + duration <= end; current += 30) candidates.push(hhmm(current));
    }

    return Array.from(new Set(candidates)).filter((time) => {
      const startIso = wallToIso(dateKey, time, timezone);
      const start = new Date(startIso).getTime();
      const end = start + duration * 60_000;
      return !events.some((event) => {
        if (event.playerId && selectedPlayerId && event.playerId !== selectedPlayerId) return false;
        if (!event.playerId && dateKeyInZone(event.startAt, timezone) !== dateKey) return false;
        const eventStart = new Date(event.startAt).getTime();
        const eventEnd = new Date(event.endAt).getTime();
        return eventStart < end && eventEnd > start;
      });
    });
  }, [availabilityRules, dateKey, duration, events, selectedPlayerId, timezone]);

  useEffect(() => {
    if (slot && !availableSlots.includes(slot)) setSlot("");
  }, [availableSlots, slot]);

  async function confirmBooking() {
    if (!selectedPlayerId || !selectedService || !slot) return;
    setWorking(true);
    setMessage(null);
    const scheduledAt = wallToIso(dateKey, slot, timezone);
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
    const payload = await response.json().catch(() => ({})) as { error?: string; initPoint?: string | null; booking?: { id?: string }; bookingId?: string };
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
    setMessage("Reserva creada. El horario quedó bloqueado en Agenda.");
    setWorking(false);
  }

  return (
    <div className={styles.root}>
      <main className={styles.shell}>
        <Link className={styles.back} href="/lamatrix/estudios/eliglurecords">← Volver al IGLÚ</Link>
        <header className={styles.header}>
          <p className={styles.eyebrow}>IGLÚ RECORDS · RESERVAS</p>
          <h1 className={styles.title}>RESERVÁ TU SESIÓN</h1>
          <p className={styles.subtitle}>Elegí un Player real del IGLÚ. La confirmación valida al mismo tiempo la Agenda del Studio y la Agenda del Player para evitar dobles reservas.</p>
        </header>

        <section className={styles.section}>
          <div className={styles.sectionHead}><h2>Tu zona</h2><span>{me?.location || "Sin zona configurada"}</span></div>
          <div className={styles.notice}>
            <MapPin size={14} style={{ display: "inline", marginRight: 6 }} />
            {me?.location ? "Ordenamos por distancia cuando ambos Players tienen coordenadas públicas." : "Configurá tu ubicación en tu Player para ordenar por cercanía. No inventamos distancias."}
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHead}><h2>{ranked.length ? "Players del IGLÚ" : "Players"}</h2><span>{ranked.length} disponibles en directorio</span></div>
          <div className={styles.grid}>
            {ranked.map((player, index) => (
              <button key={player.id} type="button" className={styles.card} onClick={() => setSelectedPlayerId(player.id)} style={{ padding: 0, color: "inherit", textAlign: "left", borderColor: selectedPlayerId === player.id ? "rgba(132,214,255,.58)" : undefined }}>
                <div className={styles.playerCard}>
                  {player.avatar ? <img className={styles.avatar} src={player.avatar} alt="" /> : <span className={styles.avatarFallback}>{player.displayName.charAt(0)}</span>}
                  <div>
                    <p className={styles.cardTitle}>{index === 0 && player.distance != null ? "Más cercano · " : ""}{player.displayName}</p>
                    <p className={styles.meta}>{player.location || "Ubicación no publicada"}{player.distance != null ? ` · ${player.distance.toFixed(1)} km` : ""}</p>
                    <div className={styles.chips}>{[player.role, player.primaryRole, ...player.disciplines].filter(Boolean).slice(0, 4).map((item) => <span className={styles.chip} key={String(item)}>{item}</span>)}</div>
                  </div>
                  <ChevronRight size={18} />
                </div>
              </button>
            ))}
            {!ranked.length ? <div className={styles.empty}>No hay otros Players publicados vinculados al IGLÚ para reservar.</div> : null}
          </div>
          {selectedPlayer ? <Link className={styles.secondaryButton} style={{ marginTop: 12 }} href={`/${selectedPlayer.slug}`}>Ver Player público →</Link> : null}
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHead}><h2>Servicio y fecha</h2><span>Agenda real</span></div>
          {!bookingEnabled ? <div className={styles.notice}>La Agenda del IGLÚ todavía no tiene reservas públicas habilitadas. Podés explorar Players y calendario, pero no se confirmará un turno hasta que el Studio las active.</div> : null}
          {!services.length ? <div className={styles.empty}>El IGLÚ todavía no publicó un servicio con CTA “reservar”. No mostramos precios ni servicios inventados.</div> : (
            <div className={styles.form}>
              <select className={styles.select} value={serviceId} onChange={(event) => setServiceId(event.target.value)}>
                {services.map((service) => <option value={service.id} key={service.id}>{service.name} · {formatMoney(service.price, service.currency)}</option>)}
              </select>
              <input className={styles.input} type="date" value={dateKey} min={new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())} onChange={(event) => setDateKey(event.target.value)} />
              <div className={styles.chips}>
                {availableSlots.map((time) => <button type="button" key={time} className={styles.chip} onClick={() => setSlot(time)} style={{ borderColor: slot === time ? "rgba(136,219,255,.8)" : undefined, background: slot === time ? "rgba(87,181,237,.16)" : undefined }}>{time}</button>)}
              </div>
              {!availableSlots.length ? <div className={styles.empty}>No hay franjas de disponibilidad publicadas para esta fecha. Elegí otra fecha o esperá a que el IGLÚ configure sus horarios.</div> : null}
            </div>
          )}
        </section>

        {selectedPlayer && selectedService && slot ? (
          <section className={styles.section}>
            <div className={styles.sectionHead}><h2>Confirmar</h2><span>{duration} min</span></div>
            <p className={styles.cardTitle}>{selectedPlayer.displayName}</p>
            <p className={styles.meta}>{selectedService.name} · {dateKey} · {slot} · {formatMoney(selectedService.price, selectedService.currency)}</p>
            {authRequired ? <Link className={styles.primaryButton} style={{ marginTop: 14 }} href="/login">Iniciar sesión para reservar →</Link> : (
              <button type="button" className={styles.primaryButton} style={{ marginTop: 14, width: "100%" }} disabled={working || !bookingEnabled} onClick={() => void confirmBooking()}>{working ? "Confirmando…" : "CONFIRMAR RESERVA →"}</button>
            )}
            {message ? <p className={message.startsWith("Reserva creada") ? styles.meta : styles.error}>{message}</p> : null}
          </section>
        ) : null}

        <div className={styles.bottomActions}><Link className={styles.secondaryButton} style={{ width: "100%" }} href="/lamatrix/estudios/eliglurecords/agenda"><CalendarDays size={16} /> Ver calendario completo</Link></div>
      </main>
    </div>
  );
}
