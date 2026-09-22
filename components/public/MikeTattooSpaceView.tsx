import Link from "next/link";
import { ArrowRight, CalendarDays, ExternalLink, MapPin, PackageOpen, ScanLine, Sparkles } from "lucide-react";
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
    return currency + " " + value;
  }
}

export function MikeTattooSpaceView({ data }: { data: PublicSpaceIdentity }) {
  const { space, spot, products, canonicalAlias, ownerPlayer } = data;
  const accent = spot?.accent_color || space.accent_color || ownerPlayer?.accent_color || "#a970ff";
  const logo = spot?.logo_url || space.logo_url || ownerPlayer?.profile_image_url || null;
  const cover = spot?.cover_url || space.cover_url || null;
  const description = spot?.description || space.description;
  const categories = Array.from(new Set([
    ...(spot?.business_categories ?? []),
    space.category,
    space.subcategory,
  ].filter((item): item is string => Boolean(item))));

  return (
    <PublicShell
      brand={space.name}
      brandHref={"/" + canonicalAlias}
      accent={accent}
      navStyle="bar"
      navLinks={[
        { label: "Inicio", href: "#inicio" },
        { label: "Piezas", href: "#piezas" },
        { label: "Turnos", href: "#turnos" },
      ]}
      footer={<span>{space.name} · Tattoo Spot · CLOUVA</span>}
    >
      <section id="inicio" className="relative isolate overflow-hidden border-b border-white/[0.08]">
        {cover ? <img src={cover} alt="" className="absolute inset-0 -z-30 h-full w-full object-cover opacity-25" /> : null}
        <div className="absolute inset-0 -z-20 bg-[radial-gradient(circle_at_25%_25%,var(--public-accent),transparent_25rem)] opacity-20" />
        <div className="absolute inset-0 -z-20 bg-[linear-gradient(110deg,#050407_0%,rgba(5,4,7,.96)_46%,rgba(5,4,7,.56)_100%)]" />
        <div className="pointer-events-none absolute inset-0 -z-10 opacity-[0.07] bg-[repeating-linear-gradient(0deg,transparent_0px,transparent_5px,#fff_6px)]" />

        <div className="mx-auto grid min-h-[640px] max-w-7xl items-center gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[.8fr_1.2fr] lg:py-24">
          <div className="mx-auto w-full max-w-[390px] lg:mx-0">
            <div className="relative aspect-square overflow-hidden rounded-[38px] border border-white/10 bg-black/35 p-8">
              <div className="absolute inset-8 rounded-full bg-[color:var(--public-accent)]/15 blur-3xl" />
              {logo ? <img src={logo} alt={space.name} className="relative h-full w-full object-contain drop-shadow-2xl" /> : <div className="relative grid h-full place-items-center"><ScanLine size={72} className="text-[color:var(--public-accent)]" /></div>}
            </div>
          </div>

          <div>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full border border-[color:var(--public-accent)]/35 bg-[color:var(--public-accent)]/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-[color:var(--public-accent)]">Tattoo Spot</span>
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45">CLOUVA Matrix</span>
            </div>
            <h1 className="mt-6 max-w-4xl text-6xl font-black uppercase leading-[0.86] tracking-[-0.07em] sm:text-8xl">{space.name}</h1>
            {ownerPlayer ? <Link href={"/" + ownerPlayer.canonicalAlias} className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-[color:var(--public-accent)]">por {ownerPlayer.display_name} <ArrowRight size={14} /></Link> : null}
            {description ? <p className="mt-6 max-w-2xl text-base leading-7 text-white/58">{description}</p> : null}
            {categories.length ? <div className="mt-6 flex flex-wrap gap-2">{categories.map((category) => <span key={category} className="rounded-lg border border-white/[0.08] bg-black/30 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.11em] text-white/42">{category.replaceAll("_", " ")}</span>)}</div> : null}

            <div className="mt-8 flex flex-wrap gap-3">
              <a href="#piezas" className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-bold text-black">Ver piezas <ExternalLink size={14} /></a>
              {ownerPlayer ? <Link href={"/" + ownerPlayer.canonicalAlias + "/agenda"} className="inline-flex items-center gap-2 rounded-full border border-[color:var(--public-accent)]/45 bg-[color:var(--public-accent)]/10 px-5 py-3 text-sm font-bold text-[color:var(--public-accent)]"><CalendarDays size={15} /> Reservar turno</Link> : null}
              {spot ? <SpaceManageButton spotId={spot.id} /> : null}
            </div>

            {space.location_label ? <p className="mt-7 inline-flex items-center gap-2 text-xs text-white/35"><MapPin size={13} /> {space.location_label}</p> : null}
          </div>
        </div>
      </section>

      <section id="turnos" className="border-b border-white/[0.08] bg-white/[0.018]">
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-18">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[color:var(--public-accent)]">Flow de tatuaje</p>
          <div className="mt-4 grid gap-3 md:grid-cols-4">
            {[
              ["01", "REFERENCIA", "Idea, estilo, zona y referencias."],
              ["02", "DISEÑO", "Pieza y variantes dentro del mismo archivo."],
              ["03", "TURNO", "Agenda conectada al Player."],
              ["04", "SESIÓN", "Cobro e historial quedan en el Spot."],
            ].map(([step, title, copy]) => (
              <article key={step} className="rounded-[24px] border border-white/[0.08] bg-black/20 p-5">
                <span className="text-xs font-black text-[color:var(--public-accent)]">{step}</span>
                <h3 className="mt-7 text-lg font-black tracking-tight">{title}</h3>
                <p className="mt-2 text-xs leading-5 text-white/38">{copy}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="piezas" className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-24">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[color:var(--public-accent)]">Flash / piezas / productos</p>
            <h2 className="mt-2 text-4xl font-black uppercase tracking-[-0.045em] sm:text-6xl">Archivo disponible</h2>
          </div>
          <p className="max-w-md text-sm leading-6 text-white/38">Esta sección usa únicamente lo que el Spot publique en su catálogo real.</p>
        </div>

        {products.length ? (
          <div className="mt-9 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {products.map((product) => {
              const price = money(product);
              return (
                <article key={product.id} className="group overflow-hidden rounded-[26px] border border-white/[0.08] bg-white/[0.025]">
                  <div className="aspect-square overflow-hidden bg-black/30">
                    {product.cover_url ? <img src={product.cover_url} alt={product.name} className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.035]" /> : <div className="grid h-full place-items-center text-white/18"><PackageOpen size={38} /></div>}
                  </div>
                  <div className="p-4">
                    {product.product_type ? <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-[color:var(--public-accent)]">{product.product_type.replaceAll("_", " ")}</p> : null}
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
          <div className="mt-9 rounded-[30px] border border-dashed border-white/10 bg-white/[0.02] p-10">
            <Sparkles size={28} className="text-[color:var(--public-accent)]" />
            <h3 className="mt-4 text-xl font-semibold">El archivo público todavía está vacío.</h3>
            <p className="mt-2 max-w-xl text-sm leading-6 text-white/40">Diseños, flash, merch o productos aparecen acá solamente cuando el Spot los publica.</p>
          </div>
        )}
      </section>
    </PublicShell>
  );
}
