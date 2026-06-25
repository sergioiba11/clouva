"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { slugify } from "@/lib/store-utils";

type Row = Record<string, any>;
export function SimpleAdminCrud({ table, fields, title, bucket }: { table: "categories" | "banners"; fields: string[]; title: string; bucket?: string }) {
  const [rows, setRows] = useState<Row[]>([]); const [form, setForm] = useState<Row>({});
  const load = async () => { const { data } = await supabase.from(table).select("*").order("created_at", { ascending: false }); setRows(data ?? []); };
  useEffect(() => { void load(); }, []);
  const save = async () => { const payload = { ...form }; if (payload.name && !payload.slug) payload.slug = slugify(payload.name); await supabase.from(table).upsert(payload); setForm({}); await load(); };
  const upload = async (file: File) => { if (!bucket) return; const path = `${Date.now()}-${file.name}`; const { data } = await supabase.storage.from(bucket).upload(path, file, { upsert: true }); if (data) { const { data: pub } = supabase.storage.from(bucket).getPublicUrl(data.path); setForm((old) => ({ ...old, image_url: pub.publicUrl })); } };
  return <div className="space-y-5"><h1 className="text-3xl font-semibold">{title}</h1><div className="grid gap-3 rounded-[2rem] border border-white/10 p-5 md:grid-cols-2">{fields.map((field) => <input key={field} placeholder={field} value={form[field] ?? ""} onChange={(event) => setForm({ ...form, [field]: event.target.value })} className="rounded-2xl bg-white/10 px-4 py-3"/>)}{bucket ? <input type="file" onChange={(event) => event.target.files?.[0] && upload(event.target.files[0])}/> : null}<button onClick={save} className="rounded-full bg-white px-5 py-3 font-semibold text-black">Guardar</button></div><div className="grid gap-3">{rows.map((row) => <div key={row.id} className="rounded-3xl border border-white/10 p-4"><div className="flex justify-between"><span>{row.name ?? row.title}</span><div className="flex gap-3"><button onClick={() => setForm(row)} className="text-[#95d8ff]">Editar</button><button onClick={async () => { await supabase.from(table).delete().eq("id", row.id); await load(); }} className="text-red-300">Eliminar</button></div></div></div>)}</div></div>;
}
