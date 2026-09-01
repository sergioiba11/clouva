import type { SocialLink } from "@/lib/players-data";
import { getSocialPlatformDefinition, normalizeSocialUsername } from "@/lib/social-platforms";
import { SocialBrandIcon } from "./SocialBrandIcon";

export function PublicSocialLinks({ links, playerName }: { links: SocialLink[]; playerName?: string }) {
  if (links.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {links.map((link) => {
        const definition = getSocialPlatformDefinition(link.platform);
        const username = normalizeSocialUsername(link.username);
        const text = link.label?.trim() || username || definition.label;
        const subject = playerName ? ` de ${playerName}` : "";
        return (
          <a
            key={`${definition.platform}-${link.url}`}
            href={link.url}
            target={link.url.startsWith("mailto:") ? undefined : "_blank"}
            rel={link.url.startsWith("mailto:") ? undefined : "noopener noreferrer"}
            aria-label={`Abrir ${definition.label}${subject}`}
            className="group inline-flex max-w-full items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-2 text-sm text-white/75 transition hover:border-[color:var(--public-accent)]/50 hover:bg-[color:var(--public-accent)]/10 hover:text-white [--social-icon-cutout:#09070f]"
          >
            <SocialBrandIcon icon={definition.icon} className="h-4 w-4 shrink-0 text-current" />
            <span className="max-w-[14rem] truncate">{text}</span>
          </a>
        );
      })}
    </div>
  );
}
