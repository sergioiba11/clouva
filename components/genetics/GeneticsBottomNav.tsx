"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, Camera, Compass, Dna, UsersRound, UserRound } from "lucide-react";
import styles from "./genetics.module.css";

type GeneticsNavItem = {
  href: string;
  label: string;
  icon: typeof Compass;
  exact?: boolean;
};

const ITEMS: readonly GeneticsNavItem[] = [
  { href: "/geneticas", label: "Descubrir", icon: Compass, exact: true },
  { href: "/geneticas/escanear", label: "Escanear", icon: Camera },
  { href: "/geneticas/biblioteca", label: "Genéticas", icon: Dna },
  { href: "/geneticas/aprender", label: "Aprender", icon: BookOpen },
  { href: "/geneticas/comunidad", label: "Comunidad", icon: UsersRound },
  { href: "/geneticas/perfil", label: "Perfil", icon: UserRound },
];

export function GeneticsBottomNav() {
  const pathname = usePathname() || "/geneticas";

  return (
    <nav className={styles.bottomNav} aria-label="Navegación de genéticas">
      {ITEMS.map((item) => {
        const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link key={item.href} href={item.href} className={active ? styles.bottomNavActive : undefined}>
            <Icon size={18} strokeWidth={1.7} />
            <span>{item.label}</span>
            {active ? <i aria-hidden="true" /> : null}
          </Link>
        );
      })}
    </nav>
  );
}
