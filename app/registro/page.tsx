import Link from "next/link";
import { ProShell } from "@/components/pro-shell";

export default function RegistroPage() {
  return (
    <ProShell>
      <section className="mx-auto w-full max-w-md px-4 py-16">
        <h1 className="text-3xl">Registro</h1>
        <p className="mt-3 text-white/70">Alta de usuario conectable a Supabase Auth + tabla users.</p>
        <div className="mt-6 rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <p className="text-sm text-white/70">Placeholder de signup. Podés reutilizar la lógica OTP del login.</p>
          <Link href="/login" className="mt-4 inline-block text-xs uppercase tracking-[0.15em] text-[#95d8ff]">Ir a login</Link>
        </div>
      </section>
    </ProShell>
  );
}
