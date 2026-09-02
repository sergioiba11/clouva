"use client";

import { Ban, CalendarClock, Loader2, Plus, Save, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type Context = {
  agendaId: string;
  timezone: string;
  role: "owner" | "editor" | "participant" | "viewer";
  presentation: {
    identityType: "player" | "studio" | "business_space";
    displayName: string;
    alias: string | null;
  };
};

type AvailabilityRule = {
  id: string;
  weekday: number;
  start_local: string;
  end_local: string;
  timezone: string;
  valid_from: string | null;
  valid_until: string | null;
  is_available: boolean;
};

type AgendaBlock = {
  id: string;
  start_at: string;
  end_at: string;
  reason: string | null;
  status: string;
  event_id: string | null;
  booking_id: string | null;
};

type DayWindow = { enabled: boolean; start: string; end: string };
type SpecialDay = { key: string; date: string; isAvailable: boolean; start: string; end: string };
type AvailabilityMode = "open" | "weekly" | "closed";

const DAYS = [
  { weekday: 1, label: "Lunes" },
  { weekday: 2, label: "Martes" },
  { weekday: 3, label: "Miércoles" },
  { weekday: 4, label: "Jueves" },
  { weekday: 5, label: "Viernes" },
  { weekday: 6, label: "Sábado" },
  { weekday: 0, label: "Domingo" },
];

function blankWeek(): Record<number, DayWindow> {
  return Object.fromEntries(Array.from({ length: 7 }, (_, weekday) => [weekday, { enabled: false, start: "09:00", end: "18:00" }])) as Record<number, DayWindow>;
}

function shortTime(value: string | null | undefined, fallback: string) {
  return typeof value === "string" && value.length >= 5 ? value.slice(0, 5) : fallback;
}

function localPartsInZone(date: Date, timezone: string) {
  const values: Record<string, number> = {};
  for (const part of new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date)) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  return values as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

function wallTimeToIso(value: string, timezone: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error("Fecha u hora inválida.");
  const target = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), 0);
  let guess = target;
  for (let index = 0; index < 3; index += 1) {
    const local = localPartsInZone(new Date(guess), timezone);
    const observed = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second || 0);
    guess += target - observed;
  }
  return new Date(guess).toISOString();
}

