"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { MainFooter, MainNav } from "@/components/layout";
import { getRedirectByRole, roleHome } from "@/lib/auth";
import { useAuth } from "@/components/auth-provider";

export default function LoginContent() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  const isAddAccountMode = useMemo(() => searchParams.get("addAccount") === "1", [searchParams]);
  const { user, role, loading: authLoading, hydrationReady } = useAuth();

  useEffect(() => {
    const oauthError = searchParams.get("error");
    setError(oauthError || null);
  }, [searchParams]);

  useEffect(() => {
    let cancelled = false;

    // El login nunca debe quedar mostrando el esqueleto para siempre, incluso si
    // el almacenamiento del navegador o Supabase tardan en responder en Android.
    const releaseTimer = window.setTimeout(() => {
      if (!cancelled) setCheckingSession(false);
    }, 7000);

    const resolveLoginScreen = async () => {
      if (isAddAccountMode) {
        if (!cancelled) setCheckingSession(false);
        return;
      }

      if (!hydrationReady || authLoading) return;

      if (!user) {
        if (!cancelled) setCheckingSession(false);
        return;
      }

      const targetId = localStorage.getItem("clouva.switch_target");
      if (targetId && targetId !== user.id) {
        try {
          const { supabase } = await import("@/lib/supabase");
          await supabase.auth.signOut();
        } finally {
          if (!cancelled) setCheckingSession(false);
        }
        return;
      }

      localStorage.removeItem("clouva.switch_target");
      if (!cancelled) setCheckingSession(false);
      router.replace(roleHome[role]);
    };

    void resolveLoginScreen();
    return () => {
      cancelled = true;
      window.clearTimeout(releaseTimer);
    };
  }, [authLoading, hydrationReady, isAddAccountMode, role, router, user]);

  const redirectByRole = async (userId: string, forceSwitcher = false) => {
    const { supabase } = await import("@/lib/supabase");
    let { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .maybeSingle();

    if (profileError) throw profileError;

    if (!profile) {
      const { data: created, error: createError } = await supabase
        .from("profiles")
        .insert({ id: userId, role: "cliente" })
        .select("role")
        .maybeSingle();
      if (createError) throw createError;
      profile = created;
    }

    const redirectPath = getRedirectByRole(profile?.role ?? "cliente");
    router.replace(forceSwitcher ? `${redirectPath}?openAccountSwitcher=1` : redirectPath);
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const { supabase } = await import("@/lib/supabase");
      const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError || !data.user) throw signInError ?? new Error("No se pudo iniciar sesión.");

      localStorage.removeItem("clouva.switch_target");
      await redirectByRole(data.user.id, isAddAccountMode);
    } catch (signInError) {
      setError(signInError instanceof Error ? signInError.message : "No se pudo iniciar sesión.");
      setLoading(false);
    }
  };

  const onGoogle = async () => {
    setError(null);
    setLoading(true);

    const { supabase } = await import("@/lib/supabase");
    const redirectTo = `${window.location.origin}/auth/callback${isAddAccountMode ? "?addAccount=1" : ""}`;
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
        queryParams: { prompt: "select_account" },
      },
    });

    if (oauthError) {
      setError(oauthError.message);
      setLoading(false);
    }
  };

  return (
    <main>
      <MainNav />
      <section className="mx-auto w-full max-w-md px-4 py-16">
        {checkingSession ? (
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
              <input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email" className="w-full rounded-xl border border-white/20 bg-black/30 px-4 py-3" />
              <input type="password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Contraseña" className="w-full rounded-xl border border-white/20 bg-black/30 px-4 py-3" />
              <button disabled={loading} className="w-full rounded-xl bg-white px-4 py-3 text-black disabled:opacity-60">{loading ? "Ingresando..." : "Ingresar"}</button>
              <button disabled={loading} type="button" onClick={() => void onGoogle()} className="w-full rounded-xl border border-white/20 px-4 py-3 disabled:opacity-60">{loading ? "Abriendo Google..." : "Continuar con Google"}</button>
              {error ? <p className="rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">{error}</p> : null}
            </form>
            <Link href="/registro" className="mt-4 inline-block text-xs uppercase tracking-[0.15em] text-[#95d8ff]">Crear cuenta</Link>
          </>
        )}
      </section>
      <MainFooter />
    </main>
  );
}
