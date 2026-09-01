"use client";

import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
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

  const userId = user?.id ?? null;
  const bypassed = bypass(pathname);
  const pathnameRef = useRef(pathname);
  const checkedUserIdRef = useRef<string | null>(null);
  const checkingUserIdRef = useRef<string | null>(null);

  // Keep the latest route available for the onboarding redirect without making
  // every navigation re-run the Player basics validation.
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    let alive = true;

    if (!userId) {
      checkedUserIdRef.current = null;
      checkingUserIdRef.current = null;
    }

    if (loading || !hydrationReady || !userId || bypassed) {
      setChecking(false);
      return () => {
        alive = false;
      };
    }

    // Supabase can emit SIGNED_IN / TOKEN_REFRESHED again when the browser tab
    // regains focus. Those events may replace the User object even though the
    // authenticated account is unchanged. Validate once per stable user id so
    // returning to CLOUVA never blanks the mounted application again.
    if (checkedUserIdRef.current === userId || checkingUserIdRef.current === userId) {
      setChecking(false);
      return () => {
        alive = false;
      };
    }

    checkingUserIdRef.current = userId;
    setChecking(true);

    void (async () => {
      try {
        const response = await authenticatedFetch("/api/onboarding/player-basics");
        const payload = await readApiJson<BasicsPayload>(response);
        if (!alive) return;

        checkedUserIdRef.current = userId;
        if (!payload.complete) {
          const nextPath = pathnameRef.current || "/";
          router.replace(`/onboarding/player-basics?next=${encodeURIComponent(nextPath)}`);
        }
      } catch (error) {
        console.error("Player basics gate failed", error);
      } finally {
        if (checkingUserIdRef.current === userId) checkingUserIdRef.current = null;
        if (alive) setChecking(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [bypassed, hydrationReady, loading, router, userId]);

  if (checking) {
    return <main className="min-h-screen bg-[#05040a]" aria-hidden="true" />;
  }

  return children;
}
