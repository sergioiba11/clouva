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
  const { user, role, loading: authLoading } = useAuth();

  useEffect(() => {
    const oauthError = searchParams.get("error");
    if (oauthError) setError(oauthError);

    const checkSession = async () => {
      if (isAddAccountMode) return;
      const { supabase } = await import("@/lib/supabase");
      const targetId = localStorage.getItem("clouva.switch_target");
      const { data } = await supabase.auth.getSession();
      const userId = data.session?.user?.id;
      if (userId && targetId && targetId !== userId) {
        await supabase.auth.signOut();
        setCheckingSession(false);
        return;
      }
      if (userId) {
        localStorage.removeItem("clouva.switch_target");
        router.replace(roleHome[role]);
        return;
      }
      setCheckingSession(false);
    };

    void checkSession();
  }, [isAddAccountMode, searchParams, router, role]);

  useEffect(() => {
    if (authLoading || isAddAccountMode) return;
    if (user) {
      router.replace(roleHome[role]);
      return;
    }
    setCheckingSession(false);
  }, [authLoading, isAddAccountMode, router, role, user]);

  const redirectByRole = async (userId: string, forceSwitcher = false) => {
    const { supabase } = await import("@/lib/supabase");
    let { data: profile } = await supabase.from("profiles").select("role").eq("id", userId).maybeSingle();

    if (!profile) {
      const { data: created } = await supabase
        .from("profiles")
        .insert({ id: userId, role: "cliente" })
        .select("role")
        .maybeSingle();
      profile = created;
    }

    const redirectPath = getRedirectByRole(profile?.role ?? "cliente");
    if (forceSwitcher) {
      router.push(`${redirectPath}?openAccountSwitcher=1`);
      return;
    }
    router.push(redirectPath);
  };

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { supabase } = await import("@/lib/supabase");
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error || !data.user) {
      setError(error?.message ?? "No se pudo iniciar sesión.");
      setLoading(false);
      return;
    }

    localStorage.removeItem("clouva.switch_target");
    await redirectByRole(data.user.id, isAddAccountMode);
    setLoading(false);
  };

  const onGoogle = async () => {
    setError(null);
    const { supabase } = await import("@/lib/supabase");
    const redirectTo = `${window.location.origin}/auth/callback${isAddAccountMode ? "?addAccount=1" : ""}`;

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
    if (error) setError(error.message);
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
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="w-full rounded-xl border border-white/20 bg-black/30 px-4 py-3" />
          <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Contraseña" className="w-full rounded-xl border border-white/20 bg-black/30 px-4 py-3" />
          <button disabled={loading} className="w-full rounded-xl bg-white px-4 py-3 text-black disabled:opacity-60">{loading ? "Ingresando..." : "Ingresar"}</button>
          <button type="button" onClick={onGoogle} className="w-full rounded-xl border border-white/20 px-4 py-3">Continuar con Google</button>
          {error ? <p className="text-sm text-red-300">{error}</p> : null}
        </form>
        <Link href="/registro" className="mt-4 inline-block text-xs uppercase tracking-[0.15em] text-[#95d8ff]">Crear cuenta</Link>
          </>
        )}
      </section>
      <MainFooter />
    </main>
  );
}
