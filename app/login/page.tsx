"use client";

import { useState } from "react";
import { ProShell } from "@/components/pro-shell";
import { hasSupabaseEnv, supabase } from "@/lib/supabase";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("Modo placeholder: activá variables para login real.");

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return setMessage("Faltan variables NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY.");
    const { error } = await supabase.auth.signInWithOtp({ email });
    setMessage(error ? error.message : "Revisá tu email para continuar.");
  }

  return (
    <ProShell>
      <section className="mx-auto w-full max-w-md px-4 py-16">
        <h1 className="text-3xl">Login</h1>
        <p className="mt-3 text-white/70">Magic link con Supabase Auth.</p>
        {!hasSupabaseEnv ? <p className="mt-3 text-sm text-amber-300">Faltan variables públicas de Supabase en Vercel.</p> : null}
        <form onSubmit={handleLogin} className="mt-6 space-y-3 rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="w-full rounded-xl border border-white/20 bg-black/30 px-4 py-3" />
          <button className="w-full rounded-xl bg-white px-4 py-3 text-black">Continuar</button>
        </form>
        <p className="mt-4 text-sm text-white/70">{message}</p>
      </section>
    </ProShell>
  );
}
