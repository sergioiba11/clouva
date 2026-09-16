import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { PublicShareButton } from "./PublicShareButton";
import { studioPublicHref } from "@/lib/public-studio-routes";
import {
  parsePlayerSocialLinks,
  type Player,
  type PlayerMedia,
  type PlayerStudioAffiliation,
} from "@/lib/players-data";
import type {
  BlurPreset,
  ButtonStyle,
  Decoration,
  FontFamilyToken,
  HeaderConfig,
  ImageSlot,
  LayoutConfig,
  LayoutSectionType,
  PositionedElement,
  PreciseSection,
  ShadowPreset,
} from "@/lib/server/layout-config";

const SECTION_ANCHOR: Record<LayoutSectionType, string> = {
  hero: "inicio", about: "sobre", pillars: "pilares", gallery: "galeria", roster: "estudios",
  services: "servicios", membership: "membresias", music: "musica", contact: "contacto",
};
const BUTTON_CLASS: Record<ButtonStyle, string> = {
  solid: "bg-[color:var(--public-accent)] text-white",
  outline: "border border-white/20 bg-black/25 text-white",
  gradient: "bg-gradient-to-r from-[color:var(--public-accent)] to-black text-white",
  glow: "border border-[color:var(--public-accent)]/60 bg-black/35 text-white shadow-[0_0_24px_-5px_var(--public-accent)]",
};
const FONT_STACK: Record<FontFamilyToken, string> = {
  system: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  display: '"Arial Black", Impact, ui-sans-serif, system-ui, sans-serif',
  editorial: 'Georgia, "Times New Roman", serif',
  sans: 'Arial, Helvetica, ui-sans-serif, sans-serif',
  condensed: '"Arial Narrow", "Roboto Condensed", Arial, sans-serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  serif: 'Georgia, Cambria, "Times New Roman", serif',
};
const SHADOW_STYLE: Record<ShadowPreset, string | undefined> = {
  none: undefined, soft: "0 8px 28px rgba(0,0,0,.18)", medium: "0 16px 44px rgba(0,0,0,.28)",
  strong: "0 24px 72px rgba(0,0,0,.42)", glow: "0 0 32px color-mix(in srgb, var(--public-accent) 55%, transparent)",
};
const BLUR_STYLE: Record<BlurPreset, string | undefined> = { none: undefined, soft: "blur(6px)", medium: "blur(12px)", strong: "blur(20px)" };

function studioPresentation(studio: NonNullable<PlayerStudioAffiliation["studio"]>) {
  return {
    name: studio.public_name || studio.share_title || studio.name,
    href: studio.public_href || studioPublicHref(studio.public_alias || studio.slug),
    logo: studio.official_logo_url || studio.logo_url,
  };
}

function mobileFontCap(element: PositionedElement) {
  switch (element.type) {
    case "heading": return 48;
    case "subheading": return 34;
    case "button": return 16;
    case "badge": return 14;
    case "eyebrow": return 14;
    case "paragraph": return 18;
    default: return 20;
  }
}

