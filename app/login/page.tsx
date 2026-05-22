"use client";

import { useState } from "react";
import Link from "next/link";
import { MainFooter, MainNav } from "@/components/layout";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    console.log("LOGIN CLICK");
    console.log(email);

    setMessage("");
    setError("");
    setLoading(true);

    const { error: supabaseError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: window.location.origin,
      },
    });

    if (supabaseError) {
      setError(supabaseError.message);
    } else {
      setMessage("Revisá tu correo para ingresar.");
      setEmail("");
    }

    setLoading(false);
  };

  return (
    <main>
      <MainNav />
      <section className="relative mx-auto w-full max-w-md overflow-hidden px-4 py-16">
        <div className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b from-transparent via-white/[0.03] to-transparent" />

        <h1 className="text-3xl">Login</h1>
        <p className="mt-3 text-white/70">Acceso premium con Supabase Auth (email, magic link o OAuth).</p>

        <form
          onSubmit={handleLogin}
          className="relative z-20 mt-6 space-y-3 rounded-3xl border border-white/10 bg-white/[0.03] p-6"
        >
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={loading}
            className="w-full rounded-xl border border-white/20 bg-black/30 px-4 py-3"
          />

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-white px-4 py-3 text-black transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Enviando..." : "Continuar"}
          </button>

          {message ? <p className="text-sm text-emerald-300">{message}</p> : null}
          {error ? <p className="text-sm text-rose-300">{error}</p> : null}
        </form>

        <Link href="/account" className="mt-4 inline-block text-xs uppercase tracking-[0.15em] text-[#95d8ff]">
          Ir a Account
        </Link>
      </section>
      <MainFooter />
    </main>
  );
}
