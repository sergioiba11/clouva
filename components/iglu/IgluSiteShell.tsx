"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { IGLU_STUDIO_PATH } from "@/lib/iglu-radio/routes";

const PRIMARY_NAV = [
  ["Inicio", IGLU_STUDIO_PATH],
  ["El estudio", "/iglu/estudio"],
  ["Grabaciones", "/iglu/grabaciones"],
  ["Producciones", "/iglu/producciones"],
  ["Iglú Radio", "/iglu/radio"],
  ["Nosotros", "/iglu/nosotros"],
  ["Contacto", "/iglu/contacto"],
] as const;

const MORE_NAV = [
  ["Productores", "/iglu/productores"],
  ["Artistas / Player", "/iglu/artistas"],
  ["Sesiones", "/iglu/sesiones"],
  ["Membresías", "/iglu/membresias"],
  ["Pagos únicos", "/iglu/pagos-unicos"],
] as const;

const ALL_NAV = [...PRIMARY_NAV, ...MORE_NAV] as const;

function isActive(pathname: string, href: string) {
  if (href === IGLU_STUDIO_PATH) return pathname === href || pathname === "/iglu";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function IgluSiteShell({ children, logoUrl, emblemUrl }: { children: ReactNode; logoUrl?: string; emblemUrl?: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 20);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  return (
    <div className="iglu-site">
      <header className={`iglu-header${scrolled ? " is-scrolled" : ""}`}>
        <Link href={IGLU_STUDIO_PATH} className="iglu-header__brand" aria-label="IGLÚ Records">
          {logoUrl ? <img src={logoUrl} alt="IGLÚ Records" /> : <span>IGLÚ <small>RECORDS</small></span>}
        </Link>

        <nav className="iglu-nav" aria-label="Navegación de IGLÚ Records">
          {PRIMARY_NAV.map(([label, href]) => (
            <Link key={href} href={href} className={isActive(pathname, href) ? "is-active" : ""}>{label}</Link>
          ))}
          <details className="iglu-nav-more">
            <summary className={MORE_NAV.some(([, href]) => isActive(pathname, href)) ? "is-active" : ""}>Más</summary>
            <div className="iglu-nav-more__menu">
              {MORE_NAV.map(([label, href]) => <Link key={href} href={href} className={isActive(pathname, href) ? "is-active" : ""}>{label}</Link>)}
            </div>
          </details>
        </nav>

        <div className="iglu-header__actions">
          <Link className="iglu-header__cart" href="/carrito" aria-label="Abrir carrito">Carrito</Link>
          <Link className="iglu-header__reserve" href="/iglu/contacto#reservar">Reservar sesión</Link>
          <button className="iglu-menu-button" type="button" aria-label="Abrir menú" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
            <span /> <span /> <span />
          </button>
        </div>
      </header>

      {open ? (
        <div className="iglu-mobile-menu">
          {ALL_NAV.map(([label, href]) => <Link key={href} href={href} className={isActive(pathname, href) ? "is-active" : ""}>{label}</Link>)}
          <Link href="/carrito">Carrito</Link>
          <Link className="iglu-mobile-menu__reserve" href="/iglu/contacto#reservar">Reservar sesión</Link>
        </div>
      ) : null}

      <main>{children}</main>

      <footer className="iglu-footer">
        <div className="iglu-footer__brand">
          {emblemUrl ? <img src={emblemUrl} alt="" aria-hidden="true" /> : null}
          <div><strong>IGLÚ RECORDS</strong><span>Southern sounds · global reach</span></div>
        </div>
        <p>Música · cultura · familia · del sur para el mundo</p>
        <div className="iglu-footer__links">
          <Link href="/iglu/estudio">Estudio</Link>
          <Link href="/iglu/artistas">Artistas</Link>
          <Link href="/iglu/radio">Radio</Link>
          <Link href="/iglu/contacto">Contacto</Link>
        </div>
      </footer>
    </div>
  );
}
