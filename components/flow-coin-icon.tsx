"use client";

import { useEffect, useState } from "react";
import { FlowLogo } from "@/components/flows/flow-logo";

type FlowCoinIconProps = {
  size?: number;
  glow?: string;
  edge?: string;
  className?: string;
  title?: string;
  imageUrl?: string | null;
  fallbackImageUrl?: string | null;
};

export function FlowCoinIcon({
  size = 34,
  glow = "#a58bff",
  className,
  title = "FLOW",
  imageUrl = null,
  fallbackImageUrl = null,
}: FlowCoinIconProps) {
  const [activeImageUrl, setActiveImageUrl] = useState<string | null>(imageUrl);

  useEffect(() => {
    setActiveImageUrl(imageUrl);
  }, [imageUrl, fallbackImageUrl]);

  const wrapperStyle = {
    width: size,
    height: size,
    minWidth: size,
    minHeight: size,
    maxWidth: size,
    maxHeight: size,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    flex: "0 0 auto",
    lineHeight: 0,
  } as const;

  if (activeImageUrl) {
    return (
      <span className={className} style={wrapperStyle}>
        <img
          src={activeImageUrl}
          alt={title}
          title={title}
          width={size}
          height={size}
          draggable={false}
          decoding="async"
          loading="eager"
          fetchPriority="high"
          onError={() => {
            if (fallbackImageUrl && activeImageUrl !== fallbackImageUrl) {
              setActiveImageUrl(fallbackImageUrl);
              return;
            }
            setActiveImageUrl(null);
          }}
          style={{
            display: "block",
            width: "100%",
            height: "100%",
            maxWidth: "100%",
            maxHeight: "100%",
            objectFit: "contain",
            userSelect: "none",
            flex: "0 0 auto",
            filter: `drop-shadow(0 0 ${Math.max(5, size * 0.18)}px ${glow})`,
          }}
        />
      </span>
    );
  }

  return <FlowLogo size={size} className={className} priority alt={title} />;
}
