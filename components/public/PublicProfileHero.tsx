import Link from "next/link";
import { PublicShareButton } from "./PublicShareButton";
import { VISUAL_ASSETS } from "@/lib/visual-assets";

export function PublicProfileHero({
  kind,
  name,
  username,
  tagline,
  location,
  profileImageUrl,
  coverUrl,
  badges = [],
  primaryAction,
  secondaryAction,
}: {
  kind: "player" | "studio";
  name: string;
  username?: string | null;
  tagline?: string | null;
  location?: string | null;
  profileImageUrl?: string | null;
  coverUrl?: string | null;
  badges?: string[];
  primaryAction?: { label: string; href: string } | null;
  secondaryAction?: { label: string; href: string } | null;
}) {
  const initial = name.trim().charAt(0).toUpperCase() || "C";
  // Real content always wins. Only Players (not yet Studios -- separate
  // stage) fall back to the shared CLOUVA cover artwork when the owner
  // hasn't uploaded their own, so the profile never ships with an empty box.
  const placeholderCoverUrl = kind === "player" ? VISUAL_ASSETS["player-public-profile-cover-01"] : null;
  const resolvedCoverUrl = coverUrl || placeholderCoverUrl;
  const isPlaceholderCover = !coverUrl && Boolean(placeholderCoverUrl);
  return (
    <section className="relative overflow-hidden border-b border-white/10">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_20%,rgba(124,58,237,.28),transparent_42%),linear-gradient(180deg,#0d0a18_0%,#07060b_100%)]" />
      <div className="relative mx-auto max-w-6xl px-4 pb-10 pt-5 sm:px-6 sm:pb-14">
        <div className="relative h-56 overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.03] sm:h-80" data-placeholder-cover={isPlaceholderCover || undefined}>
          {resolvedCoverUrl ? <img src={resolvedCoverUrl} alt="" className="h-full w-full object-cover" /> : null}
          <div className="absolute inset-0 bg-gradient-to-t from-[#07060b] via-[#07060b]/30 to-transparent" />
        </div>

        <div className="relative -mt-16 flex flex-col gap-5 px-3 sm:-mt-20 sm:flex-row sm:items-end sm:justify-between sm:px-8">
          <div className="flex min-w-0 items-end gap-4">
            {profileImageUrl ? (
              <img src={profileImageUrl} alt={name} className="h-28 w-28 shrink-0 rounded-3xl border-4 border-[#07060b] object-cover shadow-2xl sm:h-36 sm:w-36" />
            ) : (
              <div className="flex h-28 w-28 shrink-0 items-center justify-center rounded-3xl border-4 border-[#07060b] bg-gradient-to-br from-violet-500/50 to-black text-4xl font-semibold sm:h-36 sm:w-36">
                {initial}
              </div>
            )}
            <div className="min-w-0 pb-1">
              <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-violet-300/80">{kind === "player" ? "Player" : "Estudio"}</p>
              <h1 className="truncate text-3xl font-bold tracking-tight sm:text-5xl">{name}</h1>
              {username ? <p className="mt-1 text-sm text-white/50">@{username.replace(/^@/, "")}</p> : null}
            </div>
          </div>

          <div className="flex flex-wrap gap-2 pb-1">
            {primaryAction ? <Link href={primaryAction.href} className="rounded-full bg-violet-600 px-5 py-2.5 text-sm font-semibold transition hover:bg-violet-500">{primaryAction.label}</Link> : null}
            {secondaryAction ? <Link href={secondaryAction.href} className="rounded-full border border-white/15 bg-black/30 px-5 py-2.5 text-sm font-semibold transition hover:border-violet-400/60">{secondaryAction.label}</Link> : null}
            <PublicShareButton title={name} />
          </div>
        </div>

        <div className="mt-6 max-w-3xl px-3 sm:px-8">
          {badges.length > 0 ? (
            <div className="mb-3 flex flex-wrap gap-2">
              {badges.map((badge) => (
                <span key={badge} className={badge.toLowerCase() === "vip" ? "rounded-full border border-amber-400/40 bg-amber-400/10 px-3 py-1 text-xs font-semibold text-amber-300" : "rounded-full border border-violet-400/20 bg-violet-400/10 px-3 py-1 text-xs text-violet-200"}>{badge}</span>
              ))}
            </div>
          ) : null}
          {tagline ? <p className="text-base leading-relaxed text-white/75 sm:text-lg">{tagline}</p> : null}
          {location ? <p className="mt-2 text-sm text-white/45">{location}</p> : null}
        </div>
      </div>
    </section>
  );
}
