import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
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
  image?: string;
  icon?: string;
};

type HeroAlign = "center" | "left";

type ServiceScene = {
  scene: string;
  background?: string;
  align: HeroAlign;
  sectionLabel: string;
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
  align = "center",
  scene = "default",
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
  align?: HeroAlign;
  scene?: string;
}) {
  const style = background ? ({ "--iglu-hero-bg": `url(${background})` } as CSSProperties) : undefined;
  return (
    <section className={`iglu-hero iglu-hero--${scene}${compact ? " iglu-hero--compact" : ""}${align === "left" ? " iglu-hero--left" : ""}`} style={style}>
      <div className="iglu-hero__atmosphere" />
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

export function IgluOfferGrid({
  offers,
  ctaLabel = "Reservar sesión",
  iconUrl,
  sectionLabel = "Nuestros servicios",
}: {
  offers: IgluOffer[];
  ctaLabel?: string;
  iconUrl?: string;
  sectionLabel?: string;
}) {
  return (
    <section className="iglu-offers">
      <div className="iglu-section-heading"><i /><span>{sectionLabel}</span><i /></div>
      <div className="iglu-card-grid">
        {offers.map((offer) => (
          <article className="iglu-card" key={offer.name}>
            {offer.badge ? <span className="iglu-card__badge">{offer.badge}</span> : null}
            {offer.image ? (
              <div className="iglu-card__media"><img src={offer.image} alt="" aria-hidden="true" /></div>
            ) : offer.icon || iconUrl ? (
              <div className="iglu-card__asset"><img src={offer.icon ?? iconUrl} alt="" aria-hidden="true" /></div>
            ) : (
              <span className="iglu-card__mark" aria-hidden="true" />
            )}
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

function serviceScene(data: IgluSiteData, title: string): ServiceScene {
  switch (title) {
    case "EL ESTUDIO":
      return { scene: "studio", background: data.assets.studioHero, align: "left", sectionLabel: "Servicios del estudio" };
    case "GRABACIONES":
      return { scene: "recordings", background: data.assets.recordingsScene, align: "left", sectionLabel: "Grabá en IGLÚ" };
    case "PRODUCCIONES":
      return { scene: "productions", background: data.assets.productionsScene, align: "left", sectionLabel: "Nuestros servicios" };
    case "PRODUCTORES":
      return { scene: "producers", background: data.assets.producersScene, align: "left", sectionLabel: "Nuestros productores" };
    case "SESIONES":
      return { scene: "sessions", background: data.assets.sessionsScene, align: "left", sectionLabel: "Nuestras sesiones" };
    case "MEMBRESÍAS":
      return { scene: "memberships", background: data.assets.membershipsScene, align: "center", sectionLabel: "Elegí tu camino" };
    case "PAGOS ÚNICOS":
      return { scene: "payments", background: data.assets.paymentsScene, align: "left", sectionLabel: "Elegí tu servicio" };
    default:
      return { scene: "default", background: data.assets.studioHeroAlt, align: "left", sectionLabel: "Nuestros servicios" };
  }
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
  const scene = serviceScene(data, title);
  const heroCta = title === "PRODUCCIONES" ? "Pedir producción" : title === "PRODUCTORES" ? "Conocer productores" : title === "PAGOS ÚNICOS" ? "Ver servicios" : "Reservar sesión";
  const heroHref = title === "PRODUCTORES" ? "#iglu-services" : "/iglu/contacto#reservar";

  return (
    <>
      <IgluHero background={scene.background} emblem={data.assets.emblem} kicker={kicker} title={title} subtitle={subtitle} description={description} compact align={scene.align} scene={scene.scene}>
        <div className="iglu-hero__actions">
          <Link className="iglu-primary-cta" href={heroHref}>
            {data.assets.snowflake ? <img src={data.assets.snowflake} alt="" aria-hidden="true" /> : null}
            <span>{heroCta}</span><b>→</b>
          </Link>
        </div>
      </IgluHero>
      <div id="iglu-services">
        <IgluOfferGrid offers={offers} ctaLabel={ctaLabel} iconUrl={data.assets.snowflake ?? data.assets.emblem} sectionLabel={scene.sectionLabel} />
      </div>
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
  const homeStyle = data.assets.homeScene ? ({ "--iglu-home-bg": `url(${data.assets.homeScene})` } as CSSProperties) : undefined;

  return (
    <>
      <section className="iglu-home-hero" style={homeStyle}>
        <div className="iglu-home-hero__atmosphere" />
        <div className="iglu-home-hero__vignette" />

        <div className="iglu-home-brand">
          {data.assets.emblem ? <img className="iglu-home-brand__emblem" src={data.assets.emblem} alt="" aria-hidden="true" /> : null}
          {data.assets.logo ? <img className="iglu-home-brand__logo" src={data.assets.logo} alt="IGLÚ Records" /> : <h1>IGLÚ RECORDS</h1>}
          <p>SOUTHERN SOUNDS · GLOBAL REACH</p>
        </div>

        <div className="iglu-home-worlds iglu-home-worlds--left">
          <article className="iglu-home-world iglu-home-world--fresh">
            {data.assets.snowflake ? <img src={data.assets.snowflake} alt="" aria-hidden="true" /> : null}
            <div><strong>FRESH</strong><span>Bebidas · ideas · buenas vibras</span></div>
          </article>
          <article className="iglu-home-world iglu-home-world--rapa">
            <div><strong>RAPAFERNALIA</strong><span>Naturaleza · creatividad · equilibrio</span></div>
          </article>
        </div>

        <div className="iglu-home-core">
          {data.assets.igloo ? <img src={data.assets.igloo} alt="" aria-hidden="true" /> : data.assets.emblem ? <img src={data.assets.emblem} alt="" aria-hidden="true" /> : null}
          <p>MÚSICA<br />ARTE<br />NATURALEZA<br />COMUNIDAD</p>
        </div>

        <div className="iglu-home-worlds iglu-home-worlds--right">
          <article className="iglu-home-world iglu-home-world--abrigo">
            {data.assets.emblem ? <img src={data.assets.emblem} alt="" aria-hidden="true" /> : null}
            <div><strong>ABRIGO</strong><span>Más que ropa · una actitud</span></div>
          </article>
        </div>

        <div className="iglu-home-portals">
          <Link href="/iglu/radio" className="iglu-home-portal">
            {data.assets.emblem ? <img src={data.assets.emblem} alt="" aria-hidden="true" /> : null}
            <strong>IGLÚ RADIO</strong>
            <span>Live sessions · hip hop · latin urban</span>
            <b>Entrar →</b>
          </Link>
          <Link href="/iglu/estudio" className="iglu-home-portal">
            {data.assets.igloo ? <img src={data.assets.igloo} alt="" aria-hidden="true" /> : null}
            <strong>EL ESTUDIO</strong>
            <span>Producción · grabación · mezcla · master</span>
            <b>Entrar →</b>
          </Link>
        </div>
      </section>

      <section className="iglu-products">
        <div className="iglu-section-heading"><i /><span>Productos destacados</span><i /></div>
        <p className="iglu-section-copy">Equipate · consumí · creá · sé parte.</p>
        {data.products.length ? (
          <div className="iglu-product-grid">
            {data.products.slice(0, 5).map((product) => (
              <Link className="iglu-product-card" href={`/producto/id/${product.id}`} key={product.id}>
                <div className="iglu-product-card__media">
                  {productImage(product) ? <img src={productImage(product)!} alt={product.name} /> : data.assets.emblem ? <img className="iglu-product-card__fallback" src={data.assets.emblem} alt="" aria-hidden="true" /> : <span>IGLÚ</span>}
                </div>
                <div className="iglu-product-card__body">
                  <h2>{product.name}</h2>
                  <p>{Number(product.price).toLocaleString("es-AR")} {product.currency}</p>
                  <span>Ver producto →</span>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="iglu-empty">Los productos publicados del estudio aparecen acá automáticamente.</div>
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
        image: service.image_url || undefined,
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
      <IgluHero background={data.assets.artistsScene} emblem={data.assets.emblem} kicker="Artistas /" title="PLAYER" subtitle="EXPLORA · ESCUCHA · APOYA · DESCUBRE" description="La música también habita en lugares fríos." compact scene="artists" />

      {data.assets.albumDelSur ? (
        <section className="iglu-featured-release">
          <div className="iglu-featured-release__cover"><img src={data.assets.albumDelSur} alt="DEL SUR — IGLÚ Records" /></div>
          <div className="iglu-featured-release__copy">
            <p className="iglu-kicker">Archivo IGLÚ</p>
            <h2>DEL SUR</h2>
            <p>Una pieza de la identidad visual y musical del IGLÚ, conectada al universo editorial del sello.</p>
            <Link href="/iglu/radio">Entrar a IGLÚ Radio →</Link>
          </div>
          {data.assets.emblem ? <img className="iglu-featured-release__emblem" src={data.assets.emblem} alt="" aria-hidden="true" /> : null}
        </section>
      ) : null}

      <section className="iglu-artists">
        <div className="iglu-section-heading"><i /><span>Artistas del IGLÚ</span><i /></div>
        <div className="iglu-artist-grid">
          {data.players.map((entry: StudioPlayer) => {
            const player = entry.player;
            if (!player) return null;
            return (
              <Link href={`/${player.slug}`} className="iglu-artist-card" key={player.id}>
                <div className="iglu-artist-card__media">
                  {player.profile_image_url ? <img src={player.profile_image_url} alt={player.display_name} /> : data.assets.emblem ? <img className="iglu-artist-card__fallback" src={data.assets.emblem} alt="" aria-hidden="true" /> : <span>IGLÚ</span>}
                </div>
                <h2>{player.display_name}</h2>
                <p>{entry.role || player.primary_role || "Player"}</p>
                <b>Ver Player →</b>
              </Link>
            );
          })}
          <Link href="/iglu/contacto#demo" className="iglu-artist-card iglu-artist-card--demo">
            <div className="iglu-artist-card__media">
              {data.assets.snowflake ? <img className="iglu-artist-card__fallback" src={data.assets.snowflake} alt="" aria-hidden="true" /> : null}
            </div>
            <h2>Demo abierta</h2><p>Tu música también puede llegar lejos.</p><b>Enviar demo →</b>
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
      <IgluHero background={data.assets.aboutScene} emblem={data.assets.emblem} kicker="Nosotros" title="NOSOTROS" subtitle="MÚSICA QUE CONECTA EL SUR CON EL MUNDO" description="Más que un sello: estudio, cultura, artistas, sesiones y comunidad dentro de un mismo refugio creativo." compact align="left" scene="about" />
      <section className="iglu-pillars">
        <div className="iglu-section-heading"><i /><span>Nuestros pilares</span><i /></div>
        <div className="iglu-card-grid iglu-card-grid--pillars">
          {pillars.map(([title, copy], index) => (
            <article className="iglu-card iglu-pillar-card" key={title}>
              {index === 3 && data.assets.emblem ? <div className="iglu-card__asset"><img src={data.assets.emblem} alt="" aria-hidden="true" /></div> : index === 2 && data.assets.igloo ? <div className="iglu-card__asset"><img src={data.assets.igloo} alt="" aria-hidden="true" /></div> : data.assets.snowflake ? <div className="iglu-card__asset"><img src={data.assets.snowflake} alt="" aria-hidden="true" /></div> : null}
              <h2>{title}</h2><p>{copy}</p>
            </article>
          ))}
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
  const email = data.studio.contact_email || null;
  return (
    <>
      <IgluHero background={data.assets.contactScene} emblem={data.assets.emblem} kicker="Conectemos" title="CONTACTO" subtitle="IDEAS · MÚSICA · PERSONAS · SIN FRONTERAS" compact scene="contact" />
      <section className="iglu-contact" id="reservar">
        <form className="iglu-contact-form" action={email ? `mailto:${email}` : undefined} method={email ? "post" : undefined} encType={email ? "text/plain" : undefined}>
          <p className="iglu-kicker">Envíanos un mensaje</p>
          <h2>Contanos sobre tu proyecto</h2>
          <label>Nombre completo<input name="nombre" autoComplete="name" required /></label>
          <label>Email<input name="email" type="email" autoComplete="email" required /></label>
          <label>Asunto<select name="asunto" defaultValue="Reserva de sesión"><option>Reserva de sesión</option><option>Producción / beat</option><option>Enviar demo</option><option>Membresías</option><option>Otro</option></select></label>
          <label>Mensaje<textarea name="mensaje" rows={5} required /></label>
          <button type="submit" disabled={!email}>Enviar mensaje <span>→</span></button>
          {!email ? <p className="iglu-contact-form__note">El canal de email se habilita desde la configuración pública del Studio.</p> : null}
        </form>
        <div className="iglu-contact-actions">
          <Link href="/iglu/grabaciones"><strong>Reservar sesión</strong><span>Grabá en IGLÚ</span></Link>
          <Link href="/iglu/producciones"><strong>Consultar beats</strong><span>Licencias y producción</span></Link>
          {email ? <a id="demo" href={`mailto:${email}?subject=Demo%20para%20IGL%C3%9A%20Records`}><strong>Enviar demo</strong><span>Compartí tu música</span></a> : <Link id="demo" href="/iglu/artistas"><strong>Demo abierta</strong><span>Conocé el Player IGLÚ</span></Link>}
          {email ? <a href={`mailto:${email}`}><strong>Email directo</strong><span>{email}</span></a> : <Link href="/iglu/radio"><strong>IGLÚ Radio</strong><span>Entrá a la señal</span></Link>}
          <Link href="/iglu/estudio"><strong>Visitar el estudio</strong><span>Conocé el espacio IGLÚ</span></Link>
        </div>
      </section>
      <IgluTrustStrip emblem={data.assets.emblem} />
    </>
  );
}

export function IgluTrustStrip({ emblem }: { emblem?: string }) {
  return (
    <section className="iglu-trust-strip">
      <span><b>CALIDAD PREMIUM</b><small>Sonido sin fronteras</small></span>
      <span><b>INGENIEROS PROFESIONALES</b><small>Experiencia en cada detalle</small></span>
      <span><b>ESTUDIO DE PRIMER NIVEL</b><small>Tecnología y creatividad</small></span>
      <span><b>COMUNIDAD IGLÚ</b><small>Música · cultura · familia</small></span>
      {emblem ? <img src={emblem} alt="" aria-hidden="true" /> : null}
    </section>
  );
}
