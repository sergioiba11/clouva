"use client";
import { MainFooter, MainNav } from "@/components/layout";
import { ProductCard, SectionTitle } from "@/components/ui";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Product = { id: string; slug: string; name: string; price: number; category: string };

export default function ShopPage() {
  const [products, setProducts] = useState<Product[]>([]);

  useEffect(() => {
    supabase.from("products").select("id,slug,name,price,category").order("created_at", { ascending: false }).then(({ data }) => setProducts((data as Product[]) ?? []));
  }, []);

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
