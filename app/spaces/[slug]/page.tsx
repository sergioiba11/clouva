import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { MainFooter, MainNav } from "@/components/layout";
import { createAdminSupabase } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";

function money(value: number, currency: string) {
  try {
    return new Intl.NumberFormat("es-AR", { style: "currency", currency }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString("es-AR")}`;
  }
}

export default async function PublicSpacePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const admin = createAdminSupabase();
  const { data: space, error } = await admin
    .from("spaces")
    .select("id,slug,name,type,description,logo_url,cover_url,accent_color,public_enabled,status,legacy_studio_id,legacy_commerce_spot_id")
    .eq("slug", slug)
    .maybeSingle();
  if (error || !space || !space.public_enabled || space.status !== "active") notFound();

  if (space.legacy_studio_id) {
    const { data: studio } = await admin.from("studios").select("slug").eq("id", space.legacy_studio_id).maybeSingle();
    if (studio?.slug) redirect(`/studios/${encodeURIComponent(studio.slug)}`);
  }

  const { data: publications, error: publicationError } = await admin
    .from("commerce_product_publications")
    .select("product_id,display_order")
    .eq("target_type", "space")
    .eq("target_space_id", space.id)
    .eq("is_visible", true)
    .order("display_order", { ascending: true });
  if (publicationError) throw new Error(publicationError.message);

  const productIds = (publications ?? []).map((row) => String(row.product_id));
  const { data: products, error: productsError } = productIds.length
    ? await admin
        .from("commerce_products")
        .select("id,name,description,price,currency,cover_url,status")
        .in("id", productIds)
        .eq("status", "published")
    : { data: [], error: null };
  if (productsError) throw new Error(productsError.message);
  const productMap = new Map((products ?? []).map((product) => [String(product.id), product]));
  const orderedProducts = productIds.map((id) => productMap.get(id)).filter(Boolean);
  const accent = space.accent_color && /^#[0-9a-f]{3,8}$/i.test(space.accent_color) ? space.accent_color : "#8f5cff";

  return (
    <main className="min-h-screen bg-[#05040a] text-white">
      <MainNav />
      <section className="mx-auto max-w-6xl px-4 py-10 sm:px-8 sm:py-14">
        <header className="relative overflow-hidden rounded-[32px] border bg-[#0c0912] p-7 sm:p-10" style={{ borderColor: `${accent}38` }}>
          {space.cover_url ? <img src={space.cover_url} alt="" className="absolute inset-0 h-full w-full object-cover opacity-20" /> : null}
          <div className="absolute inset-0 bg-gradient-to-r from-[#08060d] via-[#08060ddd] to-transparent" />
          <div className="relative max-w-3xl">
            <span className="inline-flex rounded-full border border-white/10 bg-black/30 px-3 py-1 text-[11px] font-semibold uppercase tracking-[.16em] text-white/60">{space.type}</span>
            <div className="mt-5 flex items-center gap-4">
              {space.logo_url ? <img src={space.logo_url} alt={space.name} className="h-16 w-16 rounded-2xl border border-white/10 object-cover" /> : null}
              <h1 className="text-4xl font-semibold tracking-tight sm:text-6xl">{space.name}</h1>
            </div>
            {space.description ? <p className="mt-5 max-w-2xl text-sm leading-7 text-white/58 sm:text-base">{space.description}</p> : null}
          </div>
        </header>

        <section className="mt-8">
          <div className="flex items-end justify-between gap-4">
            <div><p className="text-xs uppercase tracking-[.16em] text-white/35">Commerce</p><h2 className="mt-1 text-2xl font-semibold">Productos destacados</h2></div>
            {space.legacy_commerce_spot_id ? <span className="text-xs text-white/35">Catálogo canónico CLOUVA</span> : null}
          </div>
          {orderedProducts.length ? (
            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {orderedProducts.map((product) => product ? (
                <Link key={product.id} href={`/producto/id/${product.id}`} className="group overflow-hidden rounded-[24px] border border-white/[0.08] bg-[#0b0912] transition hover:border-violet-400/30">
                  <div className="aspect-[4/3] bg-white/[0.03]">{product.cover_url ? <img src={product.cover_url} alt={product.name} className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.02]" /> : null}</div>
                  <div className="p-5"><h3 className="text-lg font-semibold">{product.name}</h3><p className="mt-2 line-clamp-2 text-sm leading-5 text-white/42">{product.description || "Producto de este espacio."}</p><strong className="mt-4 block text-sm" style={{ color: accent }}>{money(Number(product.price), product.currency)}</strong></div>
                </Link>
              ) : null)}
            </div>
          ) : <div className="mt-5 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-6 text-sm text-white/40">Este espacio todavía no publicó productos destacados.</div>}
        </section>
      </section>
      <MainFooter />
    </main>
  );
}
