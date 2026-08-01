"use client";

import { useEffect, useMemo, useState } from "react";
import { PremiumCard, StatCard } from "@/components/os-ui";

type FanMembershipRow = {
  id: string;
  user_id: string;
  status: string;
  joined_at: string;
  studios: { name: string; slug: string } | null;
  profiles: { full_name: string | null; username: string | null; email: string | null } | null;
  studio_membership_plans: { name: string; is_free: boolean; price: number | null; currency: string } | null;
};

type PlanRow = {
  id: string;
  studio_id: string;
  name: string;
  is_free: boolean;
  price: number | null;
  currency: string;
  billing_interval: "month" | "year" | null;
  is_active: boolean;
  studios: { name: string; slug: string } | null;
};

const money = (value: number, currency = "ARS") => new Intl.NumberFormat("es-AR", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
const when = (iso: string) => new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" });

export default function EstudiosMembresiasAdminPage() {
  const [tab, setTab] = useState<"socios" | "planes">("socios");
  const [members, setMembers] = useState<FanMembershipRow[]>([]);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, { price: string; currency: string; billingInterval: "month" | "year" }>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    const { supabase } = await import("@/lib/supabase");
    const [membersResult, plansResult] = await Promise.all([
      supabase
        .from("studio_fan_memberships")
        .select("id,user_id,status,joined_at,studios(name,slug),studio_membership_plans(name,is_free,price,currency)")
        .order("joined_at", { ascending: false })
        .limit(500),
      supabase
        .from("studio_membership_plans")
        .select("id,studio_id,name,is_free,price,currency,billing_interval,is_active,studios(name,slug)")
        .order("created_at", { ascending: false })
        .limit(500),
    ]);
    if (membersResult.error) { setError(membersResult.error.message); setLoading(false); return; }
    if (plansResult.error) { setError(plansResult.error.message); setLoading(false); return; }

    // profiles.id = auth.users.id by convention, but there's no FK between
    // them for PostgREST to auto-embed a profiles(...) join on
    // studio_fan_memberships -- fetch separately and merge, same pattern as
    // the members API route (app/api/studios/[slug]/membership/members).
    const memberRows = (membersResult.data ?? []) as unknown as Omit<FanMembershipRow, "profiles">[];
    const userIds = [...new Set(memberRows.map((row) => row.user_id))];
    const { data: profileRows, error: profilesError } = userIds.length
      ? await supabase.from("profiles").select("id,full_name,username,email").in("id", userIds)
      : { data: [] as { id: string; full_name: string | null; username: string | null; email: string | null }[], error: null };
    if (profilesError) { setError(profilesError.message); setLoading(false); return; }
    const profileById = new Map((profileRows ?? []).map((profile) => [profile.id, profile]));

    setMembers(memberRows.map((row) => ({ ...row, profiles: profileById.get(row.user_id) ?? null })));
    const planRows = (plansResult.data ?? []) as unknown as PlanRow[];
    setPlans(planRows);
    setDrafts(Object.fromEntries(planRows.filter((p) => !p.is_free).map((p) => [p.id, { price: String(p.price ?? ""), currency: p.currency, billingInterval: (p.billing_interval ?? "month") as "month" | "year" }])));
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const stats = useMemo(() => {
    const active = members.filter((m) => m.status === "active");
    const paying = active.filter((m) => m.studio_membership_plans && !m.studio_membership_plans.is_free);
    return { total: members.length, active: active.length, paying: paying.length };
  }, [members]);

  const savePlan = async (plan: PlanRow) => {
    const draft = drafts[plan.id];
    if (!draft) return;
    const price = Number(draft.price);
    if (!Number.isFinite(price) || price < 0) { setError("El precio tiene que ser un número mayor o igual a 0."); return; }

    setSavingId(plan.id);
    setError(null);
    const { supabase } = await import("@/lib/supabase");
    const { error: updateError } = await supabase
      .from("studio_membership_plans")
      .update({ price, currency: draft.currency.trim().toUpperCase() || "ARS", billing_interval: draft.billingInterval })
      .eq("id", plan.id);
    setSavingId(null);
    if (updateError) { setError(updateError.message); return; }
    setPlans((current) => current.map((item) => item.id === plan.id ? { ...item, price, currency: draft.currency.trim().toUpperCase() || "ARS", billing_interval: draft.billingInterval } : item));
  };

  const togglePlanActive = async (plan: PlanRow) => {
    setSavingId(plan.id);
    setError(null);
    const { supabase } = await import("@/lib/supabase");
    const { error: updateError } = await supabase.from("studio_membership_plans").update({ is_active: !plan.is_active }).eq("id", plan.id);
    setSavingId(null);
    if (updateError) { setError(updateError.message); return; }
    setPlans((current) => current.map((item) => item.id === plan.id ? { ...item, is_active: !item.is_active } : item));
  };

  return (
    <div className="space-y-4">
      <PremiumCard className="p-6">
        <h1 className="text-2xl font-bold">Membresías de Estudios</h1>
        <p className="mt-1 text-sm text-white/50">Quién se unió a qué Estudio (gratis o pago) y control de precios de todos los planes de todos los Estudios. Todo el dinero va a la misma cuenta de Mercado Pago de CLOUVA.</p>
      </PremiumCard>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Membresías totales" value={loading ? "…" : stats.total} />
        <StatCard label="Activas" value={loading ? "…" : stats.active} />
        <StatCard label="Socios pagos activos" value={loading ? "…" : stats.paying} />
      </div>

      <div className="flex gap-2">
        <button onClick={() => setTab("socios")} className={`rounded-xl px-4 py-2 text-sm ${tab === "socios" ? "bg-violet-600 text-white" : "border border-white/10 text-white/60"}`}>Socios</button>
        <button onClick={() => setTab("planes")} className={`rounded-xl px-4 py-2 text-sm ${tab === "planes" ? "bg-violet-600 text-white" : "border border-white/10 text-white/60"}`}>Planes y precios</button>
      </div>

      {error ? <p className="rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">{error}</p> : null}

      {tab === "socios" ? (
        <PremiumCard className="p-5">
          {loading ? <p className="text-sm text-white/50">Cargando socios…</p> : null}
          {!loading && members.length === 0 ? <p className="text-sm text-white/50">Todavía no hay socios en ningún Estudio.</p> : null}
          <div className="space-y-2">
            {members.map((member) => {
              const plan = member.studio_membership_plans;
              return (
                <div key={member.id} className="grid gap-2 rounded-xl border border-white/10 bg-black/20 p-3 text-sm md:grid-cols-6 md:items-center">
                  <span>{member.profiles?.full_name || member.profiles?.username || member.profiles?.email || "—"}</span>
                  <span className="text-white/60">{member.studios?.name ?? "—"}</span>
                  <span>{!plan || plan.is_free ? "Gratis" : `${plan.name} · ${money(Number(plan.price), plan.currency)}`}</span>
                  <span className={member.status === "active" ? "text-emerald-300" : "text-white/50"}>{member.status}</span>
                  <span className="text-xs text-white/40">Desde {when(member.joined_at)}</span>
                </div>
              );
            })}
          </div>
        </PremiumCard>
      ) : (
        <PremiumCard className="p-5">
          {loading ? <p className="text-sm text-white/50">Cargando planes…</p> : null}
          {!loading && plans.length === 0 ? <p className="text-sm text-white/50">Todavía no hay planes de membresía creados.</p> : null}
          <div className="space-y-2">
            {plans.map((plan) => {
              const draft = drafts[plan.id];
              return (
                <div key={plan.id} className="grid gap-2 rounded-xl border border-white/10 bg-black/20 p-3 text-sm md:grid-cols-7 md:items-center">
                  <span className="text-white/60">{plan.studios?.name ?? "—"}</span>
                  <span>{plan.name}</span>
                  {plan.is_free ? (
                    <span className="md:col-span-3 text-white/45">Plan gratuito, sin precio</span>
                  ) : (
                    <>
                      <input value={draft?.price ?? ""} onChange={(event) => setDrafts((current) => ({ ...current, [plan.id]: { ...current[plan.id], price: event.target.value.replace(/[^0-9.]/g, ""), currency: current[plan.id]?.currency ?? plan.currency, billingInterval: current[plan.id]?.billingInterval ?? "month" } }))} className="w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5" />
                      <input value={draft?.currency ?? plan.currency} onChange={(event) => setDrafts((current) => ({ ...current, [plan.id]: { ...current[plan.id], currency: event.target.value, price: current[plan.id]?.price ?? String(plan.price ?? ""), billingInterval: current[plan.id]?.billingInterval ?? "month" } }))} className="w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5" />
                      <select value={draft?.billingInterval ?? "month"} onChange={(event) => setDrafts((current) => ({ ...current, [plan.id]: { ...current[plan.id], billingInterval: event.target.value as "month" | "year", price: current[plan.id]?.price ?? String(plan.price ?? ""), currency: current[plan.id]?.currency ?? plan.currency } }))} className="w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5">
                        <option value="month">Mensual</option>
                        <option value="year">Anual</option>
                      </select>
                    </>
                  )}
                  <span className={plan.is_active ? "text-emerald-300" : "text-white/40"}>{plan.is_active ? "Activo" : "Inactivo"}</span>
                  <div className="flex gap-2">
                    {!plan.is_free ? <button disabled={savingId === plan.id} onClick={() => void savePlan(plan)} className="rounded-lg border border-violet-400/30 px-3 py-1.5 text-xs text-violet-200">Guardar</button> : null}
                    <button disabled={savingId === plan.id} onClick={() => void togglePlanActive(plan)} className="rounded-lg border border-white/15 px-3 py-1.5 text-xs">{plan.is_active ? "Desactivar" : "Activar"}</button>
                  </div>
                </div>
              );
            })}
          </div>
        </PremiumCard>
      )}
    </div>
  );
}
