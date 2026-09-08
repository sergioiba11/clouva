"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CircleUserRound,
  DollarSign,
  Home,
  LayoutGrid,
  ShoppingBag,
  Sparkles,
  Store,
} from "lucide-react";
import { useCurrentPlayer } from "@/components/current-player-provider";
import {
  CLOUVA_NAVIGATION,
  DESKTOP_PRIMARY_NAV_KEYS,
  getNavigationItems,
  getPlayerDestination,
  type ClouvaSurfaceKey,
} from "@/lib/navigation/clouva-navigation";
import styles from "./ClouvaDesktopSidebar.module.css";

type ClouvaSidebarIcon = typeof Home;

export type ClouvaSidebarItem = {
  key: ClouvaSurfaceKey;
  label: string;
  href: string;
  icon: ClouvaSidebarIcon;
};

const navigationIcons: Partial<Record<ClouvaSurfaceKey, ClouvaSidebarIcon>> = {
  HOME: Home,
  CREATE: Sparkles,
  MARKET: ShoppingBag,
  MATRIX: LayoutGrid,
};

const primaryNavigation: ClouvaSidebarItem[] = getNavigationItems(DESKTOP_PRIMARY_NAV_KEYS).map((item) => ({
  key: item.key,
  label: item.label,
  href: item.href,
  icon: navigationIcons[item.key] ?? Home,
}));

export function useClouvaSidebarNavigation() {
  const { currentPlayer } = useCurrentPlayer();
  const playerHref = getPlayerDestination(currentPlayer);

  const workspaceNavigation: ClouvaSidebarItem[] = [
    { key: "PLAYER", label: "Mi Player", href: playerHref, icon: CircleUserRound },
    { key: "MI_FLOW", label: "Mi Flow", href: CLOUVA_NAVIGATION.MI_FLOW.href, icon: DollarSign },
    { key: "MI_SPOT", label: "Mi Spot", href: CLOUVA_NAVIGATION.MI_SPOT.href, icon: Store },
  ];

  return { primaryNavigation, workspaceNavigation, playerHref };
}

export function isClouvaSidebarItemActive(pathname: string, item: Pick<ClouvaSidebarItem, "href">) {
  if (item.href === "/") return pathname === "/";
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

type SidebarNavigationProps = {
  pathname: string;
  items: ClouvaSidebarItem[];
  onNavigate?: () => void;
  className?: string;
};

export function ClouvaSidebarNavigation({ pathname, items, onNavigate, className }: SidebarNavigationProps) {
  return (
    <nav className={className} aria-label="Navegación CLOUVA">
      {items.map((item) => {
        const Icon = item.icon;
        const active = isClouvaSidebarItemActive(pathname, item);
        return (
          <Link
            key={`${item.key}:${item.href}`}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={active ? styles.active : undefined}
          >
            <Icon size={17} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function ClouvaDesktopSidebar({ fixed = false }: { fixed?: boolean }) {
  const pathname = usePathname() || "/";
  const { primaryNavigation, workspaceNavigation } = useClouvaSidebarNavigation();

  return (
    <aside className={`${styles.sidebar} ${fixed ? styles.fixed : ""}`} data-clouva-desktop-sidebar="official">
      <ClouvaSidebarNavigation pathname={pathname} items={primaryNavigation} className={styles.sideNav} />

      <section className={styles.workspaceSection}>
        <span className={styles.workspaceLabel}>TU ESPACIO</span>
        <ClouvaSidebarNavigation pathname={pathname} items={workspaceNavigation} className={styles.workspaceNav} />
      </section>
    </aside>
  );
}
