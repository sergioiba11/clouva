"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Link2,
  Loader2,
  MapPin,
  Plus,
  Search,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";
import { supabase } from "@/lib/supabase";

type AgendaRole = "owner" | "editor" | "participant" | "viewer";
type ViewMode = "day" | "week" | "month" | "list";
type AgendaContext = {
  agendaId: string;
  ownerPlayerId: string | null;
  ownerSpaceId: string | null;
  timezone: string;
  publicEnabled: boolean;
  bookingEnabled: boolean;
  role: AgendaRole;
  presentation: {
    identityType: "player" | "studio" | "business_space";
    displayName: string;
    alias: string | null;
    avatar: string | null;
    cover: string | null;
    accent: string | null;
    palette: string[];
    category: string | null;
  };
};

type AgendaEvent = {
  id: string;
  primaryAgendaId: string;
  title: string;
  description: string | null;
  eventType: string;
  startAt: string;
  endAt: string;
  timezone: string;
  allDay: boolean;
  status: "scheduled" | "completed" | "cancelled";
  visibility: "private" | "participants" | "connections" | "public";
  locationType: "unspecified" | "physical" | "online" | "hybrid";
  locationText: string | null;
  locationUrl: string | null;
  recurrenceRule: string | null;
  relation: "primary" | "shared" | "invited";
  participants: Array<{
    playerId: string;
    displayName: string;
    username: string | null;
    avatar: string | null;
    role: "host" | "participant";
    rsvpStatus: "pending" | "accepted" | "declined" | "maybe";
  }>;
};

type PlayerResult = { id: string; displayName: string; username: string | null; avatar: string | null };
type AgendaConnection = PlayerResult & { playerId: string; status: string };

const DAY_MS = 86_400_000;
const WEEKDAY = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const RRULE_DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function addDays(date: Date, amount: number) {
  return new Date(date.getTime() + amount * DAY_MS);
}

