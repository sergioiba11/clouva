"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type BasicsPayload = { complete: boolean };

const BYPASS_PREFIXES = [
  "/login",
  "/registro",
  "/auth",
  "/debug-auth",
  "/onboarding/player-basics",
] as const;

function bypass(pathname: string) {
  return BYPASS_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function PlayerBasicsGate({ children }: { children: ReactNode }) {
  const { user, loading, hydrationReady } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    let alive = true;
    if (loading || !hydrationReady || !user || bypass(pathname)) {
      setChecking(false);
      return () => { alive = false; };
    }

    setChecking(true);
    void (async () => {
      try {
        const response = await authenticatedFetch("/api/onboarding/player-basics");
        const payload = await readApiJson<BasicsPayload>(response);
        if (!alive) return;
        if (!payload.complete) {
          router.replace(`/onboarding/player-basics?next=${encodeURIComponent(pathname || "/")}`);
          return;
        }
      } catch (error) {
        console.error("Player basics gate failed", error);
      } finally {
        if (alive) setChecking(false);
      }
    })();

    return () => { alive = false; };
  }, [hydrationReady, loading, pathname, router, user]);

  if (checking) {
    return <main className="min-h-screen bg-[#05040a]" aria-hidden="true" />;
  }

  return children;
}
