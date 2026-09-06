"use client";

import type { CSSProperties } from "react";

type ClouvaLogoMarkProps = {
  size?: number;
  className?: string;
  label?: string;
};

const MASK_URL = 'url("/assets/clouva/logo-official.svg")';

export function ClouvaLogoMark({ size = 24, className = "", label }: ClouvaLogoMarkProps) {
  const style: CSSProperties = {
    width: size,
    height: size,
    WebkitMaskImage: MASK_URL,
    maskImage: MASK_URL,
    WebkitMaskPosition: "center",
    maskPosition: "center",
    WebkitMaskRepeat: "no-repeat",
    maskRepeat: "no-repeat",
    WebkitMaskSize: "contain",
    maskSize: "contain",
  };

  return (
    <span
      className={`inline-block shrink-0 bg-current ${className}`}
      style={style}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}

export function ClouvaBrand({
  compact = false,
  className = "",
}: {
  compact?: boolean;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-3 ${className}`}>
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[14px] border border-violet-300/20 bg-violet-500/10 text-violet-300 shadow-[0_0_28px_rgba(139,92,246,0.28)]">
        <ClouvaLogoMark size={24} />
      </span>
      {compact ? null : (
        <span className="leading-none">
          <strong className="block text-[15px] font-semibold tracking-[0.14em] text-white">CLOUVA</strong>
          <small className="mt-1 block text-[9px] font-medium uppercase tracking-[0.28em] text-violet-300/75">
            Vida de flows
          </small>
        </span>
      )}
    </span>
  );
}
