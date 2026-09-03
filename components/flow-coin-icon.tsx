"use client";

import { useId } from "react";

type FlowCoinIconProps = {
  size?: number;
  glow?: string;
  edge?: string;
  className?: string;
  title?: string;
};

export function FlowCoinIcon({
  size = 34,
  glow = "#a58bff",
  edge = "#e3dcff",
  className,
  title = "FLOW",
}: FlowCoinIconProps) {
  const rawId = useId().replace(/:/g, "");
  const metalId = `flow-metal-${rawId}`;
  const coreId = `flow-core-${rawId}`;
  const rimId = `flow-rim-${rawId}`;
  const shineId = `flow-shine-${rawId}`;

  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label={title}
      style={{
        display: "block",
        flex: "0 0 auto",
        filter: `drop-shadow(0 0 ${Math.max(5, size * 0.22)}px ${glow})`,
      }}
    >
      <defs>
        <radialGradient id={metalId} cx="35%" cy="27%" r="76%">
          <stop offset="0%" stopColor="#746d80" />
          <stop offset="22%" stopColor="#413b4a" />
          <stop offset="58%" stopColor="#18151d" />
          <stop offset="100%" stopColor="#09080c" />
        </radialGradient>
        <radialGradient id={coreId} cx="32%" cy="25%" r="82%">
          <stop offset="0%" stopColor="#5c5665" />
          <stop offset="35%" stopColor="#27232c" />
          <stop offset="100%" stopColor="#0b090e" />
        </radialGradient>
        <linearGradient id={rimId} x1="8" y1="8" x2="56" y2="56">
          <stop offset="0%" stopColor={edge} />
          <stop offset="22%" stopColor={glow} />
          <stop offset="58%" stopColor="#55445e" />
          <stop offset="84%" stopColor={glow} />
          <stop offset="100%" stopColor="#241d29" />
        </linearGradient>
        <linearGradient id={shineId} x1="20" y1="18" x2="45" y2="46">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.86" />
          <stop offset="30%" stopColor={edge} stopOpacity="0.92" />
          <stop offset="62%" stopColor={glow} stopOpacity="0.82" />
          <stop offset="100%" stopColor="#7a687e" stopOpacity="0.72" />
        </linearGradient>
      </defs>

      <circle cx="32" cy="32" r="29.5" fill="#09070c" stroke={`url(#${rimId})`} strokeWidth="3" />
      <circle cx="32" cy="32" r="25.7" fill={`url(#${metalId})`} stroke="#ffffff" strokeOpacity="0.12" strokeWidth="1" />
      <circle cx="32" cy="32" r="20.7" fill={`url(#${coreId})`} stroke={glow} strokeOpacity="0.28" strokeWidth="1" />
      <path d="M17 20.5A23.2 23.2 0 0 1 46.2 13" fill="none" stroke="#fff" strokeOpacity="0.13" strokeWidth="2" strokeLinecap="round" />
      <path d="M47.7 43.8A22.7 22.7 0 0 1 20.2 50" fill="none" stroke="#000" strokeOpacity="0.5" strokeWidth="2.2" strokeLinecap="round" />

      <path
        d="M36.5 21.5A13.7 13.7 0 1 0 36.5 42.5"
        fill="none"
        stroke={`url(#${shineId})`}
        strokeWidth="5.2"
        strokeLinecap="round"
      />
      <path d="M38.7 32H47.2" stroke={`url(#${shineId})`} strokeWidth="4.8" strokeLinecap="round" />
      <path d="M39 25.6L44.6 20.2" stroke={`url(#${shineId})`} strokeWidth="3.8" strokeLinecap="round" />
      <path d="M39 38.4L44.6 43.8" stroke={`url(#${shineId})`} strokeWidth="3.8" strokeLinecap="round" />
      <circle cx="47.1" cy="32" r="1.75" fill={edge} />
    </svg>
  );
}
