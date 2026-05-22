"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { MainFooter, MainNav } from "@/components/layout";

export default function RegisterContent() {
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { supabase } = await import("@/lib/supabase");
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName, phone },
      },
    });

    if (error || !data.user) {
      setError(error?.message ?? "No se pudo crear la cuenta.");
      setLoading(false);
      return;
    }

    await supabase.from("profiles").upsert({
      id: data.user.id,
      role: "cliente",
      role_v2: "cliente",
      email,
      full_name: fullName,
      phone,
    });

    router.push("/cuenta");
    setLoading(false);
  };

  return (
    <main>
      <MainNav />
      <section className="mx-auto w-full max-w-md px-4 py-16">
        <h1 className="text-3xl">Crear cuenta</h1>
        <p className="mt-3 text-white/70">Registro con teléfono obligatorio para CLOUVA OS.</p>
        <form onSubmit={onSubmit} className="mt-6 space-y-3 rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <input required value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Nombre completo" className="w-full rounded-xl border border-white/20 bg-black/30 px-4 py-3" />
          <input required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Teléfono" className="w-full rounded-xl border border-white/20 bg-black/30 px-4 py-3" />
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="w-full rounded-xl border border-white/20 bg-black/30 px-4 py-3" />
          <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Contraseña" className="w-full rounded-xl border border-white/20 bg-black/30 px-4 py-3" />
          <button disabled={loading} className="w-full rounded-xl bg-white px-4 py-3 text-black disabled:opacity-60">{loading ? "Creando..." : "Crear cuenta"}</button>
          {error ? <p className="text-sm text-red-300">{error}</p> : null}
        </form>
        <Link href="/login" className="mt-4 inline-block text-xs uppercase tracking-[0.15em] text-[#95d8ff]">Ya tengo cuenta</Link>
      </section>
      <MainFooter />
    </main>
  );
}
