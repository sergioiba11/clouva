import Link from "next/link";
import { notFound } from "next/navigation";
import { MainFooter, MainNav } from "@/components/layout";
import { ProductCard } from "@/components/store/product-card";
import { commerceProductSelect, type CommerceProduct } from "@/lib/commerce-store-data";
import { createPublicSupabase } from "@/lib/server/public-supabase";

export const dynamic = "force-dynamic";

export default async function StudioStorePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = createPublicSupabase();
  const { data: studio } = await supabase
    .from("studios")
    .select("id,slug,name,description,logo_url,cover_url")
    .eq("slug", slug)
    .eq("is_published", true)
    .maybeSingle();
  if (!studio) notFound();
  const { data: spot } = await supabase
    .from("commerce_spots")
    .select("id,name,currency")
    .eq("studio_id", studio.id)
    .eq("status", "active")
    .eq("public_enabled", true)
    .limit(1)
    .maybeSingle();
  if (!spot) notFound();
  const { data: products } = await supabase
    .from("commerce_products")
    .select(commerceProductSelect)
    .eq("spot_id", spot.id)
    .eq("status", "published")
    .order("created_at", { ascending: false });

  return (
    <main className="min-h-screen bg-black text-white">
      <MainNav />
      <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="relative overflow-hidden rounded-[2.4rem] border border-violet-400/20 bg-[#09070f] p-8 sm:p-12">
          {studio.cover_url ? <img src={studio.cover_url} alt="" className="absolute inset-0 h-full w-full object-cover opacity-25" /> : null}
          <div className="absolute inset-0 bg-gradient-to-r from-black via-black/80 to-violet-950/30" />
          <div className="relative flex items-center gap-5">
            {studio.logo_url ? <img src={studio.logo_url} alt={studio.name} className="h-20 w-20 rounded-3xl object-cover" /> : <div className="grid h-20 w-20 place-items-center rounded-3xl border border-violet-400/25 bg-violet-500/10 text-2xl font-semibold">IG</div>}
            <div>
              <p className="text-xs uppercase tracking-[0.28em] text-violet-300">MI SPOT</p>
              <h1 className="mt-2 text-4xl font-semibold sm:text-6xl">{spot.name}</h1>
              <p className="mt-3 max-w-2xl text-white/60">Productos físicos, prendas 3D y combos conectados al mismo inventario de CLOUVA.</p>
            </div>
          </div>
        </div>

        <div className="mt-8 flex items-center justify-between gap-4">
          <div><p className="text-xs uppercase tracking-[0.22em] text-white/35">Catálogo</p><h2 className="mt-1 text-2xl font-semibold">El Iglú</h2></div>
          <Link href={`/studios/${studio.slug}`} className="rounded-xl border border-white/15 px-4 py-2 text-sm">Ver Estudio</Link>
        </div>
        <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {((products ?? []) as unknown as CommerceProduct[]).map((product) => (
            <ProductCard key={product.id} product={product} href={`/studios/${studio.slug}/tienda/${product.slug}`} />
          ))}
        </div>
        {!products?.length ? <div className="mt-8 rounded-3xl border border-dashed border-white/15 p-12 text-center text-white/45">El catálogo está listo para recibir los primeros productos.</div> : null}
      </section>
      <MainFooter />
    </main>
  );
}

