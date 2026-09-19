import Link from "next/link";
import type { IgluSiteData } from "@/lib/iglu/site-data";
import { IGLU_STUDIO_PATH } from "@/lib/iglu-radio/routes";
import styles from "./IgluPublicSpotHome.module.css";

function AssetImage({
  src,
  alt = "",
  className,
}: {
  src?: string;
  alt?: string;
  className?: string;
}) {
  return src ? <img src={src} alt={alt} className={className} /> : null;
}

export function IgluPublicSpotHome({ data }: { data: IgluSiteData }) {
  const agendaHref = `${IGLU_STUDIO_PATH}/agenda`;
  const radioHref = `${IGLU_STUDIO_PATH}/radio`;
  const merchHref = `${IGLU_STUDIO_PATH}/tienda`;

  const background = data.assets.publicBackground ?? data.assets.publicHomeHero ?? data.assets.homeScene ?? data.assets.studioHero;
  const logo = data.assets.publicLogo ?? data.assets.logo;
  const topIcons = data.assets.publicTopIcons;
  const reserveButton = data.assets.publicReserveButton;
  const playButton = data.assets.publicPlayButton;
  const playersCard = data.assets.publicPlayersCard;
  const reservationsCard = data.assets.publicReservationsCard;
  const merchBanner = data.assets.publicMerchCard;
  const bottomNav = data.assets.publicBottomNav;

  return (
    <div className={styles.viewport}>
      <main className={styles.app} aria-label="IGLÚ Records">
        <section
          className={styles.hero}
          style={background ? { backgroundImage: `url("${background}")` } : undefined}
        >
          <div className={styles.heroShade} aria-hidden="true" />

          <div className={styles.topIcons}>
            {topIcons ? (
              <AssetImage src={topIcons} alt="" />
            ) : (
              <div className={styles.topIconsFallback}>☰　⌕　🛒　◯</div>
            )}

            <details className={styles.menuHitbox}>
              <summary aria-label="Abrir menú de IGLÚ" />
              <nav className={styles.menuPanel} aria-label="Menú IGLÚ">
                <Link href="/iglu/artistas">Players</Link>
                <Link href={agendaHref}>Reservas</Link>
                <Link href={merchHref}>Merch</Link>
                <Link href="/iglu/pagos-unicos">Carta/Menu</Link>
                <Link href="/iglu/sesiones">Sesiones</Link>
                <Link href="/profile">Perfil</Link>
              </nav>
            </details>
            <Link className={styles.searchHitbox} href={`${radioHref}/search`} aria-label="Buscar" />
            <Link className={styles.cartHitbox} href="/carrito" aria-label="Carrito" />
            <Link className={styles.profileHitbox} href="/profile" aria-label="Perfil" />
          </div>

          <div className={styles.brand}>
            <AssetImage src={logo} alt="IGLÚ Records" />
          </div>

          <div className={styles.heroSpacer} />

          <div className={styles.heroCopy}>
            <h1>ENTRÁ AL IGLÚ</h1>
            <div className={styles.heroActions}>
              <Link href={agendaHref} className={styles.assetButton} aria-label="Reservar sesión">
                {reserveButton ? <AssetImage src={reserveButton} alt="Reservar sesión" /> : <span>RESERVAR SESIÓN →</span>}
              </Link>
              <Link href={radioHref} className={styles.assetButton} aria-label="Entrar a IGLÚ Radio">
                {playButton ? <AssetImage src={playButton} alt="Reproducir IGLÚ Radio" /> : <span>▶</span>}
              </Link>
            </div>
          </div>
        </section>

        <section className={styles.cards} aria-label="Accesos públicos de IGLÚ">
          <div className={styles.cardRow}>
            <Link href="/iglu/artistas" className={styles.assetCard} aria-label="Players">
              <AssetImage src={playersCard} alt="Players" />
            </Link>
            <Link href={agendaHref} className={styles.assetCard} aria-label="Reservas">
              <AssetImage src={reservationsCard} alt="Reservas" />
            </Link>
          </div>

          <Link href={merchHref} className={`${styles.assetCard} ${styles.merchCard}`} aria-label="Merch">
            <AssetImage src={merchBanner} alt="Merch" />
          </Link>
        </section>

        <nav className={styles.bottomNav} aria-label="Navegación principal de IGLÚ">
          {bottomNav ? <AssetImage src={bottomNav} alt="" /> : null}
          <Link className={styles.navHome} href={IGLU_STUDIO_PATH} aria-label="Inicio" />
          <Link className={styles.navMenu} href="/iglu/pagos-unicos" aria-label="Carta y menú" />
          <Link className={styles.navRadio} href={radioHref} aria-label="IGLÚ Radio" />
          <Link className={styles.navSessions} href="/iglu/sesiones" aria-label="Sesiones" />
          <Link className={styles.navProfile} href="/profile" aria-label="Perfil" />
        </nav>
      </main>
    </div>
  );
}
