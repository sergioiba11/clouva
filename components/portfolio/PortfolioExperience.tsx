"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowDown,
  ArrowUpRight,
  Braces,
  ChevronRight,
  Cloud,
  Code2,
  Database,
  Github,
  Languages,
  Layers3,
  MapPin,
  Sparkles,
  X,
} from "lucide-react";
import { PortfolioProjectExplorer } from "@/components/portfolio/PortfolioProjectExplorer";
import { PortfolioSystemMap } from "@/components/portfolio/PortfolioSystemMap";
import {
  PORTFOLIO_ASSETS,
  PORTFOLIO_LINKS,
  portfolioCopy,
  stackGroups,
  type PortfolioLocale,
} from "@/lib/portfolio/portfolio-data";
import {
  PORTFOLIO_PROFILE_IMAGE,
  PORTFOLIO_V2_COPY,
} from "@/lib/portfolio/portfolio-v2-data";
import {
  PORTFOLIO_V3_ASSETS,
  PORTFOLIO_V3_COPY,
} from "@/lib/portfolio/portfolio-v3-data";
import styles from "@/app/portafolio/portfolio.module.css";
import v2 from "@/app/portafolio/portfolio-v2.module.css";
import v3 from "@/app/portafolio/portfolio-v3.module.css";

const stackIcons = {
  frontend: Braces,
  backend: Database,
  cloud: Cloud,
  ai: Sparkles,
  threeD: Layers3,
  integrations: Code2,
  tools: Github,
} as const;

