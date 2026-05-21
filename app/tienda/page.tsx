import { MainFooter, MainNav } from "@/components/layout";
import { ProductCard, SectionTitle } from "@/components/ui";
import { products } from "@/lib/data";

export default function ShopPage() {
  return (
    <main>
      <MainNav />
      <section className="mx-auto w-full max-w-7xl px-4 py-14 md:px-8">
        <SectionTitle overline="Shop" title="Catálogo CLOUVA" subtitle="Dark premium essentials con construcción técnica." />
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((p) => <ProductCard key={p.id} name={p.name} price={p.price} href={`/producto/${p.slug}`} category={p.category} />)}
        </div>
      </section>
      <MainFooter />
    </main>
  );
}
