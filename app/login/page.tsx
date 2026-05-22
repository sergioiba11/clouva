"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { MainFooter, MainNav } from "@/components/layout";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  const missingEnv = useMemo(() => {
    const required = [
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY"
    ] as const;

    return required.filter((name) => !process.env[name]);
  }, []);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    alert("LOGIN CLICK");

    if (missingEnv.length > 0) {
      setStatus("Faltan variables de Supabase");
      return;
    }

    setStatus(`Submit ejecutado para ${email || "(sin email)"}.`);
  }

  return (
    <main>
      <MainNav />
      <section className="mx-auto w-full max-w-md px-4 py-16">
        <h1 className="text-3xl">Login</h1>
        <p className="mt-3 text-white/70">Acceso premium con Supabase Auth (email, magic link o OAuth).</p>
        <form onSubmit={handleSubmit} className="mt-6 space-y-3 rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <input
            placeholder="Email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="w-full rounded-xl border border-white/20 bg-black/30 px-4 py-3"
          />
          <button type="submit" className="w-full rounded-xl bg-white px-4 py-3 text-black">
            Continuar
          </button>
        </form>

        {missingEnv.length > 0 ? (
          <p className="mt-3 text-sm text-red-300">Faltan variables de Supabase</p>
        ) : null}

        {status ? <p className="mt-3 text-sm text-white/70">{status}</p> : null}

        <Link href="/account" className="mt-4 inline-block text-xs uppercase tracking-[0.15em] text-[#95d8ff]">Ir a Account</Link>
      </section>
      <MainFooter />
    </main>
  );
}
