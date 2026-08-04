import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { PublicMediaGallery } from "./PublicMediaGallery";
import { PublicShareButton } from "./PublicShareButton";
import { StudioServicesCart } from "./StudioServicesCart";
import { StudioManageButton } from "./StudioManageButton";
import { formatPlanPrice, studioSocialLinks } from "./StudioPublicView";
import { CustomShell, RADIUS_CLASS, SECTION_ANCHOR, SECTION_NAV_LABEL, renderMusicSection } from "./StudioLayoutRenderer";
import type { LayoutConfig, LayoutSectionType, PositionedElement, PreciseSection, RealAction } from "@/lib/server/layout-config";
import type { PlayerMedia, StudioMembershipPlan, StudioPlayer, StudioRow, StudioService } from "@/lib/players-data";

type CustomNavLink = { label: string; href: string };

// Contraparte "pixel por pixel" de StudioLayoutRenderer.tsx -- en vez de
// elegir entre un puñado de variantes fijas por sección, cada elemento trae
// su posición/tamaño/estilo real extraído del mockup (lib/server/layout-config.ts,
// PositionedElement) y este componente lo pinta con esas coordenadas exactas.
// Sigue sin renderizar HTML/markup que venga de la IA -- solo números y
// enums cerrados que layout-config.ts ya validó, nunca texto arbitrario
// convertido en JSX libre. Los datos reales (players/servicios/planes/
// galería/lanzamientos/redes) son exactamente los mismos que usa
// StudioLayoutRenderer, y las acciones de los botones (join/share/scroll)
// siempre las resuelve este componente, nunca la IA.
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
  const links = studioSocialLinks(studio);
  const musicLinks = links.filter((link) => link.platform === "spotify" || link.platform === "youtube");
  const defaultMembershipPlan = membershipPlans.find((plan) => plan.is_free) ?? membershipPlans[0] ?? null;
  const joinHref = defaultMembershipPlan
    ? `/studios/${studio.slug}/checkout${defaultMembershipPlan.is_free ? "" : `?plan=${defaultMembershipPlan.slug}`}`
    : `/studios/${studio.slug}/join`;

  // Igual que en StudioLayoutRenderer: si hay Players reales, roster siempre
  // entra, no queda a discreción de la IA.
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

  function renderActionButton(element: PositionedElement): ReactNode {
    const label = element.text || "Unirme";
    const action = element.action as RealAction | null | undefined;

    if (action === "share") return <PublicShareButton title={studio.name} />;

    if (action === "join") {
      return (
        <Link href={joinTargetHref} className="inline-block rounded-full bg-[color:var(--public-accent)] px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90">
          {joined ? "Ya sos miembro" : label}
        </Link>
      );
    }

    if (action?.startsWith("scroll:")) {
      const target = action.slice("scroll:".length) as LayoutSectionType;
      const href = resolveScrollHref(target);
      if (href) {
        return (
          <Link href={href} className="inline-block rounded-full border border-white/20 bg-black/30 px-5 py-2.5 text-sm font-semibold text-white transition hover:border-[color:var(--public-accent)]/60">
            {label}
          </Link>
        );
      }
    }

    // Sin acción resuelta (o el destino no está incluido en esta página) --
    // se muestra el texto igual, por fidelidad visual, pero nunca como link
    // roto (`href="#"`).
    return <span className="inline-block rounded-full border border-white/20 bg-black/30 px-5 py-2.5 text-sm font-semibold text-white/80">{label}</span>;
  }

  // `absolute`: true posiciona con las coordenadas exactas del mockup
  // (desktop/tablet); false apila los mismos elementos en flujo normal
  // (mobile) -- un mockup desktop no tiene coordenadas que tengan sentido en
  // una pantalla angosta, así que ahí se prioriza que se lea bien por sobre
  // la posición exacta.
  function renderElement(element: PositionedElement, elIndex: number, absolute: boolean): ReactNode {
    // overflowWrap protege contra texto real más largo que la caja que Gemini
    // estimó -- nunca debería desbordar la sección ni pisar el elemento de al
    // lado, aunque la estimación de ancho no haya sido perfecta.
    const style: CSSProperties = absolute
      ? { position: "absolute", left: `${element.x}%`, top: `${element.y}%`, width: `${element.w}%`, overflowWrap: "break-word" }
      : {};
    if (element.fontSizePx) style.fontSize = `${element.fontSizePx}px`;
    if (element.fontWeight) style.fontWeight = element.fontWeight;
    if (element.color) style.color = element.color;
    if (element.align) style.textAlign = element.align;

    switch (element.type) {
      case "image": {
        const src = element.imageSlot ? layout.image_slots[element.imageSlot] : undefined;
        return src ? <img key={elIndex} src={src} alt="" style={style} className={absolute ? "pointer-events-none rounded-lg object-cover" : "w-full rounded-lg object-cover"} /> : null;
      }
      case "button":
        return <div key={elIndex} style={style}>{renderActionButton(element)}</div>;
      case "badge":
        return element.text ? <span key={elIndex} style={style} className="inline-block rounded-full border border-white/20 bg-black/30 px-3 py-1 text-xs text-white/80">{element.text}</span> : null;
      case "heading":
        return element.text ? <h1 key={elIndex} style={style} className="font-bold leading-tight text-white">{element.text}</h1> : null;
      case "subheading":
        return element.text ? <h2 key={elIndex} style={style} className="font-semibold leading-snug text-white/85">{element.text}</h2> : null;
      case "paragraph":
      default:
        return element.text ? <p key={elIndex} style={style} className="leading-relaxed text-white/70">{element.text}</p> : null;
    }
  }

  function renderStaticSection(section: PreciseSection, index: number): ReactNode {
    const bgColor = section.background?.color ?? undefined;
    const bgImage = section.background?.imageSlot ? layout.image_slots[section.background.imageSlot] : undefined;
    const elements = section.elements ?? [];

    return (
      <section
        key={index}
        id={SECTION_ANCHOR[section.type]}
        className="relative w-full border-b border-white/10 md:overflow-hidden"
        style={{ height: `${section.heightVh}vh`, minHeight: `${section.heightVh}vh`, backgroundColor: bgColor || "#07060b" }}
      >
        {bgImage ? (
          <>
            <img src={bgImage} alt="" className="absolute inset-0 h-full w-full object-cover" />
            <div className="absolute inset-0 bg-black/35" />
          </>
        ) : null}
        {/* Desktop/tablet: coordenadas exactas del mockup -- la sección
            necesita una altura EXPLÍCITA (no solo min-height) para que los
            porcentajes "top"/"left" de los elementos absolutos tengan una
            base real contra la cual calcularse; con solo min-height y todo
            el contenido en position:absolute, el navegador no tiene de dónde
            derivar esos porcentajes de forma confiable. */}
        <div className="relative hidden h-full md:block">
          {elements.map((element, elIndex) => renderElement(element, elIndex, true))}
        </div>
        {/* Mobile: mismos elementos, apilados en flujo normal (acá sí puede
            crecer más allá de heightVh si hace falta -- por eso el
            overflow-hidden de arriba solo aplica desde md hacia arriba). */}
        <div className="relative flex flex-col gap-3 px-5 py-8 md:hidden">
          {elements.map((element, elIndex) => renderElement(element, elIndex, false))}
        </div>
      </section>
    );
  }

  function renderDynamicSection(section: PreciseSection, index: number): ReactNode {
    const heading = section.styleHint?.heading;
    const wrapperStyle: CSSProperties = section.background?.color ? { backgroundColor: section.background.color } : {};

    switch (section.type) {
      case "roster":
        return (
          <section key={index} id={SECTION_ANCHOR.roster} className="mx-auto max-w-6xl px-4 py-10 sm:px-6" style={wrapperStyle}>
            <h2 className="text-2xl font-semibold text-white">{heading || "Players"}</h2>
            {players.length === 0 ? (
              <div className="mt-5 rounded-2xl border border-dashed border-white/15 p-8 text-center text-white/45">Próximos Players</div>
            ) : (
              <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {players.map((entry, playerIndex) => entry.player ? (
                  <Link key={`${entry.player.id}-${playerIndex}`} href={`/${entry.player.slug}`} className="group flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.025] p-4 transition hover:border-[color:var(--public-accent)]/50">
                    {entry.player.profile_image_url ? (
                      <img src={entry.player.profile_image_url} alt={entry.player.display_name} className="h-16 w-16 rounded-2xl object-cover" />
                    ) : (
                      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[color:var(--public-accent)]/15 text-xl font-semibold text-white">{entry.player.display_name.charAt(0)}</div>
                    )}
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-white">{entry.player.display_name}</p>
                      <p className="mt-1 text-sm text-white/55">Player · {entry.role || "Miembro"}</p>
                    </div>
                  </Link>
                ) : null)}
              </div>
            )}
          </section>
        );

      case "services":
        return services.length ? (
          <section key={index} id={SECTION_ANCHOR.services} className="mx-auto max-w-6xl px-4 py-10 sm:px-6" style={wrapperStyle}>
            <h2 className="text-2xl font-semibold text-white">{heading || "Servicios"}</h2>
            <div className="mt-5"><StudioServicesCart studioId={studio.id} studioSlug={studio.slug} services={services} /></div>
          </section>
        ) : null;

      case "membership":
        return membershipPlans.length ? (
          <section key={index} id={SECTION_ANCHOR.membership} className="mx-auto max-w-6xl px-4 py-10 sm:px-6" style={wrapperStyle}>
            <h2 className="text-2xl font-semibold text-white">{heading || "Membresías"}</h2>
            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {membershipPlans.map((plan) => (
                <article key={plan.id} className="flex flex-col rounded-2xl border border-white/10 bg-white/[0.025] p-6">
                  <h3 className="font-semibold text-white">{plan.name}</h3>
                  {plan.description ? <p className="mt-3 line-clamp-3 text-sm leading-6 text-white/55">{plan.description}</p> : null}
                  <p className="mt-4 text-2xl font-bold text-white">
                    {formatPlanPrice(plan)}
                    {!plan.is_free ? <span className="ml-1 text-sm font-normal text-white/45">/ {plan.billing_interval === "year" ? "año" : "mes"}</span> : null}
                  </p>
                  <Link href={`/studios/${studio.slug}/checkout${plan.is_free ? "" : `?plan=${plan.slug}`}`} className="mt-6 rounded-xl bg-[color:var(--public-accent)] px-5 py-3 text-center text-sm font-semibold text-white transition hover:opacity-90">
                    {plan.join_policy === "approval" ? "Solicitar ingreso" : plan.is_free ? "Unirme gratis" : "Elegir plan"}
                  </Link>
                </article>
              ))}
            </div>
          </section>
        ) : null;

      case "gallery":
        return media.length ? (
          <div key={index} id={SECTION_ANCHOR.gallery} style={wrapperStyle}>
            <PublicMediaGallery media={media} />
          </div>
        ) : null;

      case "music":
        return renderMusicSection({
          sectionKey: index,
          heading,
          isList: false,
          maxReleases: 6,
          musicLinks,
          projects,
          matrixDiscoveryProjects,
          studioName: studio.name,
          radiusClass,
        });

      default:
        return null;
    }
  }

  function renderSection(section: PreciseSection, index: number): ReactNode {
    if (section.styleHint) return renderDynamicSection(section, index);
    if (section.type === "hero") {
      return (
        <div key={index}>
          {renderStaticSection(section, index)}
          {joined ? (
            <div className="mx-auto -mt-2 max-w-6xl px-4 pt-6 sm:px-6">
              <div className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-5 py-4 text-sm text-emerald-100 shadow-[0_20px_60px_rgba(16,185,129,.08)]">
                Ya sos miembro de {studio.name}. Tu Player quedó vinculado con el rol del plan elegido.
              </div>
            </div>
          ) : null}
          <div className="mx-auto mt-4 max-w-6xl px-4 sm:px-6">
            <StudioManageButton studioId={studio.id} />
          </div>
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
    >
      {sections.map((section, index) => renderSection(section, index))}
    </CustomShell>
  );
}
