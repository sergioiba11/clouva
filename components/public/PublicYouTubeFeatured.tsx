"use client";

import { useMemo, useState } from "react";
import { Play } from "lucide-react";
import type { PlayerMedia } from "@/lib/players-data";
import { SocialBrandIcon } from "./SocialBrandIcon";

function youtubeVideoId(url: string | null) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (["youtu.be"].includes(parsed.hostname)) return parsed.pathname.split("/").filter(Boolean)[0] || null;
    if (["youtube.com", "www.youtube.com", "m.youtube.com"].includes(parsed.hostname)) {
      if (parsed.pathname === "/watch") return parsed.searchParams.get("v");
      const parts = parsed.pathname.split("/").filter(Boolean);
      if (["shorts", "embed"].includes(parts[0] || "")) return parts[1] || null;
    }
  } catch {
    return null;
  }
  return null;
}

export function PublicYouTubeFeatured({ item, radiusClass }: { item: PlayerMedia; radiusClass: string }) {
  const [playing, setPlaying] = useState(false);
  const videoId = useMemo(() => youtubeVideoId(item.source_url), [item.source_url]);
  const thumbnail = item.thumbnail_url || (videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null);
  if (!videoId) return null;

  return (
    <article className={`mb-4 overflow-hidden border border-white/10 bg-black/30 ${radiusClass}`}>
      <div className="relative aspect-video bg-black">
        {playing ? (
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?autoplay=1&rel=0`}
            title={item.caption || "Video de YouTube"}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            loading="lazy"
            className="absolute inset-0 h-full w-full border-0"
          />
        ) : (
          <button type="button" onClick={() => setPlaying(true)} aria-label={`Reproducir ${item.caption || "video de YouTube"}`} className="group absolute inset-0 h-full w-full overflow-hidden text-left">
            {thumbnail ? <img src={thumbnail} alt="" loading="lazy" className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.02]" /> : null}
            <span className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-black/15" />
            <span className="absolute inset-0 m-auto grid h-14 w-14 place-items-center rounded-full border border-white/25 bg-black/65 shadow-2xl backdrop-blur transition group-hover:scale-105 group-hover:bg-[color:var(--public-accent)]">
              <Play size={20} fill="currentColor" />
            </span>
          </button>
        )}
      </div>
      <div className="flex items-center gap-3 p-4">
        <SocialBrandIcon icon="youtube" className="h-5 w-5 shrink-0" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{item.caption || "Video de YouTube"}</p>
          <p className="mt-0.5 text-[10px] uppercase tracking-wider text-white/35">YouTube</p>
        </div>
      </div>
    </article>
  );
}
