import { MainFooter, MainNav } from "@/components/layout";
import { RequireAuth } from "@/components/route-guard";

export default function AccountPage() {
  return (
    <main>
      <MainNav />
      <RequireAuth>
        <section className="mx-auto w-full max-w-5xl px-4 py-12 md:px-8">
          <h1 className="text-3xl">Account</h1>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <article className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">Perfil, dirección y preferencias.</article>
            <article className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">Órdenes, tracking y estado de pagos.</article>
          </div>
        </section>
      </RequireAuth>
      <MainFooter />
    </main>
  );
}