function startOfWeek(date: Date) {
  const day = startOfDay(date);
  const jsDay = day.getDay();
  return addDays(day, -(jsDay === 0 ? 6 : jsDay - 1));
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function viewRange(view: ViewMode, cursor: Date) {
  if (view === "day") {
    const from = startOfDay(cursor);
    return { from, to: addDays(from, 1) };
  }
  if (view === "week") {
    const from = startOfWeek(cursor);
    return { from, to: addDays(from, 7) };
  }
  if (view === "month") {
    const from = startOfWeek(startOfMonth(cursor));
    return { from, to: addDays(from, 42) };
  }
  const from = startOfDay(cursor);
  return { from, to: addDays(from, 90) };
}

function moveCursor(view: ViewMode, cursor: Date, direction: -1 | 1) {
  if (view === "day") return addDays(cursor, direction);
  if (view === "week") return addDays(cursor, direction * 7);
  if (view === "month") return new Date(cursor.getFullYear(), cursor.getMonth() + direction, 1);
  return addDays(cursor, direction * 30);
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatDayTitle(date: Date) {
  return new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long" }).format(date);
}

function formatQuickDayTitle(date: Date) {
  const value = new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric" }).format(date);
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function formatMonthTitle(date: Date) {
  return new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric" }).format(date);
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("es-AR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function localInput(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function identityLabel(kind: AgendaContext["presentation"]["identityType"]) {
  if (kind === "player") return "PLAYER";
  if (kind === "studio") return "STUDIO";
  return "MI SPOT";
}

function eventLabel(type: string) {
  const labels: Record<string, string> = {
    event: "EVENTO",
    session: "SESIÓN",
    meeting: "REUNIÓN",
    class: "CLASE",
    appointment: "TURNO",
    booking: "RESERVA",
    release: "LANZAMIENTO",
    deadline: "FECHA LÍMITE",
  };
  return labels[type] || type.toUpperCase();
}

function relationLabel(relation: AgendaEvent["relation"]) {
  if (relation === "primary") return "Propio";
  if (relation === "invited") return "Invitación";
  return "Compartido";
}

function Avatar({ src, label, size = "md" }: { src: string | null; label: string; size?: "sm" | "md" | "lg" }) {
  const className = size === "sm" ? "h-7 w-7" : size === "lg" ? "h-14 w-14" : "h-10 w-10";
  return (
    <span className={`${className} grid shrink-0 place-items-center overflow-hidden rounded-full border border-white/15 bg-white/[0.06] text-xs font-semibold`}>
      {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : label.slice(0, 1).toUpperCase()}
    </span>
  );
}

function EventCard({ event, onOpen }: { event: AgendaEvent; onOpen: (event: AgendaEvent) => void }) {
  return (
    <button type="button" onClick={() => onOpen(event)} className="w-full rounded-2xl border border-white/10 bg-black/25 p-4 text-left transition hover:border-white/20 hover:bg-white/[0.055]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold tracking-[0.16em] text-white/40">
            <span>{eventLabel(event.eventType)}</span>
            <span className="rounded-full border border-white/10 px-2 py-1 normal-case tracking-normal text-white/45">{relationLabel(event.relation)}</span>
          </div>
          <p className="mt-2 truncate font-semibold text-white">{event.title}</p>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-white/50"><Clock3 size={13} /> {formatDateTime(event.startAt)} · {formatTime(event.endAt)}</p>
          {event.locationText ? <p className="mt-1 flex items-center gap-1.5 truncate text-xs text-white/40"><MapPin size={13} /> {event.locationText}</p> : null}
        </div>
        {event.participants.length ? (
          <div className="flex -space-x-2">
            {event.participants.slice(0, 4).map((participant) => <Avatar key={participant.playerId} src={participant.avatar} label={participant.displayName} size="sm" />)}
          </div>
        ) : null}
      </div>
    </button>
  );
}

export default function AgendaPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [contexts, setContexts] = useState<AgendaContext[]>([]);
  const [activeAgendaId, setActiveAgendaId] = useState("");
  const [contextOpen, setContextOpen] = useState(false);
  const [view, setView] = useState<ViewMode>("month");
  const [cursor, setCursor] = useState(() => new Date());
  const [events, setEvents] = useState<AgendaEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [relation, setRelation] = useState<"all" | AgendaEvent["relation"]>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [quickCreateDay, setQuickCreateDay] = useState<Date | null>(null);
  const [quickHour, setQuickHour] = useState(9);
  const [quickShareOpen, setQuickShareOpen] = useState(false);
  const [connectedPlayers, setConnectedPlayers] = useState<PlayerResult[]>([]);
  const [connectionsLoading, setConnectionsLoading] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<AgendaEvent | null>(null);
  const [saving, setSaving] = useState(false);
  const [playerQuery, setPlayerQuery] = useState("");
  const [playerResults, setPlayerResults] = useState<PlayerResult[]>([]);
  const [selectedPlayers, setSelectedPlayers] = useState<PlayerResult[]>([]);
  const [shareAgendaIds, setShareAgendaIds] = useState<string[]>([]);
  const [playerSearching, setPlayerSearching] = useState(false);
  const [form, setForm] = useState(() => {
    const start = new Date();
    start.setMinutes(0, 0, 0);
    start.setHours(start.getHours() + 1);
    return {
      title: "",
      description: "",
      eventType: "event",
      startAt: localInput(start),
      endAt: localInput(new Date(start.getTime() + 60 * 60_000)),
      allDay: false,
      visibility: "participants",
      locationType: "unspecified",
      locationText: "",
      locationUrl: "",
      recurrence: "none",
      customRrule: "",
    };
  });

  const active = useMemo(() => contexts.find((context) => context.agendaId === activeAgendaId) || contexts[0] || null, [activeAgendaId, contexts]);
  const range = useMemo(() => viewRange(view, cursor), [cursor, view]);
  const canEdit = active?.role === "owner" || active?.role === "editor";

  const loadContexts = useCallback(async () => {
    const response = await authenticatedFetch("/api/agenda/contexts");
    const payload = await readApiJson<{ contexts: AgendaContext[] }>(response);
    setContexts(payload.contexts || []);
    setActiveAgendaId((current) => current && payload.contexts.some((context) => context.agendaId === current) ? current : payload.contexts[0]?.agendaId || "");
  }, []);

  const loadEvents = useCallback(async () => {
    if (!activeAgendaId) {
      setEvents([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ agendaId: activeAgendaId, from: range.from.toISOString(), to: range.to.toISOString() });
      const response = await authenticatedFetch(`/api/agenda/events?${params.toString()}`);
      const payload = await readApiJson<{ events: AgendaEvent[] }>(response);
      setEvents(payload.events || []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudieron cargar los eventos.");
    } finally {
      setLoading(false);
    }
  }, [activeAgendaId, range.from, range.to]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace("/login?next=/agenda");
      return;
    }
    void loadContexts().catch((cause) => {
      setError(cause instanceof Error ? cause.message : "No se pudo cargar la Agenda.");
      setLoading(false);
    });
  }, [authLoading, loadContexts, router, user]);

  useEffect(() => { if (activeAgendaId) void loadEvents(); }, [activeAgendaId, loadEvents]);

  useEffect(() => {
    if (!user || !activeAgendaId) return;
    const refresh = () => void loadEvents();
    const channel = supabase
      .channel(`agenda:${activeAgendaId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "agenda_events" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "agenda_event_agendas" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "agenda_event_participants" }, refresh)
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [activeAgendaId, loadEvents, user]);

  const filteredEvents = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return events.filter((event) => {
      if (relation !== "all" && event.relation !== relation) return false;
      if (!normalized) return true;
      return `${event.title} ${event.description || ""} ${event.locationText || ""} ${event.participants.map((p) => p.displayName).join(" ")}`.toLowerCase().includes(normalized);
    });
  }, [events, query, relation]);

  function resetCreateForm(day = new Date()) {
    const start = new Date(day);
    const now = new Date();
    start.setHours(sameDay(day, now) ? Math.max(now.getHours() + 1, 9) : 18, 0, 0, 0);
    setForm({
      title: "",
      description: "",
      eventType: "event",
      startAt: localInput(start),
      endAt: localInput(new Date(start.getTime() + 60 * 60_000)),
      allDay: false,
      visibility: "participants",
      locationType: "unspecified",
      locationText: "",
      locationUrl: "",
      recurrence: "none",
      customRrule: "",
    });
    setSelectedPlayers([]);
    setShareAgendaIds([]);
    setPlayerQuery("");
    setPlayerResults([]);
  }

  async function loadConnectedPlayers() {
    if (!active) return;
    setConnectionsLoading(true);
    try {
      const response = await authenticatedFetch(`/api/agenda/connections?agendaId=${encodeURIComponent(active.agendaId)}`);
      const payload = await readApiJson<{ connections: AgendaConnection[] }>(response);
      setConnectedPlayers((payload.connections || [])
        .filter((connection) => connection.status === "active")
        .map((connection) => ({ id: connection.playerId, displayName: connection.displayName, username: connection.username, avatar: connection.avatar })));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudieron cargar los Players conectados.");
      setConnectedPlayers([]);
    } finally {
      setConnectionsLoading(false);
    }
  }

  function openQuickCreate(day: Date) {
    const now = new Date();
    const hour = sameDay(day, now) ? Math.min(now.getHours() + 1, 23) : 9;
    const start = new Date(day);
    start.setHours(hour, 0, 0, 0);
    resetCreateForm(day);
    setForm((current) => ({
      ...current,
      startAt: localInput(start),
      endAt: localInput(new Date(start.getTime() + 60 * 60_000)),
    }));
    setQuickHour(hour);
    setQuickShareOpen(false);
    setQuickCreateDay(startOfDay(day));
    setCreateOpen(false);
    void loadConnectedPlayers();
  }

  function selectQuickHour(hour: number) {
    if (!quickCreateDay) return;
    const start = new Date(quickCreateDay);
    start.setHours(hour, 0, 0, 0);
    setQuickHour(hour);
    setForm((current) => ({
      ...current,
      startAt: localInput(start),
      endAt: localInput(new Date(start.getTime() + 60 * 60_000)),
    }));
  }

  async function searchPlayers() {
    setPlayerSearching(true);
    try {
      const response = await authenticatedFetch(`/api/agenda/players?q=${encodeURIComponent(playerQuery)}`);
      const payload = await readApiJson<{ players: PlayerResult[] }>(response);
      setPlayerResults(payload.players || []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudieron buscar Players.");
    } finally {
      setPlayerSearching(false);
    }
  }

  function recurrenceRule() {
    if (form.recurrence === "none") return null;
    if (form.recurrence === "daily") return "FREQ=DAILY";
    if (form.recurrence === "weekly") return `FREQ=WEEKLY;BYDAY=${RRULE_DAYS[new Date(form.startAt).getDay()]}`;
    if (form.recurrence === "monthly") return "FREQ=MONTHLY";
    return form.customRrule.trim().replace(/^RRULE:/i, "") || null;
  }

  async function createEvent() {
    if (!active) return;
    setSaving(true);
    setError(null);
    try {
      const response = await authenticatedFetch("/api/agenda/events", {
        method: "POST",
        body: JSON.stringify({
          agendaId: active.agendaId,
          title: form.title,
          description: form.description,
          eventType: form.eventType,
          startAt: new Date(form.startAt).toISOString(),
          endAt: new Date(form.endAt).toISOString(),
          timezone: active.timezone,
          allDay: form.allDay,
          visibility: form.visibility,
          locationType: form.locationType,
          locationText: form.locationText,
          locationUrl: form.locationUrl,
          recurrenceRule: recurrenceRule(),
          participantPlayerIds: selectedPlayers.map((player) => player.id),
          shareAgendaIds,
        }),
      });
      await readApiJson(response);
      setCreateOpen(false);
      setQuickCreateDay(null);
      setQuickShareOpen(false);
      resetCreateForm();
      await loadEvents();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo crear el evento.");
    } finally {
      setSaving(false);
    }
  }

  async function respondRsvp(eventId: string, rsvpStatus: "accepted" | "declined" | "maybe") {
    setSaving(true);
    try {
      const response = await authenticatedFetch(`/api/agenda/events/${eventId}/rsvp`, { method: "POST", body: JSON.stringify({ rsvpStatus }) });
      await readApiJson(response);
      await loadEvents();
      setSelectedEvent((current) => current ? { ...current, participants: current.participants.map((p) => ({ ...p, rsvpStatus })) } : current);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo responder la invitación.");
    } finally {
      setSaving(false);
    }
  }

  async function cancelEvent(eventId: string) {
    setSaving(true);
    try {
      const response = await authenticatedFetch(`/api/agenda/events/${eventId}`, { method: "DELETE" });
      await readApiJson(response);
      setSelectedEvent(null);
      await loadEvents();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo cancelar el evento.");
    } finally {
      setSaving(false);
    }
  }

  if (authLoading || (loading && !contexts.length)) {
    return <main className="grid min-h-screen place-items-center bg-[#08080d] text-white"><Loader2 className="animate-spin text-violet-300" /></main>;
  }

  if (!active) {
    return (
      <main className="min-h-screen bg-[#08080d] px-5 py-16 text-white">
        <div className="mx-auto max-w-xl rounded-3xl border border-white/10 bg-white/[0.03] p-8 text-center">
          <CalendarDays className="mx-auto text-violet-300" />
          <h1 className="mt-4 text-2xl font-semibold">Agenda</h1>
          <p className="mt-2 text-sm text-white/45">No pudimos resolver una identidad con acceso a Agenda.</p>
          {error ? <p className="mt-4 text-sm text-red-200">{error}</p> : null}
        </div>
      </main>
    );
  }

  const accent = active.presentation.accent || "#8b5cf6";
  const weekDays = Array.from({ length: 7 }, (_, index) => addDays(startOfWeek(cursor), index));
  const monthDays = Array.from({ length: 42 }, (_, index) => addDays(startOfWeek(startOfMonth(cursor)), index));

  return (
    <main className="min-h-screen bg-[#08080d] text-white" style={{ "--agenda-accent": accent } as React.CSSProperties}>
      <div className="relative overflow-hidden border-b border-white/10">
        {active.presentation.cover ? <img src={active.presentation.cover} alt="" className="absolute inset-0 h-full w-full object-cover opacity-25" /> : null}
        <div className="absolute inset-0 bg-gradient-to-b from-black/35 via-[#08080d]/75 to-[#08080d]" />
        <div className="relative mx-auto max-w-7xl px-4 pb-5 pt-5 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Avatar src={active.presentation.avatar} label={active.presentation.displayName} size="lg" />
              <div className="relative">
                <p className="text-[10px] font-bold tracking-[0.22em] text-white/40">{identityLabel(active.presentation.identityType)} · AGENDA</p>
                <button type="button" onClick={() => setContextOpen((value) => !value)} className="mt-1 inline-flex items-center gap-2 text-left text-xl font-semibold sm:text-2xl">
                  {active.presentation.displayName}<ChevronDown size={18} className="text-white/45" />
                </button>
                {active.presentation.alias ? <p className="mt-0.5 text-xs text-white/40">@{active.presentation.alias}</p> : null}
                {contextOpen ? (
                  <div className="absolute left-0 top-full z-40 mt-3 w-[min(88vw,340px)] rounded-2xl border border-white/10 bg-[#111119]/95 p-2 shadow-2xl backdrop-blur-xl">
                    {contexts.map((context) => (
                      <button key={context.agendaId} type="button" onClick={() => { setActiveAgendaId(context.agendaId); setContextOpen(false); }} className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition ${context.agendaId === active.agendaId ? "bg-white/[0.08]" : "hover:bg-white/[0.05]"}`}>
                        <Avatar src={context.presentation.avatar} label={context.presentation.displayName} />
                        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{context.presentation.displayName}</span><span className="block text-[11px] text-white/35">{identityLabel(context.presentation.identityType)} · {context.role}</span></span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
            {canEdit ? <button type="button" onClick={() => { resetCreateForm(cursor); setCreateOpen(true); }} className="inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-semibold text-white shadow-lg transition hover:brightness-110" style={{ background: accent }}><Plus size={17} /> Crear evento</button> : null}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setCursor(moveCursor(view, cursor, -1))} className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/[0.03]"><ChevronLeft size={18} /></button>
            <button type="button" onClick={() => setCursor(new Date())} className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm font-medium">Hoy</button>
            <button type="button" onClick={() => setCursor(moveCursor(view, cursor, 1))} className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/[0.03]"><ChevronRight size={18} /></button>
            <h2 className="ml-2 hidden text-lg font-semibold capitalize sm:block">{view === "day" ? formatDayTitle(cursor) : formatMonthTitle(cursor)}</h2>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 lg:pb-0">
            {(["day", "week", "month", "list"] as ViewMode[]).map((mode) => <button key={mode} type="button" onClick={() => setView(mode)} className={`whitespace-nowrap rounded-xl border px-4 py-2 text-sm transition ${view === mode ? "border-white/20 bg-white/[0.09] text-white" : "border-white/8 bg-transparent text-white/45 hover:text-white"}`}>{mode === "day" ? "Día" : mode === "week" ? "Semana" : mode === "month" ? "Mes" : "Lista"}</button>)}
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <label className="flex flex-1 items-center rounded-xl border border-white/10 bg-white/[0.025] px-3"><Search size={15} className="text-white/30" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar evento, lugar o Player…" className="min-w-0 flex-1 bg-transparent px-2 py-2.5 text-sm outline-none placeholder:text-white/25" /></label>
          <select value={relation} onChange={(event) => setRelation(event.target.value as typeof relation)} className="rounded-xl border border-white/10 bg-[#101017] px-3 py-2.5 text-sm text-white/70 outline-none"><option value="all">Todos</option><option value="primary">Propios</option><option value="shared">Compartidos</option><option value="invited">Invitaciones</option></select>
        </div>

        {error ? <div className="mt-4 flex items-start justify-between gap-3 rounded-2xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-100"><span>{error}</span><button type="button" onClick={() => setError(null)}><X size={16} /></button></div> : null}
        {loading ? <div className="mt-10 flex items-center justify-center gap-2 text-sm text-white/35"><Loader2 size={16} className="animate-spin" /> Actualizando Agenda…</div> : null}

        {!loading && view === "day" ? (
          <section className="mt-5 space-y-3">
            <h3 className="text-sm font-semibold capitalize text-white/70">{formatDayTitle(cursor)}</h3>
            {filteredEvents.filter((event) => sameDay(new Date(event.startAt), cursor)).map((event) => <EventCard key={event.id} event={event} onOpen={setSelectedEvent} />)}
            {!filteredEvents.some((event) => sameDay(new Date(event.startAt), cursor)) ? <EmptyDay canEdit={canEdit} onCreate={() => { resetCreateForm(cursor); setCreateOpen(true); }} /> : null}
          </section>
        ) : null}

        {!loading && view === "week" ? (
          <section className="mt-5 overflow-x-auto pb-3">
            <div className="grid min-w-[840px] grid-cols-7 gap-2">
              {weekDays.map((day) => {
                const dayEvents = filteredEvents.filter((event) => sameDay(new Date(event.startAt), day));
                return <div key={day.toISOString()} className={`min-h-[360px] rounded-2xl border p-2 ${sameDay(day, new Date()) ? "border-white/20 bg-white/[0.045]" : "border-white/8 bg-white/[0.02]"}`}><button type="button" onClick={() => { setCursor(day); setView("day"); }} className="mb-3 w-full rounded-xl px-2 py-2 text-left"><span className="block text-[10px] font-bold uppercase tracking-[0.16em] text-white/35">{new Intl.DateTimeFormat("es-AR", { weekday: "short" }).format(day)}</span><span className="mt-1 block text-lg font-semibold">{day.getDate()}</span></button><div className="space-y-2">{dayEvents.map((event) => <button key={event.id} type="button" onClick={() => setSelectedEvent(event)} className="w-full rounded-xl border border-white/8 bg-black/25 p-2 text-left"><span className="block text-[10px] text-white/35">{formatTime(event.startAt)}</span><span className="mt-1 block line-clamp-2 text-xs font-medium">{event.title}</span></button>)}</div></div>;
              })}
            </div>
          </section>
        ) : null}

        {!loading && view === "month" ? (
          <section className="mt-5 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.015]">
            <div className="grid grid-cols-7 border-b border-white/10">{WEEKDAY.map((day) => <div key={day} className="px-2 py-3 text-center text-[10px] font-bold uppercase tracking-[0.16em] text-white/35">{day}</div>)}</div>
            <div className="grid grid-cols-7">
              {monthDays.map((day) => {
                const dayEvents = filteredEvents.filter((event) => sameDay(new Date(event.startAt), day));
                const outside = day.getMonth() !== cursor.getMonth();
                return <button key={day.toISOString()} type="button" onClick={() => { setCursor(day); if (canEdit) openQuickCreate(day); else setView("day"); }} className={`min-h-[92px] border-b border-r border-white/[0.065] p-1.5 text-left sm:min-h-[128px] sm:p-2 ${outside ? "bg-black/20 text-white/25" : "text-white"} ${sameDay(day, new Date()) ? "bg-white/[0.045]" : ""}`}><span className={`grid h-6 w-6 place-items-center rounded-full text-xs ${sameDay(day, new Date()) ? "text-white" : "text-white/55"}`} style={sameDay(day, new Date()) ? { background: accent } : undefined}>{day.getDate()}</span><div className="mt-1 space-y-1">{dayEvents.slice(0, 3).map((event) => <span key={event.id} className="block truncate rounded-md border border-white/8 bg-black/25 px-1.5 py-1 text-[9px] text-white/70 sm:text-[10px]">{formatTime(event.startAt)} {event.title}</span>)}{dayEvents.length > 3 ? <span className="block text-[9px] text-white/30">+{dayEvents.length - 3}</span> : null}</div></button>;
              })}
            </div>
          </section>
        ) : null}

        {!loading && view === "list" ? (
          <section className="mt-5 space-y-5">
            {Array.from(new Set(filteredEvents.map((event) => startOfDay(new Date(event.startAt)).toISOString()))).map((dayKey) => {
              const day = new Date(dayKey);
              const dayEvents = filteredEvents.filter((event) => sameDay(new Date(event.startAt), day));
              return <div key={dayKey}><h3 className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-white/35">{formatDayTitle(day)}</h3><div className="grid gap-3 lg:grid-cols-2">{dayEvents.map((event) => <EventCard key={event.id} event={event} onOpen={setSelectedEvent} />)}</div></div>;
            })}
            {!filteredEvents.length ? <EmptyDay canEdit={canEdit} onCreate={() => { resetCreateForm(cursor); setCreateOpen(true); }} /> : null}
          </section>
        ) : null}
      </div>

      {quickCreateDay ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/65 backdrop-blur-sm">
          <div className="max-h-[94vh] w-full overflow-y-auto rounded-t-[28px] border border-white/10 bg-[#111119] px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3 shadow-2xl sm:max-w-2xl sm:px-6 sm:pb-6">
            <div className="mx-auto h-1.5 w-16 rounded-full bg-white/15" />
            <div className="mt-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">{formatQuickDayTitle(quickCreateDay)} · Horarios</h2>
                <p className="mt-1 text-sm text-white/45">Tocá una hora para agendar al toque</p>
              </div>
              <button type="button" onClick={() => { setQuickCreateDay(null); setQuickShareOpen(false); }} className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.025]"><X size={17} /></button>
            </div>

            <div className="mt-5 grid grid-cols-6 gap-2">
              {HOURS.map((hour) => {
                const selected = quickHour === hour;
                return <button key={hour} type="button" onClick={() => selectQuickHour(hour)} className={`min-h-11 rounded-xl border px-1 py-2 text-center text-[13px] font-medium tabular-nums transition active:scale-[0.97] ${selected ? "border-transparent text-white shadow-lg" : "border-white/10 bg-black/20 text-white/65 hover:border-white/20 hover:bg-white/[0.05]"}`} style={selected ? { background: accent, boxShadow: `0 10px 28px color-mix(in srgb, ${accent} 28%, transparent)` } : undefined}>{String(hour).padStart(2, "0")}:00</button>;
              })}
            </div>

            <label className="mt-5 block">
              <FieldLabel>Título / tarea</FieldLabel>
              <input autoFocus value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} maxLength={180} className="field" placeholder="Agregar título…" />
            </label>

            <div id="quick-share-players" className="mt-4 rounded-2xl border border-white/10 bg-white/[0.025] p-4">
              <button type="button" onClick={() => setQuickShareOpen((value) => !value)} className="flex w-full items-center gap-3 text-left">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.035]" style={{ color: accent }}><Users size={17} /></span>
                <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">Compartir esta tarea con otro Player</span><span className="mt-0.5 block text-xs text-white/35">El evento aparecerá también en su Agenda.</span></span>
                <ChevronDown size={17} className={`text-white/35 transition ${quickShareOpen ? "rotate-180" : ""}`} />
              </button>

              {selectedPlayers.length ? <div className="mt-3 flex flex-wrap gap-2">{selectedPlayers.map((player) => <button key={player.id} type="button" onClick={() => setSelectedPlayers((list) => list.filter((item) => item.id !== player.id))} className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] py-1 pl-1 pr-3 text-xs"><Avatar src={player.avatar} label={player.displayName} size="sm" /><span>{player.displayName}</span><X size={12} /></button>)}</div> : null}

              {quickShareOpen ? (
                <div className="mt-4">
                  {connectionsLoading ? <div className="flex items-center gap-2 py-4 text-xs text-white/40"><Loader2 size={14} className="animate-spin" /> Cargando Players conectados…</div> : connectedPlayers.length ? <div className="grid gap-2 sm:grid-cols-2">{connectedPlayers.map((player) => {
                    const selected = selectedPlayers.some((item) => item.id === player.id);
                    return <button key={player.id} type="button" onClick={() => setSelectedPlayers((list) => selected ? list.filter((item) => item.id !== player.id) : [...list, player])} className={`flex items-center gap-3 rounded-xl border p-2.5 text-left transition ${selected ? "border-white/25 bg-white/[0.08]" : "border-white/8 bg-black/20 hover:border-white/20"}`}><Avatar src={player.avatar} label={player.displayName} size="sm" /><span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium">{player.displayName}</span>{player.username ? <span className="block truncate text-[10px] text-white/35">@{player.username}</span> : null}</span>{selected ? <span className="text-xs font-bold" style={{ color: accent }}>✓</span> : null}</button>;
                  })}</div> : <div className="rounded-xl border border-dashed border-white/10 p-4 text-center"><p className="text-xs text-white/40">No hay Players conectados activos en esta Agenda.</p><Link href="/agenda/conexiones" className="mt-2 inline-block text-xs font-medium" style={{ color: accent }}>Ir a Conexiones</Link></div>}
                </div>
              ) : null}
            </div>

            <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button type="button" onClick={() => void createEvent()} disabled={saving || !form.title.trim()} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl px-5 py-3 text-sm font-semibold text-white disabled:opacity-40" style={{ background: accent }}>{saving ? <Loader2 size={17} className="animate-spin" /> : <CalendarDays size={17} />} Agendar</button>
              <button type="button" onClick={() => setQuickShareOpen(true)} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.025] px-5 py-3 text-sm font-semibold text-white/80"><Users size={17} /> Compartir con otro Player</button>
            </div>
          </div>
        </div>
      ) : null}

      {createOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-5">
          <div className="max-h-[94vh] w-full overflow-y-auto rounded-t-3xl border border-white/10 bg-[#111119] p-5 shadow-2xl sm:max-w-2xl sm:rounded-3xl sm:p-6">
            <div className="flex items-center justify-between"><div><p className="text-[10px] font-bold tracking-[0.18em] text-white/35">{active.presentation.displayName}</p><h2 className="mt-1 text-xl font-semibold">Crear evento</h2></div><button type="button" onClick={() => setCreateOpen(false)} className="grid h-9 w-9 place-items-center rounded-full border border-white/10"><X size={17} /></button></div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="sm:col-span-2"><FieldLabel>Título</FieldLabel><input value={form.title} onChange={(e) => setForm((v) => ({ ...v, title: e.target.value }))} maxLength={180} className="field" placeholder="Sesión de grabación" /></label>
              <label className="sm:col-span-2"><FieldLabel>Descripción</FieldLabel><textarea value={form.description} onChange={(e) => setForm((v) => ({ ...v, description: e.target.value }))} rows={3} className="field resize-none" placeholder="Detalles del encuentro…" /></label>
              <label><FieldLabel>Inicio</FieldLabel><input type="datetime-local" value={form.startAt} onChange={(e) => setForm((v) => ({ ...v, startAt: e.target.value }))} className="field" /></label>
              <label><FieldLabel>Final</FieldLabel><input type="datetime-local" value={form.endAt} onChange={(e) => setForm((v) => ({ ...v, endAt: e.target.value }))} className="field" /></label>
              <label><FieldLabel>Tipo</FieldLabel><select value={form.eventType} onChange={(e) => setForm((v) => ({ ...v, eventType: e.target.value }))} className="field"><option value="event">Evento</option><option value="session">Sesión</option><option value="meeting">Reunión</option><option value="class">Clase</option><option value="appointment">Turno</option><option value="booking">Reserva</option><option value="release">Lanzamiento</option><option value="deadline">Fecha límite</option><option value="custom">Custom</option></select></label>
              <label><FieldLabel>Visibilidad</FieldLabel><select value={form.visibility} onChange={(e) => setForm((v) => ({ ...v, visibility: e.target.value }))} className="field"><option value="private">Privado</option><option value="participants">Participantes</option><option value="connections">Conexiones</option><option value="public">Público</option></select></label>
              <label><FieldLabel>Repetición</FieldLabel><select value={form.recurrence} onChange={(e) => setForm((v) => ({ ...v, recurrence: e.target.value }))} className="field"><option value="none">No repetir</option><option value="daily">Diario</option><option value="weekly">Semanal</option><option value="monthly">Mensual</option><option value="custom">Custom RRULE</option></select></label>
              {form.recurrence === "custom" ? <label><FieldLabel>RRULE</FieldLabel><input value={form.customRrule} onChange={(e) => setForm((v) => ({ ...v, customRrule: e.target.value }))} className="field" placeholder="FREQ=WEEKLY;BYDAY=MO,WE" /></label> : <label className="flex items-end"><span className="flex h-[42px] w-full items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white/50"><input type="checkbox" checked={form.allDay} onChange={(e) => setForm((v) => ({ ...v, allDay: e.target.checked }))} /> Todo el día</span></label>}
              <label><FieldLabel>Ubicación</FieldLabel><select value={form.locationType} onChange={(e) => setForm((v) => ({ ...v, locationType: e.target.value }))} className="field"><option value="unspecified">Sin definir</option><option value="physical">Lugar físico</option><option value="online">Online</option><option value="hybrid">Híbrido</option></select></label>
              <label><FieldLabel>Lugar</FieldLabel><input value={form.locationText} onChange={(e) => setForm((v) => ({ ...v, locationText: e.target.value }))} className="field" placeholder="Sala A / dirección" /></label>
              <label className="sm:col-span-2"><FieldLabel>Link</FieldLabel><input value={form.locationUrl} onChange={(e) => setForm((v) => ({ ...v, locationUrl: e.target.value }))} className="field" placeholder="https://…" /></label>
            </div>

            <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.025] p-4">
              <div className="flex items-center gap-2"><Users size={16} className="text-white/45" /><h3 className="text-sm font-semibold">Invitar Players</h3></div>
              <div className="mt-3 flex gap-2"><input value={playerQuery} onChange={(e) => setPlayerQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void searchPlayers(); } }} className="field min-w-0 flex-1" placeholder="Nombre o @" /><button type="button" onClick={() => void searchPlayers()} className="rounded-xl border border-white/10 px-4 text-sm">{playerSearching ? <Loader2 size={15} className="animate-spin" /> : "Buscar"}</button></div>
              {selectedPlayers.length ? <div className="mt-3 flex flex-wrap gap-2">{selectedPlayers.map((player) => <button key={player.id} type="button" onClick={() => setSelectedPlayers((list) => list.filter((item) => item.id !== player.id))} className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] py-1 pl-1 pr-3 text-xs"><Avatar src={player.avatar} label={player.displayName} size="sm" />{player.displayName}<X size={12} /></button>)}</div> : null}
              {playerResults.length ? <div className="mt-3 grid gap-2 sm:grid-cols-2">{playerResults.filter((player) => !selectedPlayers.some((selected) => selected.id === player.id)).map((player) => <button key={player.id} type="button" onClick={() => setSelectedPlayers((list) => [...list, player])} className="flex items-center gap-3 rounded-xl border border-white/8 bg-black/20 p-2.5 text-left hover:border-white/20"><Avatar src={player.avatar} label={player.displayName} size="sm" /><span className="min-w-0"><span className="block truncate text-xs font-medium">{player.displayName}</span>{player.username ? <span className="block text-[10px] text-white/35">@{player.username}</span> : null}</span></button>)}</div> : null}
            </div>

            {contexts.filter((context) => context.agendaId !== active.agendaId && (context.role === "owner" || context.role === "editor")).length ? <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.025] p-4"><div className="flex items-center gap-2"><Link2 size={16} className="text-white/45" /><h3 className="text-sm font-semibold">Compartir con otra Agenda</h3></div><div className="mt-3 grid gap-2 sm:grid-cols-2">{contexts.filter((context) => context.agendaId !== active.agendaId && (context.role === "owner" || context.role === "editor")).map((context) => <label key={context.agendaId} className="flex cursor-pointer items-center gap-3 rounded-xl border border-white/8 bg-black/20 p-3 text-xs"><input type="checkbox" checked={shareAgendaIds.includes(context.agendaId)} onChange={(e) => setShareAgendaIds((ids) => e.target.checked ? [...ids, context.agendaId] : ids.filter((id) => id !== context.agendaId))} /><Avatar src={context.presentation.avatar} label={context.presentation.displayName} size="sm" /><span className="truncate">{context.presentation.displayName}</span></label>)}</div></div> : null}

            <button type="button" onClick={() => void createEvent()} disabled={saving || !form.title.trim()} className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-2xl px-5 py-3.5 text-sm font-semibold text-white disabled:opacity-40" style={{ background: accent }}>{saving ? <Loader2 size={17} className="animate-spin" /> : <Plus size={17} />} Crear evento</button>
          </div>
        </div>
      ) : null}

      {selectedEvent ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-5">
          <div className="w-full rounded-t-3xl border border-white/10 bg-[#111119] p-5 sm:max-w-lg sm:rounded-3xl sm:p-6">
            <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-bold tracking-[0.16em] text-white/35">{eventLabel(selectedEvent.eventType)} · {relationLabel(selectedEvent.relation)}</p><h2 className="mt-2 text-xl font-semibold">{selectedEvent.title}</h2></div><button type="button" onClick={() => setSelectedEvent(null)} className="grid h-9 w-9 place-items-center rounded-full border border-white/10"><X size={17} /></button></div>
            <p className="mt-4 flex items-center gap-2 text-sm text-white/55"><Clock3 size={15} /> {formatDateTime(selectedEvent.startAt)} → {formatTime(selectedEvent.endAt)}</p>
            {selectedEvent.locationText ? <p className="mt-2 flex items-center gap-2 text-sm text-white/50"><MapPin size={15} /> {selectedEvent.locationText}</p> : null}
            {selectedEvent.locationUrl ? <a href={selectedEvent.locationUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-2 text-sm text-violet-200"><Link2 size={14} /> Abrir link</a> : null}
            {selectedEvent.description ? <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-white/55">{selectedEvent.description}</p> : null}
            {selectedEvent.recurrenceRule ? <p className="mt-3 rounded-xl border border-white/8 bg-black/20 p-3 text-xs text-white/40">Se repite · {selectedEvent.recurrenceRule}</p> : null}
            {selectedEvent.participants.length ? <div className="mt-5"><p className="text-xs font-semibold text-white/45">Players</p><div className="mt-2 grid gap-2">{selectedEvent.participants.map((participant) => participant.username ? <Link key={participant.playerId} href={`/${participant.username}`} className="flex items-center gap-3 rounded-xl border border-white/8 bg-black/20 p-2.5"><Avatar src={participant.avatar} label={participant.displayName} size="sm" /><span className="min-w-0 flex-1"><span className="block truncate text-sm">{participant.displayName}</span><span className="text-[10px] text-white/35">@{participant.username} · {participant.rsvpStatus}</span></span></Link> : <div key={participant.playerId} className="flex items-center gap-3 rounded-xl border border-white/8 bg-black/20 p-2.5"><Avatar src={participant.avatar} label={participant.displayName} size="sm" /><span className="text-sm">{participant.displayName}</span></div>)}</div></div> : null}
            {selectedEvent.relation === "invited" ? <div className="mt-5 grid grid-cols-3 gap-2"><button disabled={saving} type="button" onClick={() => void respondRsvp(selectedEvent.id, "accepted")} className="rounded-xl border border-emerald-300/20 bg-emerald-300/10 px-3 py-2.5 text-xs text-emerald-100">Aceptar</button><button disabled={saving} type="button" onClick={() => void respondRsvp(selectedEvent.id, "maybe")} className="rounded-xl border border-amber-300/20 bg-amber-300/10 px-3 py-2.5 text-xs text-amber-100">Quizás</button><button disabled={saving} type="button" onClick={() => void respondRsvp(selectedEvent.id, "declined")} className="rounded-xl border border-red-300/20 bg-red-300/10 px-3 py-2.5 text-xs text-red-100">Rechazar</button></div> : null}
            {canEdit && selectedEvent.primaryAgendaId === active.agendaId && selectedEvent.status !== "cancelled" ? <button disabled={saving} type="button" onClick={() => void cancelEvent(selectedEvent.id)} className="mt-5 w-full rounded-xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-100">Cancelar evento</button> : null}
          </div>
        </div>
      ) : null}

      <style jsx global>{`
        .field { width: 100%; border-radius: .75rem; border: 1px solid rgba(255,255,255,.1); background: rgba(0,0,0,.24); padding: .7rem .8rem; font-size: .875rem; color: white; outline: none; }
        .field:focus { border-color: color-mix(in srgb, var(--agenda-accent) 65%, white 10%); }
        .field::placeholder { color: rgba(255,255,255,.24); }
        .field option { background: #111119; color: white; }
      `}</style>
    </main>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="mb-1.5 block text-[11px] font-semibold text-white/45">{children}</span>;
}

function EmptyDay({ canEdit, onCreate }: { canEdit: boolean; onCreate: () => void }) {
  return <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.015] px-5 py-10 text-center"><CalendarDays className="mx-auto text-white/20" /><p className="mt-3 text-sm text-white/40">No hay eventos en este período.</p>{canEdit ? <button type="button" onClick={onCreate} className="mt-4 rounded-xl border border-white/10 px-4 py-2 text-xs text-white/70 hover:bg-white/[0.05]">Crear evento</button> : null}</div>;
}
