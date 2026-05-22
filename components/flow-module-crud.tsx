"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";

type ModuleConfig = {
  table: string;
  title: string;
  subtitle: string;
  createLabel: string;
  fields: Array<{ key: string; label: string; type?: "text" | "textarea" | "number" | "date" }>;
};

export function FlowModuleCrud({ config }: { config: ModuleConfig }) {
  const { user } = useAuth();
  const [items, setItems] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const emptyForm = useMemo(() => Object.fromEntries(config.fields.map((f) => [f.key, ""])), [config.fields]);
  const [form, setForm] = useState<Record<string, string>>(emptyForm);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const { supabase } = await import("@/lib/supabase");
    const { data } = await supabase.from(config.table).select("*").order("created_at", { ascending: false });
    setItems((data ?? []) as Record<string, unknown>[]);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, [user]);

  const reset = () => {
    setForm(emptyForm);
    setEditingId(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    const { supabase } = await import("@/lib/supabase");
    const payload: Record<string, unknown> = { owner_id: user.id };
    for (const field of config.fields) payload[field.key] = form[field.key] || null;

    if (editingId) {
      await supabase.from(config.table).update(payload).eq("id", editingId);
    } else {
      await supabase.from(config.table).insert(payload);
    }
    setSaving(false);
    reset();
    void load();
  };

  const edit = (item: Record<string, unknown>) => {
    setEditingId(String(item.id));
    const next: Record<string, string> = {};
    for (const field of config.fields) next[field.key] = String(item[field.key] ?? "");
    setForm(next);
  };

  const remove = async (id: string) => {
    const { supabase } = await import("@/lib/supabase");
    await supabase.from(config.table).delete().eq("id", id);
    void load();
  };

  return (
    <div className="space-y-5">
      <section className="panel rounded-3xl border border-white/10 p-5">
        <h1 className="text-2xl font-semibold">{config.title}</h1>
        <p className="text-sm text-white/70">{config.subtitle}</p>
      </section>
      <section className="panel rounded-3xl border border-[#8f7cff]/20 p-5">
        <h2 className="mb-3 text-sm uppercase tracking-[0.15em] text-white/70">{editingId ? "Editar item" : config.createLabel}</h2>
        <form onSubmit={submit} className="grid gap-3 md:grid-cols-2">
          {config.fields.map((field) => (
            <label key={field.key} className="text-sm">
              <span className="mb-1 block text-white/70">{field.label}</span>
              {field.type === "textarea" ? (
                <textarea className="w-full rounded-xl border border-white/10 bg-black/30 p-2" rows={4} value={form[field.key] ?? ""} onChange={(e) => setForm((prev) => ({ ...prev, [field.key]: e.target.value }))} />
              ) : (
                <input type={field.type ?? "text"} className="w-full rounded-xl border border-white/10 bg-black/30 p-2" value={form[field.key] ?? ""} onChange={(e) => setForm((prev) => ({ ...prev, [field.key]: e.target.value }))} />
              )}
            </label>
          ))}
          <div className="md:col-span-2 flex gap-2">
            <button disabled={saving} className="rounded-full bg-[#8f7cff] px-4 py-2 text-sm font-medium text-black">{saving ? "Guardando..." : editingId ? "Actualizar" : "Crear"}</button>
            {editingId ? <button type="button" onClick={reset} className="rounded-full border border-white/20 px-4 py-2 text-sm">Cancelar</button> : null}
          </div>
        </form>
      </section>
      <section className="panel rounded-3xl p-5">
        <h2 className="text-lg font-semibold">Lista</h2>
        {loading ? <p className="mt-3 text-sm text-white/60">Cargando...</p> : null}
        {!loading && items.length === 0 ? (
          <div className="mt-3 rounded-2xl border border-dashed border-white/20 p-5 text-sm text-white/70">Todavía no hay elementos. Creá tu primer registro para empezar.</div>
        ) : null}
        <div className="mt-3 space-y-2">
          {items.map((item) => (
            <article key={String(item.id)} className="rounded-2xl border border-white/10 p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{String(item.title ?? item.name ?? "Sin título")}</p>
                  <p className="text-xs text-white/60">{config.fields.slice(0, 3).map((f) => `${f.label}: ${String(item[f.key] ?? "-")}`).join(" · ")}</p>
                </div>
                <div className="flex gap-2 text-xs">
                  <button onClick={() => edit(item)} className="rounded-full border border-white/20 px-3 py-1">Editar</button>
                  <button onClick={() => remove(String(item.id))} className="rounded-full border border-rose-300/30 px-3 py-1 text-rose-200">Borrar</button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
