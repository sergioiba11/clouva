"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { MainFooter, MainNav } from "@/components/layout";
import { ProductCard } from "@/components/store/product-card";
import {
  commerceProductCategory,
  commerceProductSelect,
  type CommerceProduct,
} from "@/lib/commerce-store-data";
import { supabase } from "@/lib/supabase";

export default function CatalogPage() {
  const searchParams = useSearchParams();
  const [products, setProducts] = useState<CommerceProduct[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(searchParams.get("category") ?? "");
  const [sort, setSort] = useState("recent");

  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from("commerce_products")
        .select(commerceProductSelect)
        .eq("owner_type", "clouva")
        .eq("product_type", "physical")
        .eq("status", "published")
        .order("created_at", { ascending: false });
      setProducts((data ?? []) as unknown as CommerceProduct[]);
    })();
  }, []);

  const categories = useMemo(
    () => [...new Set(products.map((product) => commerceProductCategory(product)))].sort(),
    [products],
  );

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return products
      .filter(
        (product) =>
          (!normalizedQuery ||
            product.name.toLowerCase().includes(normalizedQuery) ||
            product.description?.toLowerCase().includes(normalizedQuery)) &&
          (!category || commerceProductCategory(product) === category),
      )
      .sort((a, b) => {
        if (sort === "price_asc") return Number(a.price) - Number(b.price);
        if (sort === "price_desc") return Number(b.price) - Number(a.price);
        return +new Date(b.created_at) - +new Date(a.created_at);
      });
  }, [products, query, category, sort]);

  return (
    <main>
      <MainNav />
      <section className="mx-auto max-w-7xl px-4 py-14 md:px-8">
        <h1 className="text-4xl font-semibold">Catálogo</h1>
        <div className="mt-6 grid gap-3 md:grid-cols-3">
          <input
            placeholder="Buscar"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="rounded-full bg-white/10 px-5 py-3"
          />
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className="rounded-full bg-black px-5 py-3"
          >
            <option value="">Todas las categorías</option>
            {categories.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value)}
            className="rounded-full bg-black px-5 py-3"
          >
            <option value="recent">Más recientes</option>
            <option value="price_asc">Precio menor</option>
            <option value="price_desc">Precio mayor</option>
          </select>
        </div>

        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      </section>
      <MainFooter />
    </main>
  );
}
