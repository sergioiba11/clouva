import type { CommunityProject } from "@/lib/community-data";

const LINK_FIELDS: { key: keyof CommunityProject; label: string }[] = [
  { key: "youtube_url", label: "YouTube" },
  { key: "apple_music_url", label: "Apple Music" },
  { key: "soundcloud_url", label: "SoundCloud" },
  { key: "bandcamp_url", label: "Bandcamp" },
];

/** Plain link buttons for a project's non-Spotify platforms -- v1 deliberately
 * has no embedded players for these, only Spotify keeps its existing embed
 * (see lib/spotify.ts spotifyEmbedUrl, used separately). */
export function ExternalLinkButtons({ project }: { project: CommunityProject }) {
  const links = LINK_FIELDS.filter((field) => typeof project[field.key] === "string" && project[field.key]);
  if (links.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {links.map((field) => (
        <a
          key={field.key}
          href={project[field.key] as string}
          target="_blank"
          rel="noreferrer"
          className="rounded-full border border-white/20 px-3 py-1 text-xs font-medium text-white/80 transition hover:border-[#8f7cff] hover:text-[#8f7cff]"
        >
          {field.label}
        </a>
      ))}
    </div>
  );
}
