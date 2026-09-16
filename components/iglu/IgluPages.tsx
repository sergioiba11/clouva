import Link from "next/link";
import type { ReactNode } from "react";
import type { CommerceProduct } from "@/lib/commerce-store-data";
import type { StudioMembershipPlan, StudioPlayer, StudioService } from "@/lib/players-data";
import type { IgluSiteData } from "@/lib/iglu/site-data";

export type IgluOffer = {
  name: string;
  description: string;
  usd?: number;
  flows?: number;
  ars?: string;
  href?: string;
  badge?: string;
};

export function IgluPrice({ usd, flows, ars }: { usd?: number; flows?: number; ars?: string }) {
  if (usd == null && flows == null && !ars) return null;
  return (
    <div className="iglu-price">
      <strong>{usd != null ? `${usd} USD` : "Consultar"}{flows != null ? ` · ${flows} FLOWS` : ""}</strong>
      {ars ? <span>ARS {ars}</span> : null}
    </div>
  );
}

export function IgluHero({
  background,
  logo,
  emblem,
  kicker,
  title,
  subtitle,
  description,
  children,
  compact = false,
}: {
  background?: string;
  logo?: string;
  emblem?: string;
  kicker?: string;
  title?: string;
  subtitle?: string;
  description?: string;
  children?: ReactNode;
  compact?: boolean;
}) {
  return (
    <section className={`iglu-hero${compact ? " iglu-hero--compact" : ""}`} style={background ? { backgroundImage: `url(${background})` } : undefined}>
      <div className="iglu-hero__shade" />
      <div className="iglu-hero__content">
        {emblem ? <img className="iglu-hero__emblem" src={emblem} alt="" aria-hidden="true" /> : null}
        {logo && !title ? <img className="iglu-hero__logo" src={logo} alt="IGLÚ Records" /> : null}
        {kicker ? <p className="iglu-kicker">{kicker}</p> : null}
        {title ? <h1>{title}</h1> : null}
        {subtitle ? <p className="iglu-hero__subtitle">{subtitle}</p> : null}
        {description ? <p className="iglu-hero__description">{description}</p> : null}
        {children}
      </div>
    </section>
  );
}

export function IgluOfferGrid({ offers, ctaLabel = "Reservar sesión" }: { offers: IgluOffer[]; ctaLabel?: string }) {
  return (
    <section className="iglu-offers">
      <div className="iglu-section-heading"><span>Nuestros servicios</span><i /></div>
      <div className="iglu-card-grid">
        {offers.map((offer) => (
          <article className="iglu-card" key={offer.name}>
            {offer.badge ? <span className="iglu-card__badge">{offer.badge}</span> : null}
            <div className="iglu-card__crystal" aria-hidden="true">✦</div>
            <h2>{offer.name}</h2>
            <p>{offer.description}</p>
            <IgluPrice usd={offer.usd} flows={offer.flows} ars={offer.ars} />
            <Link className="iglu-card__cta" href={offer.href ?? "/iglu/contacto#reservar"}>{ctaLabel}<span>→</span></Link>
          </article>
        ))}
      </div>
    </section>
  );
}

export function IgluServicePage({
  data,
  kicker,
  title,
  subtitle,
  description,
  offers,
  ctaLabel,
}: {
  data: IgluSiteData;
  kicker: string;
  title: string;
  subtitle: string;
  description: string;
  offers: IgluOffer[];
  ctaLabel?: string;
}) {
  return (
    <>
      <IgluHero background={data.assets.studioHeroAlt} emblem={data.assets.emblem} kicker={kicker} title={title} subtitle={subtitle} description={description} compact />
      <IgluOfferGrid offers={offers} ctaLabel={ctaLabel} />
      <IgluTrustStrip emblem={data.assets.emblem} />
    </>
  );
}

function productImage(product: CommerceProduct) {
  if (product.cover_url) return product.cover_url;
  if (Array.isArray(product.gallery)) {
    const first = product.gallery.find((value) => typeof value === "string");
    if (typeof first === "string") return first;
  }
  return null;
}

