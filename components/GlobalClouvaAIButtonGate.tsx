"use client";

import { usePathname } from "next/navigation";
import { GlobalClouvaAIButton } from "@/components/GlobalClouvaAIButton";
import { isImmersiveClouvaPreviewPath } from "@/lib/navigation/clouva-topbar-routes";

export function GlobalClouvaAIButtonGate() {
  const pathname = usePathname() || "/";
  if (isImmersiveClouvaPreviewPath(pathname)) return null;
  return <GlobalClouvaAIButton />;
}
