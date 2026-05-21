"use client";
import { MainFooter, MainNav } from "@/components/layout";
import { useAuth } from "@/components/auth/auth-provider";

export default function AccountPage() {
  const { user, role, logout } = useAuth();
  return (
    <main>
      <MainNav />
      <section className="mx-auto w-full max-w-5xl px-4 py-12 md:px-8">
        <h1 className="text-3xl">Account</h1>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <article className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">Perfil: {user?.email ?? "Invitado"}<br />Role: {role}</article>
          <article className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">Órdenes, tracking y favoritos (persistentes).</article>
        </div>
        <button onClick={logout} className="mt-4 rounded-full border border-white/20 px-4 py-2 text-sm">Cerrar sesión</button>
      </section>
      <MainFooter />
    </main>
  );
}
