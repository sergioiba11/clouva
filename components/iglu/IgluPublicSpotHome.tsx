import Link from "next/link";
import { Menu, Search, ShoppingCart, UserRound } from "lucide-react";
import type { IgluSiteData } from "@/lib/iglu/site-data";
import { IGLU_STUDIO_PATH } from "@/lib/iglu-radio/routes";
import styles from "./IgluPublicSpotHome.module.css";

const PACK_ROOT =
  "https://storage.googleapis.com/clouva-generated-media/admin-assets/brand/clouva-logo/shared/other";

const LATEST_IGLU_ASSETS = {
  logo: `${PACK_ROOT}/02_logo_iglu_records_neon_hielo.png`,
  background: `${PACK_ROOT}/06_background_base_musical_iglu.png`,
  players: `${PACK_ROOT}/04_card_players_iglu_records.png`,
  reservations: `${PACK_ROOT}/05_card_reservas_iglu_records.png`,
  merch: `${PACK_ROOT}/03_banner_merch_iglu_records.png`,
  bottomNav: `${PACK_ROOT}/07_barra_navegacion_neon.png`,
} as const;

export function IgluPublicSpotHome({ data }: { data: IgluSiteData }) {
  const agendaHref = `${IGLU_STUDIO_PATH}/agenda`;
  const radioHref = `${IGLU_STUDIO_PATH}/radio`;
  const merchHref = `${IGLU_STUDIO_PATH}/tienda`;

  return (
    <div className={styles.viewport}>
      <main className={styles.app} aria-label="IGLÚ Records">
        <div
          className={styles.heroBackground}
          style={{ backgroundImage: `url("${LATEST_IGLU_ASSETS.background}")` }}
          aria-hidden="true"
        />
        <div className={styles.heroShade} aria-hidden="true" />

        <header className={styles.topBar}>
          <details className={styles.menu}>
            <summary aria-label="Abrir menú de IGLÚ">
              <Menu aria-hidden="true" />
            </summary>
            <nav className={styles.menuPanel} aria-label="Menú IGLÚ">
              <Link href="/iglu/artistas">Players</Link>
              <Link href={agendaHref}>Reservas</Link>
              <Link href={merchHref}>Merch</Link>
              <Link href="/iglu/pagos-unicos">Carta/Menu</Link>
              <Link href="/iglu/sesiones">Sesiones</Link>
              <Link href="/profile">Perfil</Link>
            </nav>
          </details>

          <div className={styles.topActions}>
            <Link href={`${radioHref}/search`} aria-label="Buscar">
              <Search aria-hidden="true" />
            </Link>
            <Link href="/carrito" aria-label="Carrito">
              <ShoppingCart aria-hidden="true" />
            </Link>
            <Link href="/profile" aria-label="Perfil">
              <UserRound aria-hidden="true" />
            </Link>
          </div>
        </header>

        <div className={styles.brand}>
          <img src={LATEST_IGLU_ASSETS.logo} alt="El Iglú — IGLÚ Records en CLOUVA" />
        </div>

        <section className={styles.heroCopy}>
          <h1>El Iglú</h1>
          <p className="sr-only">{data.studio.description || data.studio.tagline || "El Iglú Records es un sello, estudio y espacio musical dentro de CLOUVA."}</p>
          <div className={styles.heroActions}>
            <Link href={agendaHref} className={styles.reserveButton}>
              <span>RESERVAR SESIÓN</span>
              <span aria-hidden="true">→</span>
            </Link>
            <Link href={radioHref} className={styles.playButton} aria-label="Entrar a IGLÚ Radio">
              <span aria-hidden="true">▶</span>
            </Link>
          </div>
        </section>

        <section className={styles.cards} aria-label="Accesos públicos de IGLÚ">
          <div className={styles.cardRow}>
            <Link href="/iglu/artistas" className={styles.assetCard} aria-label="Players">
              <img src={LATEST_IGLU_ASSETS.players} alt="Players" />
            </Link>
            <Link href={agendaHref} className={styles.assetCard} aria-label="Reservas">
              <img src={LATEST_IGLU_ASSETS.reservations} alt="Reservas" />
            </Link>
          </div>

          <Link href={merchHref} className={styles.merchCard} aria-label="Merch">
            <img src={LATEST_IGLU_ASSETS.merch} alt="Merch" />
          </Link>
        </section>

        <nav className={styles.bottomNav} aria-label="Navegación principal de IGLÚ">
          <img src={LATEST_IGLU_ASSETS.bottomNav} alt="" />
          <Link className={styles.navHome} href={IGLU_STUDIO_PATH} aria-label="Inicio" />
          <Link className={styles.navMenu} href="/iglu/pagos-unicos" aria-label="Carta y menú" />
          <Link className={styles.navRadio} href={radioHref} aria-label="IGLÚ Radio" />
          <Link className={styles.navSessions} href="/iglu/sesiones" aria-label="Sesiones" />
          <Link className={styles.navProfile} href="/profile" aria-label="Perfil" />
        </nav>
      </main>

      <section className={styles.entityFacts} aria-labelledby="iglu-entity-title">
        <p className={styles.entityEyebrow}>Identidad pública</p>
        <h2 id="iglu-entity-title">El Iglú Records</h2>
        <p className={styles.entityLead}>
          El Iglú Records es un sello, estudio y espacio musical dentro de CLOUVA. Reúne grabación,
          producción, artistas, sesiones, servicios publicados e IGLÚ Radio en una misma identidad.
        </p>

        <div className={styles.entityGrid}>
          <article>
            <h3>¿Qué es El Iglú Records?</h3>
            <p>Es la entidad musical de El Iglú dentro de CLOUVA, con estudio, sello, artistas, sesiones y radio.</p>
          </article>
          <article>
            <h3>¿Qué servicios reúne?</h3>
            <p>Grabación, producción, mezcla, master, sesiones y los servicios que el Studio publica en CLOUVA.</p>
          </article>
          <article>
            <h3>¿Cómo se identifica?</h3>
            <p>También aparece como IGLÚ Records, Iglú Records, El Iglú y eliglurecords.</p>
          </article>
        </div>

        <nav className={styles.entityLinks} aria-label="Más sobre El Iglú Records">
          <Link href="/iglu/estudio">Estudio</Link>
          <Link href="/iglu/grabaciones">Grabaciones</Link>
          <Link href="/iglu/producciones">Producciones</Link>
          <Link href="/iglu/artistas">Artistas</Link>
          <Link href="/iglu/sesiones">Sesiones</Link>
          <Link href="/iglu/nosotros">Nosotros</Link>
          <Link href={radioHref}>IGLÚ Radio</Link>
        </nav>
      </section>
    </div>
  );
}
