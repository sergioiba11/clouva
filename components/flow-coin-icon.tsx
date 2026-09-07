"use client";

import { FlowLogo } from "@/components/flows/flow-logo";
import type { FlowRegion } from "@/lib/flows/flow-region";

type FlowCoinIconProps = {
  size?: number;
  glow?: string;
  edge?: string;
  className?: string;
  title?: string;
  imageUrl?: string | null;
  fallbackImageUrl?: string | null;
  countryCode?: string | null;
  region?: FlowRegion | null;
};

export function FlowCoinIcon({
  size = 34,
  glow = "#a58bff",
  edge = "#e3dcff",
  className,
  title = "FLOW",
  imageUrl = null,
  fallbackImageUrl = null,
  countryCode,
  region = null,
}: FlowCoinIconProps) {
  return (
    <FlowLogo
      size={size}
      className={className}
      priority
      alt={title}
      countryCode={countryCode}
      region={region}
      imageUrl={imageUrl}
      fallbackImageUrl={fallbackImageUrl}
      glowColor={glow}
      edgeColor={edge}
    />
  );
}
