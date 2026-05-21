import Link from "next/link";
import { MainFooter, MainNav } from "@/components/layout";

export default function LoginPage() {
  return (
    <main>
      <MainNav />
      <section className="mx-auto w-full max-w-md px-4 py-16">
        <h1 className="text-3xl">Login</h1>
        <p className="mt-3 text-white/70">Acceso premium con Supabase Auth (email, magic link o OAuth).</p>
        <form className="mt-6 space-y-3 rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <input placeholder="Email" className="w-full rounded-xl border border-white/20 bg-black/30 px-4 py-3" />
          <button className="w-full rounded-xl bg-white px-4 py-3 text-black">Continuar</button>
        </form>
        <Link href="/account" className="mt-4 inline-block text-xs uppercase tracking-[0.15em] text-[#95d8ff]">Ir a Account</Link>
      </section>
      <MainFooter />
    </main>
  );
}
