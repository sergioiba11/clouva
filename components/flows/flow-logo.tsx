"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";
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

type BalanceRegion = {
  label: string;
  glow: string;
  glowSoft?: string;
  edge: string;
  assetUrl: string | null;
  assetFallbackUrl: string | null;
};

type FlowBalanceVisualPayload = {
  region: BalanceRegion;
};

type FlowLogoProps = {
  size?: number;
  className?: string;
  priority?: boolean;
  countryCode?: string | null;
  region?: FlowRegion | null;
  alt?: string;
  glow?: boolean;
  imageUrl?: string | null;
  fallbackImageUrl?: string | null;
  glowColor?: string;
  edgeColor?: string;
};

const balanceRegionCache = new Map<string, BalanceRegion | null>();
const balanceRegionRequests = new Map<string, Promise<BalanceRegion | null>>();

async function loadBalanceRegion(userId: string) {
  if (balanceRegionCache.has(userId)) return balanceRegionCache.get(userId) ?? null;

  const inFlight = balanceRegionRequests.get(userId);
  if (inFlight) return inFlight;

  const request = (async () => {
    try {
      const response = await authenticatedFetch("/api/flows/balance", { cache: "no-store" });
      const payload = await readApiJson<FlowBalanceVisualPayload>(response);
      const resolved = payload?.region ?? null;
      balanceRegionCache.set(userId, resolved);
      return resolved;
    } catch {
      balanceRegionCache.set(userId, null);
      return null;
    } finally {
      balanceRegionRequests.delete(userId);
    }
  })();

  balanceRegionRequests.set(userId, request);
  return request;
}

export function FlowLogo({
  size = 48,
  className = "",
  priority = false,
  countryCode,
  region = null,
  alt,
  glow = true,
  imageUrl = null,
  fallbackImageUrl = null,
  glowColor,
  edgeColor,
}: FlowLogoProps) {
  const { user, profile } = useAuth();
  const effectiveCountryCode = countryCode === undefined ? profile?.country_code : countryCode;
  const resolvedRegion = region ?? resolveFlowRegion(effectiveCountryCode);
  const canonicalAssetPath = resolvedRegion ? resolveFlowLogoAsset(resolvedRegion) : null;
  const canonicalAssetUrl = canonicalAssetPath
    ? `${ADMIN_ASSETS_BASE_URL}/${canonicalAssetPath}`
    : null;
  const canonicalLabel = resolvedRegion ? `FLOW ${flowRegionLabel(resolvedRegion)}` : "FLOW";
  const [balanceRegion, setBalanceRegion] = useState<BalanceRegion | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (resolvedRegion || imageUrl || !user?.id) {
      setBalanceRegion(null);
      return () => {
        cancelled = true;
      };
    }

    void loadBalanceRegion(user.id).then((nextRegion) => {
      if (!cancelled) setBalanceRegion(nextRegion);
    });

    return () => {
      cancelled = true;
    };
  }, [imageUrl, resolvedRegion, user?.id]);

  const imageCandidates = useMemo(() => {
    const candidates = [
      imageUrl,
      canonicalAssetUrl,
      balanceRegion?.assetUrl ?? null,
      fallbackImageUrl,
      balanceRegion?.assetFallbackUrl ?? null,
    ].filter((value): value is string => Boolean(value));

    return [...new Set(candidates)];
  }, [balanceRegion?.assetFallbackUrl, balanceRegion?.assetUrl, canonicalAssetUrl, fallbackImageUrl, imageUrl]);

  const candidateKey = imageCandidates.join("|");
  const [candidateIndex, setCandidateIndex] = useState(0);

  useEffect(() => {
    setCandidateIndex(0);
  }, [candidateKey]);

  const activeImageUrl = imageCandidates[candidateIndex] ?? null;
  const visualLabel = alt ?? balanceRegion?.label ?? canonicalLabel;
  const visualGlow = glowColor ?? balanceRegion?.glow ?? "#8b5cf6";
  const visualEdge = edgeColor ?? balanceRegion?.edge ?? "#e3dcff";
  const neutralFontSize = Math.max(4, Math.round(size * 0.18));

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center ${className}`}
      style={{
        width: size,
        height: size,
        minWidth: size,
        minHeight: size,
        maxWidth: size,
        maxHeight: size,
        borderRadius: "9999px",
        overflow: "hidden",
        flex: "0 0 auto",
        lineHeight: 0,
        border: `1px solid ${visualEdge}38`,
        background:
          "radial-gradient(circle at 34% 28%, rgba(255,255,255,.10), rgba(15,12,28,.76) 46%, rgba(3,3,8,.98) 100%)",
        boxShadow: glow
          ? `0 0 ${Math.max(6, Math.round(size * 0.22))}px ${visualGlow}38, inset 0 0 ${Math.max(5, Math.round(size * 0.14))}px rgba(255,255,255,.035)`
          : "inset 0 0 0 1px rgba(255,255,255,.015)",
      }}
      title={visualLabel}
      aria-label={visualLabel}
    >
      {activeImageUrl ? (
        <img
          src={activeImageUrl}
          alt={visualLabel}
          width={size}
          height={size}
          draggable={false}
          decoding="async"
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : "auto"}
          onError={() => setCandidateIndex((current) => current + 1)}
          style={{
            display: "block",
            width: "100%",
            height: "100%",
            minWidth: "100%",
            minHeight: "100%",
            objectFit: "cover",
            transform: "scale(1.02)",
            transformOrigin: "center",
            userSelect: "none",
            flex: "0 0 auto",
          }}
        />
      ) : (
        <span
          aria-hidden="true"
          style={{
            display: "inline-flex",
            width: "100%",
            height: "100%",
            alignItems: "center",
            justifyContent: "center",
            color: "rgba(255,255,255,.72)",
            fontSize: neutralFontSize,
            fontWeight: 800,
            letterSpacing: size >= 32 ? "0.04em" : "-0.04em",
            lineHeight: 1,
          }}
        >
          FLOW
        </span>
      )}
    </span>
  );
}
