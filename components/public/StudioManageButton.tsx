"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/auth-provider";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type Membership = { studio: { id: string } | null; can_manage: boolean };

// Self-hiding: shows "Administrar estudio" on a studio's own public page
// only when the logged-in viewer can actually manage THIS studio. Reuses
// /api/profile/memberships (already the source of truth for can_manage,
// fixed in PR #290) instead of re-deriving owner/VIP logic here.
export function StudioManageButton({ studioId }: { studioId: string }) {
  const { user, loading } = useAuth();
  const [canManage, setCanManage] = useState(false);

  useEffect(() => {
    if (loading || !user) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await authenticatedFetch("/api/profile/memberships");
        const payload = await readApiJson<{ memberships: Membership[] }>(response);
        const manages = payload.memberships.some((entry) => entry.studio?.id === studioId && entry.can_manage);
        if (!cancelled) setCanManage(manages);
      } catch {
        // Silent -- worst case the owner uses "Mis Estudios" instead.
      }
    })();
    return () => { cancelled = true; };
  }, [loading, user, studioId]);

  if (!canManage) return null;

  return (
    <Link
      href={`/studio-dashboard/${studioId}`}
      className="inline-flex items-center gap-2 rounded-full border border-amber-400/40 bg-amber-400/10 px-5 py-2.5 text-sm font-semibold text-amber-200 transition hover:bg-amber-400/20"
    >
      Administrar estudio
    </Link>
  );
}
