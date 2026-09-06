import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { PublicMediaGallery } from "./PublicMediaGallery";
import { PublicShareButton } from "./PublicShareButton";
import { StudioServicesCart } from "./StudioServicesCart";
import { StudioManageButton } from "./StudioManageButton";
import { formatPlanPrice, studioSocialLinks } from "./StudioPublicView";
import { CustomShell, LAYOUT_ICON_MAP, RADIUS_CLASS, SECTION_ANCHOR, SECTION_NAV_LABEL, renderMusicSection } from "./StudioLayoutRenderer";
import type {
  BlurPreset,
  ButtonStyle,
  Decoration,
  ImageFit,
  ImagePosition,
  LayoutConfig,
  LayoutSectionType,
  PositionedElement,
  PreciseSection,
  RealAction,
  ShadowPreset,
} from "@/lib/server/layout-config";
import type { PlayerMedia, StudioMembershipPlan, StudioPlayer, StudioRow, StudioService } from "@/lib/players-data";

type CustomNavLink = { label: string; href: string };

const BUTTON_STYLE_CLASS: Record<ButtonStyle, string> = {
  solid: "bg-[color:var(--public-accent)] text-white hover:opacity-90",
  outline: "border border-white/20 bg-black/30 text-white hover:border-[color:var(--public-accent)]/60",
  gradient: "bg-gradient-to-r from-[color:var(--public-accent)] to-black text-white hover:opacity-90",
  glow: "border border-[color:var(--public-accent)]/60 bg-black/40 text-white shadow-[0_0_24px_-4px_var(--public-accent)] hover:shadow-[0_0_32px_-2px_var(--public-accent)]",
};

const HEADER_OVERLAY_SAFE_TOP_PX = 96;
const IMAGE_FIT_CLASS: Record<ImageFit, string> = { cover: "object-cover", contain: "object-contain" };
const IMAGE_POSITION_CLASS: Record<ImagePosition, string> = {
  center: "object-center",
  top: "object-top",
  bottom: "object-bottom",
  left: "object-left",
  right: "object-right",
};

const SHADOW_STYLE: Record<ShadowPreset, string | undefined> = {
  none: undefined,
  soft: "0 8px 28px rgba(0,0,0,.18)",
  medium: "0 16px 44px rgba(0,0,0,.28)",
  strong: "0 24px 72px rgba(0,0,0,.42)",
  glow: "0 0 32px color-mix(in srgb, var(--public-accent) 55%, transparent)",
};

const BLUR_STYLE: Record<BlurPreset, string | undefined> = {
  none: undefined,
  soft: "blur(6px)",
  medium: "blur(12px)",
  strong: "blur(20px)",
};

function objectPosition(position: ImagePosition | null | undefined): CSSProperties["objectPosition"] {
  switch (position) {
    case "top": return "center top";
    case "bottom": return "center bottom";
    case "left": return "left center";
    case "right": return "right center";
    default: return "center center";
  }
}

