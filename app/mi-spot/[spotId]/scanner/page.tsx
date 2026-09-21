"use client";

import { Loader2 } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { CommercePistolScanner } from "@/components/commerce/CommercePistolScanner";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type SpotScope = {
  spot: { id: string; name: string };
  capabilities: string[];
};

export default function PlayerSpotScannerPage() {
  const params = useParams<{ spotId: string }>();
  const router = useRouter();
  const spotId = String(params.spotId || "");
  const { user, loading: authLoading } = useAuth();
  const [scope, setScope] = useState<SpotScope | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!user || !spotId) return;
    try {
      const response = await authenticatedFetch(`/api/mi-spot/${encodeURIComponent(spotId)}`);
      const payload = await readApiJson<SpotScope>(response);
      const canUseScanner = payload.capabilities.includes("operations")
        || payload.capabilities.includes("catalog")
        || payload.capabilities.includes("sales")
        || payload.capabilities.includes("inventory");
      if (!canUseScanner) throw new Error("Tu rol en este Spot no permite usar el scanner comercial.");
      setScope(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo abrir el scanner de este Spot.");
    }
  }, [spotId, user]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace(`/login?next=${encodeURIComponent(`/mi-spot/${spotId}/scanner`)}`);
      return;
    }
    void load();
  }, [authLoading, load, router, spotId, user]);

  if (scope) {
    return (
      <CommercePistolScanner
        studioId={`spot:${scope.spot.id}`}
        returnPath={`/mi-spot/${scope.spot.id}/scanner`}
      />
    );
  }

  return (
    <main className="grid min-h-[100svh] place-items-center bg-black px-6 text-white">
      {error
        ? <p className="max-w-md rounded-2xl border border-rose-300/20 bg-rose-300/[0.06] p-4 text-sm text-rose-200">{error}</p>
        : <p className="flex items-center gap-2 text-sm text-white/45"><Loader2 className="h-4 w-4 animate-spin" /> Abriendo scanner…</p>}
    </main>
  );
}
