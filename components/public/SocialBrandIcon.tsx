import type { SocialIconKey } from "@/lib/social-platforms";

type Props = {
  icon: SocialIconKey;
  className?: string;
};

const common = {
  viewBox: "0 0 24 24",
  fill: "none",
  xmlns: "http://www.w3.org/2000/svg",
  "aria-hidden": true,
} as const;

export function SocialBrandIcon({ icon, className = "h-4 w-4" }: Props) {
  if (icon === "instagram") return (
    <svg {...common} className={className}>
      <rect x="3" y="3" width="18" height="18" rx="5" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="4.2" stroke="currentColor" strokeWidth="2" />
      <circle cx="17.4" cy="6.7" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
  if (icon === "spotify") return (
    <svg {...common} className={className}>
      <circle cx="12" cy="12" r="9" fill="currentColor" stroke="none" />
      <path d="M7.2 9.1c3.5-1 7.5-.7 10.2.8M7.8 12.1c3-.8 6.5-.5 8.9.7M8.4 15c2.5-.6 5.2-.4 7.3.6" stroke="var(--social-icon-cutout, #09070f)" strokeWidth="1.45" strokeLinecap="round" />
    </svg>
  );
  if (icon === "youtube") return (
    <svg {...common} className={className}>
      <path d="M21 8.2c-.2-1.5-1.2-2.6-2.7-2.8C16.7 5.1 14.5 5 12 5s-4.7.1-6.3.4C4.2 5.6 3.2 6.7 3 8.2A24 24 0 0 0 2.8 12c0 1.5.1 2.8.2 3.8.2 1.5 1.2 2.6 2.7 2.8 1.6.3 3.8.4 6.3.4s4.7-.1 6.3-.4c1.5-.2 2.5-1.3 2.7-2.8.1-1 .2-2.3.2-3.8s-.1-2.8-.2-3.8Z" fill="currentColor" stroke="none" />
      <path d="m10.2 9.1 5 2.9-5 2.9V9.1Z" fill="var(--social-icon-cutout, #09070f)" stroke="none" />
    </svg>
  );
  if (icon === "soundcloud") return (
    <svg {...common} className={className}>
      <path d="M3 14.3v2.6M5.1 12.7v4.8M7.2 11.4v6.1M9.3 10.2v7.3M11.4 9.5v8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M12.8 17.5h5.3a3.1 3.1 0 0 0 .1-6.2 5 5 0 0 0-9.4-1.6v7.8h4Z" fill="currentColor" stroke="none" />
    </svg>
  );
  if (icon === "x") return (
    <svg {...common} className={className}>
      <path d="M5 4.5h3.5L19 19.5h-3.5L5 4.5Zm10.7 0H19l-5.5 6.3-1.7-2.4 3.9-3.9ZM5 19.5l6-6.8 1.7 2.4-3.7 4.4H5Z" fill="currentColor" stroke="none" />
    </svg>
  );
  if (icon === "facebook") return (
    <svg {...common} className={className}>
      <circle cx="12" cy="12" r="9" fill="currentColor" stroke="none" />
      <path d="M13.4 18v-5h1.8l.3-2.1h-2.1V9.6c0-.6.2-1 1-1h1.2V6.7c-.2 0-.9-.1-1.7-.1-1.7 0-2.8 1-2.8 2.9v1.4H9.2V13h1.9v5h2.3Z" fill="var(--social-icon-cutout, #09070f)" stroke="none" />
    </svg>
  );
  if (icon === "tiktok") return (
    <svg {...common} className={className}>
      <path d="M14.3 4.5c.5 2 1.7 3.3 3.7 3.8v2.8a7.3 7.3 0 0 1-3.7-1.2v5a4.8 4.8 0 1 1-4.1-4.8v2.8a2.1 2.1 0 1 0 1.3 2V4.5h2.8Z" fill="currentColor" stroke="none" />
    </svg>
  );
  if (icon === "apple_music") return (
    <svg {...common} className={className}>
      <rect x="4" y="3" width="16" height="18" rx="4" stroke="currentColor" strokeWidth="1.7" />
      <path d="M14.8 7.4v7.3a2.5 2.5 0 1 1-1.4-2.2V8.6l4-1v5.9a2.5 2.5 0 1 1-1.4-2.2V7.1l-1.2.3Z" fill="currentColor" stroke="none" />
    </svg>
  );
  if (icon === "contact") return (
    <svg {...common} className={className}>
      <rect x="3" y="5" width="18" height="14" rx="3" stroke="currentColor" strokeWidth="1.8" />
      <path d="m5.5 8 6.5 5 6.5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
  return (
    <svg {...common} className={className}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3.5 12h17M12 3c2.1 2.4 3.2 5.4 3.2 9s-1.1 6.6-3.2 9c-2.1-2.4-3.2-5.4-3.2-9S9.9 5.4 12 3Z" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}
