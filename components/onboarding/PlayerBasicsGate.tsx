"use client";

import type { CSSProperties, ReactNode } from "react";
import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { useCurrentPlayer } from "@/components/current-player-provider";

const BYPASS_PREFIXES = [
  "/login",
  "/registro",
  "/auth",
  "/debug-auth",
  "/onboarding/player-basics",
] as const;

const VISUALLY_HIDDEN_STYLE: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
  border: 0,
};

function bypass(pathname: string) {
  return BYPASS_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function PlayerBasicsGate({ children }: { children: ReactNode }) {
  const { user, loading, hydrationReady } = useAuth();
  const { bootstrapReady, playerBasicsComplete } = useCurrentPlayer();
  const pathname = usePathname();
  const router = useRouter();

  const userId = user?.id ?? null;
  const bypassed = bypass(pathname);
  const pathnameRef = useRef(pathname);
  const checkedUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    if (!userId) {
      checkedUserIdRef.current = null;
      return;
    }

    if (loading || !hydrationReady || bypassed || !bootstrapReady) return;
    if (checkedUserIdRef.current === userId) return;

    checkedUserIdRef.current = userId;
    if (playerBasicsComplete === false) {
      const nextPath = pathnameRef.current || "/";
      router.replace(`/onboarding/player-basics?next=${encodeURIComponent(nextPath)}`);
    }
  }, [bootstrapReady, bypassed, hydrationReady, loading, playerBasicsComplete, router, userId]);

  const checking = Boolean(userId && !bypassed && hydrationReady && !loading && !bootstrapReady);

  // The onboarding check is routing logic, not a security boundary. Keep the
  // current UI mounted while bootstrap resolves so reloads and token refreshes
  // never flash a full black page.
  return (
    <>
      {children}
      {checking ? (
        <span className="sr-only" style={VISUALLY_HIDDEN_STYLE} aria-live="polite">
          Verificando tu Player
        </span>
      ) : null}
    </>
  );
}
