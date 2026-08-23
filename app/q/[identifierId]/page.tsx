import Link from "next/link";
import { notFound } from "next/navigation";
import { MainFooter, MainNav } from "@/components/layout";
import { createAdminSupabase } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";

export default async function ClouvaProductQrPage({ params }: { params: Promise<{ identifierId: string }> }) {
  const { identifierId } = await params;
  const admin = createAdminSupabase();
  const { data: identifier } = await admin
    .from("commerce_product_identifiers")
    .select("id,catalog_product_id,catalog_variant_id,identifier_type,value")
    .eq("id", identifierId)
    .eq("identifier_type", "clouva_qr")
    .maybeSingle();
  if (!identifier) notFound();
  const [{ data: catalog }, { data: listing }, variantResult] = await Promise.all([
    admin.from("commerce_catalog_products").select("name,description,brand,product_kind,avatar_asset_id").eq("id", identifier.catalog_product_id).maybeSingle(),
    admin.from("commerce_products").select("name,slug,description,price,currency,status,cover_url,spot_id").eq("catalog_product_id", identifier.catalog_product_id).eq("status", "published").limit(1).maybeSingle(),
    identifier.catalog_variant_id
      ? admin.from("commerce_catalog_variants").select("title,size,color,presentation").eq("id", identifier.catalog_variant_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (!catalog) notFound();
  const variant = variantResult.data;

  return (
    <main className="min-h-screen bg-black text-white">
      <MainNav />
      <section className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <div className="rounded-[2rem] border border-violet-400/30 bg-[radial-gradient(circle_at_top_right,rgba(124,58,237,.25),transparent_42%),#09070f] p-7 shadow-[0_30px_100px_rgba(91,33,182,.18)] sm:p-10">
          <p className="text-xs uppercase tracking-[0.24em] text-violet-300">Autenticidad CLOUVA · El Iglú</p>
          <div className="mt-6 grid gap-8 sm:grid-cols-[160px_1fr]">
            {listing?.cover_url ? <img src={listing.cover_url} alt={catalog.name} className="aspect-square w-full rounded-3xl object-cover" /> : <div className="aspect-square rounded-3xl border border-white/10 bg-white/5" />}
            <div>
              <h1 className="text-3xl font-semibold">{catalog.name}</h1>
              <p className="mt-2 text-white/55">{[catalog.brand, variant?.color, variant?.size, variant?.presentation].filter(Boolean).join(" · ")}</p>
              <p className="mt-5 leading-7 text-white/65">{catalog.description || listing?.description || "Producto identificado dentro del catálogo de El Iglú."}</p>
              <div className="mt-6 flex flex-wrap gap-2 text-xs">
                <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-emerald-200">Código válido</span>
                {catalog.avatar_asset_id ? <span className="rounded-full border border-violet-400/25 bg-violet-400/10 px-3 py-1 text-violet-200">Experiencia 3D vinculada</span> : null}
              </div>
              {listing ? <Link href={`/studios/el-iglu/tienda/${listing.slug}`} className="mt-8 inline-block rounded-xl bg-violet-600 px-5 py-3 font-semibold">Ver en El Iglú</Link> : null}
            </div>
          </div>
        </div>
      </section>
      <MainFooter />
    </main>
  );
}