export function IgluHome({ data }: { data: IgluSiteData }) {
  return (
    <>
      <IgluHero background={data.assets.studioHero} logo={data.assets.logo} emblem={data.assets.emblem}>
        <p className="iglu-home-tagline">SOUTHERN SOUNDS · GLOBAL REACH</p>
        <div className="iglu-portals">
          <Link href="/iglu/radio"><strong>IGLÚ RADIO</strong><span>Live sessions · hip hop · latin urban</span><b>Entrar →</b></Link>
          <Link href="/iglu/estudio"><strong>EL ESTUDIO</strong><span>Producción · grabación · mezcla · master</span><b>Entrar →</b></Link>
        </div>
      </IgluHero>

      <section className="iglu-worlds">
        <div><span>FRESH</span><p>Bebidas · ideas · buenas vibras</p></div>
        <div><span>RAPAFERNALIA</span><p>Naturaleza · creatividad · equilibrio</p></div>
        <div><span>ABRIGO</span><p>Más que ropa, una actitud</p></div>
      </section>

      <section className="iglu-products">
        <div className="iglu-section-heading"><span>Productos destacados</span><i /></div>
        {data.products.length ? (
          <div className="iglu-product-grid">
            {data.products.slice(0, 6).map((product) => (
              <Link className="iglu-product-card" href={`/producto/id/${product.id}`} key={product.id}>
                <div className="iglu-product-card__media">
                  {productImage(product) ? <img src={productImage(product)!} alt={product.name} /> : <span>IGLÚ</span>}
                </div>
                <h2>{product.name}</h2>
                <p>{Number(product.price).toLocaleString("es-AR")} {product.currency}</p>
                <span>Ver producto →</span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="iglu-empty">Los productos publicados del estudio aparecerán acá automáticamente.</div>
        )}
      </section>
      <IgluTrustStrip emblem={data.assets.emblem} />
    </>
  );
}

export function IgluStudio({ data }: { data: IgluSiteData }) {
  const serviceCards = data.services.length
    ? data.services.slice(0, 6).map((service: StudioService) => ({
        name: service.name,
        description: service.description || service.category || "Servicio profesional IGLÚ.",
        ars: service.currency === "ARS" && service.price != null ? Number(service.price).toLocaleString("es-AR") : undefined,
      }))
    : [
        { name: "Grabaciones", description: "Voces, tomas, coros y sesiones profesionales.", href: "/iglu/grabaciones" },
        { name: "Producciones", description: "Beats, mezcla, master y producción integral.", href: "/iglu/producciones" },
        { name: "Sesiones", description: "Cyphers, acústicos, performance y audiovisual.", href: "/iglu/sesiones" },
      ];
  return <IgluServicePage data={data} kicker="Estudio profesional" title="EL ESTUDIO" subtitle="CREA · GRABÁ · PRODUCÍ · LANZÁ" description="Un refugio creativo donde el frío guarda lo que el fuego crea." offers={serviceCards} ctaLabel="Conocer" />;
}

export function IgluArtists({ data }: { data: IgluSiteData }) {
  return (
    <>
      <IgluHero background={data.assets.studioHero} emblem={data.assets.emblem} kicker="Artistas /" title="PLAYER" subtitle="EXPLORA · ESCUCHA · APOYA · DESCUBRE" description="La música también habita en lugares fríos." compact />
      <section className="iglu-artists">
        <div className="iglu-section-heading"><span>Artistas del IGLÚ</span><i /></div>
        <div className="iglu-artist-grid">
          {data.players.map((entry: StudioPlayer) => {
            const player = entry.player;
            if (!player) return null;
            return (
              <Link href={`/${player.slug}`} className="iglu-artist-card" key={player.id}>
                <div className="iglu-artist-card__media">
                  {player.profile_image_url ? <img src={player.profile_image_url} alt={player.display_name} /> : data.assets.emblem ? <img src={data.assets.emblem} alt="" aria-hidden="true" /> : <span>IGLÚ</span>}
                </div>
                <h2>{player.display_name}</h2>
                <p>{entry.role || player.primary_role || "Player"}</p>
                <b>Ver Player →</b>
              </Link>
            );
          })}
          <Link href="/iglu/contacto#demo" className="iglu-artist-card iglu-artist-card--demo">
            <div className="iglu-artist-card__media">＋</div><h2>Demo abierta</h2><p>Tu música también puede llegar lejos.</p><b>Enviar demo →</b>
          </Link>
        </div>
      </section>
      <IgluTrustStrip emblem={data.assets.emblem} />
    </>
  );
}

export function IgluMemberships({ data, fallback }: { data: IgluSiteData; fallback: IgluOffer[] }) {
  const realPlans = data.membershipPlans.filter((plan: StudioMembershipPlan) => plan.is_public && plan.is_active && !plan.is_free);
  const offers = realPlans.length >= 3
    ? realPlans.map((plan) => ({
        name: plan.name,
        description: plan.description || (plan.benefits ?? []).slice(0, 2).join(" · ") || "Membresía IGLÚ.",
        ars: plan.currency === "ARS" && plan.price != null ? Number(plan.price).toLocaleString("es-AR") : undefined,
        badge: plan.display_badge || undefined,
      }))
    : fallback;
  return <IgluServicePage data={data} kicker="Un mismo norte" title="MEMBRESÍAS" subtitle="DISTINTOS CAMINOS" description="Accedé a herramientas, beneficios y una comunidad global. Elegí la membresía que potencie tu música." offers={offers} ctaLabel="Comenzar ahora" />;
}

export function IgluAbout({ data }: { data: IgluSiteData }) {
  const pillars = [
    ["MÚSICA", "Creamos, grabamos y amplificamos talento que trasciende."],
    ["CULTURA", "Promovemos nuestras raíces, sonidos e historias del sur al mundo."],
    ["FAMILIA", "Artistas, equipo y comunidad creciendo en un mismo lugar."],
    ["DEL SUR", "Nuestra identidad nace en la naturaleza, la autenticidad y la resiliencia."],
    ["GLOBAL REACH", "Llevamos la música del sur a cada rincón del mundo."],
  ];
  return (
    <>
      <IgluHero background={data.assets.studioHeroAlt} emblem={data.assets.emblem} kicker="Nosotros" title="IGLÚ RECORDS" subtitle="MÚSICA QUE CONECTA EL SUR CON EL MUNDO" description="Más que un sello: estudio, cultura, artistas, sesiones y comunidad dentro de un mismo refugio creativo." compact />
      <section className="iglu-pillars">
        <div className="iglu-section-heading"><span>Nuestros pilares</span><i /></div>
        <div className="iglu-card-grid iglu-card-grid--pillars">
          {pillars.map(([title, copy]) => <article className="iglu-card" key={title}><h2>{title}</h2><p>{copy}</p></article>)}
        </div>
      </section>
      <section className="iglu-do-grid">
        {[["ESTUDIO", "/iglu/estudio"], ["RADIO", "/iglu/radio"], ["SESIONES", "/iglu/sesiones"], ["MARKET", "/iglu"], ["COMUNIDAD", "/iglu/artistas"]].map(([label, href]) => <Link href={href} key={label}>{label}<span>→</span></Link>)}
      </section>
      <IgluTrustStrip emblem={data.assets.emblem} />
    </>
  );
}

export function IgluContact({ data }: { data: IgluSiteData }) {
  const email = data.studio.contact_email || "info@iglurecords.com";
  return (
    <>
      <IgluHero background={data.assets.studioHero} emblem={data.assets.emblem} kicker="Conectemos" title="CONTACTO" subtitle="IDEAS · MÚSICA · PERSONAS · SIN FRONTERAS" compact />
      <section className="iglu-contact" id="reservar">
        <form className="iglu-contact-form" action={`mailto:${email}`} method="post" encType="text/plain">
          <p className="iglu-kicker">Envíanos un mensaje</p>
          <h2>Contanos sobre tu proyecto</h2>
          <label>Nombre completo<input name="nombre" autoComplete="name" required /></label>
          <label>Email<input name="email" type="email" autoComplete="email" required /></label>
          <label>Asunto<select name="asunto" defaultValue="Reserva de sesión"><option>Reserva de sesión</option><option>Producción / beat</option><option>Enviar demo</option><option>Membresías</option><option>Otro</option></select></label>
          <label>Mensaje<textarea name="mensaje" rows={5} required /></label>
          <button type="submit">Enviar mensaje <span>→</span></button>
        </form>
        <div className="iglu-contact-actions">
          <Link href="/iglu/grabaciones"><strong>Reservar sesión</strong><span>Grabá en IGLÚ</span></Link>
          <Link href="/iglu/producciones"><strong>Consultar beats</strong><span>Licencias y producción</span></Link>
          <a id="demo" href={`mailto:${email}?subject=Demo%20para%20IGL%C3%9A%20Records`}><strong>Enviar demo</strong><span>Compartí tu música</span></a>
          <a href={`mailto:${email}`}><strong>Email directo</strong><span>{email}</span></a>
          <Link href="/iglu/estudio"><strong>Visitar el estudio</strong><span>Buenos Aires, Argentina</span></Link>
        </div>
      </section>
      <IgluTrustStrip emblem={data.assets.emblem} />
    </>
  );
}

export function IgluTrustStrip({ emblem }: { emblem?: string }) {
  return (
    <section className="iglu-trust-strip">
      <span>◇ Calidad premium</span>
      <span>◫ Ingenieros profesionales</span>
      <span>◎ Estudio de primer nivel</span>
      <span>∞ Música sin fronteras</span>
      {emblem ? <img src={emblem} alt="" aria-hidden="true" /> : null}
    </section>
  );
}
