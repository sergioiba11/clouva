"use client";

import { MainNav } from "@/components/layout";
import { useAuth } from "@/components/auth-provider";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function PerfilPage() {
  const { user, profile, role } = useAuth();
  const [clouvaId,setClouvaId]=useState("");
  const [username,setUsername]=useState("");
  const router = useRouter();
  const [fullName, setFullName] = useState(profile?.full_name ?? "");
  const [phone, setPhone] = useState("");
  const [saved, setSaved] = useState(false);

  const loadExtras = async () => {
    if (!user) return;
    const { supabase } = await import("@/lib/supabase");
    const { data } = await supabase.from("profiles").select("clouva_id,username").eq("id", user.id).maybeSingle();
    setClouvaId(data?.clouva_id ?? "");
    setUsername(data?.username ?? "");
  };

  const save = async () => {
    if (!user) return;
    const { supabase } = await import("@/lib/supabase");
    await supabase.from("profiles").update({ full_name: fullName, phone, username }).eq("id", user.id);
    setSaved(true);
  };

  const signOut = async () => {
    const { supabase } = await import("@/lib/supabase");
    await supabase.auth.signOut();
    router.push("/login");
  };

  useEffect(() => {
    if (user) void loadExtras();
  }, [user]);

  return (
    <main>
      <MainNav />
      <section className="mx-auto w-full max-w-4xl px-4 py-8">
        <div className="panel rounded-3xl p-6">
          <h1 className="text-2xl font-semibold">Perfil</h1>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="text-sm">Nombre<input className="mt-1 w-full rounded-xl border border-white/20 bg-transparent px-3 py-2" value={fullName} onChange={(e) => setFullName(e.target.value)} /></label>
            <label className="text-sm">Teléfono<input className="mt-1 w-full rounded-xl border border-white/20 bg-transparent px-3 py-2" value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
            <div className="text-sm">Email: <span className="text-white/70">{user?.email}</span></div>
            <div className="text-sm">Rol: <span className="rounded-full border border-white/20 px-2 py-0.5 text-xs">{role}</span></div>
            <div className="text-sm">Estado VIP: <span className="text-white/70">{role === "vip" ? "Activo" : "No activo"}</span></div>
            <div className="text-sm">Avatar: <span className="text-white/70">Listo para configurar en Mi Flow</span></div>
            <div className="text-sm">CLOUVA ID: <span className="text-white/70">{clouvaId || "pendiente"}</span></div>
            <label className="text-sm">Username público<input className="mt-1 w-full rounded-xl border border-white/20 bg-transparent px-3 py-2" value={username} onChange={(e) => setUsername(e.target.value)} /></label>
            {user ? <div><img alt="QR" className="h-24 w-24" src={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(typeof window !== "undefined" ? window.location.origin + `/perfil-publico/${user.id}` : `/perfil-publico/${user.id}`)}`} /></div> : null}
          </div>
          <div className="mt-6 flex gap-2">
            <button onClick={save} className="rounded-full bg-[#8f7cff]/25 px-4 py-2 text-sm">Guardar</button>
            <button onClick={signOut} className="rounded-full border border-white/20 px-4 py-2 text-sm">Cerrar sesión</button>
          </div>
          {saved ? <p className="mt-3 text-sm text-emerald-300">Perfil actualizado.</p> : null}
        </div>
      </section>
    </main>
  );
}
