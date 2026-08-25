import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { MainFooter, MainNav } from "@/components/layout";
import { createAdminSupabase } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";

type RegistryRow = {
  entity_type: "PRODUCT" | "VARIANT" | "ITEM" | "USER" | "SPACE";
  entity_id: string;
  source_identifier_id: string | null;
  destination_path: string | null;
};

function safeInternalPath(value: string | null | undefined) {
  return Boolean(value?.startsWith("/") && !value.startsWith("//"));
}

function QrState({ title, detail }: { title: string; detail: string }) {
  return (
    <main className="min-h-screen bg-black text-white">
      <MainNav />
      <section className="mx-auto max-w-2xl px-4 py-20 sm:px-6">
        <div className="rounded-[2rem] border border-violet-400/25 bg-[radial-gradient(circle_at_top_right,rgba(124,58,237,.22),transparent_45%),#09070f] p-8 text-center">
          <p className="text-xs font-semibold uppercase tracking-[.24em] text-violet-300">QR CLOUVA</p>
          <h1 className="mt-4 text-3xl font-semibold">{title}</h1>
          <p className="mx-auto mt-3 max-w-lg leading-7 text-white/55">{detail}</p>
        </div>
      </section>
      <MainFooter />
    </main>
  );
}

export default async function ClouvaQrPage({ params }: { params: Promise<{ identifierId: string }> }) {
  const { identifierId: publicToken } = await params;
  const admin = createAdminSupabase();

  // The registry is the canonical resolver. Query errors are intentionally
  // tolerated so old product QR links keep working during migration rollout.
  const { data: registryData } = await admin
    .from("clouva_qr_registry")
    .select("entity_type,entity_id,source_identifier_id,destination_path")
    .eq("public_token", publicToken)
    .eq("status", "ACTIVE")
    .maybeSingle();
  const registry = registryData as RegistryRow | null;

  if (registry?.entity_type === "USER") {
    if (safeInternalPath(registry.destination_path)) redirect(registry.destination_path!);
    const { data: player } = await admin
      .from("players")
      .select("id,slug,is_published,publication_status,privacy_status")
      .eq("owner_user_id", registry.entity_id)
      .eq("is_published", true)
      .eq("publication_status", "published")
      .neq("privacy_status", "private")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!player) return <QrState title="Perfil no disponible" detail="Este QR es válido, pero su Player no está publicado en este momento." />;
    const { data: alias } = await admin
      .from("public_slug_aliases")
      .select("alias")
      .eq("entity_type", "player")
      .eq("entity_id", player.id)
      .eq("is_primary", true)
      .maybeSingle();
    redirect(`/${encodeURIComponent(alias?.alias || player.slug)}`);
  }

  if (registry?.entity_type === "SPACE") {
    if (safeInternalPath(registry.destination_path)) redirect(registry.destination_path!);
    const { data: space } = await admin
      .from("spaces")
      .select("slug,public_enabled,status,legacy_studio_id")
      .eq("id", registry.entity_id)
      .maybeSingle();
    if (!space || !space.public_enabled || space.status !== "active") {
      return <QrState title="Espacio no disponible" detail="Este QR es válido y permanente, pero el espacio no está publicado en este momento." />;
    }
    if (space.legacy_studio_id) {
      const { data: studio } = await admin.from("studios").select("slug").eq("id", space.legacy_studio_id).maybeSingle();
      if (studio?.slug) redirect(`/studios/${encodeURIComponent(studio.slug)}`);
    }
    redirect(`/spaces/${encodeURIComponent(space.slug)}`);
  }

  if (registry?.entity_type === "ITEM") {
    if (safeInternalPath(registry.destination_path)) redirect(registry.destination_path!);
    return <QrState title="Prenda CLOUVA identificada" detail="La unidad física tiene una identidad QR válida. Todavía no tiene una experiencia pública adicional asignada." />;
  }

  const identifierFields = "id,catalog_product_id,catalog_variant_id,spot_id,identifier_type,value,status,public_token,destination_type,destination_path,destination_metadata";
  const { data: registryIdentifier } = registry?.source_identifier_id
    ? await admin
        .from("commerce_product_identifiers")
        .select(identifierFields)
        .eq("id", registry.source_identifier_id)
        .eq("identifier_type", "clouva_qr")
        .eq("status", "active")
        .maybeSingle()
    : { data: null };
  const { data: tokenIdentifier } = !registryIdentifier
    ? await admin
        .from("commerce_product_identifiers")
        .select(identifierFields)
        .eq("public_token", publicToken)
        .eq("identifier_type", "clouva_qr")
        .eq("status", "active")
        .maybeSingle()
    : { data: null };
  const { data: legacyIdentifier } = !registryIdentifier && !tokenIdentifier && /^[0-9a-f-]{36}$/i.test(publicToken)
    ? await admin
        .from("commerce_product_identifiers")
        .select(identifierFields)
        .eq("id", publicToken)
        .eq("identifier_type", "clouva_qr")
        .eq("status", "active")
        .maybeSingle()
    : { data: null };
  const identifier = registryIdentifier ?? tokenIdentifier ?? legacyIdentifier;
  if (!identifier) notFound();
  if (safeInternalPath(identifier.destination_path)) redirect(identifier.destination_path!);

  const [{ data: catalog }, { data: listing }, variantResult, spotResult] = await Promise.all([
    admin.from("commerce_catalog_products").select("name,description,brand,product_kind,avatar_asset_id").eq("id", identifier.catalog_product_id).maybeSingle(),
    identifier.spot_id
      ? admin.from("commerce_products").select("name,slug,description,price,currency,status,cover_url,spot_id").eq("catalog_product_id", identifier.catalog_product_id).eq("spot_id", identifier.spot_id).eq("status", "published").limit(1).maybeSingle()
      : admin.from("commerce_products").select("name,slug,description,price,currency,status,cover_url,spot_id").eq("catalog_product_id", identifier.catalog_product_id).eq("status", "published").limit(1).maybeSingle(),
    identifier.catalog_variant_id
      ? admin.from("commerce_catalog_variants").select("title,size,color,presentation").eq("id", identifier.catalog_variant_id).maybeSingle()
      : Promise.resolve({ data: null }),
    identifier.spot_id
      ? admin.from("commerce_spots").select("studio_id,name").eq("id", identifier.spot_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (!catalog) notFound();
  const variant = variantResult.data;
  const { data: studio } = spotResult.data?.studio_id
    ? await admin.from("studios").select("slug").eq("id", spotResult.data.studio_id).maybeSingle()
    : { data: null };
  const storeUrl = listing && studio?.slug ? `/studios/${studio.slug}/tienda/${listing.slug}` : null;

  return (
    <main className="min-h-screen bg-black text-white">
      <MainNav />
      <section className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <div className="rounded-[2rem] border border-violet-400/30 bg-[radial-gradient(circle_at_top_right,rgba(124,58,237,.25),transparent_42%),#09070f] p-7 shadow-[0_30px_100px_rgba(91,33,182,.18)] sm:p-10">
          <p className="text-xs uppercase tracking-[0.24em] text-violet-300">{identifier.destination_type === "authenticity" ? "Autenticidad" : "Producto identificado"} CLOUVA · {spotResult.data?.name || "El Iglú"}</p>
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
              {storeUrl ? <Link href={storeUrl} className="mt-8 inline-block rounded-xl bg-violet-600 px-5 py-3 font-semibold">Ver producto</Link> : null}
            </div>
          </div>
        </div>
      </section>
      <MainFooter />
    </main>
  );
}
