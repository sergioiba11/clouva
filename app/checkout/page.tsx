import { MainFooter, MainNav } from "@/components/layout";

export default function CheckoutPage() {
  return (
    <main>
      <MainNav />
      <section className="mx-auto w-full max-w-4xl px-4 py-12 md:px-8">
        <h1 className="text-3xl">Checkout</h1>
        <div className="mt-6 space-y-4 rounded-3xl border border-white/10 bg-white/[0.03] p-6 text-sm text-white/70">
          <p>Integración lista para Supabase Auth + profiles + orders table.</p>
          <p>Mercado Pago ready: crear preferencia server-side y redirección al checkout oficial.</p>
          <p>Deploy-ready para Vercel con variables de entorno seguras.</p>
        </div>
      </section>
      <MainFooter />
    </main>
  );
}
