"use client";

import { usePathname } from "next/navigation";
import { GlobalClouvaAIButton } from "@/components/GlobalClouvaAIButton";
import { isImmersiveClouvaPreviewPath } from "@/lib/navigation/clouva-topbar-routes";

export function GlobalClouvaAIButtonGate() {
  const pathname = usePathname() || "/";
  const isPortfolioRoute = pathname === "/portafolio" || pathname.startsWith("/portafolio/");

  if (isPortfolioRoute || isImmersiveClouvaPreviewPath(pathname)) return null;
  return <GlobalClouvaAIButton />;
}
