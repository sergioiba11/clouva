import Link from "next/link";
import { ExternalLink, MapPin, PackageOpen, Store } from "lucide-react";
import { PublicShell } from "@/components/public/PublicShell";
import { SpaceManageButton } from "@/components/public/SpaceManageButton";
import type { PublicSpaceIdentity, PublicSpaceProduct } from "@/lib/server/public-space-data";

function money(product: PublicSpaceProduct) {
  if (product.price === null || product.price === undefined) return null;
  const value = Number(product.price);
  if (!Number.isFinite(value)) return null;
  const currency = product.currency || "ARS";
  try {
    return new Intl.NumberFormat("es-AR", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${currency} ${value}`;
  }
}

export function SpacePublicView({ data }: { data: PublicSpaceIdentity }) {
  const { space, spot, products, canonicalAlias } = data;
  const logo = spot?.logo_url || space.logo_url;
  const cover = spot?.cover_url || space.cover_url;
  const description = spot?.description || space.description;
  const accent = spot?.accent_color || space.accent_color || "#8f5cff";
  const categories = Array.from(new Set([
    ...(spot?.business_categories ?? []),
    space.category,
    space.subcategory,
  ].filter((item): item is string => Boolean(item))));

  return (
    <PublicShell
      brand={space.name}
      brandHref={`/${canonicalAlias}`}
      accent={accent}
      navLinks={[{ label: "Inicio", href: `/${canonicalAlias}` }, { label: "Catálogo", href: `/${canonicalAlias}#catalogo` }]}
      footer={<span>{space.name} · Spot oficial en CLOUVA Matrix</span>}
    >
      <section className="relative overflow-hidden border-b border-white/[0.08]">
        {cover ? <img src={cover} alt="" className="absolute inset-0 h-full w-full object-cover opacity-20" /> : null}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_20%,var(--public-accent),transparent_32rem)] opacity-[0.16]" />
        <div className="absolute inset-0 bg-gradient-to-b from-[#07060b]/55 via-[#07060b]/85 to-[#07060b]" />

        <div className="relative mx-auto grid min-h-[560px] max-w-7xl items-center gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[0.85fr_1.15fr] lg:py-24">
          <div className="flex justify-center lg:justify-start">
            <div className="relative grid aspect-square w-full max-w-[390px] place-items-center overflow-hidden rounded-[36px] border border-white/10 bg-white/[0.025] p-8 shadow-2xl">
              <div className="absolute inset-8 rounded-full bg-[color:var(--public-accent)]/15 blur-3xl" />
              {logo ? (
                <img src={logo} alt={space.name} className="relative max-h-full max-w-full object-contain drop-shadow-2xl" />
              ) : (
                <div className="relative grid h-32 w-32 place-items-center rounded-[32px] border border-white/10 bg-white/[0.04] text-[color:var(--public-accent)]">
                  <Store size={52} />
                </div>
              )}
            </div>
          </div>

          <div className="max-w-2xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-[color:var(--public-accent)]/35 bg-[color:var(--public-accent)]/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--public-accent)]">Spot oficial</span>
              <span className="rounded-full border border-white/10 bg-white/[0.035] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/45">CLOUVA Matrix</span>
            </div>
            <h1 className="mt-5 text-5xl font-semibold tracking-[-0.055em] sm:text-7xl lg:text-8xl">{space.name}</h1>
            {description ? <p className="mt-5 max-w-xl text-base leading-7 text-white/58 sm:text-lg">{description}</p> : null}

            {categories.length ? (
              <div className="mt-6 flex flex-wrap gap-2">
                {categories.map((category) => <span key={category} className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs capitalize text-white/48">{category.replaceAll("_", " ")}</span>)}
              </div>
            ) : null}

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <a href="#catalogo" className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-semibold text-black">Ver catálogo <ExternalLink size={14} /></a>
              {spot ? <SpaceManageButton spotId={spot.id} /> : null}
            </div>

            {space.location_label ? <p className="mt-6 inline-flex items-center gap-2 text-xs text-white/35"><MapPin size={13} /> {space.location_label}</p> : null}
          </div>
        </div>
      </section>

      <section id="catalogo" className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.19em] text-[color:var(--public-accent)]">Catálogo del Spot</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-5xl">Productos públicos</h2>
            <p className="mt-3 max-w-xl text-sm leading-6 text-white/42">Este escaparate se alimenta del catálogo real del Spot. Lo que se publica desde Mi Spot aparece acá.</p>
          </div>
          {spot ? <Link href="/matrix" className="text-xs font-semibold text-white/45 transition hover:text-white">Seguir explorando la Matrix →</Link> : null}
        </div>

        {products.length ? (
          <div className="mt-9 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {products.map((product) => {
              const price = money(product);
              return (
                <article key={product.id} className="overflow-hidden rounded-[24px] border border-white/[0.08] bg-white/[0.025]">
                  <div className="aspect-square bg-black/30">
                    {product.cover_url ? <img src={product.cover_url} alt={product.name} className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-white/18"><PackageOpen size={38} /></div>}
                  </div>
                  <div className="p-4">
                    {product.product_type ? <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-white/28">{product.product_type.replaceAll("_", " ")}</p> : null}
                    <h3 className="mt-1 text-base font-semibold">{product.name}</h3>
                    {product.description ? <p className="mt-2 line-clamp-2 text-xs leading-5 text-white/40">{product.description}</p> : null}
                    <div className="mt-4 flex items-end justify-between gap-3">
                      <strong className="text-sm">{price ?? "Consultar"}</strong>
                      {typeof product.stock === "number" ? <span className="text-[10px] text-white/30">Stock {product.stock}</span> : null}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="mt-9 rounded-[28px] border border-dashed border-white/10 bg-white/[0.02] p-8 sm:p-12">
            <PackageOpen size={26} className="text-[color:var(--public-accent)]" />
            <h3 className="mt-4 text-xl font-semibold">Todavía no hay productos públicos.</h3>
            <p className="mt-2 max-w-xl text-sm leading-6 text-white/42">Cuando el equipo publique productos desde el catálogo de este Spot, aparecen automáticamente en este perfil. No mostramos stock ni productos inventados.</p>
          </div>
        )}
      </section>
    </PublicShell>
  );
}