export function PortfolioExperience() {
  const [locale, setLocale] = useState<PortfolioLocale>("en");
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);
  const reduceMotion = useReducedMotion();
  const copy = portfolioCopy[locale];
  const v2Copy = PORTFOLIO_V2_COPY[locale];
  const v3Copy = PORTFOLIO_V3_COPY[locale];

  useEffect(() => {
    if (!lightbox) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLightbox(null);
    };
    document.addEventListener("keydown", onKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
    };
  }, [lightbox]);

  const reveal = useMemo(
    () => ({
      initial: reduceMotion ? { opacity: 1 } : { opacity: 0, y: 18 },
      whileInView: { opacity: 1, y: 0 },
      viewport: { once: true, amount: 0.12 },
      transition: { duration: reduceMotion ? 0 : 0.42, ease: "easeOut" as const },
    }),
    [reduceMotion],
  );

  const sectionClass = `${styles.section} ${v2.sectionV2} ${v3.sectionV3}`;
  const headingClass = `${styles.sectionHeading} ${v2.sectionHeadingV2} ${v3.sectionHeadingV3}`;

  return (
    <main className={styles.page}>
      <a className={styles.skipLink} href="#portfolio-content">Skip to content</a>
      <div className={styles.ambient} aria-hidden="true" />
      <div className={styles.gridNoise} aria-hidden="true" />

      <header className={`${styles.header} ${v2.headerV2} ${v3.headerV3}`}>
        <Link href="/portafolio" className={styles.brand} aria-label="Sergio Ibañez portfolio">
          <span className={styles.brandMark}>SI</span>
          <span className={styles.brandCopy}>
            <strong>SERGIO IBAÑEZ</strong>
            <small>AI-NATIVE PRODUCT BUILDER</small>
          </span>
        </Link>

        <nav className={styles.nav} aria-label="Portfolio navigation">
          <a href="#flagship">{copy.nav.work}</a>
          <a href="#stack">{copy.nav.stack}</a>
          <a href="#system">{copy.nav.system}</a>
          <a href="#process">{copy.nav.process}</a>
          <a href="#about">{locale === "en" ? "About" : "Sobre mí"}</a>
          <a href="#contact">{copy.nav.contact}</a>
        </nav>

        <div className={styles.headerActions}>
          <div className={styles.languageToggle} aria-label={copy.language}>
            <Languages size={14} aria-hidden="true" />
            <button type="button" className={locale === "en" ? styles.languageActive : ""} onClick={() => setLocale("en")} aria-pressed={locale === "en"}>EN</button>
            <span>/</span>
            <button type="button" className={locale === "es" ? styles.languageActive : ""} onClick={() => setLocale("es")} aria-pressed={locale === "es"}>ES</button>
          </div>
          <a className={styles.iconLink} href={PORTFOLIO_LINKS.source} target="_blank" rel="noreferrer" aria-label="GitHub CLOUVA">
            <Github size={17} />
          </a>
        </div>
      </header>

      <div id="portfolio-content">
        <section className={v3.heroV3} aria-labelledby="portfolio-title">
          <div className={v3.heroCopyV3}>
            <div className={v3.heroTopline}>
              <span className={v3.heroAvailability}>{v3Copy.hero.availability}</span>
              <span className={v3.heroLocation}><MapPin size={12} />{v3Copy.hero.location}</span>
            </div>

            <p className={v3.heroRoleV3}>{v3Copy.hero.role}</p>
            <h1 id="portfolio-title" className={v3.heroName}><span>SERGIO</span><span>IBAÑEZ</span></h1>
            <h2 className={v3.heroHeadline}>{v3Copy.hero.headline}</h2>
            <p className={v3.heroLeadV3}>{v3Copy.hero.lead}</p>

            <div className={v3.heroAvailabilityRoles} aria-label={v3Copy.hero.availableFor}>
              <b>{v3Copy.hero.availableFor}</b>
              {v3Copy.hero.roles.map((role) => <span key={role}>{role}</span>)}
            </div>

            <div className={v3.heroActionsV3}>
              <a className={v3.heroPrimary} href="#flagship">{v3Copy.hero.viewWork}<ArrowDown size={15} /></a>
              <a className={v3.heroSecondary} href={PORTFOLIO_LINKS.clouva} target="_blank" rel="noreferrer">{v3Copy.hero.viewClouva}<ArrowUpRight size={15} /></a>
              <a className={v3.heroTextLink} href={PORTFOLIO_LINKS.source} target="_blank" rel="noreferrer"><Github size={14} />GitHub</a>
              <a className={v3.heroTextLink} href="#contact">{copy.hero.contact}</a>
            </div>

            <div className={v3.heroCapabilities} aria-label="Capabilities">
              {v3Copy.statement.capabilities.map((item) => <span key={item}>{item}</span>)}
            </div>
          </div>

          <div className={v3.heroEvidenceV3} aria-label="CLOUVA product evidence">
            <a className={v3.heroEvidenceMain} href={PORTFOLIO_LINKS.clouva} target="_blank" rel="noreferrer">
              <span className={v3.evidenceToolbar}><strong>{v3Copy.hero.currentBuild}</strong><span>{v3Copy.hero.liveSurface}</span></span>
              <span className={v3.evidenceViewport}>
                <Image src={PORTFOLIO_V3_ASSETS.home} alt="Registered CLOUVA Home product asset" fill priority sizes="(max-width: 760px) 92vw, 52vw" />
                <i className={v3.evidenceShade} aria-hidden="true" />
              </span>
              <span className={v3.evidenceFooter}><span>{v3Copy.hero.productView}</span><b>{v3Copy.hero.evidence}</b></span>
            </a>

            <div className={v3.heroEvidenceStack}>
              <button type="button" className={v3.miniEvidence} onClick={() => setLightbox({ src: PORTFOLIO_V3_ASSETS.player, alt: "Registered CLOUVA Player identity visual asset" })}>
                <Image src={PORTFOLIO_V3_ASSETS.player} alt="Registered CLOUVA Player identity visual asset" fill sizes="260px" />
                <span className={v3.miniEvidenceCopy}><span>{v3Copy.hero.evidence}</span><strong>{v3Copy.hero.playerView}</strong></span>
              </button>
              <button type="button" className={`${v3.miniEvidence} ${v3.miniEvidenceContain}`} onClick={() => setLightbox({ src: PORTFOLIO_V3_ASSETS.creator, alt: v2Copy.creatorEvidenceAlt })}>
                <Image src={PORTFOLIO_V3_ASSETS.creator} alt={v2Copy.creatorEvidenceAlt} fill sizes="260px" />
                <span className={v3.miniEvidenceCopy}><span>{locale === "en" ? "DEVELOPMENT PIPELINE" : "PIPELINE EN DESARROLLO"}</span><strong>{v3Copy.hero.creatorView}</strong></span>
              </button>
            </div>
          </div>
        </section>

        <motion.section {...reveal} id="flagship" className={v3.flagshipSection} aria-labelledby="flagship-title">
          <div className={v3.flagshipHeading}>
            <div>
              <span className={v3.flagshipIndex}>{v3Copy.flagship.index}</span>
              <h2 id="flagship-title" className={v3.flagshipTitle}>{v3Copy.flagship.title}</h2>
              <p className={v3.flagshipSubtitle}>{v3Copy.flagship.subtitle}</p>
            </div>
            <p>{v3Copy.flagship.body}</p>
          </div>

          <div className={v3.flagshipMediaStage}>
            <div className={v3.flagshipMediaMain}>
              <Image src={PORTFOLIO_V3_ASSETS.publicSystem} alt="Registered CLOUVA public visual system asset" fill sizes="(max-width: 1100px) 100vw, 72vw" />
              <span className={v3.assetTag}>{v3Copy.flagship.visualLabel}</span>
              <span className={v3.assetCaption}><span>CLOUVA / PUBLIC SYSTEM</span><small>REAL PRODUCT ASSET</small></span>
            </div>
            <div className={v3.flagshipMediaSide}>
              <div className={v3.flagshipMediaSideItem}>
                <Image src={PORTFOLIO_V3_ASSETS.player} alt="Registered CLOUVA Player product asset" fill sizes="(max-width: 1100px) 50vw, 28vw" />
                <span className={v3.assetTag}>PLAYER / IDENTITY</span>
                <span className={v3.assetCaption}><span>PLAYER</span><small>REAL PRODUCT ASSET</small></span>
              </div>
              <div className={v3.flagshipMediaSideItem}>
                <Image src={PORTFOLIO_V3_ASSETS.market} alt="Registered CLOUVA Market product asset" fill sizes="(max-width: 1100px) 50vw, 28vw" />
                <span className={v3.assetTag}>MARKET / COMMERCE</span>
                <span className={v3.assetCaption}><span>MARKET</span><small>REAL PRODUCT ASSET</small></span>
              </div>
            </div>
          </div>

          <div className={v3.flagshipNote}>
            <strong>{v3Copy.flagship.visualLabel}</strong>
            <span>{v3Copy.flagship.visualNote}</span>
          </div>
          <div className={v3.flagshipAnnotations} aria-label="CLOUVA product characteristics">
            {v3Copy.flagship.annotations.map((annotation) => <span key={annotation}>{annotation}</span>)}
          </div>

          <div className={v3.flagshipMeta}>
            <div className={v3.metaBlock}>
              <span>{v3Copy.flagship.roles}</span>
              <div className={v3.metaRoles}>{copy.caseStudy.roles.map((role) => <strong key={role}>{role}</strong>)}</div>
              <a className={v3.flagshipLiveLink} href={PORTFOLIO_LINKS.clouva} target="_blank" rel="noreferrer">{v3Copy.flagship.live}<ArrowUpRight size={14} /></a>
            </div>
            <div className={v3.metaBlock}>
              <span>{v3Copy.flagship.stack}</span>
              <div className={v3.metaStack}>
                {["Next.js", "React", "TypeScript", "Supabase", "PostgreSQL", "Google Cloud", "Cloud Run", "GitHub", "Gemini", "Blender", "GLB", "OAuth", "Mercado Pago"].map((item) => <span key={item}>{item}</span>)}
              </div>
            </div>
          </div>

          <div className={v3.architectureEditorial}>
            <div className={v3.architectureLabel}>{v3Copy.flagship.architecture}</div>
            <div className={v3.architectureFlowV3}>
              {copy.caseStudy.architecture.map((node, index) => (
                <div className={v3.architectureNode} key={node}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{node}</strong>
                </div>
              ))}
            </div>
          </div>

          <div className={v3.snapshotSection}>
            <div className={v3.snapshotHeader}>
              <span className={v3.editorialIndex}>{v3Copy.snapshot.eyebrow}</span>
              <h3>{v3Copy.snapshot.title}</h3>
              <p>{v3Copy.snapshot.intro}</p>
            </div>
            <div className={v3.snapshotGrid}>
              {v3Copy.snapshot.items.map(([number, domain, product, detail]) => (
                <div className={v3.snapshotItem} key={domain}>
                  <span>{number}</span>
                  <div><strong>{domain}</strong><b>{product}</b><small>{detail}</small></div>
                </div>
              ))}
            </div>
          </div>
        </motion.section>

        <motion.section {...reveal} className={v3.statementSection} aria-labelledby="statement-title">
          <span className={v3.editorialIndex}>{v3Copy.statement.eyebrow}</span>
          <h2 id="statement-title">{v3Copy.statement.lineOne}<span>{v3Copy.statement.lineTwo}</span></h2>
          <div className={v3.statementCapabilities}>{v3Copy.statement.capabilities.map((item) => <span key={item}>{item}</span>)}</div>
        </motion.section>

        <motion.section {...reveal} className={v3.featuredSection} aria-labelledby="featured-title">
          <div className={v3.featuredHeader}>
            <div><span className={v3.editorialIndex}>{v3Copy.featured.index}</span><h2 id="featured-title">{v3Copy.featured.title}</h2></div>
            <p>{v3Copy.featured.intro}</p>
          </div>

          <div className={v3.featuredList}>
            {v3Copy.featured.items.map((item) => (
              <article className={v3.featuredRow} key={item.id}>
                <div className={v3.featuredCopy}>
                  <div className={v3.featuredTopline}>
                    <span>{item.eyebrow}</span>
                    <b className={`${styles.statusBadge} ${styles[`status${item.status.replace(/\s/g, "")}`]}`}>{item.status}</b>
                  </div>
                  <h3>{item.title}</h3>
                  <div className={v3.featuredFacts}>
                    <div className={v3.featuredFact}><span>{v3Copy.featured.problem}</span><p>{item.problem}</p></div>
                    <div className={v3.featuredFact}><span>{v3Copy.featured.decision}</span><p>{item.decision}</p></div>
                    <div className={v3.featuredFact}><span>{v3Copy.featured.rail}</span><p>{item.rail}</p></div>
                  </div>
                </div>
                <div className={`${v3.featuredVisual} ${item.image ? v3.featuredVisualWithImage : ""}`}>
                  <span className={v3.featuredEvidenceLabel}>{item.evidenceLabel}</span>
                  {item.image ? <Image src={item.image} alt={item.imageAlt} fill sizes="(max-width: 760px) 100vw, 50vw" /> : null}
                  <div className={v3.featuredPipeline} aria-label={`${item.title} pipeline`}>
                    {item.pipeline.map((step, index) => (
                      <span key={step}><b>{step}</b>{index < item.pipeline.length - 1 ? <i>→</i> : null}</span>
                    ))}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </motion.section>

        <motion.section {...reveal} id="about" className={v3.aboutCompact} aria-labelledby="about-title">
          <div className={v3.aboutMonogram}>
            {PORTFOLIO_PROFILE_IMAGE ? <Image src={PORTFOLIO_PROFILE_IMAGE} alt="Sergio Ibañez" fill sizes="180px" /> : <span>SI</span>}
          </div>
          <div className={v3.aboutCompactCopy}>
            <span>{v3Copy.about.eyebrow}</span>
            <h2 id="about-title">{v3Copy.about.title}</h2>
            <p>{v3Copy.about.body}</p>
            <p className={v3.aboutProofV3}>{v3Copy.about.proof}</p>
            <div className={v3.aboutRoleRail}>{v2Copy.about.roles.map((role) => <span key={role}>{role}</span>)}</div>
          </div>
        </motion.section>

        <motion.section {...reveal} id="work" className={sectionClass} aria-labelledby="work-title">
          <div className={headingClass}>
            <div><span className={styles.sectionIndex}>{v3Copy.deepDive.index}</span><h2 id="work-title">{v3Copy.deepDive.title}</h2></div>
            <p>{v3Copy.deepDive.intro}</p>
          </div>
          <PortfolioProjectExplorer
            locale={locale}
            projects={copy.work.projects}
            labels={{ open: copy.work.open, authenticated: copy.work.authenticated, evidence: copy.work.evidence, details: copy.work.details }}
            onOpenMedia={(src, alt) => setLightbox({ src, alt })}
          />
        </motion.section>

        <motion.section {...reveal} id="stack" className={sectionClass} aria-labelledby="stack-title">
          <div className={headingClass}>
            <div><span className={styles.sectionIndex}>{copy.stack.index}</span><h2 id="stack-title">{copy.stack.title}</h2></div>
            <p>{copy.stack.intro}</p>
          </div>
          <div className={v3.stackEditorial}>
            {stackGroups.map((group) => {
              const Icon = stackIcons[group.key];
              return (
                <div className={v3.stackRow} key={group.key}>
                  <div className={v3.stackRowTitle}><Icon size={17} /><span>{copy.stack.labels[group.key]}</span></div>
                  <div className={v3.stackRowItems}>{group.items.map((item) => <strong key={item}>{item}</strong>)}</div>
                </div>
              );
            })}
          </div>
        </motion.section>

        <motion.section {...reveal} className={sectionClass} aria-labelledby="thinking-title">
          <div className={headingClass}>
            <div><span className={styles.sectionIndex}>{copy.thinking.index}</span><h2 id="thinking-title">{copy.thinking.title}</h2></div>
            <p>{copy.thinking.intro}</p>
          </div>
          <div className={v3.thinkingEditorial}>
            {copy.thinking.items.map(([title, description], index) => (
              <article className={v3.thinkingItem} key={title}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div><h3>{title}</h3><p>{description}</p></div>
              </article>
            ))}
          </div>
        </motion.section>

        <motion.section {...reveal} id="system" className={sectionClass} aria-labelledby="system-title">
          <div className={headingClass}>
            <div><span className={styles.sectionIndex}>{copy.system.index}</span><h2 id="system-title">{copy.system.title}</h2></div>
            <p>{copy.system.intro}</p>
          </div>
          <PortfolioSystemMap centerLabel={copy.system.center} labels={copy.system.domainLabels} />
        </motion.section>

        <motion.section {...reveal} id="process" className={sectionClass} aria-labelledby="process-title">
          <div className={headingClass}>
            <div><span className={styles.sectionIndex}>{copy.process.index}</span><h2 id="process-title">{copy.process.title}</h2></div>
            <p>{locale === "en"
              ? "AI accelerates implementation, research and debugging. Product direction, architecture, validation and system decisions remain part of my build process."
              : "La IA acelera implementación, investigación y debugging. La dirección del producto, arquitectura, validación y decisiones del sistema siguen formando parte de mi proceso."}</p>
          </div>
          <div className={v3.processEditorial}>
            {copy.process.steps.map(([number, title, description]) => (
              <article className={v3.processItem} key={number}>
                <span>{number}</span><strong>{title}</strong><p>{description}</p>
              </article>
            ))}
          </div>
        </motion.section>

        <motion.section {...reveal} className={sectionClass} aria-labelledby="journey-title">
          <div className={`${styles.sectionHeadingCompact} ${v2.sectionHeadingCompactV2}`}>
            <span className={styles.sectionIndex}>{copy.journey.index}</span>
            <h2 id="journey-title">{copy.journey.title}</h2>
          </div>
          <div className={styles.timeline}>
            {copy.journey.stages.map((stage, index) => (
              <div className={styles.timelineItem} key={stage}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <i />
                <strong>{stage}</strong>
              </div>
            ))}
          </div>
        </motion.section>

        <motion.section {...reveal} className={`${styles.sourceSection} ${v2.sourceSectionV2} ${v3.sourceV3}`} aria-labelledby="source-title">
          <div>
            <span className={styles.sectionIndex}>{copy.source.index}</span>
            <h2 id="source-title">{copy.source.title}</h2>
            <p>{copy.source.body}</p>
          </div>
          <a href={PORTFOLIO_LINKS.source} target="_blank" rel="noreferrer" className={styles.sourceButton}>
            <Github size={22} />
            <span><small>github.com/sergioiba11</small><strong>{copy.source.cta}</strong></span>
            <ArrowUpRight size={18} />
          </a>
        </motion.section>

        <section className={v2.opportunityBand} aria-label={v2Copy.opportunity.eyebrow}>
          <div>
            <span>{v2Copy.opportunity.eyebrow}</span>
            <h2>{v2Copy.opportunity.title}</h2>
          </div>
          <div className={v2.opportunityMeta}>
            <strong>{v2Copy.opportunity.location}</strong>
            <div>{v2Copy.opportunity.modes.map((mode) => <span key={mode}>{mode}</span>)}</div>
          </div>
        </section>

        <section id="contact" className={`${styles.contact} ${v2.contactV2} ${v3.contactV3}`} aria-labelledby="contact-title">
          <span className={styles.sectionIndex}>{copy.contact.index}</span>
          <h2 id="contact-title">{copy.contact.title}</h2>
          <p>{locale === "en"
            ? "Available for product, frontend, AI product and creative technology opportunities."
            : "Disponible para oportunidades de producto, frontend, AI product y creative technology."}</p>
          <div className={styles.contactActions}>
            <a href={PORTFOLIO_LINKS.github} target="_blank" rel="noreferrer"><Github size={18} />{copy.contact.github}<ArrowUpRight size={15} /></a>
            <a href={PORTFOLIO_LINKS.clouva} target="_blank" rel="noreferrer"><Sparkles size={18} />{copy.contact.clouva}<ArrowUpRight size={15} /></a>
            {PORTFOLIO_LINKS.linkedin ? <a href={PORTFOLIO_LINKS.linkedin} target="_blank" rel="noreferrer">LinkedIn<ArrowUpRight size={15} /></a> : null}
            {PORTFOLIO_LINKS.email ? <a href={`mailto:${PORTFOLIO_LINKS.email}`}>Email<ArrowUpRight size={15} /></a> : null}
            {PORTFOLIO_LINKS.cv ? <a href={PORTFOLIO_LINKS.cv}>{copy.hero.cv}<ArrowUpRight size={15} /></a> : null}
          </div>
          <small className={styles.contactNote}>{copy.contact.note}</small>
        </section>

        <footer className={styles.footer}>
          <span>© 2026 Sergio Ibañez</span>
          <span>{copy.footer}</span>
          <a href="#portfolio-content">TOP ↑</a>
        </footer>
      </div>

      {lightbox ? (
        <div className={styles.lightbox} role="dialog" aria-modal="true" aria-label={lightbox.alt} onClick={() => setLightbox(null)}>
          <button type="button" className={styles.lightboxClose} onClick={() => setLightbox(null)} aria-label={copy.gallery.close}><X size={20} /></button>
          <div className={styles.lightboxFrame} onClick={(event) => event.stopPropagation()}>
            <Image src={lightbox.src} alt={lightbox.alt} fill sizes="96vw" priority />
          </div>
        </div>
      ) : null}
    </main>
  );
}
