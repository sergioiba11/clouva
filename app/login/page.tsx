"use client";
import Link from "next/link";
import { MainFooter, MainNav } from "@/components/layout";
import { useAuth } from "@/components/auth/auth-provider";
import { useState } from "react";

export default function LoginPage() {
  const { login, register, loading } = useAuth();
  const [mode, setMode] = useState<"login"|"register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const result = mode === "login" ? await login(email, password) : await register(email, password, name);
    setMsg(result.error ? `Error: ${result.error}` : "Listo. Sesión actualizada.");
  }

  return (
    <main>
      <MainNav />
      <section className="mx-auto w-full max-w-md px-4 py-16">
        <h1 className="text-3xl">{mode === "login" ? "Login" : "Registro"}</h1>
        <p className="mt-3 text-white/70">Acceso premium CLOUVA con Supabase Auth.</p>
        <form onSubmit={handleSubmit} className="mt-6 space-y-3 rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          {mode === "register" ? <input value={name} onChange={(e)=>setName(e.target.value)} placeholder="Nombre" className="w-full rounded-xl border border-white/20 bg-black/30 px-4 py-3" /> : null}
          <input value={email} onChange={(e)=>setEmail(e.target.value)} placeholder="Email" className="w-full rounded-xl border border-white/20 bg-black/30 px-4 py-3" />
          <input value={password} onChange={(e)=>setPassword(e.target.value)} placeholder="Password" type="password" className="w-full rounded-xl border border-white/20 bg-black/30 px-4 py-3" />
          <button disabled={loading} className="w-full rounded-xl bg-white px-4 py-3 text-black">{mode === "login" ? "Ingresar" : "Crear cuenta"}</button>
          <button type="button" onClick={()=>setMode(mode === "login" ? "register" : "login")} className="w-full text-xs text-[#95d8ff]">{mode === "login" ? "Crear cuenta" : "Ya tengo cuenta"}</button>
        </form>
        {msg ? <p className="mt-3 text-sm text-white/70">{msg}</p> : null}
        <Link href="/account" className="mt-4 inline-block text-xs uppercase tracking-[0.15em] text-[#95d8ff]">Ir a Account</Link>
      </section>
      <MainFooter />
    </main>
  );
}
