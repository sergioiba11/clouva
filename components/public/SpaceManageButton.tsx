"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Settings2 } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

export function SpaceManageButton({ spotId }: { spotId: string }) {
  const { user, loading } = useAuth();
  const [canManage, setCanManage] = useState(false);

  useEffect(() => {
    if (loading || !user || !spotId) return;
    let cancelled = false;

    void (async () => {
      try {
        const response = await authenticatedFetch(`/api/mi-spot/${encodeURIComponent(spotId)}`);
        const payload = await readApiJson<{ capabilities?: string[] }>(response);
        if (!cancelled) setCanManage(payload.capabilities?.includes("settings") === true);
      } catch {
        if (!cancelled) setCanManage(false);
      }
    })();

    return () => { cancelled = true; };
  }, [loading, spotId, user]);

  if (!canManage) return null;

  return (
    <Link
      href={`/mi-spot/${spotId}/public-profile`}
      className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.055] px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-white/[0.1]"
    >
      <Settings2 size={14} /> Administrar perfil
    </Link>
  );
}
