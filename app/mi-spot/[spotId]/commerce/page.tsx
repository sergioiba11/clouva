"use client";

import { Loader2 } from "lucide-react";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { SpaceCommerceWorkspace } from "@/components/commerce/SpaceCommerceWorkspace";
import { MainNav } from "@/components/layout";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type SpotScope = {
  spot: { id: string; owner_type: "user" | "studio"; studio_id: string | null };
  studio: { id: string; name: string; slug: string } | null;
  canOpenCommerce: boolean;
};

export default function SpotCommercePage() {
  const params = useParams<{ spotId: string }>();
  const spotId = String(params.spotId || "");
  const { user, loading: authLoading } = useAuth();
  const [scope, setScope] = useState<SpotScope | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user || !spotId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await authenticatedFetch(`/api/mi-spot/${encodeURIComponent(spotId)}`);
      const payload = await readApiJson<SpotScope>(response);
      if (!payload.canOpenCommerce) throw new Error("Tu rol no permite abrir el panel operativo completo de este Espacio.");
      setScope(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo abrir el centro operativo del Espacio.");
    } finally {
      setLoading(false);
    }
  }, [spotId, user]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLoading(false);
      return;
    }
    void load();
  }, [authLoading, load, user]);

  if (scope) {
    const commerceScope = scope.spot.owner_type === "studio" && scope.studio?.id
      ? scope.studio.id
      : `spot:${scope.spot.id}`;
    return <SpaceCommerceWorkspace commerceScopeId={commerceScope} />;
  }

  return <main className="min-h-screen bg-[#05040a] text-white"><MainNav /><div className="mx-auto max-w-3xl px-4 py-14">{loading ? <p className="flex items-center gap-2 text-sm text-white/45"><Loader2 size={16} className="animate-spin" /> Abriendo operaciones…</p> : null}{error ? <p className="rounded-2xl border border-rose-300/15 bg-rose-300/[0.06] p-4 text-sm text-rose-200">{error}</p> : null}</div></main>;
}
