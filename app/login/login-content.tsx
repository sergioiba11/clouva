"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { MainFooter, MainNav } from "@/components/layout";
import { roleHome } from "@/lib/auth";
import { useAuth } from "@/components/auth-provider";

function oauthBaseUrl() {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  if (typeof window !== "undefined" && window.location.hostname === "localhost") return window.location.origin;
  return "https://clouva.com.ar";
}

export default function LoginContent() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  const isAddAccountMode = useMemo(() => searchParams.get("addAccount") === "1", [searchParams]);
  const { user, role, loading: authLoading } = useAuth();

  useEffect(() => {
    const oauthError = searchParams.get("error");
    if (oauthError) setError(oauthError);
  }, [searchParams]);

  useEffect(() => {
    if (authLoading || isAddAccountMode) return;
    if (user) {
      router.replace(roleHome[role] || "/mi-flow");
      return;
    }
    setCheckingSession(false);
  }, [authLoading, isAddAccountMode, router, role, user]);

  useEffect(() => {
    const timer = window.setTimeout(() => setCheckingSession(false), 5000);
    return () => window.clearTimeout(timer);
  }, []);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const { supabase } = await import("@/lib/supabase");
      const { data, error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (signInError) throw signInError;
      if (!data.session?.user) throw new Error("No se pudo establecer la sesión.");

      localStorage.removeItem("clouva.switch_target");
      const target = isAddAccountMode ? "/mi-flow?openAccountSwitcher=1" : "/mi-flow";
      window.location.assign(target);
    } catch (signInError) {
      setError(signInError instanceof Error ? signInError.message : "No se pudo iniciar sesión.");
      setLoading(false);
    }
  };

  const onGoogle = async () => {
    setError(null);
    setLoading(true);
    try {
      const { supabase } = await import("@/lib/supabase");
      const redirectTo = `${oauthBaseUrl()}/auth/callback${isAddAccountMode ? "?addAccount=1" : ""}`;
      const { error: oauthError } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo } });
      if (oauthError) throw oauthError;
    } catch (oauthError) {
      setError(oauthError instanceof Error ? oauthError.message : "No se pudo iniciar con Google.");
      setLoading(false);
    }
  };

  return (
    <main>
      <MainNav />
      <section className="mx-auto w-full max-w-md px-4 py-16">
        {authLoading || checkingSession ? (
          <div className="space-y-4 rounded-3xl border border-white/10 bg-white/[0.03] p-6">
            <div className="h-8 w-48 animate-pulse rounded-lg bg-white/10" />
            <div className="h-4 w-64 animate-pulse rounded bg-white/10" />
            <div className="space-y-3 pt-2">
              <div className="h-12 w-full animate-pulse rounded-xl bg-white/10" />
              <div className="h-12 w-full animate-pulse rounded-xl bg-white/10" />
              <div className="h-12 w-full animate-pulse rounded-xl bg-white/10" />
            </div>
          </div>
        ) : (
          <>
            <h1 className="text-3xl">Iniciar sesión</h1>
            <p className="mt-3 text-white/70">Acceso con email/contraseña o Google.</p>
            <form onSubmit={onSubmit} className="mt-6 space-y-3 rounded-3xl border border-white/10 bg-white/[0.03] p-6">
              <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="w-full rounded-xl border border-white/20 bg-black/30 px-4 py-3" />
              <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Contraseña" className="w-full rounded-xl border border-white/20 bg-black/30 px-4 py-3" />
              <button disabled={loading} className="w-full rounded-xl bg-white px-4 py-3 text-black disabled:opacity-60">{loading ? "Ingresando…" : "Ingresar"}</button>
              <button type="button" disabled={loading} onClick={onGoogle} className="w-full rounded-xl border border-white/20 px-4 py-3 disabled:opacity-60">Continuar con Google</button>
              {error ? <p className="rounded-xl bg-red-400/10 p-3 text-sm text-red-300">{error}</p> : null}
            </form>
            <Link href="/registro" className="mt-4 inline-block text-xs uppercase tracking-[0.15em] text-[#95d8ff]">Crear cuenta</Link>
          </>
        )}
      </section>
      <MainFooter />
    </main>
  );
}
