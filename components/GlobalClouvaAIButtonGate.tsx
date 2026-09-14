"use client";

import { usePathname } from "next/navigation";
import { GlobalClouvaAIButton } from "@/components/GlobalClouvaAIButton";
import { isImmersiveClouvaPreviewPath } from "@/lib/navigation/clouva-topbar-routes";

export function GlobalClouvaAIButtonGate() {
  const pathname = usePathname() || "/";
  const isPortfolioRoute = pathname === "/portafolio" || pathname.startsWith("/portafolio/");
  const isAdminRoute = pathname === "/admin" || pathname.startsWith("/admin/");

  // Admin already has its own workspace controls. Keeping the global draggable
  // launcher mounted there causes it to float over mobile admin/scanner UI.
  if (isPortfolioRoute || isAdminRoute || isImmersiveClouvaPreviewPath(pathname)) return null;
  return <GlobalClouvaAIButton />;
}
