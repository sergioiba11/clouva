import Link from "next/link";
import {
  BarChart3,
  ChevronRight,
  List,
  Menu,
  Play,
  Search,
  ShoppingCart,
  UserCircle,
  UserRound,
  Home,
} from "lucide-react";
import type { CSSProperties } from "react";
import type { IgluSiteData } from "@/lib/iglu/site-data";
import { IGLU_STUDIO_PATH } from "@/lib/iglu-radio/routes";
import styles from "./IgluPublicSpotHome.module.css";

function imageFromProduct(product: IgluSiteData["products"][number] | undefined) {
  if (!product) return undefined;
  if (product.cover_url) return product.cover_url;
  if (Array.isArray(product.gallery)) {
    const first = product.gallery.find((item) => typeof item === "string");
    if (typeof first === "string") return first;
  }
  return undefined;
}

function imageStyle(url?: string): CSSProperties | undefined {
  return url ? { backgroundImage: `url("${url}")` } : undefined;
}

function SpotCard({
  href,
  label,
  image,
  wide = false,
}: {
  href: string;
  label: string;
  image?: string;
  wide?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`${styles.card} ${wide ? styles.cardWide : ""}`}
      style={imageStyle(image)}
      aria-label={label}
    >
      <span className={styles.cardShade} aria-hidden="true" />
      <span className={styles.cardLabel}>{label}</span>
      <span className={styles.cardArrow} aria-hidden="true"><ChevronRight size={20} strokeWidth={1.8} /></span>
    </Link>
  );
}

export function IgluPublicSpotHome({ data }: { data: IgluSiteData }) {
  const agendaHref = `${IGLU_STUDIO_PATH}/agenda`;
  const radioHref = `${IGLU_STUDIO_PATH}/radio`;
  const merchHref = `${IGLU_STUDIO_PATH}/tienda`;

  const hero = data.assets.publicHomeHero ?? data.assets.homeScene ?? data.assets.studioHero ?? data.assets.studioHeroAlt;
  const playersImage = data.assets.publicPlayersCard ?? data.assets.artistsScene ?? data.assets.recordingsScene ?? hero;
  const reservationsImage = data.assets.publicReservationsCard ?? data.assets.sessionsScene ?? data.assets.studioHeroAlt ?? hero;
  const merchImage = data.assets.publicMerchCard ?? imageFromProduct(data.products[0]) ?? data.assets.membershipsScene ?? hero;

  return (
    <div className={styles.viewport} style={imageStyle(hero)}>
      <main className={styles.app} aria-label="IGLÚ Records">
        <section className={styles.hero} style={imageStyle(hero)}>
          <div className={styles.heroOverlay} aria-hidden="true" />

          <div className={styles.topbar}>
            <details className={styles.menu}>
              <summary aria-label="Abrir menú de IGLÚ"><Menu size={32} strokeWidth={1.8} /></summary>
              <nav className={styles.menuPanel} aria-label="Menú IGLÚ">
                <Link href="/iglu/artistas">Players</Link>
                <Link href={agendaHref}>Reservas</Link>
                <Link href={merchHref}>Merch</Link>
                <Link href="/iglu/pagos-unicos">Carta/Menu</Link>
                <Link href="/iglu/sesiones">Sesiones</Link>
                <Link href="/profile">Perfil</Link>
              </nav>
            </details>

            <div className={styles.brand}>
              {data.assets.logo ? (
                <img src={data.assets.logo} alt="IGLÚ Records" />
              ) : (
                <div className={styles.brandFallback}>
                  {data.assets.igloo ? <img src={data.assets.igloo} alt="" aria-hidden="true" /> : null}
                  <strong>IGLÚ</strong>
                  <span>RECORDS</span>
                </div>
              )}
            </div>

            <div className={styles.topActions}>
              <Link href={`${radioHref}/search`} aria-label="Buscar"><Search size={28} strokeWidth={1.8} /></Link>
              <Link href="/carrito" aria-label="Carrito"><ShoppingCart size={28} strokeWidth={1.8} /></Link>
              <Link href="/profile" aria-label="Perfil"><UserCircle size={30} strokeWidth={1.65} /></Link>
            </div>
          </div>

          <div className={styles.heroCopy}>
            <h1>ENTRÁ AL IGLÚ</h1>
            <div className={styles.heroActions}>
              <Link className={styles.reserveButton} href={agendaHref}>
                <span>RESERVAR SESIÓN</span>
                <span aria-hidden="true">→</span>
              </Link>
              <Link className={styles.playButton} href={radioHref} aria-label="Entrar a IGLÚ Radio">
                <Play size={30} fill="currentColor" strokeWidth={1.5} />
              </Link>
            </div>
          </div>
        </section>

        <section className={styles.cards} aria-label="Accesos públicos de IGLÚ">
          <div className={styles.cardRow}>
            <SpotCard href="/iglu/artistas" label="PLAYERS" image={playersImage} />
            <SpotCard href={agendaHref} label="RESERVAS" image={reservationsImage} />
          </div>
          <SpotCard href={merchHref} label="MERCH" image={merchImage} wide />
        </section>

        <nav className={styles.bottomNav} aria-label="Navegación principal de IGLÚ">
          <Link className={styles.navActive} href={IGLU_STUDIO_PATH}>
            <Home size={25} strokeWidth={1.8} />
            <span>INICIO</span>
          </Link>
          <Link href="/iglu/pagos-unicos">
            <List size={25} strokeWidth={1.8} />
            <span>CARTA/MENU</span>
          </Link>
          <Link className={styles.centerAction} href={radioHref} aria-label="IGLÚ Radio">
            <span className={styles.centerGlow}>
              {data.assets.igloo ? <img src={data.assets.igloo} alt="" aria-hidden="true" /> : <Play size={26} fill="currentColor" />}
            </span>
          </Link>
          <Link href="/iglu/sesiones">
            <BarChart3 size={25} strokeWidth={1.8} />
            <span>SESIONES</span>
          </Link>
          <Link href="/profile">
            <UserRound size={25} strokeWidth={1.8} />
            <span>PERFIL</span>
          </Link>
        </nav>
      </main>
    </div>
  );
}
