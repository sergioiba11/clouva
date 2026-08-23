"use client";

import { ArrowLeft, Lightbulb, Plus } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { MainNav } from "@/components/layout";

type IncomeProject = {
  id: string;
  name: string;
  estimated_income_cents: number | null;
  expenses_cents: number | null;
};

function moneyFromCents(value: number | null) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(Number(value ?? 0) / 100);
}

export default function IncomeProjectsPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<IncomeProject[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    const { supabase } = await import("@/lib/supabase");
    const { data, error: loadError } = await supabase
      .from("flow_businesses")
      .select("id,name,estimated_income_cents,expenses_cents")
      .eq("owner_id", user.id)
      .order("created_at", { ascending: false });
    if (loadError) {
      setError(loadError.message);
      return;
    }
    setRows((data ?? []) as IncomeProject[]);
  }, [user]);

  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    if (!user || !name.trim()) return;
    setBusy(true);
    setError(null);
    const { supabase } = await import("@/lib/supabase");
    const { error: createError } = await supabase.from("flow_businesses").insert({ owner_id: user.id, name: name.trim() });
    if (createError) setError(createError.message);
    else {
      setName("");
      await load();
    }
    setBusy(false);
  };

  return (
    <main className="min-h-screen bg-[#07060d] text-white">
      <MainNav />
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-8 sm:py-12">
        <Link href="/mi-flow" className="inline-flex items-center gap-2 text-sm text-white/42 transition hover:text-white"><ArrowLeft size={15} /> MI FLOW</Link>
        <section className="mt-5 rounded-[28px] border border-white/[0.08] bg-[#0c0a13] p-6 sm:p-8">
          <div className="inline-grid rounded-2xl border border-amber-300/15 bg-amber-300/[0.06] p-3 text-amber-200"><Lightbulb size={21} /></div>
          <h1 className="mt-5 text-3xl font-semibold">Proyectos de ingresos</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-white/45">Esta es tu herramienta histórica de ideas y estimaciones. No es MI SPOT y sus números no modifican el saldo real de MI FLOW.</p>
          <div className="mt-6 flex flex-col gap-2 sm:flex-row"><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Nueva idea o proyecto" className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-sm outline-none focus:border-violet-400/40" /><button type="button" onClick={() => void create()} disabled={busy || !name.trim()} className="inline-flex items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold disabled:opacity-45"><Plus size={15} /> Crear</button></div>
          {error ? <p className="mt-4 rounded-xl border border-rose-300/15 bg-rose-300/[0.06] p-3 text-sm text-rose-200">{error}</p> : null}
        </section>
        <div className="mt-5 grid gap-3">{rows.map((row) => <article key={row.id} className="rounded-2xl border border-white/[0.08] bg-[#0b0912] p-5"><h2 className="font-semibold">{row.name}</h2><div className="mt-3 flex flex-wrap gap-4 text-xs text-white/38"><span>Ingreso esperado <b className="text-white/65">{moneyFromCents(row.estimated_income_cents)}</b></span><span>Gastos <b className="text-white/65">{moneyFromCents(row.expenses_cents)}</b></span></div></article>)}</div>
      </div>
    </main>
  );
}
