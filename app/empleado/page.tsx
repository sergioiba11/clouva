import { MainNav } from "@/components/layout";

export default function EmpleadoPage() {
  return (
    <main>
      <MainNav />
      <section className="mx-auto max-w-6xl px-4 py-10">
        <h1 className="text-3xl">Panel de empleado</h1>
        <p className="mt-2 text-white/70">Vista operativa para tiendas asignadas: stock, ventas y pedidos.</p>
      </section>
    </main>
  );
}