export function PrecisePlayerLayoutRenderer({
  player,
  affiliations,
  media,
  layout,
}: {
  player: Player;
  affiliations: PlayerStudioAffiliation[];
  media: PlayerMedia[];
  layout: LayoutConfig;
}) {
  const socials = parsePlayerSocialLinks(player.social_links);
  const accent = layout.page_style?.palette?.accent || player.accent_color || "#8f7cff";
  const sections = layout.precise_sections;
  const nav = layout.nav_items?.length
    ? layout.nav_items.map((item) => ({ label: item.label, href: `#${SECTION_ANCHOR[item.section]}` }))
    : sections.filter((section) => section.type !== "hero").map((section) => ({ label: section.type.toUpperCase(), href: `#${SECTION_ANCHOR[section.type]}` }));

  function realMediaUrl(index: number) {
    const item = media[index];
    return item?.public_url || item?.thumbnail_url || item?.source_url || null;
  }
  function resolveImage(slot: ImageSlot | null | undefined) {
    if (!slot) return null;
    const explicit = layout.image_slots[slot];
    if (explicit) return explicit;
    if (slot === "logo" || slot === "brand-lockup") return player.logo_url || player.profile_image_url;
    if (slot === "avatar" || slot === "player-0") return player.profile_image_url;
    if (slot === "cover" || slot === "hero-primary" || slot === "background-0") return player.hero_image_url || player.cover_url || player.profile_image_url;
    const match = /^(gallery|media|background)-(\d+)$/.exec(slot);
    if (match) return realMediaUrl(Number(match[2]));
    return null;
  }
  function elementStyle(element: PositionedElement, absolute: boolean): CSSProperties {
    const style: CSSProperties = absolute
      ? { position: "absolute", left: `${element.x}%`, top: `${element.y}%`, width: `${element.w}%`, height: element.h != null ? `${element.h}%` : undefined, zIndex: element.zIndex ?? undefined }
      : {
          width: `${Math.min(100, Math.max(10, element.mobile?.w ?? 100))}%`,
          maxWidth: "100%",
          minWidth: 0,
          height: "auto",
          order: element.mobile?.order ?? undefined,
          alignSelf: element.mobile?.align === "center" ? "center" : element.mobile?.align === "right" ? "flex-end" : "stretch",
          overflowWrap: "anywhere",
          wordBreak: "break-word",
        };
    if (element.fontSizePx) {
      if (absolute) style.fontSize = `${element.fontSizePx}px`;
      else {
        const max = Math.min(element.fontSizePx, mobileFontCap(element));
        const min = Math.max(10, Math.min(max, Math.round(max * 0.72)));
        style.fontSize = `clamp(${min}px, ${Math.min(10, Math.max(4, max / 5))}vw, ${max}px)`;
      }
    }
    if (element.fontWeight) style.fontWeight = element.fontWeight;
    if (element.fontFamilyToken) style.fontFamily = FONT_STACK[element.fontFamilyToken];
    if (element.textTransform) style.textTransform = element.textTransform;
    if (element.letterSpacingPx != null) style.letterSpacing = `${absolute ? element.letterSpacingPx : Math.min(4, Math.max(-2, element.letterSpacingPx))}px`;
    if (element.lineHeight != null) style.lineHeight = absolute ? element.lineHeight : Math.max(1, Math.min(1.7, element.lineHeight));
    if (element.align) style.textAlign = element.align;
    if (element.color) style.color = element.color;
    if (element.backgroundColor) style.backgroundColor = element.backgroundColor;
    if (element.opacity != null) style.opacity = element.opacity;
    if (element.borderColor) style.borderColor = element.borderColor;
    if (element.borderWidthPx != null) { style.borderWidth = `${element.borderWidthPx}px`; style.borderStyle = "solid"; }
    if (element.radiusPx != null) style.borderRadius = `${element.radiusPx}px`;
    if (element.shadow) style.boxShadow = SHADOW_STYLE[element.shadow];
    if (element.blur) style.backdropFilter = BLUR_STYLE[element.blur];
    return style;
  }
  function renderDynamic(element: PositionedElement): ReactNode {
    const index = element.dataIndex ?? 0;
    switch (element.widget) {
      case "gallery-item":
      case "media-card": {
        const src = realMediaUrl(index);
        return src ? <img src={src} alt="" className="h-full w-full object-cover" /> : <div className="h-full w-full border border-dashed border-white/15" />;
      }
      case "player-card":
        return <div className="flex h-full min-w-0 items-center gap-3 border border-white/10 bg-black/25 p-3">{player.profile_image_url ? <img src={player.profile_image_url} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover" /> : null}<div className="min-w-0"><p className="truncate font-semibold">{player.display_name}</p><p className="text-xs text-white/45">{player.primary_role || "Player"}</p></div></div>;
      case "social-link": {
        const social = socials[index] || socials[0];
        return social ? <a href={social.url} target="_blank" rel="noreferrer" className="flex min-h-11 h-full items-center justify-center border border-white/15 bg-black/25 px-3 text-center text-xs font-semibold uppercase tracking-[.12em]">{social.label || social.platform}</a> : null;
      }
      case "project-card":
      case "release-card":
      case "featured-release":
      case "now-playing": {
        const audio = media.find((item) => item.media_type === "audio" || item.media_type === "embed") || null;
        const href = audio?.public_url || audio?.source_url || player.spotify_profile_url || player.youtube_channel_url;
        return <article className="flex h-full min-w-0 flex-col justify-center border border-white/10 bg-black/30 p-4"><p className="text-xs uppercase tracking-[.15em] text-white/40">Música</p><h3 className="mt-2 break-words font-semibold">{audio?.caption || player.display_name}</h3>{href ? <a href={href} target="_blank" rel="noreferrer" className="mt-3 text-sm font-semibold text-[color:var(--public-accent)]">Escuchar</a> : <span className="mt-3 text-xs text-white/35">Sin reproducción disponible</span>}</article>;
      }
      case "stat": return <div className="flex h-full items-center"><strong className="text-3xl">{element.text || affiliations.length}</strong></div>;
      case "section-title": return <h2 className="flex h-full items-center text-2xl font-semibold">{element.text || ""}</h2>;
      case "cta": {
        const href = player.spotify_profile_url || player.youtube_channel_url || (player.booking_email ? `mailto:${player.booking_email}` : null);
        return href ? <a href={href} target={href.startsWith("mailto:") ? undefined : "_blank"} rel={href.startsWith("mailto:") ? undefined : "noreferrer"} className="flex min-h-11 h-full items-center justify-center bg-[color:var(--public-accent)] px-4 text-center text-sm font-semibold">{element.text || "Ver más"}</a> : <span className="flex min-h-11 h-full items-center justify-center border border-white/15 px-3 text-center text-sm text-white/50">{element.text || "Sin acción disponible"}</span>;
      }
      default: return null;
    }
  }
  function action(element: PositionedElement): ReactNode {
    if (element.action === "share") return <PublicShareButton title={player.display_name} />;
    const href = element.action?.startsWith("scroll:") ? `#${SECTION_ANCHOR[element.action.slice(7) as LayoutSectionType]}` : null;
    if (!href) return <span className={`flex min-h-11 h-full w-full items-center justify-center px-4 text-center text-sm font-semibold ${BUTTON_CLASS[element.buttonStyle || "outline"]}`}>{element.text || "Acción"}</span>;
    return <Link href={href} className={`flex min-h-11 h-full w-full items-center justify-center px-4 text-center text-sm font-semibold ${BUTTON_CLASS[element.buttonStyle || "outline"]}`}>{element.text || "Ver"}</Link>;
  }
  function renderElement(element: PositionedElement, index: number, absolute: boolean): ReactNode {
    if (!absolute && element.mobile?.hidden) return null;
    const style = elementStyle(element, absolute), key = element.id || index;
    if (element.type === "image") { const src = resolveImage(element.imageSlot); return src ? <img key={key} src={src} alt="" style={{ ...style, objectFit: element.imageFit || "cover", objectPosition: element.imagePosition || "center" }} /> : null; }
    if (element.type === "dynamic") return <div key={key} className="min-w-0" style={style}>{renderDynamic(element)}</div>;
    if (element.type === "button") return <div key={key} className="min-w-0" style={style}>{action(element)}</div>;
    if (!element.text) return null;
    if (element.type === "heading") return <h1 key={key} style={style}>{element.text}</h1>;
    if (element.type === "subheading") return <h2 key={key} style={style}>{element.text}</h2>;
    if (element.type === "badge") return <span key={key} style={style}>{element.text}</span>;
    return <p key={key} style={style}>{element.text}</p>;
  }
  function decoration(decoration: Decoration, index: number): ReactNode {
    const style: CSSProperties = { position: "absolute", left: `${decoration.x}%`, top: `${decoration.y}%`, width: decoration.w ? `${decoration.w}%` : undefined, height: decoration.h ? `${decoration.h}%` : undefined, opacity: decoration.opacity ?? undefined, color: decoration.color ?? undefined, backgroundColor: decoration.backgroundColor ?? undefined, borderColor: decoration.borderColor ?? undefined, borderWidth: decoration.borderWidthPx ? `${decoration.borderWidthPx}px` : undefined, borderStyle: decoration.borderWidthPx ? "solid" : undefined, borderRadius: decoration.radiusPx != null ? `${decoration.radiusPx}px` : undefined, filter: decoration.blur ? BLUR_STYLE[decoration.blur] : undefined };
    if (decoration.type === "vertical-label") return <div key={decoration.id || index} style={{ ...style, writingMode: "vertical-rl" }}>{decoration.text}</div>;
    if (decoration.type === "scroll-indicator") return <div key={decoration.id || index} style={style} className="text-[10px] uppercase tracking-[.2em] text-white/55">Scroll</div>;
    if (decoration.type === "waveform") return <div key={decoration.id || index} style={style} className="flex items-end gap-[3px]">{Array.from({ length: 20 }).map((_, i) => <span key={i} className="w-[3px] bg-current" style={{ height: `${7 + (i * 19) % 20}px` }} />)}</div>;
    return <div key={decoration.id || index} style={style} />;
  }
  function dynamicSection(section: PreciseSection, index: number): ReactNode {
    if (section.type === "gallery" && media.length) return <section key={section.id || index} id={SECTION_ANCHOR.gallery} className="mx-auto max-w-6xl px-5 py-10"><h2 className="text-2xl font-semibold">{section.styleHint?.heading || "Galería"}</h2><div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3">{media.slice(0, 6).map((item) => { const src = item.public_url || item.thumbnail_url || item.source_url; return src ? <img key={item.id} src={src} alt="" className="aspect-square w-full object-cover" /> : null; })}</div></section>;
    if (section.type === "roster" && affiliations.length) return <section key={section.id || index} id={SECTION_ANCHOR.roster} className="mx-auto max-w-6xl px-5 py-10"><h2 className="text-2xl font-semibold">{section.styleHint?.heading || "Estudios"}</h2><div className="mt-5 grid gap-3 md:grid-cols-3">{affiliations.map((entry, i) => { if (!entry.studio) return null; const publicStudio = studioPresentation(entry.studio); return <Link key={`${entry.studio.id}-${i}`} href={publicStudio.href} className="flex min-w-0 items-center gap-3 border border-white/10 bg-black/25 p-4">{publicStudio.logo ? <img src={publicStudio.logo} alt="" className="h-12 w-12 shrink-0 object-contain" /> : null}<div className="min-w-0"><p className="truncate font-semibold">{publicStudio.name}</p><p className="text-xs text-white/45">{entry.role || entry.area_label || "Studio"}</p></div></Link>; })}</div></section>;
    return null;
  }
  function backgroundLayer(section: PreciseSection, bg: string | null) {
    return <>{bg ? <img src={bg} alt="" className="absolute inset-0 h-full w-full" style={{ objectFit: section.background?.fit || "cover", objectPosition: section.background?.position || "center" }} /> : null}{section.background?.overlayOpacity ? <div className="absolute inset-0 bg-black" style={{ opacity: section.background.overlayOpacity }} /> : null}</>;
  }
  function section(section: PreciseSection, index: number): ReactNode {
    if (section.styleHint && (!section.elements || section.elements.length === 0)) return dynamicSection(section, index);
    const bg = section.background?.imageSlot ? resolveImage(section.background.imageSlot) : null;
    const desktopStyle: CSSProperties = { minHeight: `${section.heightVh}vh`, height: `${section.heightVh}vh`, width: section.widthPct ? `${section.widthPct}%` : "100%", marginLeft: section.xPct ? `${section.xPct}%` : undefined, backgroundColor: section.background?.color || "#07060b" };
    const mobileMinHeight = Math.min(65, Math.max(24, Math.round(section.heightVh * 0.32)));
    return <section key={section.id || index} id={SECTION_ANCHOR[section.type]} className="relative w-full overflow-hidden bg-[#07060b]">
      <div className="relative hidden overflow-hidden md:block" style={desktopStyle}>{backgroundLayer(section, bg)}<div className="relative h-full">{(section.elements || []).map((element, i) => renderElement(element, i, true))}{(section.decorations || []).map(decoration)}</div></div>
      <div className="relative min-w-0 overflow-hidden md:hidden" style={{ minHeight: `${mobileMinHeight}vh`, backgroundColor: section.background?.color || "#07060b" }}>{backgroundLayer(section, bg)}<div className="relative flex min-w-0 flex-col gap-3 overflow-x-hidden px-5 py-8">{(section.elements || []).map((element, i) => renderElement(element, i, false))}</div></div>
    </section>;
  }

  return <div className="relative min-h-screen max-w-full overflow-x-hidden bg-[#07060b] text-white" style={{ ["--public-accent" as string]: accent }}><PlayerHeader config={layout.header} player={player} layout={layout} nav={nav} resolveImage={resolveImage} /><main>{sections.map(section)}</main><footer className="border-t border-white/10 px-5 py-8 text-center text-xs text-white/40">{socials.length ? <div className="mb-4 flex flex-wrap justify-center gap-4">{socials.map((social) => <a key={`${social.platform}-${social.url}`} href={social.url} target="_blank" rel="noreferrer">{social.label || social.platform}</a>)}</div> : null}{player.display_name} · CLOUVA</footer></div>;
}

function PlayerHeader({ config, player, layout, nav, resolveImage }: { config: HeaderConfig | null | undefined; player: Player; layout: LayoutConfig; nav: Array<{ label: string; href: string }>; resolveImage: (slot: ImageSlot | null | undefined) => string | null }) {
  const header = config || { mode: layout.page_style?.header_overlay ? "overlay" : "normal" } as HeaderConfig;
  const brand = header.brand?.imageSlot ? resolveImage(header.brand.imageSlot) : player.logo_url || player.profile_image_url;
  const position: CSSProperties["position"] = header.mode === "sticky" ? "sticky" : header.mode === "overlay" || header.mode === "floating" ? "absolute" : "relative";
  return <header className="z-40 max-w-full" style={{ position, top: header.mode === "sticky" ? 0 : header.yPx || 0, left: header.xPct ? `${header.xPct}%` : 0, width: header.widthPct ? `${header.widthPct}%` : "100%", minHeight: header.heightPx || 64, backgroundColor: header.backgroundColor || (header.mode === "normal" ? "rgba(7,6,11,.92)" : "transparent"), opacity: header.opacity ?? 1, backdropFilter: header.blur ? BLUR_STYLE[header.blur] : undefined, borderColor: header.borderColor || undefined, borderWidth: header.borderWidthPx ? `${header.borderWidthPx}px` : undefined, borderStyle: header.borderWidthPx ? "solid" : undefined, borderRadius: header.radiusPx ? `${header.radiusPx}px` : undefined }}><div className="mx-auto flex min-h-16 max-w-7xl items-center gap-3 overflow-hidden px-4 sm:gap-5 sm:px-5">{brand ? <img src={brand} alt={player.display_name} className="shrink-0" style={{ width: Math.min(header.brand?.widthPx || 34, 120), height: Math.min(header.brand?.heightPx || 34, 72), objectFit: header.brand?.fit || "contain" }} /> : null}{header.brand?.showText !== false ? <span className="min-w-0 truncate font-semibold">{player.display_name}</span> : null}<nav className="ml-auto hidden items-center md:flex" style={{ gap: `${header.nav?.gapPx || 22}px`, fontFamily: header.nav?.fontFamilyToken ? FONT_STACK[header.nav.fontFamilyToken] : undefined, fontSize: header.nav?.fontSizePx || 13, textTransform: header.nav?.uppercase ? "uppercase" : undefined }}>{nav.map((item) => <Link key={item.href} href={item.href} className="text-white/65 hover:text-white">{item.label}</Link>)}</nav>{header.cta ? <span className={`ml-auto shrink-0 px-3 py-2 text-center text-[11px] font-semibold md:ml-0 md:px-4 md:text-xs ${BUTTON_CLASS[header.cta.buttonStyle || "outline"]}`}>{header.cta.label || "Ver más"}</span> : null}</div></header>;
}
