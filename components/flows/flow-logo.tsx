"use client";

const DEFAULT_ADMIN_ASSETS_BASE_URL =
  "https://storage.googleapis.com/clouva-generated-media/admin-assets";

const ADMIN_ASSETS_BASE_URL = (
  process.env.NEXT_PUBLIC_CLOUVA_ADMIN_ASSETS_BASE_URL || DEFAULT_ADMIN_ASSETS_BASE_URL
).replace(/\/+$/, "");

export const FLOW_LOGO_ASSET_PATH = "brand/01_flows_sudamerica.png";
export const FLOW_LOGO_URL = `${ADMIN_ASSETS_BASE_URL}/${FLOW_LOGO_ASSET_PATH}`;

type FlowLogoProps = {
  size?: number;
  className?: string;
  priority?: boolean;
  alt?: string;
  glow?: boolean;
};

export function FlowLogo({
  size = 48,
  className = "",
  priority = false,
  alt = "FLOW",
  glow = true,
}: FlowLogoProps) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center overflow-visible ${className}`}
      style={{
        width: size,
        height: size,
        minWidth: size,
        minHeight: size,
      }}
    >
      <img
        src={FLOW_LOGO_URL}
        alt={alt}
        title={alt}
        width={size}
        height={size}
        draggable={false}
        decoding="async"
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "auto"}
        className="block h-full w-full select-none object-contain"
        style={{
          filter: glow ? `drop-shadow(0 0 ${Math.max(4, Math.round(size * 0.11))}px rgba(139,92,246,0.34))` : undefined,
        }}
      />
    </span>
  );
}
