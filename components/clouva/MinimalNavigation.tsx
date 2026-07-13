"use client";

import Link from "next/link";
import { Compass, Home, ShoppingBag, User, VenetianMask } from "lucide-react";

type MinimalNavigationProps = { visible: boolean };

const items = [
  { href: "/", label: "Inicio", Icon: Home },
  { href: "/lookbook", label: "Explorar", Icon: Compass },
  { href: "/mi-flow/avatar", label: "Avatar", Icon: VenetianMask },
  { href: "/tienda", label: "Tienda", Icon: ShoppingBag },
  { href: "/perfil", label: "Perfil", Icon: User },
];

export function MinimalNavigation({ visible }: MinimalNavigationProps) {
  return (
    <nav className={`clouva-min-nav ${visible ? "clouva-min-nav-visible" : ""}`} aria-hidden={!visible} aria-label="Navegación principal CLOUVA">
      {items.map(({ href, label, Icon }) => (
        <Link key={href} href={href}>
          <Icon className="h-4 w-4" />
          <span>{label}</span>
        </Link>
      ))}
    </nav>
  );
}
