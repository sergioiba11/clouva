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

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    console.log("LOGIN CLICK");
    console.log(email);

    setLoading(true);
    setMessage(null);
    setError(null);

    const { error: supabaseError } = await supabase.auth.signInWithOtp({
      email,
    });

    if (supabaseError) {
      console.log("LOGIN ERROR", supabaseError);
      setError(supabaseError.message);
      setLoading(false);
      return;
    }

    setMessage("Revisá tu correo para ingresar.");
    setLoading(false);
  };

  return (
    <main>
      <MainNav />
      <section className="mx-auto w-full max-w-md px-4 py-16">
        <h1 className="text-3xl">Login</h1>
        <p className="mt-3 text-white/70">Acceso premium con Supabase Auth (email, magic link o OAuth).</p>
        <form
          onSubmit={handleSubmit}
          className="relative z-10 mt-6 space-y-3 rounded-3xl border border-white/10 bg-white/[0.03] p-6"
        >
          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Email"
            className="w-full rounded-xl border border-white/20 bg-black/30 px-4 py-3"
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-white px-4 py-3 text-black disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Enviando..." : "Continuar"}
          </button>
          {message ? <p className="rounded-xl border border-emerald-400/40 bg-emerald-500/10 p-3 text-sm text-emerald-200">{message}</p> : null}
          {error ? <p className="rounded-xl border border-red-400/40 bg-red-500/10 p-3 text-sm text-red-200">{error}</p> : null}
        </form>
        <Link href="/account" className="mt-4 inline-block text-xs uppercase tracking-[0.15em] text-[#95d8ff]">Ir a Account</Link>
      </section>
      <MainFooter />
    </main>
  );
}