export function PreciseStudioLayoutRenderer({
  studio,
  players,
  media,
  projects,
  matrixDiscoveryProjects = [],
  services,
  membershipPlans = [],
  joined = false,
  layout,
}: {
  studio: StudioRow;
  players: StudioPlayer[];
  media: PlayerMedia[];
  projects: Array<Record<string, unknown>>;
  matrixDiscoveryProjects?: Array<Record<string, unknown>>;
  services: StudioService[];
  membershipPlans?: StudioMembershipPlan[];
  joined?: boolean;
  layout: LayoutConfig;
}) {
  const isV2 = layout.schema_version === 2;
  const headerOverlay = layout.page_style?.header_overlay ?? false;
  const links = studioSocialLinks(studio);
  const musicLinks = links.filter((link) => link.platform === "spotify" || link.platform === "youtube");
  const defaultMembershipPlan = membershipPlans.find((plan) => plan.is_free) ?? membershipPlans[0] ?? null;
  const joinHref = defaultMembershipPlan
    ? `/studios/${studio.slug}/checkout${defaultMembershipPlan.is_free ? "" : `?plan=${defaultMembershipPlan.slug}`}`
    : `/studios/${studio.slug}/join`;

  const hasRoster = layout.precise_sections.some((section) => section.type === "roster");
  const sections: PreciseSection[] = players.length && !hasRoster
    ? [...layout.precise_sections, { type: "roster", heightVh: 60, elements: [], styleHint: { heading: "Players", cardStyle: "bordered" } }]
    : layout.precise_sections;
  const includedTypes = new Set(sections.map((section) => section.type));
  const radiusClass = RADIUS_CLASS[layout.page_style?.radius ?? "medium"];

  const joinTargetHref = joined && includedTypes.has("roster") ? `#${SECTION_ANCHOR.roster}` : joinHref;
  const headerJoinAction = { label: joined ? "Ya sos miembro" : "Unirme", href: joinTargetHref };

  const navLinks: CustomNavLink[] = layout.nav_items?.length
    ? layout.nav_items.map((item) => ({ label: item.label, href: `#${SECTION_ANCHOR[item.section]}` }))
    : sections.filter((section) => section.type !== "hero").map((section) => ({ label: SECTION_NAV_LABEL[section.type], href: `#${SECTION_ANCHOR[section.type]}` }));
  if (players.length && includedTypes.has("roster") && !navLinks.some((link) => link.href === `#${SECTION_ANCHOR.roster}`)) {
    navLinks.push({ label: "Players", href: `#${SECTION_ANCHOR.roster}` });
  }

  const footer = layout.footer && includedTypes.has(layout.footer.cta_section) ? (
    <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 sm:flex-row sm:justify-between">
      <p className="text-sm text-white/60">{layout.footer.heading}</p>
      <Link href={`#${SECTION_ANCHOR[layout.footer.cta_section]}`} className="rounded-xl bg-[color:var(--public-accent)] px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90">
        {layout.footer.cta_label}
      </Link>
    </div>
  ) : undefined;

  function resolveScrollHref(target: LayoutSectionType): string | null {
    return includedTypes.has(target) ? `#${SECTION_ANCHOR[target]}` : null;
  }

  function boxStyle(element: PositionedElement, absolute: boolean): CSSProperties {
    const style: CSSProperties = absolute
      ? {
          position: "absolute",
          left: `${element.x}%`,
          top: `${element.y}%`,
          width: `${element.w}%`,
          overflowWrap: "break-word",
        }
      : {
          width: element.mobile?.w ? `${element.mobile.w}%` : undefined,
          order: element.mobile?.order ?? undefined,
          alignSelf: element.mobile?.align === "center" ? "center" : element.mobile?.align === "right" ? "flex-end" : "flex-start",
        };

    if (absolute && element.h !== null && element.h !== undefined) style.height = `${element.h}%`;
    if (element.zIndex !== null && element.zIndex !== undefined) style.zIndex = element.zIndex;
    if (element.fontSizePx) style.fontSize = `${element.fontSizePx}px`;
    if (element.fontWeight) style.fontWeight = element.fontWeight;
    if (element.color) style.color = element.color;
    if (element.align) style.textAlign = element.align;
    if (element.letterSpacingPx !== null && element.letterSpacingPx !== undefined) style.letterSpacing = `${element.letterSpacingPx}px`;
    if (element.lineHeight !== null && element.lineHeight !== undefined) style.lineHeight = element.lineHeight;
    if (element.opacity !== null && element.opacity !== undefined) style.opacity = element.opacity;
    return style;
  }

  function surfaceStyle(element: PositionedElement): CSSProperties {
    const style: CSSProperties = {};
    if (element.backgroundColor) style.backgroundColor = element.backgroundColor;
    if (element.borderColor) style.borderColor = element.borderColor;
    if (element.borderWidthPx !== null && element.borderWidthPx !== undefined) {
      style.borderWidth = `${element.borderWidthPx}px`;
      style.borderStyle = "solid";
    }
    if (element.radiusPx !== null && element.radiusPx !== undefined) style.borderRadius = `${element.radiusPx}px`;
    if (element.shadow) style.boxShadow = SHADOW_STYLE[element.shadow];
    if (element.blur) style.backdropFilter = BLUR_STYLE[element.blur];
    return style;
  }

  function renderActionButton(element: PositionedElement): ReactNode {
    const label = element.text || "Unirme";
    const action = element.action as RealAction | null | undefined;
    const Icon = element.icon ? LAYOUT_ICON_MAP[element.icon] : null;
    const iconNode = Icon ? <Icon className="h-4 w-4" /> : null;

    if (action === "share") return <PublicShareButton title={studio.name} />;

    const styleClass = BUTTON_STYLE_CLASS[element.buttonStyle ?? (action === "join" ? "solid" : "outline")];
    const visualStyle: CSSProperties = isV2
      ? {
          ...surfaceStyle(element),
          width: "100%",
          height: "100%",
          minHeight: element.h ? undefined : "38px",
          padding: element.h ? "0 12px" : "8px 16px",
        }
      : {};
    const commonClass = isV2
      ? `inline-flex items-center justify-center gap-2 text-sm font-semibold transition ${styleClass}`
      : `inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition ${styleClass}`;

    if (action === "join") {
      return (
        <Link href={joinTargetHref} className={commonClass} style={visualStyle}>
          {iconNode}
          {joined ? "Ya sos miembro" : label}
        </Link>
      );
    }

    if (action?.startsWith("scroll:")) {
      const target = action.slice("scroll:".length) as LayoutSectionType;
      const href = resolveScrollHref(target);
      if (href) {
        return (
          <Link href={href} className={commonClass} style={visualStyle}>
            {iconNode}
            {label}
          </Link>
        );
      }
    }

    return (
      <span className={`${commonClass} opacity-80`} style={visualStyle}>
        {iconNode}
        {label}
      </span>
    );
  }

  function renderDecoration(decoration: Decoration, decIndex: number): ReactNode {
    const style: CSSProperties = {
      position: "absolute",
      left: `${decoration.x}%`,
      top: `${decoration.y}%`,
      width: decoration.w ? `${decoration.w}%` : undefined,
      height: decoration.h ? `${decoration.h}%` : undefined,
      zIndex: decoration.zIndex ?? undefined,
      opacity: decoration.opacity ?? undefined,
    };
    const key = decoration.id ?? decIndex;

    switch (decoration.type) {
      case "waveform":
        return (
          <div key={key} style={style} className="flex items-end gap-[3px]">
            {Array.from({ length: 24 }).map((_, barIndex) => (
              <span key={barIndex} className="w-[3px] rounded-full bg-white/60" style={{ height: `${8 + ((barIndex * 37) % 20)}px` }} />
            ))}
          </div>
        );
      case "scroll-indicator":
        return (
          <div key={key} style={style} className="flex flex-col items-center gap-2 text-[10px] font-medium uppercase tracking-[0.2em] text-white/60">
            <span className="flex h-8 w-5 items-start justify-center rounded-full border border-white/40 p-1"><span className="h-1.5 w-1.5 rounded-full bg-white/70" /></span>
            Scroll
          </div>
        );
      case "vertical-label":
        return decoration.text ? <div key={key} style={{ ...style, writingMode: "vertical-rl" }} className="text-[10px] uppercase tracking-[0.3em] text-white/40">{decoration.text}</div> : null;
      case "divider-line":
        return <div key={key} style={{ ...style, width: decoration.w ? `${decoration.w}%` : "1px", height: decoration.h ? `${decoration.h}%` : "60px" }} className="bg-white/15" />;
      default:
        return null;
    }
  }

  function renderElement(element: PositionedElement, elIndex: number, absolute: boolean): ReactNode {
    if (!absolute && element.mobile?.hidden) return null;
    const style = boxStyle(element, absolute);
    const mergedStyle = isV2 ? { ...style, ...surfaceStyle(element) } : style;
    const key = element.id ?? elIndex;

    switch (element.type) {
      case "image": {
        const src = element.imageSlot ? layout.image_slots[element.imageSlot] : undefined;
        if (!src) return null;
        if (isV2) {
          return (
            <img
              key={key}
              src={src}
              alt=""
              style={{
                ...mergedStyle,
                objectFit: element.imageFit ?? "cover",
                objectPosition: objectPosition(element.imagePosition),
              }}
              className={absolute ? "pointer-events-none" : "block max-w-full"}
            />
          );
        }
        return <img key={key} src={src} alt="" style={style} className={absolute ? "pointer-events-none rounded-lg object-cover" : "w-full rounded-lg object-cover"} />;
      }
      case "button":
        return <div key={key} style={style}>{renderActionButton(element)}</div>;
      case "badge":
        return element.text ? <span key={key} style={mergedStyle} className={isV2 ? "inline-flex items-center" : "inline-block rounded-full border border-white/20 bg-black/30 px-3 py-1 text-xs text-white/80"}>{element.text}</span> : null;
      case "eyebrow":
        return element.text ? <p key={key} style={mergedStyle} className={isV2 ? "flex items-center" : "flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.28em] text-[color:var(--public-accent)]"}>{element.text}</p> : null;
      case "heading":
        return element.text ? <h1 key={key} style={mergedStyle} className={isV2 ? "text-white" : "font-bold leading-tight text-white"}>{element.text}</h1> : null;
      case "subheading":
        return element.text ? <h2 key={key} style={mergedStyle} className={isV2 ? "text-white/85" : "font-semibold leading-snug text-white/85"}>{element.text}</h2> : null;
      case "paragraph":
      default:
        return element.text ? <p key={key} style={mergedStyle} className={isV2 ? "text-white/70" : "leading-relaxed text-white/70"}>{element.text}</p> : null;
    }
  }

  function sectionOuterStyle(section: PreciseSection): CSSProperties {
    const style: CSSProperties = {
      height: `${section.heightVh}vh`,
      minHeight: `${section.heightVh}vh`,
      backgroundColor: section.background?.color || "#07060b",
    };
    if (isV2 && section.widthPct && section.widthPct < 99.5) style.width = `${section.widthPct}%`;
    if (isV2 && section.xPct) style.marginLeft = `${section.xPct}%`;
    return style;
  }

  function renderSectionBackground(section: PreciseSection): ReactNode {
    const bgImage = section.background?.imageSlot ? layout.image_slots[section.background.imageSlot] : undefined;
    if (!bgImage) return null;
    const fitClass = IMAGE_FIT_CLASS[section.background?.fit ?? "cover"];
    const positionClass = IMAGE_POSITION_CLASS[section.background?.position ?? "center"];
    const overlayOpacity = isV2 ? (section.background?.overlayOpacity ?? 0) : 0.35;
    return (
      <>
        <img src={bgImage} alt="" className={`absolute inset-0 h-full w-full ${fitClass} ${positionClass}`} />
        {overlayOpacity > 0 ? <div className="absolute inset-0 bg-black" style={{ opacity: overlayOpacity }} /> : null}
      </>
    );
  }

  function renderStaticSection(section: PreciseSection, index: number): ReactNode {
    const elements = section.elements ?? [];
    const decorations = section.decorations ?? [];
    return (
      <section
        key={section.id ?? index}
        id={SECTION_ANCHOR[section.type]}
        className={`relative md:overflow-hidden ${isV2 ? "" : "w-full border-b border-white/10"}`}
        style={sectionOuterStyle(section)}
      >
        {renderSectionBackground(section)}
        <div className="relative hidden h-full md:block">
          <div className="absolute inset-0" style={!isV2 && headerOverlay && index === 0 ? { top: HEADER_OVERLAY_SAFE_TOP_PX } : undefined}>
            {elements.map((element, elIndex) => renderElement(element, elIndex, true))}
            {decorations.map((decoration, decIndex) => renderDecoration(decoration, decIndex))}
          </div>
        </div>
        <div className="relative flex flex-col gap-3 px-5 py-8 md:hidden">
          {elements.map((element, elIndex) => renderElement(element, elIndex, false))}
        </div>
      </section>
    );
  }

  function renderColumn(column: PreciseSection, colIndex: number, columnCount: number): ReactNode {
    const widthStyle: CSSProperties = column.widthPct ? { flex: `0 0 ${column.widthPct}%` } : { flex: `1 1 ${100 / columnCount}%` };
    if (isV2 && column.xPct) widthStyle.marginLeft = `${column.xPct}%`;

    if (column.styleHint) {
      return <div key={column.id ?? colIndex} className="relative min-w-0" style={widthStyle}>{renderDynamicSection(column, colIndex)}</div>;
    }

    const elements = column.elements ?? [];
    return (
      <div key={column.id ?? colIndex} className="relative h-full min-w-0" style={widthStyle}>
        {elements.map((element, elIndex) => renderElement(element, elIndex, true))}
        {(column.decorations ?? []).map((decoration, decIndex) => renderDecoration(decoration, decIndex))}
      </div>
    );
  }

  function renderColumnsSection(section: PreciseSection, index: number): ReactNode {
    const columns = section.columns ?? [];
    const gapPx = section.styleHint?.gapPx ?? 32;
    const paddingPx = section.styleHint?.paddingPx ?? 40;
    return (
      <section
        key={section.id ?? index}
        id={SECTION_ANCHOR[section.type]}
        className={`relative ${isV2 ? "" : "w-full border-b border-white/10"}`}
        style={sectionOuterStyle(section)}
      >
        {renderSectionBackground(section)}
        <div className="relative mx-auto flex h-full max-w-7xl flex-col md:flex-row md:items-stretch" style={{ gap: gapPx, padding: paddingPx }}>
          {columns.map((column, colIndex) => renderColumn(column, colIndex, columns.length))}
        </div>
      </section>
    );
  }

  function dynamicWrapperStyle(section: PreciseSection): CSSProperties {
    const hint = section.styleHint;
    const style: CSSProperties = {};
    if (section.background?.color) style.backgroundColor = section.background.color;
    if (hint?.backgroundColor) style.backgroundColor = hint.backgroundColor;
    if (hint?.borderColor) {
      style.borderColor = hint.borderColor;
      style.borderStyle = "solid";
      style.borderWidth = "1px";
    }
    if (hint?.radiusPx !== null && hint?.radiusPx !== undefined) style.borderRadius = `${hint.radiusPx}px`;
    if (hint?.paddingPx !== null && hint?.paddingPx !== undefined) style.padding = `${hint.paddingPx}px`;
    if (isV2 && section.widthPct && section.widthPct < 99.5) style.width = `${section.widthPct}%`;
    if (isV2 && section.xPct) style.marginLeft = `${section.xPct}%`;
    return style;
  }

  function dynamicCardStyle(section: PreciseSection): CSSProperties {
    const hint = section.styleHint;
    const style: CSSProperties = {};
    if (hint?.cardBackgroundColor) style.backgroundColor = hint.cardBackgroundColor;
    if (hint?.cardBorderColor) {
      style.borderColor = hint.cardBorderColor;
      style.borderStyle = "solid";
      style.borderWidth = "1px";
    }
    if (hint?.cardRadiusPx !== null && hint?.cardRadiusPx !== undefined) style.borderRadius = `${hint.cardRadiusPx}px`;
    return style;
  }

  function renderDynamicSection(section: PreciseSection, index: number): ReactNode {
    const heading = section.styleHint?.heading;
    const wrapperStyle = dynamicWrapperStyle(section);
    const cardStyle = dynamicCardStyle(section);
    const gapPx = section.styleHint?.gapPx ?? 16;
    const gridStyle: CSSProperties = { gap: `${gapPx}px` };
    if (section.styleHint?.columns) gridStyle.gridTemplateColumns = `repeat(${section.styleHint.columns}, minmax(0, 1fr))`;

    switch (section.type) {
      case "roster":
        return (
          <section key={section.id ?? index} id={SECTION_ANCHOR.roster} className="mx-auto max-w-6xl px-4 py-10 sm:px-6" style={wrapperStyle}>
            <h2 className="text-2xl font-semibold text-white">{heading || "Players"}</h2>
            {players.length === 0 ? (
              <div className="mt-5 border border-dashed border-white/15 p-8 text-center text-white/45" style={cardStyle}>Próximos Players</div>
            ) : (
              <div className="mt-5 grid sm:grid-cols-2 lg:grid-cols-3" style={gridStyle}>
                {players.map((entry, playerIndex) => entry.player ? (
                  <Link key={`${entry.player.id}-${playerIndex}`} href={`/${entry.player.slug}`} className="group flex items-center gap-4 border border-white/10 bg-white/[0.025] p-4 transition hover:border-[color:var(--public-accent)]/50" style={cardStyle}>
                    {entry.player.profile_image_url ? (
                      <img src={entry.player.profile_image_url} alt={entry.player.display_name} className="h-16 w-16 object-cover" style={{ borderRadius: section.styleHint?.cardRadiusPx ?? 16 }} />
                    ) : (
                      <div className="flex h-16 w-16 items-center justify-center bg-[color:var(--public-accent)]/15 text-xl font-semibold text-white" style={{ borderRadius: section.styleHint?.cardRadiusPx ?? 16 }}>{entry.player.display_name.charAt(0)}</div>
                    )}
                    <div className="min-w-0"><p className="truncate font-semibold text-white">{entry.player.display_name}</p><p className="mt-1 text-sm text-white/55">Player · {entry.role || "Miembro"}</p></div>
                  </Link>
                ) : null)}
              </div>
            )}
          </section>
        );

      case "services":
        return services.length ? (
          <section key={section.id ?? index} id={SECTION_ANCHOR.services} className="mx-auto max-w-6xl px-4 py-10 sm:px-6" style={wrapperStyle}>
            <h2 className="text-2xl font-semibold text-white">{heading || "Servicios"}</h2>
            <div className="mt-5"><StudioServicesCart studioId={studio.id} studioSlug={studio.slug} services={services} /></div>
          </section>
        ) : null;

      case "membership":
        return membershipPlans.length ? (
          <section key={section.id ?? index} id={SECTION_ANCHOR.membership} className="mx-auto max-w-6xl px-4 py-10 sm:px-6" style={wrapperStyle}>
            <h2 className="text-2xl font-semibold text-white">{heading || "Membresías"}</h2>
            <div className="mt-5 grid sm:grid-cols-2 lg:grid-cols-3" style={gridStyle}>
              {membershipPlans.map((plan) => (
                <article key={plan.id} className="flex flex-col border border-white/10 bg-white/[0.025] p-6" style={cardStyle}>
                  <h3 className="font-semibold text-white">{plan.name}</h3>
                  {plan.description ? <p className="mt-3 line-clamp-3 text-sm leading-6 text-white/55">{plan.description}</p> : null}
                  <p className="mt-4 text-2xl font-bold text-white">{formatPlanPrice(plan)}{!plan.is_free ? <span className="ml-1 text-sm font-normal text-white/45">/ {plan.billing_interval === "year" ? "año" : "mes"}</span> : null}</p>
                  <Link href={`/studios/${studio.slug}/checkout${plan.is_free ? "" : `?plan=${plan.slug}`}`} className="mt-6 bg-[color:var(--public-accent)] px-5 py-3 text-center text-sm font-semibold text-white transition hover:opacity-90" style={{ borderRadius: section.styleHint?.cardRadiusPx ?? 12 }}>
                    {plan.join_policy === "approval" ? "Solicitar ingreso" : plan.is_free ? "Unirme gratis" : "Elegir plan"}
                  </Link>
                </article>
              ))}
            </div>
          </section>
        ) : null;

      case "gallery":
        return media.length ? <div key={section.id ?? index} id={SECTION_ANCHOR.gallery} style={wrapperStyle}><PublicMediaGallery media={media} /></div> : null;

      case "music":
        return (
          <div key={section.id ?? index} style={wrapperStyle}>
            {renderMusicSection({
              sectionKey: index,
              heading,
              isList: false,
              maxReleases: 6,
              musicLinks,
              projects,
              matrixDiscoveryProjects,
              studioName: studio.name,
              radiusClass,
            })}
          </div>
        );

      default:
        return null;
    }
  }

  function renderSection(section: PreciseSection, index: number): ReactNode {
    if (section.columns?.length) return renderColumnsSection(section, index);
    if (section.styleHint) return renderDynamicSection(section, index);
    if (section.type === "hero") {
      return (
        <div key={section.id ?? index}>
          {renderStaticSection(section, index)}
          {joined ? (
            <div className="mx-auto -mt-2 max-w-6xl px-4 pt-6 sm:px-6">
              <div className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-5 py-4 text-sm text-emerald-100 shadow-[0_20px_60px_rgba(16,185,129,.08)]">Ya sos miembro de {studio.name}. Tu Player quedó vinculado con el rol del plan elegido.</div>
            </div>
          ) : null}
          <div className="mx-auto mt-4 max-w-6xl px-4 sm:px-6"><StudioManageButton studioId={studio.id} /></div>
        </div>
      );
    }
    return renderStaticSection(section, index);
  }

  return (
    <CustomShell
      brand={studio.name}
      logoUrl={studio.logo_url}
      navLinks={navLinks}
      accent={layout.page_style?.palette?.accent || "#8f7cff"}
      navStyle={layout.page_style?.nav_style ?? "pill"}
      joinAction={headerJoinAction}
      links={links}
      footer={footer}
      headerOverlay={headerOverlay}
    >
      {sections.map((section, index) => renderSection(section, index))}
    </CustomShell>
  );
}
