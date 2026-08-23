"use client";

import {
  ArrowDownLeft,
  ArrowUpRight,
  CircleDollarSign,
  Pencil,
  Plus,
  ReceiptText,
  RefreshCw,
  Trash2,
  TrendingUp,
  WalletCards,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useAuth } from "@/components/auth-provider";
import { MainNav } from "@/components/layout";

type EntryType = "ingreso" | "gasto";

type MoneyEntry = {
  id: string;
  owner_id?: string;
  type: EntryType;
  amount: number | string | null;
  category: string | null;
  source: string | null;
  date: string | null;
  notes: string | null;
  created_at: string | null;
};

type MoneyForm = {
  type: EntryType;
  amount: string;
  category: string;
  source: string;
  date: string;
  notes: string;
};

const TABLE = "flow_money_entries";
const CARD = "rounded-[24px] border border-white/[0.08] bg-[#0c0a13]/95 shadow-[0_22px_70px_rgba(0,0,0,.18)]";
const INPUT = "w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-white/25 focus:border-violet-400/60";

function localDate() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function emptyForm(type: EntryType = "ingreso"): MoneyForm {
  return { type, amount: "", category: "", source: "", date: localDate(), notes: "" };
}

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function amount(value: unknown) {
  return `$ ${new Intl.NumberFormat("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numberValue(value))}`;
}

function shortDate(value: string | null) {
  if (!value) return "Sin fecha";
  const [year, month, day] = value.slice(0, 10).split("-");
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}