function formatBlock(value: string, timezone: string) {
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: timezone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function weekdayForDate(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
}

export default function AgendaAvailabilityPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [contexts, setContexts] = useState<Context[]>([]);
  const [agendaId, setAgendaId] = useState("");
  const [mode, setMode] = useState<AvailabilityMode>("open");
  const [week, setWeek] = useState<Record<number, DayWindow>>(() => blankWeek());
  const [specialDays, setSpecialDays] = useState<SpecialDay[]>([]);
  const [blocks, setBlocks] = useState<AgendaBlock[]>([]);
  const [blockForm, setBlockForm] = useState({ startAt: "", endAt: "", reason: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const editable = useMemo(() => contexts.filter((context) => context.role === "owner" || context.role === "editor"), [contexts]);
  const active = useMemo(() => editable.find((context) => context.agendaId === agendaId) || null, [agendaId, editable]);

  const applyAvailability = useCallback((rules: AvailabilityRule[], nextBlocks: AgendaBlock[]) => {
    const recurring = rules.filter((rule) => !rule.valid_from && !rule.valid_until);
    const positives = recurring.filter((rule) => rule.is_available);
    const fullClosed = recurring.length >= 7 && recurring.every((rule) => !rule.is_available && shortTime(rule.start_local, "") === "00:00");
    setMode(fullClosed ? "closed" : positives.length ? "weekly" : "open");

    const nextWeek = blankWeek();
    for (const rule of positives) {
      if (!nextWeek[rule.weekday]?.enabled) {
        nextWeek[rule.weekday] = {
          enabled: true,
          start: shortTime(rule.start_local, "09:00"),
          end: shortTime(rule.end_local, "18:00"),
        };
      }
    }
    setWeek(nextWeek);

    setSpecialDays(rules
      .filter((rule) => rule.valid_from && rule.valid_until && rule.valid_from === rule.valid_until)
      .map((rule) => ({
        key: rule.id,
        date: rule.valid_from || "",
        isAvailable: rule.is_available,
        start: shortTime(rule.start_local, "09:00"),
        end: shortTime(rule.end_local, "18:00"),
      })));
    setBlocks(nextBlocks || []);
  }, []);

  const loadAvailability = useCallback(async (nextAgendaId: string) => {
    if (!nextAgendaId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await authenticatedFetch(`/api/agenda/availability?agendaId=${encodeURIComponent(nextAgendaId)}`);
      const payload = await readApiJson<{ rules: AvailabilityRule[]; blocks: AgendaBlock[] }>(response);
      applyAvailability(payload.rules || [], payload.blocks || []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo cargar la disponibilidad.");
    } finally {
      setLoading(false);
    }
  }, [applyAvailability]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace("/login?next=/agenda/disponibilidad");
      return;
    }
    void (async () => {
      try {
        const response = await authenticatedFetch("/api/agenda/contexts");
        const payload = await readApiJson<{ contexts: Context[] }>(response);
        const nextEditable = (payload.contexts || []).filter((context) => context.role === "owner" || context.role === "editor");
        setContexts(payload.contexts || []);
        const first = nextEditable[0];
        if (first) {
          setAgendaId(first.agendaId);
          await loadAvailability(first.agendaId);
        } else {
          setLoading(false);
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "No se pudieron cargar tus Agendas.");
        setLoading(false);
      }
    })();
  }, [authLoading, loadAvailability, router, user]);

  async function selectAgenda(nextAgendaId: string) {
    setAgendaId(nextAgendaId);
    await loadAvailability(nextAgendaId);
  }

  function addSpecialDay() {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    setSpecialDays((current) => [...current, { key: crypto.randomUUID(), date: tomorrow, isAvailable: false, start: "09:00", end: "18:00" }]);
  }

  async function saveRules() {
    if (!active) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const rules: Array<Record<string, unknown>> = [];
      if (mode === "weekly") {
        for (const { weekday } of DAYS) {
          const day = week[weekday];
          if (day.enabled) rules.push({ weekday, startLocal: day.start, endLocal: day.end, timezone: active.timezone, isAvailable: true });
        }
        if (!rules.length) throw new Error("Activá al menos un día o elegí 'Siempre disponible' / 'Cerrada'.");
      } else if (mode === "closed") {
        for (let weekday = 0; weekday < 7; weekday += 1) {
          rules.push({ weekday, startLocal: "00:00", endLocal: "23:59:59", timezone: active.timezone, isAvailable: false });
        }
      }

      for (const special of specialDays) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(special.date)) continue;
        rules.push({
          weekday: weekdayForDate(special.date),
          startLocal: special.start,
          endLocal: special.end,
          timezone: active.timezone,
          validFrom: special.date,
          validUntil: special.date,
          isAvailable: special.isAvailable,
        });
      }

      const response = await authenticatedFetch("/api/agenda/availability", {
        method: "PUT",
        body: JSON.stringify({ agendaId: active.agendaId, rules }),
      });
      await readApiJson(response);
      await loadAvailability(active.agendaId);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo guardar la disponibilidad.");
    } finally {
      setSaving(false);
    }
  }

  async function createBlock() {
    if (!active || !blockForm.startAt || !blockForm.endAt) return;
    setSaving(true);
    setError(null);
    try {
      const startAt = wallTimeToIso(blockForm.startAt, active.timezone);
      const endAt = wallTimeToIso(blockForm.endAt, active.timezone);
      const response = await authenticatedFetch("/api/agenda/availability/blocks", {
        method: "POST",
        body: JSON.stringify({ agendaId: active.agendaId, startAt, endAt, reason: blockForm.reason }),
      });
      await readApiJson(response);
      setBlockForm({ startAt: "", endAt: "", reason: "" });
      await loadAvailability(active.agendaId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo bloquear ese horario.");
    } finally {
      setSaving(false);
    }
  }

  async function releaseBlock(block: AgendaBlock) {
    if (!active || block.event_id || block.booking_id) return;
    setSaving(true);
    try {
      const response = await authenticatedFetch("/api/agenda/availability/blocks", {
        method: "DELETE",
        body: JSON.stringify({ agendaId: active.agendaId, blockId: block.id }),
      });
      await readApiJson(response);
      await loadAvailability(active.agendaId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo liberar el horario.");
    } finally {
      setSaving(false);
    }
  }

  if (authLoading || (loading && !contexts.length)) {
    return <main className="grid min-h-screen place-items-center bg-[#08080d] text-white"><Loader2 className="animate-spin text-violet-300" /></main>;
  }

  return (
    <main className="min-h-screen bg-[#08080d] px-4 pb-28 pt-8 text-white sm:px-6 md:pb-12">
      <div className="mx-auto max-w-4xl">
        <div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-2xl border border-violet-300/15 bg-violet-300/10 text-violet-200"><CalendarClock size={20} /></span><div><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/35">AGENDA CLOUVA</p><h1 className="text-2xl font-semibold">Disponibilidad</h1></div></div>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-white/45">Definí cuándo esta identidad puede recibir reservas. Los eventos ocupados y bloqueos se combinan automáticamente con estas reglas.</p>

        {error ? <div className="mt-5 flex justify-between gap-3 rounded-2xl border border-red-300/15 bg-red-300/[0.07] p-4 text-sm text-red-100"><span>{error}</span><button type="button" onClick={() => setError(null)}><X size={15} /></button></div> : null}

        {!editable.length ? <div className="mt-7 rounded-3xl border border-white/10 bg-white/[0.025] p-8 text-center text-sm text-white/45">No tenés una Agenda editable para configurar.</div> : null}

        {active ? <>
          <section className="mt-7 rounded-3xl border border-white/10 bg-white/[0.025] p-5 sm:p-6">
            <label className="block"><span className="mb-2 block text-xs font-semibold text-white/45">Identidad / Agenda</span><select value={agendaId} onChange={(event) => void selectAgenda(event.target.value)} className="w-full rounded-xl border border-white/10 bg-[#111119] px-3 py-3 text-sm outline-none">{editable.map((context) => <option key={context.agendaId} value={context.agendaId}>{context.presentation.displayName} · {context.presentation.identityType}</option>)}</select></label>
            <p className="mt-2 text-xs text-white/30">Timezone: {active.timezone}</p>

            <div className="mt-6 grid gap-2 sm:grid-cols-3">
              {([
                ["open", "Siempre disponible", "Solo bloquean eventos y bloqueos manuales"],
                ["weekly", "Horarios semanales", "Elegí días y franjas recurrentes"],
                ["closed", "Cerrada", "No aceptar nuevas reservas"],
              ] as const).map(([value, label, description]) => <button key={value} type="button" onClick={() => setMode(value)} className={`rounded-2xl border p-4 text-left transition ${mode === value ? "border-violet-300/35 bg-violet-300/[0.09]" : "border-white/8 bg-black/20 hover:border-white/15"}`}><span className="block text-sm font-semibold">{label}</span><span className="mt-1 block text-[11px] leading-4 text-white/35">{description}</span></button>)}
            </div>

            {mode === "weekly" ? <div className="mt-6 grid gap-2">{DAYS.map(({ weekday, label }) => {
              const day = week[weekday];
              return <div key={weekday} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-white/8 bg-black/20 p-3 sm:grid-cols-[150px_1fr_1fr]">
                <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={day.enabled} onChange={(event) => setWeek((current) => ({ ...current, [weekday]: { ...current[weekday], enabled: event.target.checked } }))} className="h-4 w-4 accent-violet-500" /><span>{label}</span></label>
                <div className="col-span-2 grid grid-cols-2 gap-2 sm:col-span-2"><input type="time" value={day.start} disabled={!day.enabled} onChange={(event) => setWeek((current) => ({ ...current, [weekday]: { ...current[weekday], start: event.target.value } }))} className="rounded-xl border border-white/10 bg-[#111119] px-3 py-2.5 text-sm disabled:opacity-30" /><input type="time" value={day.end} disabled={!day.enabled} onChange={(event) => setWeek((current) => ({ ...current, [weekday]: { ...current[weekday], end: event.target.value } }))} className="rounded-xl border border-white/10 bg-[#111119] px-3 py-2.5 text-sm disabled:opacity-30" /></div>
              </div>;
            })}</div> : null}

            <div className="mt-7 border-t border-white/8 pt-6">
              <div className="flex items-center justify-between gap-3"><div><h2 className="text-sm font-semibold">Días especiales</h2><p className="mt-1 text-xs text-white/35">Abrí o cerrá una fecha concreta sin cambiar tu semana habitual.</p></div><button type="button" onClick={addSpecialDay} className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-xs"><Plus size={14} /> Agregar</button></div>
              <div className="mt-3 grid gap-2">{specialDays.map((special) => <div key={special.key} className="grid gap-2 rounded-2xl border border-white/8 bg-black/20 p-3 sm:grid-cols-[1fr_140px_120px_120px_auto] sm:items-center"><input type="date" value={special.date} onChange={(event) => setSpecialDays((items) => items.map((item) => item.key === special.key ? { ...item, date: event.target.value } : item))} className="rounded-xl border border-white/10 bg-[#111119] px-3 py-2.5 text-sm" /><select value={special.isAvailable ? "available" : "closed"} onChange={(event) => setSpecialDays((items) => items.map((item) => item.key === special.key ? { ...item, isAvailable: event.target.value === "available" } : item))} className="rounded-xl border border-white/10 bg-[#111119] px-3 py-2.5 text-sm"><option value="available">Disponible</option><option value="closed">No disponible</option></select><input type="time" value={special.start} onChange={(event) => setSpecialDays((items) => items.map((item) => item.key === special.key ? { ...item, start: event.target.value } : item))} className="rounded-xl border border-white/10 bg-[#111119] px-3 py-2.5 text-sm" /><input type="time" value={special.end} onChange={(event) => setSpecialDays((items) => items.map((item) => item.key === special.key ? { ...item, end: event.target.value } : item))} className="rounded-xl border border-white/10 bg-[#111119] px-3 py-2.5 text-sm" /><button type="button" onClick={() => setSpecialDays((items) => items.filter((item) => item.key !== special.key))} className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 text-white/45 hover:text-red-200"><Trash2 size={15} /></button></div>)}{!specialDays.length ? <p className="rounded-2xl border border-dashed border-white/8 px-4 py-6 text-center text-xs text-white/30">Sin días especiales.</p> : null}</div>
            </div>

            <button type="button" onClick={() => void saveRules()} disabled={saving} className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-violet-600 px-5 py-3.5 text-sm font-semibold disabled:opacity-40">{saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}{saved ? "Guardado" : "Guardar disponibilidad"}</button>
          </section>

          <section className="mt-5 rounded-3xl border border-white/10 bg-white/[0.025] p-5 sm:p-6">
            <div className="flex items-center gap-2"><Ban size={17} className="text-white/45" /><div><h2 className="text-sm font-semibold">Bloquear horario</h2><p className="mt-1 text-xs text-white/35">Útil para feriados, mantenimiento, viajes o cualquier franja que no querés reservar.</p></div></div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2"><label><span className="mb-1.5 block text-[11px] font-semibold text-white/40">Desde</span><input type="datetime-local" value={blockForm.startAt} onChange={(event) => setBlockForm((current) => ({ ...current, startAt: event.target.value }))} className="w-full rounded-xl border border-white/10 bg-[#111119] px-3 py-2.5 text-sm" /></label><label><span className="mb-1.5 block text-[11px] font-semibold text-white/40">Hasta</span><input type="datetime-local" value={blockForm.endAt} onChange={(event) => setBlockForm((current) => ({ ...current, endAt: event.target.value }))} className="w-full rounded-xl border border-white/10 bg-[#111119] px-3 py-2.5 text-sm" /></label><label className="sm:col-span-2"><span className="mb-1.5 block text-[11px] font-semibold text-white/40">Motivo</span><input value={blockForm.reason} onChange={(event) => setBlockForm((current) => ({ ...current, reason: event.target.value }))} placeholder="Viaje, mantenimiento, feriado…" maxLength={500} className="w-full rounded-xl border border-white/10 bg-[#111119] px-3 py-2.5 text-sm outline-none" /></label></div>
            <button type="button" onClick={() => void createBlock()} disabled={saving || !blockForm.startAt || !blockForm.endAt} className="mt-4 inline-flex items-center gap-2 rounded-xl border border-violet-300/20 bg-violet-300/[0.08] px-4 py-2.5 text-sm text-violet-100 disabled:opacity-35"><Plus size={15} /> Bloquear franja</button>

            <div className="mt-6 grid gap-2">{blocks.map((block) => {
              const automatic = Boolean(block.event_id || block.booking_id);
              return <div key={block.id} className="flex flex-col gap-3 rounded-2xl border border-white/8 bg-black/20 p-4 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><p className="text-sm font-medium">{block.reason || (block.booking_id ? "Reserva" : block.event_id ? "Evento" : "Bloqueo manual")}</p><p className="mt-1 text-xs text-white/40">{formatBlock(block.start_at, active.timezone)} → {formatBlock(block.end_at, active.timezone)}</p>{automatic ? <p className="mt-1 text-[10px] uppercase tracking-[0.12em] text-white/25">Gestionado automáticamente por {block.booking_id ? "Booking" : "Evento"}</p> : null}</div>{!automatic ? <button type="button" onClick={() => void releaseBlock(block)} disabled={saving} className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-xs text-white/55 hover:text-white"><Trash2 size={13} /> Liberar</button> : null}</div>;
            })}{!blocks.length ? <p className="rounded-2xl border border-dashed border-white/8 px-4 py-7 text-center text-xs text-white/30">No hay bloqueos futuros.</p> : null}</div>
          </section>
        </> : null}
      </div>
    </main>
  );
}
