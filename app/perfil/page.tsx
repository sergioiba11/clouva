"use client";

import { MainNav } from "@/components/layout";
import { useAuth } from "@/components/auth-provider";
import { useEffect, useState } from "react";
import Link from "next/link";
import { normalizeRole } from "@/lib/auth";

export default function PerfilPage() {
  const { user, profile, role } = useAuth();
  const rawRole = profile?.role;
  const normalizedFromRaw = normalizeRole(rawRole);
  const [form, setForm] = useState({ clouva_id: "", username: "", bio: "", accent_color: "#8f7cff", full_name: profile?.full_name ?? "", phone: "" });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      const { supabase } = await import("@/lib/supabase");
      const { data } = await supabase.from("profiles").select("clouva_id,username,bio,accent_color,full_name,phone").eq("id", user.id).maybeSingle();
      if (data) setForm({ clouva_id: data.clouva_id ?? "", username: data.username ?? "", bio: data.bio ?? "", accent_color: data.accent_color ?? "#8f7cff", full_name: data.full_name ?? "", phone: data.phone ?? "" });
    })();
  }, [user]);

  const save = async () => { if (!user) return; const { supabase } = await import("@/lib/supabase"); await supabase.from("profiles").update(form).eq("id", user.id); setSaved(true); };
  const publicUrl = form.username ? `https://clouva.ar/u/${form.username}` : "";

  return <main><MainNav /><section className="mx-auto w-full max-w-4xl px-4 py-6 sm:py-8"><div className="panel rounded-3xl p-4 sm:p-6"><h1 className="text-2xl font-semibold">Perfil</h1>
    <div className="mt-4 flex flex-col items-center gap-4 sm:flex-row sm:items-start">
      <div className="w-full max-w-[200px] sm:max-w-[180px]">
        {profile?.avatar_3d_url ? (
          <model-viewer src={profile.avatar_3d_url} alt="Tu avatar 3D" camera-controls auto-rotate style={{ width: "100%", height: "200px", borderRadius: "1rem" }} />
        ) : (
          <div className="grid h-[200px] w-full place-items-center rounded-2xl border border-dashed border-white/20 text-center text-xs text-white/50">Sin avatar 3D todavía</div>
        )}
      </div>
      <div className="flex-1">
        <p className="text-sm text-white/70">Tu avatar 3D y tu foto de perfil se administran desde Mi Flow.</p>
        <Link href="/mi-flow/avatar" className="mt-2 inline-block rounded-full border border-[#8f7cff]/40 px-4 py-2 text-sm">
          {profile?.avatar_3d_url ? "Editar avatar 3D" : "Crear avatar 3D"}
        </Link>
      </div>
    </div>
    <div className="mt-6 grid gap-3 sm:grid-cols-2">
    <label className="text-sm">Nombre<input className="mt-1 w-full rounded-xl border border-white/20 bg-transparent px-3 py-2" value={form.full_name} onChange={(e)=>setForm(v=>({...v,full_name:e.target.value}))} /></label>
    <label className="text-sm">Teléfono<input className="mt-1 w-full rounded-xl border border-white/20 bg-transparent px-3 py-2" value={form.phone} onChange={(e)=>setForm(v=>({...v,phone:e.target.value}))} /></label>
    <label className="text-sm">Username público<input className="mt-1 w-full rounded-xl border border-white/20 bg-transparent px-3 py-2" value={form.username} onChange={(e)=>setForm(v=>({...v,username:e.target.value.toLowerCase()}))} /></label>
    <label className="text-sm">Bio corta<input className="mt-1 w-full rounded-xl border border-white/20 bg-transparent px-3 py-2" value={form.bio} onChange={(e)=>setForm(v=>({...v,bio:e.target.value}))} /></label>
    <label className="text-sm">Accent color<input type="color" className="mt-1 h-10 w-full rounded-xl border border-white/20 bg-transparent p-1" value={form.accent_color} onChange={(e)=>setForm(v=>({...v,accent_color:e.target.value}))} /></label>
    <div className="text-sm">CLOUVA ID: <span className="text-white/70">{form.clouva_id || "pendiente"}</span></div>
    <div className="text-sm">Rol normalizado (context): <span className="rounded-full border border-white/20 px-2 py-0.5 text-xs">{role}</span></div>
    <div className="text-sm">Rol REAL (Supabase): <span className="rounded-full border border-white/20 px-2 py-0.5 text-xs">{String(rawRole)}</span></div>
    <div className="text-sm">Rol normalizado (desde rol real): <span className="rounded-full border border-white/20 px-2 py-0.5 text-xs">{normalizedFromRaw}</span></div>
    <div className="text-sm">Tipo rol real: <span className="text-white/70">{rawRole === null ? "null" : typeof rawRole}</span></div>
    <div className="text-sm">Estado VIP: <span className="text-white/70">{role === "vip" ? "Activo" : "No activo"}</span></div>
    {publicUrl ? <div><img alt="QR" className="h-24 w-24" src={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(publicUrl)}`} /></div> : null}
  </div><div className="mt-6 flex gap-2"><button onClick={save} className="rounded-full bg-[#8f7cff]/25 px-4 py-2 text-sm">Guardar</button><Link href="/perfil/configuracion" className="rounded-full border border-white/20 px-4 py-2 text-sm">Configuración</Link></div>{saved ? <p className="mt-3 text-sm text-emerald-300">Perfil actualizado.</p> : null}</div></section></main>;
}
