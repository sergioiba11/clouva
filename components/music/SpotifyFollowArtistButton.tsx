"use client";

import { LoaderCircle } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { authenticatedFetch } from "@/lib/authenticated-fetch";
import { startSpotifyConnection } from "@/lib/music/spotify-client";

type State = "loading" | "followed" | "unfollowed" | "requires_connection" | "error";

export function SpotifyFollowArtistButton({ uri, className = "" }: { uri: string; className?: string }) {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<State>(user ? "loading" : "requires_connection");

  useEffect(() => {
    if (!user || !uri) {
      setState("requires_connection");
      return;
    }
    let cancelled = false;
    void authenticatedFetch(`/api/integrations/spotify/library?uri=${encodeURIComponent(uri)}`)
      .then(async (response) => {
        const payload = await response.json().catch(() => ({})) as { followed?: boolean; code?: string };
        if (cancelled) return;
        if (response.ok) setState(payload.followed ? "followed" : "unfollowed");
        else if (payload.code === "spotify_connection_required" || payload.code === "spotify_reconnect_required") setState("requires_connection");
        else setState("error");
      })
      .catch(() => { if (!cancelled) setState("error"); });
    return () => { cancelled = true; };
  }, [uri, user]);

  const connect = async () => {
    if (!user) {
      router.push(`/login?next=${encodeURIComponent(pathname || "/")}`);
      return;
    }
    setState("loading");
    try {
      await startSpotifyConnection({ returnPath: pathname || "/", pendingAction: { type: "follow_artist", uri } });
    } catch {
      setState("error");
    }
  };

  const toggle = async () => {
    if (state === "loading") return;
    if (state === "requires_connection" || state === "error") {
      await connect();
      return;
    }
    const wasFollowed = state === "followed";
    setState(wasFollowed ? "unfollowed" : "followed");
    try {
      const response = await authenticatedFetch("/api/integrations/spotify/library", {
        method: wasFollowed ? "DELETE" : "PUT",
        body: JSON.stringify({ uri }),
      });
      const payload = await response.json().catch(() => ({})) as { code?: string };
      if (!response.ok) {
        if (payload.code === "spotify_connection_required" || payload.code === "spotify_reconnect_required") setState("requires_connection");
        else setState(wasFollowed ? "followed" : "unfollowed");
      }
    } catch {
      setState(wasFollowed ? "followed" : "unfollowed");
    }
  };

  const label = state === "requires_connection" ? "Conectar Spotify" : state === "followed" ? "Siguiendo ✓" : "+ Seguir en Spotify";
  return (
    <button
      type="button"
      onClick={toggle}
      disabled={!uri || state === "loading"}
      aria-label={label}
      aria-pressed={state === "followed"}
      className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition ${state === "followed" ? "border-[#1DB954]/50 bg-[#1DB954]/15 text-[#8ff0b0]" : "border-white/15 bg-white/[0.04] text-white hover:border-[#1DB954]/60"} ${className}`}
    >
      {state === "loading" ? <LoaderCircle size={16} className="animate-spin" /> : null}
      {label}
    </button>
  );
}
