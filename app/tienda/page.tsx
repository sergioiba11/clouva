"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { MainFooter, MainNav } from "@/components/layout";
import { ProductCard } from "@/components/store/product-card";
import {
  commerceProductCategory,
  commerceProductSelect,
  type CommerceProduct,
} from "@/lib/commerce-store-data";
import { supabase } from "@/lib/supabase";

type StoreBanner = {
  id: string;
  title: string;
  subtitle: string | null;
  image_url: string | null;
};

export default function StoreHome() {
  const [products, setProducts] = useState<CommerceProduct[]>([]);
  const [banners, setBanners] = useState<StoreBanner[]>([]);

  useEffect(() => {
    void (async () => {
      const [productsResult, bannersResult] = await Promise.all([
        supabase
          .from("commerce_products")
          .select(commerceProductSelect)
          .eq("owner_type", "clouva")
          .eq("product_type", "physical")
          .eq("status", "published")
          .order("created_at", { ascending: false })
          .limit(6),
        supabase.from("banners").select("id,title,subtitle,image_url").eq("active", true).order("sort_order"),
      ]);

      setProducts((productsResult.data ?? []) as unknown as CommerceProduct[]);
      setBanners((bannersResult.data ?? []) as StoreBanner[]);
    })();
  }, []);

  const categories = useMemo(
    () => [...new Set(products.map((product) => commerceProductCategory(product)))],
    [products],
  );
  const hero = banners[0];

  return (
    <main>
      <MainNav />
      <section className="mx-auto max-w-7xl px-4 py-10 md:px-8">
        <div className="overflow-hidden rounded-[2.5rem] border border-white/10 bg-white/[0.04]">
          <div
            className="grid min-h-[520px] items-end bg-cover bg-center p-8 md:p-14"
            style={{
              backgroundImage: hero?.image_url
                ? `linear-gradient(90deg, rgba(0,0,0,.75), rgba(0,0,0,.15)), url(${hero.image_url})`
                : "radial-gradient(circle at top right, rgba(149,216,255,.25), transparent 40%)",
            }}
          >
            <div>
              <p className="text-xs uppercase tracking-[0.25em] text-white/60">CLOUVA Store</p>
              <h1 className="mt-3 max-w-2xl text-5xl font-semibold md:text-7xl">
                {hero?.title ?? "Merch oficial de CLOUVA"}
              </h1>
              <p className="mt-4 max-w-xl text-white/65">
                {hero?.subtitle ?? "Drops físicos oficiales, con talle, color y stock real por variante."}
              </p>
              <Link
                href="/catalogo"
                className="mt-8 inline-block rounded-full bg-white px-6 py-3 font-semibold text-black"
              >
                Comprar ahora
              </Link>
            </div>
          </div>
        </div>

        <h2 className="mt-14 text-2xl font-semibold">Productos destacados</h2>
        <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>

        {categories.length ? (
          <>
            <h2 className="mt-14 text-2xl font-semibold">Categorías</h2>
            <div className="mt-6 grid gap-4 md:grid-cols-4">
              {categories.map((category) => (
                <Link
                  key={category}
                  href={`/catalogo?category=${encodeURIComponent(category)}`}
                  className="rounded-[2rem] border border-white/10 p-6"
                >
                  {category}
                </Link>
              ))}
            </div>
          </>
        ) : null}
      </section>
      <MainFooter />
    </main>
  );
}
