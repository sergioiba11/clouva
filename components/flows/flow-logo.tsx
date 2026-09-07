"use client";

import { useAuth } from "@/components/auth-provider";
import { ClouvaLogoMark } from "@/components/brand/clouva-logo";
import {
  flowRegionLabel,
  resolveFlowLogoAsset,
  resolveFlowRegion,
  type FlowRegion,
} from "@/lib/flows/flow-region";

const DEFAULT_ADMIN_ASSETS_BASE_URL =
  "https://storage.googleapis.com/clouva-generated-media/admin-assets";

const ADMIN_ASSETS_BASE_URL = (
  process.env.NEXT_PUBLIC_CLOUVA_ADMIN_ASSETS_BASE_URL || DEFAULT_ADMIN_ASSETS_BASE_URL
).replace(/\/+$/, "");

type FlowLogoProps = {
  size?: number;
  className?: string;
  priority?: boolean;
  countryCode?: string | null;
  region?: FlowRegion | null;
  alt?: string;
  glow?: boolean;
};

export function FlowLogo({
  size = 48,
  className = "",
  priority = false,
  countryCode,
  region = null,
  alt,
  glow = true,
}: FlowLogoProps) {
  const { profile } = useAuth();
  const effectiveCountryCode = countryCode === undefined ? profile?.country_code : countryCode;
  const resolvedRegion = region ?? resolveFlowRegion(effectiveCountryCode);
  const assetPath = resolvedRegion ? resolveFlowLogoAsset(resolvedRegion) : null;
  const label = resolvedRegion ? `FLOW ${flowRegionLabel(resolvedRegion)}` : "FLOW";

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center overflow-visible ${className}`}
      style={{
        width: size,
        height: size,
        minWidth: size,
        minHeight: size,
      }}
      title={alt ?? label}
    >
      {assetPath ? (
        <img
          src={`${ADMIN_ASSETS_BASE_URL}/${assetPath}`}
          alt={alt ?? label}
          width={size}
          height={size}
          draggable={false}
          decoding="async"
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : "auto"}
          className="block h-full w-full select-none object-contain"
          style={{
            filter: glow
              ? `drop-shadow(0 0 ${Math.max(4, Math.round(size * 0.11))}px rgba(139,92,246,0.34))`
              : undefined,
          }}
        />
      ) : (
        <span
          className="inline-flex h-full w-full items-center justify-center"
          style={{
            filter: glow
              ? `drop-shadow(0 0 ${Math.max(4, Math.round(size * 0.1))}px rgba(139,92,246,0.26))`
              : undefined,
          }}
          aria-label={alt ?? "FLOW"}
        >
          <ClouvaLogoMark
            size={Math.max(12, Math.round(size * 0.82))}
            className="text-[#8f7cff]"
            label={alt ?? "FLOW"}
          />
        </span>
      )}
    </span>
  );
}
