"use client";

import type { CSSProperties } from "react";

type FlowLogoProps = {
  size?: number;
  className?: string;
  priority?: boolean;
  glow?: boolean;
  title?: string;
};

const FLOW_LOGO_SRC = "/api/flows/brand/logo";

export function FlowLogo({
  size = 40,
  className = "",
  priority = false,
  glow = true,
  title = "FLOW",
}: FlowLogoProps) {
  const wrapperStyle: CSSProperties = {
    width: size,
    height: size,
    minWidth: size,
    minHeight: size,
    maxWidth: size,
    maxHeight: size,
    display: "inline-grid",
    placeItems: "center",
    flex: "0 0 auto",
    lineHeight: 0,
  };

  return (
    <span className={className} style={wrapperStyle}>
      <img
        src={FLOW_LOGO_SRC}
        alt={title}
        title={title}
        width={size}
        height={size}
        draggable={false}
        decoding="async"
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "auto"}
        style={{
          display: "block",
          width: "100%",
          height: "100%",
          objectFit: "contain",
          userSelect: "none",
          filter: glow ? `drop-shadow(0 0 ${Math.max(4, size * 0.12)}px rgba(139,92,246,0.32))` : undefined,
        }}
      />
    </span>
  );
}
