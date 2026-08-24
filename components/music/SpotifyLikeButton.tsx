"use client";

import { Heart, LoaderCircle } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { authenticatedFetch } from "@/lib/authenticated-fetch";
import { startSpotifyConnection } from "@/lib/music/spotify-client";

type State = "loading" | "saved" | "unsaved" | "requires_connection" | "error";

export function SpotifyLikeButton({ uri, className = "" }: { uri: string; className?: string }) {
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
        const payload = await response.json().catch(() => ({})) as { saved?: boolean; code?: string };
        if (cancelled) return;
        if (response.ok) setState(payload.saved ? "saved" : "unsaved");
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
      await startSpotifyConnection({ returnPath: pathname || "/", pendingAction: { type: "save_track", uri } });
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
    const wasSaved = state === "saved";
    setState(wasSaved ? "unsaved" : "saved");
    try {
      const response = await authenticatedFetch("/api/integrations/spotify/library", {
        method: wasSaved ? "DELETE" : "PUT",
        body: JSON.stringify({ uri }),
      });
      const payload = await response.json().catch(() => ({})) as { code?: string };
      if (!response.ok) {
        if (payload.code === "spotify_connection_required" || payload.code === "spotify_reconnect_required") setState("requires_connection");
        else setState(wasSaved ? "saved" : "unsaved");
      }
    } catch {
      setState(wasSaved ? "saved" : "unsaved");
    }
  };

  const saved = state === "saved";
  const label = state === "requires_connection"
    ? "Conectar Spotify para guardar canción"
    : saved ? "Quitar de tu biblioteca de Spotify" : "Guardar en tu biblioteca de Spotify";

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={!uri || state === "loading"}
      aria-label={label}
      aria-pressed={saved}
      title={label}
      className={`inline-grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-black/35 text-white transition hover:border-[#1DB954]/60 hover:text-[#1DB954] disabled:opacity-60 ${className}`}
    >
      {state === "loading" ? <LoaderCircle size={18} className="animate-spin" /> : <Heart size={19} fill={saved ? "currentColor" : "none"} />}
    </button>
  );
}
