"use client";

import { useEffect, useState } from "react";
import { MainFooter, MainNav } from "@/components/layout";

export default function Page({ params }: { params: Promise<{ username: string }> }) {
  const [username, setUsername] = useState("");
  const [p, setP] = useState<any>(null);

  useEffect(() => { void params.then((v) => setUsername(v.username)); }, [params]);
  useEffect(() => {
    if (!username) return;
    void (async () => {
      const { supabase } = await import("@/lib/supabase");
      const { data } = await supabase.from("profiles").select("full_name,avatar_url,is_vip,clouva_id,username,bio,accent_color").eq("username", username).maybeSingle();
      setP(data);
    })();
  }, [username]);

  return <main><MainNav /><section className="mx-auto max-w-3xl p-6">{!p ? <p>Perfil no encontrado o cargando...</p> : <div className="panel rounded-3xl border p-6" style={{ borderColor: `${p.accent_color ?? "#8f7cff"}66` }}><div className="flex items-center gap-3">{p.avatar_url ? <img src={p.avatar_url} alt={p.username ?? "avatar"} className="h-16 w-16 rounded-full object-cover" /> : <div className="grid h-16 w-16 place-items-center rounded-full bg-white/10">{(p.full_name ?? p.username ?? "U").charAt(0).toUpperCase()}</div>}<div><h1 className="text-2xl font-semibold">@{p.username}</h1><p className="text-white/70">{p.full_name}</p></div></div><p className="mt-3 text-white/80">{p.bio ?? "Vida de flows."}</p><p className="mt-2 text-xs text-white/60">{p.clouva_id}</p>{p.is_vip ? <p className="mt-2 text-amber-300">VIP</p> : null}</div>}</section><MainFooter /></main>;
}
