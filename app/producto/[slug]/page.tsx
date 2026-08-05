"use client";

import { useEffect, useState } from "react";
import { MainFooter, MainNav } from "@/components/layout";
import { AddToCart } from "@/components/store/add-to-cart";
import {
  commerceProductCategory,
  commerceProductImages,
  commerceProductSelect,
  type CommerceProduct,
} from "@/lib/commerce-store-data";
import { supabase } from "@/lib/supabase";
import { money } from "@/lib/store-utils";

export default function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const [product, setProduct] = useState<CommerceProduct | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void (async () => {
      const { slug } = await params;
      const { data } = await supabase
        .from("commerce_products")
        .select(commerceProductSelect)
        .eq("owner_type", "clouva")
        .eq("product_type", "physical")
        .eq("status", "published")
        .eq("slug", slug)
        .maybeSingle();
      setProduct((data as unknown as CommerceProduct | null) ?? null);
      setLoaded(true);
    })();
  }, [params]);

  if (!loaded) {
    return (
      <main>
        <MainNav />
        <div className="p-10">Cargando producto...</div>
      </main>
    );
  }

  if (!product) {
    return (
      <main>
        <MainNav />
        <div className="p-10">Este producto no está disponible.</div>
        <MainFooter />
      </main>
    );
  }

  const images = commerceProductImages(product);

  return (
    <main>
      <MainNav />
      <section className="mx-auto grid max-w-7xl gap-10 px-4 py-14 md:grid-cols-2 md:px-8">
        <div className="grid gap-4">
          {images.length ? (
            images.map((image) => (
              <img key={image} src={image} alt={product.name} className="rounded-[2rem]" />
            ))
          ) : (
            <div className="aspect-square rounded-[2rem] bg-white/5" />
          )}
        </div>

        <div className="md:sticky md:top-8 md:h-fit">
          <p className="text-sm uppercase tracking-[0.2em] text-white/45">{commerceProductCategory(product)}</p>
          <h1 className="mt-3 text-5xl font-semibold">{product.name}</h1>
          <div className="mt-5 text-2xl">Desde {money(Number(product.price), product.currency)}</div>
          <p className="mt-6 text-white/65">{product.description}</p>
          <div className="mt-8">
            <AddToCart product={product} />
          </div>
        </div>
      </section>
      <MainFooter />
    </main>
  );
}
