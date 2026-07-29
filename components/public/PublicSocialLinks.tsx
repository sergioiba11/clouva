import type { SocialLink } from "@/lib/players-data";

const labels: Record<string, string> = {
  instagram: "Instagram",
  spotify: "Spotify",
  youtube: "YouTube",
  tiktok: "TikTok",
  soundcloud: "SoundCloud",
  apple_music: "Apple Music",
  website: "Sitio web",
};

export function PublicSocialLinks({ links }: { links: SocialLink[] }) {
  if (links.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {links.map((link) => (
        <a
          key={`${link.platform}-${link.url}`}
          href={link.url}
          target="_blank"
          rel="noreferrer"
          className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-white/75 transition hover:border-violet-400/50 hover:bg-violet-500/10 hover:text-white"
        >
          {link.label || labels[link.platform] || link.platform}
        </a>
      ))}
    </div>
  );
}
