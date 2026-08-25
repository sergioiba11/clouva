import { ProductCard } from "@/components/store/product-card";
import { commerceProductSelect, type CommerceProduct } from "@/lib/commerce-store-data";
import { createPublicSupabase } from "@/lib/server/public-supabase";

type Props = {
  playerId?: string | null;
  studioId?: string | null;
  title?: string;
  eyebrow?: string;
};

export async function PublicMerchSection({ playerId, studioId, title = "Merch", eyebrow = "Tienda" }: Props) {
  const supabase = createPublicSupabase();
  let targetSpaceId: string | null = null;

  if (studioId) {
    const { data: space } = await supabase
      .from("spaces")
      .select("id")
      .eq("legacy_studio_id", studioId)
      .maybeSingle();
    targetSpaceId = space?.id ?? null;
  }

  let publicationsQuery = supabase
    .from("commerce_product_publications")
    .select("product_id,display_order,placement")
    .eq("is_visible", true)
    .eq("placement", "merch")
    .order("display_order", { ascending: true });

  if (playerId) {
    publicationsQuery = publicationsQuery.eq("target_type", "player").eq("target_player_id", playerId);
  } else if (targetSpaceId) {
    publicationsQuery = publicationsQuery.eq("target_type", "space").eq("target_space_id", targetSpaceId);
  } else {
    return null;
  }

  const { data: publications, error: publicationError } = await publicationsQuery;
  if (publicationError || !publications?.length) return null;

  const productIds = Array.from(new Set(publications.map((row) => String(row.product_id))));
  const { data: products, error: productError } = await supabase
    .from("commerce_products")
    .select(commerceProductSelect)
    .in("id", productIds)
    .eq("status", "published");
  if (productError || !products?.length) return null;

  const productMap = new Map((products as unknown as CommerceProduct[]).map((product) => [product.id, product]));
  const ordered = publications
    .map((publication) => productMap.get(String(publication.product_id)))
    .filter((product): product is CommerceProduct => Boolean(product));
  if (!ordered.length) return null;

  return (
    <section id="merch" className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-violet-300/70">{eyebrow}</p>
          <h2 className="mt-1 text-2xl font-semibold">{title}</h2>
        </div>
        <p className="max-w-md text-right text-xs leading-5 text-white/35">Un producto canónico: el mismo precio, stock e inventario aunque aparezca en varios perfiles.</p>
      </div>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {ordered.map((product) => (
          <ProductCard key={product.id} product={product} href={`/producto/id/${product.id}`} />
        ))}
      </div>
    </section>
  );
}
