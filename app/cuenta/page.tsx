import { MainFooter, MainNav } from "@/components/layout";

export default function AccountPage() {
  return (
    <main>
      <MainNav />
      <section className="mx-auto w-full max-w-5xl px-4 py-12 md:px-8">
        <h1 className="text-3xl">Mi cuenta</h1>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <article className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">Perfil, dirección, avatar y datos de talle.</article>
          <article className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">Órdenes, historial y estado de pagos.</article>
        </div>
      </section>
      <MainFooter />
    </main>
  );
}
