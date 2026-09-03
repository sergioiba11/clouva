"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDays, ChevronLeft, ChevronRight, Loader2, MoonStar } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";

const DAY_MS = 86_400_000;
const SYNODIC_MONTH = 29.530588853;
const NEW_MOON_EPOCH = Date.UTC(2000, 0, 6, 18, 14, 0);
const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const PHASES = [
  { name: "Luna nueva", icon: "🌑" },
  { name: "Creciente", icon: "🌒" },
  { name: "Cuarto creciente", icon: "🌓" },
  { name: "Gibosa creciente", icon: "🌔" },
  { name: "Luna llena", icon: "🌕" },
  { name: "Gibosa menguante", icon: "🌖" },
  { name: "Cuarto menguante", icon: "🌗" },
  { name: "Menguante", icon: "🌘" },
] as const;

function lunarData(date: Date) {
  const sample = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0);
  const elapsedDays = (sample - NEW_MOON_EPOCH) / DAY_MS;
  const age = ((elapsedDays % SYNODIC_MONTH) + SYNODIC_MONTH) % SYNODIC_MONTH;
  const fraction = age / SYNODIC_MONTH;
  const phaseIndex = Math.round(fraction * 8) % 8;
  const illumination = Math.round(((1 - Math.cos(2 * Math.PI * fraction)) / 2) * 100);
  return { ...PHASES[phaseIndex], age, illumination, fraction };
}

function monthTitle(date: Date) {
  return new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric" }).format(date);
}

function fullDate(date: Date) {
  return new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(date);
}

export default function LunarAgendaPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [cursor, setCursor] = useState(() => new Date());
  const [selected, setSelected] = useState(() => new Date());

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login?next=/agenda/lunar");
  }, [authLoading, router, user]);

  const cells = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const leading = (first.getDay() + 6) % 7;
    const days = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    return [
      ...Array.from({ length: leading }, () => null),
      ...Array.from({ length: days }, (_, index) => new Date(cursor.getFullYear(), cursor.getMonth(), index + 1)),
    ];
  }, [cursor]);

  const selectedMoon = lunarData(selected);

  function moveMonth(direction: -1 | 1) {
    const next = new Date(cursor.getFullYear(), cursor.getMonth() + direction, 1);
    setCursor(next);
    setSelected(next);
  }

  function goToday() {
    const today = new Date();
    setCursor(today);
    setSelected(today);
  }

  if (authLoading || !user) {
    return <main className="grid min-h-screen place-items-center bg-[#08080d] text-white"><Loader2 className="animate-spin text-violet-300" /></main>;
  }

  return (
    <main className="min-h-screen bg-[#08080d] px-4 pb-28 pt-7 text-white sm:px-6 md:pb-10">
      <div className="mx-auto max-w-5xl">
        <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-2xl border border-violet-300/15 bg-violet-300/10 text-violet-200"><MoonStar size={20} /></span>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/35">AGENDA CLOUVA</p>
                <h1 className="text-2xl font-semibold">Calendario lunar</h1>
              </div>
            </div>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/45">Fases lunares integradas a la Agenda y calculadas automáticamente para cada fecha.</p>
          </div>
          <Link href="/agenda" className="inline-flex items-center gap-2 self-start rounded-xl border border-white/10 bg-white/[0.025] px-4 py-2.5 text-sm text-white/70 transition hover:bg-white/[0.06] hover:text-white"><CalendarDays size={15} /> Volver a Agenda</Link>
        </header>

        <section className="mt-7 rounded-3xl border border-white/10 bg-white/[0.02] p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => moveMonth(-1)} className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-black/20"><ChevronLeft size={18} /></button>
              <button type="button" onClick={goToday} className="rounded-xl border border-white/10 bg-black/20 px-4 py-2.5 text-sm font-medium">Hoy</button>
              <button type="button" onClick={() => moveMonth(1)} className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-black/20"><ChevronRight size={18} /></button>
            </div>
            <h2 className="text-lg font-semibold capitalize">{monthTitle(cursor)}</h2>
          </div>

          <div className="mt-5 grid grid-cols-7 border-b border-white/10">
            {WEEKDAYS.map((day) => <div key={day} className="py-3 text-center text-[10px] font-bold uppercase tracking-[0.15em] text-white/35">{day}</div>)}
          </div>
          <div className="grid grid-cols-7 overflow-hidden rounded-b-2xl border-l border-white/[0.065]">
            {cells.map((day, index) => {
              if (!day) return <div key={`empty-${index}`} className="min-h-[82px] border-b border-r border-white/[0.065] bg-black/15 sm:min-h-[112px]" />;
              const moon = lunarData(day);
              const active = day.getFullYear() === selected.getFullYear() && day.getMonth() === selected.getMonth() && day.getDate() === selected.getDate();
              const today = new Date();
              const isToday = day.getFullYear() === today.getFullYear() && day.getMonth() === today.getMonth() && day.getDate() === today.getDate();
              return (
                <button key={day.toISOString()} type="button" onClick={() => setSelected(day)} className={`min-h-[82px] border-b border-r border-white/[0.065] p-1.5 text-left transition sm:min-h-[112px] sm:p-2 ${active ? "bg-violet-500/[0.09]" : "bg-black/10 hover:bg-white/[0.035]"}`}>
                  <div className="flex items-start justify-between gap-1">
                    <span className={`grid h-6 w-6 place-items-center rounded-full text-xs ${isToday ? "bg-violet-500 text-white" : "text-white/55"}`}>{day.getDate()}</span>
                    <span className="text-lg leading-none sm:text-xl" title={moon.name}>{moon.icon}</span>
                  </div>
                  <p className="mt-2 hidden truncate text-[9px] text-white/35 sm:block">{moon.name}</p>
                  <p className="mt-1 text-[9px] tabular-nums text-white/25">{moon.illumination}%</p>
                </button>
              );
            })}
          </div>
        </section>

        <section className="mt-5 rounded-3xl border border-violet-300/15 bg-[radial-gradient(circle_at_top_left,rgba(124,58,237,.18),transparent_45%),rgba(255,255,255,.02)] p-5 sm:p-6">
          <div className="flex items-center gap-4">
            <span className="text-5xl" aria-hidden>{selectedMoon.icon}</span>
            <div className="min-w-0">
              <p className="capitalize text-sm text-white/45">{fullDate(selected)}</p>
              <h2 className="mt-1 text-xl font-semibold">{selectedMoon.name}</h2>
            </div>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4"><p className="text-[10px] font-bold uppercase tracking-[0.15em] text-white/30">Iluminación</p><p className="mt-2 text-xl font-semibold">{selectedMoon.illumination}%</p></div>
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4"><p className="text-[10px] font-bold uppercase tracking-[0.15em] text-white/30">Edad lunar</p><p className="mt-2 text-xl font-semibold">{selectedMoon.age.toFixed(1)} días</p></div>
            <div className="col-span-2 rounded-2xl border border-white/10 bg-black/20 p-4 sm:col-span-1"><p className="text-[10px] font-bold uppercase tracking-[0.15em] text-white/30">Ciclo</p><p className="mt-2 text-xl font-semibold">{Math.round(selectedMoon.fraction * 100)}%</p></div>
          </div>
        </section>
      </div>
    </main>
  );
}
