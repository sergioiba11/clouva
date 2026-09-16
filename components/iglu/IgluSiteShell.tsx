"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

const NAV = [
  ["Inicio", "/iglu"],
  ["El estudio", "/iglu/estudio"],
  ["Grabaciones", "/iglu/grabaciones"],
  ["Producciones", "/iglu/producciones"],
  ["Productores", "/iglu/productores"],
  ["Artistas", "/iglu/artistas"],
  ["Sesiones", "/iglu/sesiones"],
  ["Iglú Radio", "/iglu/radio"],
  ["Nosotros", "/iglu/nosotros"],
  ["Contacto", "/iglu/contacto"],
] as const;

function isActive(pathname: string, href: string) {
  return href === "/iglu" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
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
        <Link href="/iglu" className="iglu-header__brand" aria-label="IGLÚ Records">
          {logoUrl ? <img src={logoUrl} alt="IGLÚ Records" /> : <span>IGLÚ <small>RECORDS</small></span>}
        </Link>

        <nav className="iglu-nav" aria-label="Navegación de IGLÚ Records">
          {NAV.map(([label, href]) => (
            <Link key={href} href={href} className={isActive(pathname, href) ? "is-active" : ""}>{label}</Link>
          ))}
        </nav>

        <div className="iglu-header__actions">
          <Link className="iglu-header__reserve" href="/iglu/contacto#reservar">Reservar sesión</Link>
          <button className="iglu-menu-button" type="button" aria-label="Abrir menú" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
            <span /> <span /> <span />
          </button>
        </div>
      </header>

      {open ? (
        <div className="iglu-mobile-menu">
          {NAV.map(([label, href]) => <Link key={href} href={href}>{label}</Link>)}
          <Link href="/iglu/membresias">Membresías</Link>
          <Link href="/iglu/pagos-unicos">Pagos únicos</Link>
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
          <Link href="/iglu/nosotros">Nosotros</Link>
          <Link href="/iglu/contacto">Contacto</Link>
          <Link href="/iglu/radio">Radio</Link>
        </div>
      </footer>
    </div>
  );
}
