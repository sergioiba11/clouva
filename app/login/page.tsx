"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { MainFooter, MainNav } from "@/components/layout";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setMessage(null);
    setError(null);
    setLoading(true);

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/account`,
      },
    });

    if (error) {
      setError(error.message);
    } else {
      setMessage("Revisa tu correo para continuar.");
    }

    setLoading(false);
  };

  return (
    <main>
      <MainNav />
      <section className="mx-auto w-full max-w-md px-4 py-16">
        <h1 className="text-3xl">Login</h1>
        <p className="mt-3 text-white/70">Acceso premium con Supabase Auth (email, magic link o OAuth).</p>
        <form onSubmit={onSubmit} className="mt-6 space-y-3 rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            className="w-full rounded-xl border border-white/20 bg-black/30 px-4 py-3"
          />
          <button disabled={loading} className="w-full rounded-xl bg-white px-4 py-3 text-black disabled:opacity-60">
            {loading ? "Enviando..." : "Continuar"}
          </button>
          {message ? <p className="text-sm text-emerald-300">{message}</p> : null}
          {error ? <p className="text-sm text-red-300">{error}</p> : null}
        </form>
        <Link href="/account" className="mt-4 inline-block text-xs uppercase tracking-[0.15em] text-[#95d8ff]">
          Ir a Account
        </Link>
      </section>
      <MainFooter />
    </main>
  );
}
