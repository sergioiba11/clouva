"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { MainFooter, MainNav } from "@/components/layout";
import { supabase, isSupabaseConfigured } from "@/lib/supabase-client";
import { useAuth } from "@/components/auth-provider";

export default function LoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, loading } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const nextPath = params.get("next") || "/account";

  useEffect(() => {
    if (!loading && user) router.replace(nextPath);
  }, [loading, nextPath, router, user]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setSuccess(null);
    try {
      if (!supabase || !isSupabaseConfigured) throw new Error("Supabase no configurado. Agregá NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY.");
      if (mode === "login") {
        const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
        if (authError) throw authError;
        setSuccess("Sesión iniciada. Redirigiendo...");
        router.replace(nextPath);
      } else {
        const { error: registerError } = await supabase.auth.signUp({ email, password });
        if (registerError) throw registerError;
        setSuccess("Cuenta creada. Revisá tu email para confirmar tu acceso.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ocurrió un error inesperado.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main>
      <MainNav />
      <section className="relative mx-auto w-full max-w-md px-4 pb-16 pt-10 sm:pt-16">
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_30%_0%,rgba(81,145,255,.22),transparent_50%),radial-gradient(circle_at_90%_20%,rgba(148,87,255,.24),transparent_42%)] blur-2xl" />
        <h1 className="text-3xl font-semibold tracking-tight">{mode === "login" ? "Bienvenido de nuevo" : "Crear cuenta premium"}</h1>
        <p className="mt-3 text-white/70">Acceso CLOUVA con sesión persistente, refresh automático y experiencia premium.</p>

        <form onSubmit={onSubmit} className="mt-6 space-y-4 rounded-3xl border border-white/15 bg-white/[0.04] p-6 shadow-[0_15px_55px_rgba(0,0,0,.45)] backdrop-blur-xl">
          <label className="group relative block">
            <span className="absolute left-4 top-2 text-[11px] uppercase tracking-[0.2em] text-white/45">Email</span>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" className="w-full rounded-2xl border border-white/20 bg-black/35 px-4 pb-3 pt-7 outline-none transition focus:border-[#76bbff] focus:shadow-[0_0_0_3px_rgba(118,187,255,.15)]" />
          </label>

          <label className="group relative block">
            <span className="absolute left-4 top-2 text-[11px] uppercase tracking-[0.2em] text-white/45">Password</span>
            <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} className="w-full rounded-2xl border border-white/20 bg-black/35 px-4 pb-3 pt-7 outline-none transition focus:border-[#8f8bff] focus:shadow-[0_0_0_3px_rgba(143,139,255,.15)]" />
          </label>

          {error ? <p className="rounded-xl border border-rose-400/35 bg-rose-400/10 px-3 py-2 text-sm text-rose-200">{error}</p> : null}
          {success ? <p className="rounded-xl border border-emerald-400/35 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-200">{success}</p> : null}

          <button disabled={pending} className="w-full rounded-2xl bg-white px-4 py-3 font-medium text-black transition hover:scale-[1.01] disabled:opacity-80">
            {pending ? "Procesando..." : mode === "login" ? "Iniciar sesión" : "Crear cuenta"}
          </button>
        </form>

        <div className="mt-4 flex items-center justify-between text-sm text-white/65">
          <button onClick={() => setMode(mode === "login" ? "register" : "login")} className="text-[#95d8ff] hover:text-white">
            {mode === "login" ? "¿No tenés cuenta? Registrate" : "¿Ya tenés cuenta? Ingresá"}
          </button>
          <Link href="/" className="hover:text-white">Volver</Link>
        </div>
      </section>
      <MainFooter />
    </main>
  );
}
