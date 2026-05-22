"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { MainFooter, MainNav } from "@/components/layout";
import { normalizeRole, roleHome } from "@/lib/auth";

export default function LoginContent() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const oauthError = searchParams.get("error");
    if (oauthError) setError(oauthError);

    const checkSession = async () => {
      const { supabase } = await import("@/lib/supabase");
      const { data } = await supabase.auth.getSession();
      const userId = data.session?.user?.id;
      if (userId) await redirectByRole(userId);
    };

    void checkSession();
  }, [searchParams]);

  const redirectByRole = async (userId: string) => {
    const { supabase } = await import("@/lib/supabase");
    const { data } = await supabase.from("profiles").select("role").eq("id", userId).single();
    const role = normalizeRole(data?.role);
    router.push(roleHome[role]);
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

    await redirectByRole(data.user.id);
    setLoading(false);
  };

  const onGoogle = async () => {
    setError(null);
    const { supabase } = await import("@/lib/supabase");
    const redirectTo = `${window.location.origin}/auth/callback`;

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
      </section>
      <MainFooter />
    </main>
  );
}