export default function MiFlowPage() {
  const { user } = useAuth();
  const [entries, setEntries] = useState<MoneyEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<MoneyForm>(() => emptyForm());

  const loadEntries = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);

    const { supabase } = await import("@/lib/supabase");
    const { data, error: loadError } = await supabase
      .from(TABLE)
      .select("id, owner_id, type, amount, category, source, date, notes, created_at")
      .eq("owner_id", user.id)
      .order("created_at", { ascending: false });

    if (loadError) {
      setError("No pude cargar tus movimientos.");
      setEntries([]);
    } else {
      setEntries((data ?? []) as MoneyEntry[]);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  const totals = useMemo(() => {
    const income = entries.reduce((sum, entry) => sum + (entry.type === "ingreso" ? numberValue(entry.amount) : 0), 0);
    const expense = entries.reduce((sum, entry) => sum + (entry.type === "gasto" ? numberValue(entry.amount) : 0), 0);
    const month = localDate().slice(0, 7);
    const currentMonth = entries.reduce((sum, entry) => {
      if (!entry.date?.startsWith(month)) return sum;
      return sum + (entry.type === "ingreso" ? numberValue(entry.amount) : -numberValue(entry.amount));
    }, 0);

    return { income, expense, balance: income - expense, currentMonth };
  }, [entries]);

  const sortedEntries = useMemo(
    () => [...entries].sort((a, b) => String(b.date ?? b.created_at ?? "").localeCompare(String(a.date ?? a.created_at ?? ""))),
    [entries],
  );

  function openCreate(type: EntryType) {
    setEditingId(null);
    setForm(emptyForm(type));
    setError(null);
    setFormOpen(true);
  }

  function openEdit(entry: MoneyEntry) {
    setEditingId(entry.id);
    setForm({
      type: entry.type,
      amount: String(entry.amount ?? ""),
      category: entry.category ?? "",
      source: entry.source ?? "",
      date: entry.date?.slice(0, 10) ?? localDate(),
      notes: entry.notes ?? "",
    });
    setError(null);
    setFormOpen(true);
  }

  function closeForm() {
    if (saving) return;
    setFormOpen(false);
    setEditingId(null);
    setForm(emptyForm());
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || saving) return;

    const parsedAmount = Number(form.amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError("Ingresá un monto mayor a cero.");
      return;
    }

    setSaving(true);
    setError(null);
    const { supabase } = await import("@/lib/supabase");
    const payload = {
      owner_id: user.id,
      type: form.type,
      amount: parsedAmount,
      category: form.category.trim() || null,
      source: form.source.trim() || null,
      date: form.date || null,
      notes: form.notes.trim() || null,
    };

    const result = editingId
      ? await supabase.from(TABLE).update(payload).eq("id", editingId).eq("owner_id", user.id)
      : await supabase.from(TABLE).insert(payload);

    if (result.error) {
      setError(editingId ? "No pude actualizar el movimiento." : "No pude guardar el movimiento.");
      setSaving(false);
      return;
    }

    setSaving(false);
    closeForm();
    await loadEntries();
  }

  async function remove(entry: MoneyEntry) {
    if (!user) return;
    const confirmed = window.confirm(`¿Eliminar este ${entry.type} de ${amount(entry.amount)}?`);
    if (!confirmed) return;

    const { supabase } = await import("@/lib/supabase");
    const { error: deleteError } = await supabase.from(TABLE).delete().eq("id", entry.id).eq("owner_id", user.id);
    if (deleteError) {
      setError("No pude eliminar el movimiento.");
      return;
    }
    await loadEntries();
  }

  return (
    <main className="min-h-screen bg-[#07060d] text-white">
      <MainNav />

      <div className="relative overflow-hidden border-b border-white/[0.06]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_76%_18%,rgba(124,58,237,.23),transparent_34%),radial-gradient(circle_at_18%_0%,rgba(91,33,182,.12),transparent_30%)]" />
        <div className="relative mx-auto max-w-7xl px-4 py-8 md:px-8 md:py-12">
          <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
            <section className="rounded-[28px] border border-violet-400/15 bg-gradient-to-br from-[#171022] via-[#0f0b18] to-[#09080f] p-6 md:p-8">
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-violet-300/15 bg-violet-400/[0.07] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-200">
                <WalletCards size={14} />
                Tu economía personal
              </div>
              <h1 className="text-3xl font-semibold tracking-tight md:text-5xl">MI FLOW</h1>
              <p className="mt-2 max-w-2xl text-sm text-white/55 md:text-base">Dinero, ganancias, gastos y movimientos dentro de tu cuenta CLOUVA.</p>

              <div className="mt-7 flex flex-wrap gap-3">
                <button onClick={() => openCreate("ingreso")} className="inline-flex items-center gap-2 rounded-xl bg-[#8f5cff] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_10px_35px_rgba(139,92,246,.28)] transition hover:bg-[#9c6aff]">
                  <ArrowDownLeft size={17} />
                  Nuevo ingreso
                </button>
                <button onClick={() => openCreate("gasto")} className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/[0.08]">
                  <ArrowUpRight size={17} />
                  Nuevo gasto
                </button>
              </div>
            </section>

            <section className={`${CARD} flex flex-col justify-between p-6`}>
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/35">Disponible</span>
                  <CircleDollarSign size={19} className="text-emerald-300" />
                </div>
                <strong className="mt-4 block text-3xl font-semibold tracking-tight md:text-4xl">{amount(totals.balance)}</strong>
              </div>
              <div className="mt-7 grid grid-cols-2 gap-3 border-t border-white/[0.07] pt-5 text-xs">
                <div>
                  <span className="block uppercase tracking-[0.12em] text-white/30">Este mes</span>
                  <b className={totals.currentMonth >= 0 ? "mt-1 block text-emerald-300" : "mt-1 block text-rose-300"}>{amount(totals.currentMonth)}</b>
                </div>
                <div>
                  <span className="block uppercase tracking-[0.12em] text-white/30">Movimientos</span>
                  <b className="mt-1 block text-white/85">{entries.length}</b>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl space-y-5 px-4 py-6 md:px-8 md:py-8">
        <section className="grid gap-3 md:grid-cols-3">
          <article className={`${CARD} p-5`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/35">Ingresos</span>
                <strong className="mt-3 block text-2xl font-semibold text-emerald-300">{amount(totals.income)}</strong>
              </div>
              <span className="rounded-xl border border-emerald-300/15 bg-emerald-300/[0.06] p-2 text-emerald-300"><ArrowDownLeft size={18} /></span>
            </div>
          </article>
          <article className={`${CARD} p-5`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/35">Gastos</span>
                <strong className="mt-3 block text-2xl font-semibold text-rose-300">{amount(totals.expense)}</strong>
              </div>
              <span className="rounded-xl border border-rose-300/15 bg-rose-300/[0.06] p-2 text-rose-300"><ArrowUpRight size={18} /></span>
            </div>
          </article>
          <article className={`${CARD} p-5`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/35">Balance</span>
                <strong className="mt-3 block text-2xl font-semibold">{amount(totals.balance)}</strong>
              </div>
              <span className="rounded-xl border border-violet-300/15 bg-violet-300/[0.06] p-2 text-violet-300"><TrendingUp size={18} /></span>
            </div>
          </article>
        </section>

        <section className={`${CARD} overflow-hidden`}>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] px-5 py-4 md:px-6">
            <div>
              <h2 className="text-lg font-semibold">Movimientos</h2>
              <p className="mt-0.5 text-xs text-white/40">Tu historial de ingresos y gastos.</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => void loadEntries()} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-xs text-white/65 transition hover:bg-white/[0.05] disabled:opacity-50">
                <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
                Actualizar
              </button>
              <button onClick={() => openCreate("ingreso")} className="inline-flex items-center gap-2 rounded-xl bg-violet-500 px-3 py-2 text-xs font-semibold text-white">
                <Plus size={14} />
                Agregar
              </button>
            </div>
          </div>

          {error && !formOpen ? <div className="border-b border-rose-300/10 bg-rose-300/[0.04] px-5 py-3 text-sm text-rose-200 md:px-6">{error}</div> : null}

          {loading ? (
            <div className="flex min-h-44 items-center justify-center gap-2 text-sm text-white/40"><RefreshCw size={16} className="animate-spin" /> Cargando movimientos...</div>
          ) : sortedEntries.length === 0 ? (
            <div className="flex min-h-56 flex-col items-center justify-center px-6 text-center">
              <span className="mb-4 rounded-2xl border border-violet-300/15 bg-violet-300/[0.06] p-3 text-violet-300"><ReceiptText size={24} /></span>
              <h3 className="font-semibold">Tu Flow empieza acá</h3>
              <p className="mt-1 max-w-md text-sm text-white/40">Registrá el primer ingreso o gasto y el tablero se actualiza automáticamente.</p>
              <button onClick={() => openCreate("ingreso")} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-violet-500 px-4 py-2 text-sm font-semibold"><Plus size={16} /> Nuevo movimiento</button>
            </div>
          ) : (
            <div className="divide-y divide-white/[0.06]">
              {sortedEntries.map((entry) => {
                const isIncome = entry.type === "ingreso";
                return (
                  <article key={entry.id} className="group flex flex-col gap-3 px-5 py-4 transition hover:bg-white/[0.025] md:flex-row md:items-center md:px-6">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <span className={isIncome ? "rounded-xl border border-emerald-300/15 bg-emerald-300/[0.06] p-2.5 text-emerald-300" : "rounded-xl border border-rose-300/15 bg-rose-300/[0.06] p-2.5 text-rose-300"}>
                        {isIncome ? <ArrowDownLeft size={18} /> : <ArrowUpRight size={18} />}
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <strong className="truncate text-sm">{entry.category || (isIncome ? "Ingreso" : "Gasto")}</strong>
                          {entry.source ? <span className="rounded-full border border-white/[0.07] px-2 py-0.5 text-[10px] text-white/40">{entry.source}</span> : null}
                        </div>
                        <p className="mt-1 truncate text-xs text-white/35">{entry.notes || shortDate(entry.date)}{entry.notes ? ` · ${shortDate(entry.date)}` : ""}</p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-4 pl-[52px] md:pl-0">
                      <strong className={isIncome ? "text-sm text-emerald-300" : "text-sm text-rose-300"}>{isIncome ? "+" : "−"}{amount(entry.amount)}</strong>
                      <div className="flex gap-1 opacity-70 transition group-hover:opacity-100">
                        <button onClick={() => openEdit(entry)} aria-label="Editar movimiento" className="rounded-lg p-2 text-white/50 transition hover:bg-white/[0.06] hover:text-white"><Pencil size={14} /></button>
                        <button onClick={() => void remove(entry)} aria-label="Eliminar movimiento" className="rounded-lg p-2 text-white/35 transition hover:bg-rose-300/[0.07] hover:text-rose-300"><Trash2 size={14} /></button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {formOpen ? (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm md:items-center md:p-5" onMouseDown={(event) => event.target === event.currentTarget && closeForm()}>
          <section className="w-full max-w-xl rounded-t-[28px] border border-white/10 bg-[#100d17] p-5 shadow-2xl md:rounded-[28px] md:p-6">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <span className="text-[10px] font-semibold uppercase tracking-[0.17em] text-violet-300">MI FLOW</span>
                <h2 className="mt-1 text-xl font-semibold">{editingId ? "Editar movimiento" : "Nuevo movimiento"}</h2>
              </div>
              <button onClick={closeForm} aria-label="Cerrar" className="rounded-xl border border-white/10 p-2 text-white/50 hover:bg-white/[0.05] hover:text-white"><X size={18} /></button>
            </div>

            <form onSubmit={submit} className="grid gap-4 md:grid-cols-2">
              <label className="text-sm">
                <span className="mb-1.5 block text-xs text-white/50">Tipo</span>
                <select className={INPUT} value={form.type} onChange={(event) => setForm((current) => ({ ...current, type: event.target.value as EntryType }))}>
                  <option value="ingreso">Ingreso</option>
                  <option value="gasto">Gasto</option>
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1.5 block text-xs text-white/50">Monto</span>
                <input className={INPUT} type="number" min="0" step="0.01" inputMode="decimal" placeholder="0,00" required value={form.amount} onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))} />
              </label>
              <label className="text-sm">
                <span className="mb-1.5 block text-xs text-white/50">Categoría</span>
                <input className={INPUT} placeholder="Ej: Música, ventas, comida" value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))} />
              </label>
              <label className="text-sm">
                <span className="mb-1.5 block text-xs text-white/50">Fuente</span>
                <input className={INPUT} placeholder="Ej: Iglú, Spotify, efectivo" value={form.source} onChange={(event) => setForm((current) => ({ ...current, source: event.target.value }))} />
              </label>
              <label className="text-sm md:col-span-2">
                <span className="mb-1.5 block text-xs text-white/50">Fecha</span>
                <input className={INPUT} type="date" value={form.date} onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))} />
              </label>
              <label className="text-sm md:col-span-2">
                <span className="mb-1.5 block text-xs text-white/50">Notas</span>
                <textarea className={INPUT} rows={3} placeholder="Detalle opcional" value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} />
              </label>

              {error ? <p className="rounded-xl border border-rose-300/15 bg-rose-300/[0.05] px-3 py-2 text-xs text-rose-200 md:col-span-2">{error}</p> : null}

              <div className="flex flex-wrap justify-end gap-2 pt-1 md:col-span-2">
                <button type="button" onClick={closeForm} disabled={saving} className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-white/60 hover:bg-white/[0.05] disabled:opacity-50">Cancelar</button>
                <button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-violet-500 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_10px_30px_rgba(139,92,246,.24)] hover:bg-violet-400 disabled:opacity-50">
                  {saving ? <RefreshCw size={15} className="animate-spin" /> : <Plus size={15} />}
                  {saving ? "Guardando..." : editingId ? "Guardar cambios" : "Crear movimiento"}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </main>
  );
}
