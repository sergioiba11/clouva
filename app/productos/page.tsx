import { ProShell } from "@/components/pro-shell";
import { ProductCard, SectionTitle } from "@/components/ui";
import { products } from "@/lib/data";

export default function ProductosPage() {
  return (
    <ProShell>
      <section className="mx-auto w-full max-w-7xl px-4 py-12 md:px-8">
        <SectionTitle overline="Productos" title="Drop activo" subtitle="Placeholder conectado para futura tabla products en Supabase." />
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((p) => (
            <ProductCard key={p.id} name={p.name} price={p.price} href={`/producto/${p.slug}`} category={p.category} />
          ))}
        </div>
      </section>
    </ProShell>
  );
}
