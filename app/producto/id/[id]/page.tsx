import { notFound } from "next/navigation";
import { MainFooter, MainNav } from "@/components/layout";
import { AddToCart } from "@/components/store/add-to-cart";
import {
  commerceProductCategory,
  commerceProductImages,
  commerceProductSelect,
  type CommerceProduct,
} from "@/lib/commerce-store-data";
import { createPublicSupabase } from "@/lib/server/public-supabase";
import { money } from "@/lib/store-utils";

export const dynamic = "force-dynamic";

export default async function CanonicalProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createPublicSupabase();
  const { data } = await supabase
    .from("commerce_products")
    .select(commerceProductSelect)
    .eq("id", id)
    .eq("status", "published")
    .maybeSingle();

  const product = (data as unknown as CommerceProduct | null) ?? null;
  if (!product) notFound();
  const images = commerceProductImages(product);

  return (
    <main className="min-h-screen bg-black text-white">
      <MainNav />
      <section className="mx-auto grid max-w-7xl gap-10 px-4 py-14 md:grid-cols-2 md:px-8">
        <div className="grid gap-4">
          {images.length ? images.map((image) => (
            <img key={image} src={image} alt={product.name} className="rounded-[2rem]" />
          )) : <div className="aspect-square rounded-[2rem] bg-white/5" />}
        </div>
        <div className="md:sticky md:top-8 md:h-fit">
          <p className="text-sm uppercase tracking-[0.2em] text-white/45">{commerceProductCategory(product)}</p>
          <h1 className="mt-3 text-5xl font-semibold">{product.name}</h1>
          <div className="mt-5 text-2xl">Desde {money(Number(product.price), product.currency)}</div>
          {product.description ? <p className="mt-6 text-white/65">{product.description}</p> : null}
          <div className="mt-8"><AddToCart product={product} /></div>
          <p className="mt-5 text-xs leading-5 text-white/35">El producto conserva el mismo ID, precio, stock y beneficiario aunque lo encuentres desde distintos perfiles o espacios.</p>
        </div>
      </section>
      <MainFooter />
    </main>
  );
}
