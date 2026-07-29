import type { SocialLink } from "@/lib/community-data";

const PLATFORM_LABELS: Record<SocialLink["platform"], string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  discord: "Discord",
  x: "X",
  website: "Sitio web",
};

export function SocialLinks({ links }: { links: SocialLink[] }) {
  if (links.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {links.map((link) => (
        <a
          key={`${link.platform}-${link.url}`}
          href={link.url}
          target="_blank"
          rel="noreferrer"
          className="rounded-full border border-white/20 px-3 py-1.5 text-xs font-medium text-white/80 transition hover:border-[#8f7cff] hover:text-[#8f7cff]"
        >
          {PLATFORM_LABELS[link.platform]}
        </a>
      ))}
    </div>
  );
}
