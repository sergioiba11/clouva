"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { MainFooter, MainNav } from "@/components/layout";
import { useAuth } from "@/components/auth-provider";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { user, loading, error, signInWithPassword, signUp, signInWithMagicLink } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user) router.replace("/account");
  }, [loading, user, router]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    await signInWithPassword(email, password);
  };

  return (
    <main>
      <MainNav />
      <section className="mx-auto w-full max-w-md px-4 py-16">
        <h1 className="text-3xl">Login CLOUVA</h1>
        <p className="mt-3 text-white/70">Acceso premium con Supabase Auth real: password, magic link y registro.</p>
        <form onSubmit={onSubmit} className="mt-6 space-y-3 rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <input value={email} onChange={(e)=>setEmail(e.target.value)} type="email" required placeholder="Email" className="w-full rounded-xl border border-white/20 bg-black/30 px-4 py-3" />
          <input value={password} onChange={(e)=>setPassword(e.target.value)} type="password" required placeholder="Password" className="w-full rounded-xl border border-white/20 bg-black/30 px-4 py-3" />
          <button disabled={loading} className="w-full rounded-xl bg-white px-4 py-3 text-black disabled:opacity-60">{loading ? "Validando..." : "Entrar"}</button>
          <button type="button" onClick={()=>signUp(email,password)} disabled={loading} className="w-full rounded-xl border border-white/20 px-4 py-3 text-white">Crear cuenta</button>
          <button type="button" onClick={()=>signInWithMagicLink(email)} disabled={loading} className="w-full rounded-xl border border-[#95d8ff]/50 px-4 py-3 text-[#95d8ff]">Enviar magic link</button>
          {error ? <p className="text-sm text-rose-300">{error}</p> : null}
        </form>
        <Link href="/account" className="mt-4 inline-block text-xs uppercase tracking-[0.15em] text-[#95d8ff]">Ir a Account</Link>
      </section>
      <MainFooter />
    </main>
  );
}
