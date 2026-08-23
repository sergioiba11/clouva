import { notFound } from "next/navigation";
import { MainFooter, MainNav } from "@/components/layout";
import { AddToCart } from "@/components/store/add-to-cart";
import { commerceProductCategory, commerceProductImages, commerceProductSelect, type CommerceProduct } from "@/lib/commerce-store-data";
import { createPublicSupabase } from "@/lib/server/public-supabase";
import { money } from "@/lib/store-utils";

export const dynamic = "force-dynamic";

export default async function StudioProductPage({ params }: { params: Promise<{ slug: string; productSlug: string }> }) {
  const { slug, productSlug } = await params;
  const supabase = createPublicSupabase();
  const { data: studio } = await supabase.from("studios").select("id,slug,name").eq("slug", slug).eq("is_published", true).maybeSingle();
  if (!studio) notFound();
  const { data: spot } = await supabase.from("commerce_spots").select("id,name").eq("studio_id", studio.id).eq("status", "active").eq("public_enabled", true).limit(1).maybeSingle();
  if (!spot) notFound();
  const { data } = await supabase
    .from("commerce_products")
    .select(commerceProductSelect)
    .eq("spot_id", spot.id)
    .eq("slug", productSlug)
    .eq("status", "published")
    .maybeSingle();
  if (!data) notFound();
  const product = data as unknown as CommerceProduct;
  const images = commerceProductImages(product);
  let comboItems: Array<{ id: string; name: string; product_type: string; quantity: number; component_role: string }> = [];
  if (product.product_type === "bundle") {
    const { data: components } = await supabase
      .from("commerce_listing_components")
      .select("component_listing_id,quantity,component_role")
      .eq("bundle_listing_id", product.id);
    const componentIds = (components ?? []).map((component) => component.component_listing_id);
    if (componentIds.length) {
      const { data: componentProducts } = await supabase
        .from("commerce_products")
        .select("id,name,product_type")
        .in("id", componentIds)
        .eq("status", "published");
      comboItems = (components ?? []).flatMap((component) => {
        const match = (componentProducts ?? []).find((candidate) => candidate.id === component.component_listing_id);
        return match ? [{ ...match, quantity: component.quantity, component_role: component.component_role }] : [];
      });
    }
  }

  return (
    <main className="min-h-screen bg-black text-white">
      <MainNav />
      <section className="mx-auto grid max-w-7xl gap-10 px-4 py-14 md:grid-cols-2 md:px-8">
        <div className="grid gap-4">{images.length ? images.map((image) => <img key={image} src={image} alt={product.name} className="rounded-[2rem]" />) : <div className="aspect-square rounded-[2rem] border border-white/10 bg-white/5" />}</div>
        <div className="md:sticky md:top-8 md:h-fit">
          <p className="text-sm uppercase tracking-[0.2em] text-violet-300">{spot.name} · {commerceProductCategory(product)}</p>
          <h1 className="mt-3 text-5xl font-semibold">{product.name}</h1>
          <div className="mt-5 text-2xl">Desde {money(Number(product.price), product.currency)}</div>
          <p className="mt-6 leading-7 text-white/65">{product.description}</p>
          {comboItems.length ? <div className="mt-6 rounded-2xl border border-violet-400/20 bg-violet-500/[0.06] p-4"><p className="text-xs uppercase tracking-[.18em] text-violet-300">Incluye en una sola compra</p><div className="mt-3 space-y-2">{comboItems.map((item) => <div key={item.id} className="flex items-center justify-between rounded-xl border border-white/10 px-3 py-2 text-sm"><span>{item.quantity}× {item.name}</span><span className="text-white/40">{item.component_role === "physical" ? "Físico" : "Digital 3D"}</span></div>)}</div></div> : null}
          <div className="mt-8"><AddToCart product={product} /></div>
        </div>
      </section>
      <MainFooter />
    </main>
  );
}
