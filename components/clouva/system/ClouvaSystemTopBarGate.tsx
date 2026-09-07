"use client";

import { usePathname } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { ClouvaTopBar } from "@/components/clouva/system/ClouvaTopBar";
import { shouldShowClouvaSystemTopBar } from "@/lib/navigation/clouva-topbar-routes";

/**
 * Root-level route gate for the canonical system bar.
 * Public Player/Studio/Space/storefront experiences keep their own identity.
 */
export function ClouvaSystemTopBarGate() {
  const pathname = usePathname() || "/";
  const { user, loading, hydrationReady } = useAuth();

  if (!shouldShowClouvaSystemTopBar(pathname)) return null;
  if (loading || !hydrationReady || !user) return null;

  return <ClouvaTopBar />;
}
