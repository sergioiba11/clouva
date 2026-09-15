"use client";

import { useEffect, useState } from "react";

type StaffRow = {
  id: string;
  display_name: string | null;
  full_name: string | null;
  email: string | null;
  role: string | null;
  role_v2: string | null;
};

export default function Page() {
  const [rows, setRows] = useState<StaffRow[]>([]);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    const { supabase } = await import("@/lib/supabase");
    const { data, error } = await supabase
      .from("profiles")
      .select("id,display_name,full_name,email,role,role_v2")
      .or("role.eq.empleado,role_v2.eq.empleado,role.eq.admin,role_v2.eq.admin")
      .order("display_name", { ascending: true })
      .limit(200);
    if (error) {
      setMessage(error.message);
      return;
    }
    setRows((data ?? []) as StaffRow[]);
  };

  useEffect(() => { void load(); }, []);

  const makeEmployee = async () => {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) return;
    setBusy(true);
    setMessage(null);
    try {
      const { supabase } = await import("@/lib/supabase");
      const { data: profile, error: findError } = await supabase
        .from("profiles")
        .select("id,email,role,role_v2")
        .eq("email", cleanEmail)
        .maybeSingle();
      if (findError) throw new Error(findError.message);
      if (!profile?.id) throw new Error("No existe un perfil CLOUVA con ese email.");
      if (profile.role === "admin" || profile.role_v2 === "admin") throw new Error("La cuenta ya es administradora y no se modifica desde Empleados.");

      const { error: updateError } = await supabase
        .from("profiles")
        .update({ role: "empleado", role_v2: "empleado" })
        .eq("id", profile.id);
      if (updateError) throw new Error(updateError.message);

      setEmail("");
      setMessage("Empleado habilitado correctamente. No recibió permisos de administrador.");
      await load();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "No se pudo habilitar el empleado.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-[22px] border border-white/[0.07] bg-[#090a11]/88 p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-violet-300/65">Personas</p>
          <h1 className="mt-1 text-2xl font-bold">Empleados</h1>
          <p className="mt-2 text-sm text-white/45">El rol empleado puede operar superficies habilitadas, pero no obtiene acceso de administrador.</p>
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-2 sm:flex-row">
        <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="email existente" className="min-h-11 flex-1 rounded-xl border border-white/10 bg-black/25 px-3 text-sm outline-none focus:border-violet-400/40" />
        <button disabled={busy || !email.trim()} onClick={() => void makeEmployee()} className="min-h-11 rounded-xl bg-white px-4 text-sm font-semibold text-black disabled:opacity-40">{busy ? "Habilitando…" : "Habilitar empleado"}</button>
      </div>

      {message ? <p className="mt-3 rounded-xl border border-white/10 bg-black/25 p-3 text-sm text-white/65">{message}</p> : null}

      <div className="mt-5 space-y-2">
        {rows.map((row) => (
          <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.07] bg-black/20 p-3 text-sm">
            <div>
              <p className="font-semibold">{row.display_name || row.full_name || row.email || row.id}</p>
              <p className="mt-1 text-xs text-white/35">{row.email || row.id}</p>
            </div>
            <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase ${row.role === "admin" || row.role_v2 === "admin" ? "border-violet-300/20 bg-violet-400/10 text-violet-200" : "border-emerald-300/15 bg-emerald-400/10 text-emerald-200"}`}>
              {row.role_v2 || row.role || "empleado"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
