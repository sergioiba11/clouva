import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CommerceFlowQrPaymentCard } from "@/components/flows/CommerceFlowQrPaymentCard";
import { FlowQrPaymentCard } from "@/components/flows/FlowQrPaymentCard";
import { MainFooter, MainNav } from "@/components/layout";
import { createAdminSupabase } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";

type RegistryRow = {
  entity_type: "PRODUCT" | "VARIANT" | "ITEM" | "USER" | "SPACE";
  entity_id: string;
  source_identifier_id: string | null;
  destination_path: string | null;
  status: string;
  is_canonical: boolean;
  revoked_at: string | null;
  metadata: Record<string, unknown> | null;
};

function safeInternalPath(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return false;
  if (value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value)) return false;
  try {
    const parsed = new URL(value, "https://clouva.internal");
    return parsed.origin === "https://clouva.internal" && parsed.pathname.startsWith("/");
  } catch {
    return false;
  }
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

  const { data: registryData, error: registryError } = await admin
    .from("clouva_qr_registry")
    .select("entity_type,entity_id,source_identifier_id,destination_path,status,is_canonical,revoked_at,metadata")
    .eq("public_token", publicToken)
    .maybeSingle();
  if (registryError) throw new Error(registryError.message);
  const registry = registryData as RegistryRow | null;

  if (registry && (registry.status !== "ACTIVE" || !registry.is_canonical || registry.revoked_at)) {
    return <QrState title="QR no disponible" detail="Este código CLOUVA fue revocado o dejó de ser el identificador canónico del destino." />;
  }

  if (registry?.entity_type === "USER") {
    const { data: player } = await admin
      .from("players")
      .select("id,slug,username,display_name,profile_image_url,is_published,publication_status,privacy_status")
      .eq("owner_user_id", registry.entity_id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!player) {
      return <QrState title="Player no disponible" detail="Este QR es válido, pero todavía no tiene un Player receptor asociado." />;
    }

    const isPublic = player.is_published && player.publication_status === "published" && player.privacy_status !== "private";
    let profileHref: string | null = null;
    if (isPublic && safeInternalPath(registry.destination_path)) profileHref = registry.destination_path;
    if (!profileHref && isPublic) {
      const { data: alias } = await admin
        .from("public_slug_aliases")
        .select("alias")
        .eq("entity_type", "player")
        .eq("entity_id", player.id)
        .eq("is_primary", true)
        .maybeSingle();
      profileHref = `/${encodeURIComponent(alias?.alias || player.slug)}`;
    }

    const publicLabel = isPublic ? player.display_name || (player.username ? `@${player.username}` : player.slug) : "Player CLOUVA";

    return (
      <main className="min-h-screen bg-black text-white">
        <MainNav />
        <section className="mx-auto max-w-2xl px-4 py-12 sm:px-6 sm:py-16">
          <FlowQrPaymentCard
            publicToken={publicToken}
            recipientLabel={publicLabel}
            profileHref={profileHref}
            profileImageUrl={isPublic ? player.profile_image_url : null}
          />
        </section>
        <MainFooter />
      </main>
    );
  }

  if (registry?.entity_type === "SPACE") {
    const { data: space } = await admin
      .from("spaces")
      .select("slug,public_enabled,status,legacy_studio_id")
      .eq("id", registry.entity_id)
      .maybeSingle();
    if (!space || !space.public_enabled || space.status !== "active") {
      return <QrState title="Espacio no disponible" detail="Este QR es válido y permanente, pero el espacio no está publicado en este momento." />;
    }
    if (safeInternalPath(registry.destination_path)) redirect(registry.destination_path!);
    if (space.legacy_studio_id) {
      const { data: studio } = await admin.from("studios").select("slug").eq("id", space.legacy_studio_id).maybeSingle();
      if (studio?.slug) redirect(`/studios/${encodeURIComponent(studio.slug)}`);
    }
    redirect(`/spaces/${encodeURIComponent(space.slug)}`);
  }

  if (registry?.entity_type === "ITEM") {
    const publicDestination = registry.metadata?.public_destination === true;
    if (publicDestination && safeInternalPath(registry.destination_path)) redirect(registry.destination_path!);
    return <QrState title="Prenda CLOUVA identificada" detail="La unidad física tiene una identidad QR válida. Su información privada no se expone desde el resolver público." />;
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

  const { data: tokenIdentifier } = !registry && !registryIdentifier
    ? await admin
        .from("commerce_product_identifiers")
        .select(identifierFields)
        .eq("public_token", publicToken)
        .eq("identifier_type", "clouva_qr")
        .eq("status", "active")
        .maybeSingle()
    : { data: null };
  const { data: legacyIdentifier } = !registry && !registryIdentifier && !tokenIdentifier && /^[0-9a-f-]{36}$/i.test(publicToken)
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

  const [{ data: catalog }, { data: listing }, variantResult] = await Promise.all([
    admin.from("commerce_catalog_products").select("name,description,brand,product_kind,avatar_asset_id").eq("id", identifier.catalog_product_id).maybeSingle(),
    identifier.spot_id
      ? admin.from("commerce_products").select("id,name,slug,description,price,currency,status,cover_url,stock,spot_id,catalog_product_id").eq("catalog_product_id", identifier.catalog_product_id).eq("spot_id", identifier.spot_id).eq("status", "published").limit(1).maybeSingle()
      : admin.from("commerce_products").select("id,name,slug,description,price,currency,status,cover_url,stock,spot_id,catalog_product_id").eq("catalog_product_id", identifier.catalog_product_id).eq("status", "published").limit(1).maybeSingle(),
    identifier.catalog_variant_id
      ? admin.from("commerce_catalog_variants").select("title,size,color,presentation").eq("id", identifier.catalog_variant_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (!catalog || !listing || !listing.spot_id) {
    return <QrState title="Producto no disponible" detail="El código es válido, pero la publicación asociada no está disponible públicamente en este momento." />;
  }

  const [{ data: spot }, { data: saleVariant }, { data: fxRate }] = await Promise.all([
    admin.from("commerce_spots").select("id,studio_id,name,status,public_enabled,currency").eq("id", listing.spot_id).maybeSingle(),
    identifier.catalog_variant_id
      ? admin.from("commerce_product_variants").select("id,catalog_variant_id,price_override,stock,active").eq("product_id", listing.id).eq("catalog_variant_id", identifier.catalog_variant_id).eq("active", true).maybeSingle()
      : Promise.resolve({ data: null }),
    admin.from("commerce_fx_rates")
      .select("id,local_currency,quote_currency,local_per_quote,quoted_at")
      .eq("spot_id", listing.spot_id)
      .eq("local_currency", listing.currency)
      .eq("quote_currency", "USD")
      .order("quoted_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (!spot || spot.status !== "active" || !spot.public_enabled) {
    return <QrState title="Spot no disponible" detail="El producto existe, pero su Spot no está publicado para compras en este momento." />;
  }
  if (registry?.entity_type === "VARIANT" && identifier.catalog_variant_id && !saleVariant) {
    return <QrState title="Variante no disponible" detail="El QR es válido, pero esa variante ya no está disponible para compra." />;
  }

  const variant = variantResult.data;
  const { data: studio } = spot.studio_id
    ? await admin.from("studios").select("slug").eq("id", spot.studio_id).maybeSingle()
    : { data: null };
  const storeUrl = studio?.slug ? `/studios/${encodeURIComponent(studio.slug)}/tienda/${encodeURIComponent(listing.slug)}` : null;
  const customDestination = registry?.destination_path || identifier.destination_path;
  const productHref = safeInternalPath(customDestination) ? customDestination : storeUrl;
  const unitPrice = Number(saleVariant?.price_override ?? listing.price);
  const localPerQuote = Number(fxRate?.local_per_quote ?? 0);

  return (
    <main className="min-h-screen bg-black text-white">
      <MainNav />
      <section className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <div className="rounded-[2rem] border border-violet-400/30 bg-[radial-gradient(circle_at_top_right,rgba(124,58,237,.25),transparent_42%),#09070f] p-7 shadow-[0_30px_100px_rgba(91,33,182,.18)] sm:p-10">
          <p className="text-xs uppercase tracking-[0.24em] text-violet-300">{identifier.destination_type === "authenticity" ? "Autenticidad" : "Producto identificado"} CLOUVA · {spot.name}</p>
          <div className="mt-6 grid gap-8 sm:grid-cols-[160px_1fr]">
            {listing.cover_url ? <img src={listing.cover_url} alt={catalog.name} className="aspect-square w-full rounded-3xl object-cover" /> : <div className="aspect-square rounded-3xl border border-white/10 bg-white/5" />}
            <div>
              <h1 className="text-3xl font-semibold">{catalog.name}</h1>
              <p className="mt-2 text-white/55">{[catalog.brand, variant?.color, variant?.size, variant?.presentation].filter(Boolean).join(" · ")}</p>
              <p className="mt-5 leading-7 text-white/65">{catalog.description || listing.description || "Producto identificado dentro del catálogo CLOUVA."}</p>
              <div className="mt-6 flex flex-wrap gap-2 text-xs">
                <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-emerald-200">Código válido</span>
                {catalog.avatar_asset_id ? <span className="rounded-full border border-violet-400/25 bg-violet-400/10 px-3 py-1 text-violet-200">Experiencia 3D vinculada</span> : null}
              </div>
            </div>
          </div>

          {fxRate && Number.isFinite(unitPrice) && unitPrice > 0 && localPerQuote > 0 ? (
            <CommerceFlowQrPaymentCard
              publicToken={publicToken}
              listingId={listing.id}
              variantId={saleVariant?.id ?? null}
              productName={catalog.name}
              recipientLabel={spot.name}
              unitPrice={unitPrice}
              currency={listing.currency}
              fxRateId={fxRate.id}
              localPerQuote={localPerQuote}
              imageUrl={listing.cover_url}
              productHref={productHref}
            />
          ) : (
            <div className="mt-6 rounded-2xl border border-amber-300/15 bg-amber-300/[.06] p-4 text-sm text-amber-100/75">
              El producto está publicado, pero todavía no tiene una cotización USD vigente para liquidar el pago con FLOW.
              {productHref ? <Link href={productHref} className="mt-3 block font-semibold text-amber-50">Ver publicación</Link> : null}
            </div>
          )}
        </div>
      </section>
      <MainFooter />
    </main>
  );
}
