"use client";

import Link from "next/link";
import { Menu, Search, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { IGLU_RADIO_PATH, IGLU_STUDIO_PATH, igluRadioRoute } from "@/lib/iglu-radio/routes";

const NAV_ITEMS = [
  ["RADIO", IGLU_RADIO_PATH],
  ["ARTISTAS", igluRadioRoute("artistas")],
  ["SESIONES", igluRadioRoute("sesiones")],
  ["PROGRAMAS", igluRadioRoute("programas")],
  ["PLAYLIST", igluRadioRoute("playlist")],
  ["SCHEDULE", igluRadioRoute("schedule")],
] as const;

export function RadioHeader() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => setMenuOpen(false), [pathname]);

  return (
    <header className={`iglu-radio-header ${scrolled ? "is-scrolled" : ""}`}>
      <div className="iglu-radio-header__inner">
        <Link href={IGLU_RADIO_PATH} className="iglu-radio-brand" aria-label="IGLÚ RADIO">
          <span className="iglu-radio-brand__iglu">IGLÚ</span>
          <span className="iglu-radio-brand__radio">RADIO</span>
          <span className="iglu-radio-brand__tagline">SOUTHERN SOUNDS · GLOBAL REACH</span>
        </Link>

        <nav className="iglu-radio-nav" aria-label="IGLÚ RADIO">
          {NAV_ITEMS.map(([label, href]) => {
            const active = href === IGLU_RADIO_PATH ? pathname === href : pathname.startsWith(href);
            return (
              <Link key={href} href={href} className={active ? "is-active" : ""}>
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="iglu-radio-header__actions">
          <Link
            href={IGLU_STUDIO_PATH}
            className="hidden min-h-10 items-center rounded-full border border-cyan-100/15 bg-black/20 px-3 text-[9px] font-bold tracking-[0.16em] text-cyan-50/70 transition hover:border-cyan-100/35 hover:text-white sm:inline-flex"
          >
            EL IGLÚ
          </Link>
          <Link href={igluRadioRoute("search")} className="iglu-radio-icon-button" aria-label="Buscar en IGLÚ RADIO">
            <Search size={19} />
          </Link>
          <button
            type="button"
            className="iglu-radio-icon-button iglu-radio-menu-button"
            aria-label={menuOpen ? "Cerrar menú" : "Abrir menú"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((value) => !value)}
          >
            {menuOpen ? <X size={21} /> : <Menu size={21} />}
          </button>
        </div>
      </div>

      {menuOpen ? (
        <nav className="iglu-radio-mobile-nav" aria-label="Navegación móvil IGLÚ RADIO">
          <Link href={IGLU_STUDIO_PATH}>EL IGLÚ</Link>
          {NAV_ITEMS.map(([label, href]) => (
            <Link key={href} href={href}>{label}</Link>
          ))}
          <Link href={igluRadioRoute("search")}>BUSCAR</Link>
        </nav>
      ) : null}
    </header>
  );
}
