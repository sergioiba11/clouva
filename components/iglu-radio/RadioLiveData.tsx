"use client";

import { useEffect } from "react";
import { useIgluRadio } from "@/components/iglu-radio/RadioProvider";
import { IGLU_STUDIO_SLUG } from "@/lib/iglu-radio/routes";

export function RadioLiveData() {
  const { setMetadata } = useIgluRadio();

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const refresh = async () => {
      try {
        const response = await fetch(`/api/studios/${IGLU_STUDIO_SLUG}/radio/now-playing`, { cache: "no-store" });
        const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
        if (!alive || !response.ok || !payload) return;
        const now = payload.nowPlaying && typeof payload.nowPlaying === "object" ? payload.nowPlaying as Record<string, unknown> : null;
        if (!now) return;
        const live = payload.live === true;
        const streamer = typeof payload.streamer === "string" ? payload.streamer : null;
        const playedAt = Number(now.playedAt);
        setMetadata({
          title: typeof now.title === "string" && now.title ? now.title : "IGLÚ RADIO",
          artist: typeof now.artist === "string" && now.artist ? now.artist : "IGLÚ RECORDS",
          program: live
            ? streamer || "EN VIVO"
            : typeof now.playlist === "string" && now.playlist ? now.playlist : "AutoDJ",
          host: live ? streamer : null,
          artwork: typeof now.artwork === "string" ? now.artwork : null,
          startedAt: Number.isFinite(playedAt) && playedAt > 0 ? new Date(playedAt * 1000).toISOString() : null,
          endsAt: null,
        });
      } catch {
        // Metadata is best-effort; the audio engine remains independent.
      } finally {
        if (alive) timer = setTimeout(refresh, 12000);
      }
    };

    void refresh();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [setMetadata]);

  return null;
}
