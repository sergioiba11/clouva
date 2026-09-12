"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowDown,
  ArrowUpRight,
  Braces,
  Check,
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
  PORTFOLIO_LINKS,
  portfolioCopy,
  stackGroups,
  type PortfolioLocale,
} from "@/lib/portfolio/portfolio-data";
import styles from "@/app/portafolio/portfolio.module.css";

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
      initial: reduceMotion ? { opacity: 1 } : { opacity: 0, y: 24 },
      whileInView: { opacity: 1, y: 0 },
      viewport: { once: true, amount: 0.12 },
      transition: { duration: reduceMotion ? 0 : 0.5, ease: "easeOut" as const },
    }),
    [reduceMotion],
  );

  return (
    <main className={styles.page}>
      <a className={styles.skipLink} href="#portfolio-content">Skip to content</a>
      <div className={styles.ambient} aria-hidden="true" />
      <div className={styles.gridNoise} aria-hidden="true" />

      <header className={styles.header}>
        <Link href="/" className={styles.brand} aria-label="CLOUVA home">
          <span className={styles.brandMark}>C</span>
          <span className={styles.brandCopy}>
            <strong>CLOUVA</strong>
            <small>PORTFOLIO / SERGIO IBAÑEZ</small>
          </span>
        </Link>

        <nav className={styles.nav} aria-label="Portfolio navigation">
          <a href="#work">{copy.nav.work}</a>
          <a href="#stack">{copy.nav.stack}</a>
          <a href="#system">{copy.nav.system}</a>
          <a href="#process">{copy.nav.process}</a>
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
        <section className={styles.hero} aria-labelledby="portfolio-title">
          <div className={styles.heroGlow} aria-hidden="true" />
          <div className={styles.heroCopy}>
            <div className={styles.availabilityRow}>
              <span className={styles.available}><i />{copy.availability}</span>
              <span className={styles.location}><MapPin size={13} />{copy.location}</span>
            </div>

            <p className={styles.role}>{copy.hero.role}</p>
            <h1 id="portfolio-title">{copy.hero.title}</h1>
            <p className={styles.heroLead}>{copy.hero.lead}</p>

            <div className={styles.subroles} aria-label="Roles">
              {copy.hero.subroles.map((role) => <span key={role}>{role}</span>)}
            </div>

            <div className={styles.heroActions}>
              <a className={styles.primaryButton} href="#work">{copy.hero.projects}<ArrowDown size={16} /></a>
              <a className={styles.secondaryButton} href={PORTFOLIO_LINKS.clouva} target="_blank" rel="noreferrer">{copy.hero.clouva}<ArrowUpRight size={16} /></a>
              <a className={styles.ghostButton} href={PORTFOLIO_LINKS.source} target="_blank" rel="noreferrer"><Github size={16} />{copy.hero.github}</a>
              <a className={styles.ghostButton} href="#contact">{copy.hero.contact}</a>
              {PORTFOLIO_LINKS.cv ? <a className={styles.ghostButton} href={PORTFOLIO_LINKS.cv}>{copy.hero.cv}</a> : null}
            </div>
          </div>

          <div className={styles.heroSystem} aria-label="CLOUVA system preview">
            <div className={styles.heroOrbit} aria-hidden="true"><span /><span /><span /></div>
            <div className={styles.heroSystemCore}>
              <span className={styles.heroCoreMark}>C</span>
              <small>CURRENT BUILD</small>
              <strong>CLOUVA</strong>
              <p>Creative Operating System</p>
            </div>
            <div className={`${styles.heroSignal} ${styles.heroSignalOne}`}>PRODUCT</div>
            <div className={`${styles.heroSignal} ${styles.heroSignalTwo}`}>AI</div>
            <div className={`${styles.heroSignal} ${styles.heroSignalThree}`}>CLOUD</div>
            <div className={`${styles.heroSignal} ${styles.heroSignalFour}`}>3D</div>
          </div>
        </section>

        <div className={styles.capabilityRail} aria-label="Capabilities">
          {["PRODUCT", "DESIGN", "FRONTEND", "CLOUD", "AI", "3D", "AUTOMATION"].map((item) => <span key={item}>{item}</span>)}
        </div>

        <motion.section {...reveal} className={styles.section} aria-labelledby="case-title">
          <div className={styles.sectionHeading}>
            <div><span className={styles.sectionIndex}>{copy.caseStudy.index}</span><h2 id="case-title">{copy.caseStudy.title}</h2></div>
            <p>{copy.caseStudy.description}</p>
          </div>

          <div className={styles.caseStudyGrid}>
            <div className={styles.caseMeta}>
              <span>{copy.caseStudy.rolesLabel}</span>
              <div>{copy.caseStudy.roles.map((role) => <strong key={role}>{role}</strong>)}</div>
            </div>
            <div className={styles.caseMeta}>
              <span>{copy.caseStudy.stackLabel}</span>
              <div className={styles.caseStack}>
                {["Next.js", "React", "TypeScript", "Supabase", "PostgreSQL", "Google Cloud", "Cloud Run", "GitHub", "Gemini", "Blender", "GLB", "APIs", "OAuth", "Mercado Pago"].map((item) => <b key={item}>{item}</b>)}
              </div>
            </div>
          </div>

          <div className={styles.architectureCard}>
            <div className={styles.architectureHeader}>
              <span>{copy.caseStudy.architectureLabel}</span>
              <span>clouva.com.ar</span>
            </div>
            <div className={styles.architectureFlow}>
              {copy.caseStudy.architecture.map((node, index) => (
                <div className={styles.architectureStep} key={node}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{node}</strong>
                  {index < copy.caseStudy.architecture.length - 1 ? <ChevronRight size={15} aria-hidden="true" /> : null}
                </div>
              ))}
            </div>
          </div>
        </motion.section>

        <motion.section {...reveal} id="work" className={styles.section} aria-labelledby="work-title">
          <div className={styles.sectionHeading}>
            <div><span className={styles.sectionIndex}>{copy.work.index}</span><h2 id="work-title">{copy.work.title}</h2></div>
            <p>{copy.work.intro}</p>
          </div>
          <PortfolioProjectExplorer
            projects={copy.work.projects}
            labels={{ open: copy.work.open, authenticated: copy.work.authenticated, evidence: copy.work.evidence, details: copy.work.details }}
            onOpenMedia={(src, alt) => setLightbox({ src, alt })}
          />
        </motion.section>

        <motion.section {...reveal} className={styles.section} aria-labelledby="evidence-title">
          <div className={styles.sectionHeading}>
            <div><span className={styles.sectionIndex}>{copy.gallery.index}</span><h2 id="evidence-title">{copy.gallery.title}</h2></div>
            <p>{copy.gallery.intro}</p>
          </div>
          <div className={styles.galleryGrid}>
            {copy.gallery.items.map((item) => (
              <button key={item.src} type="button" className={styles.galleryCard} onClick={() => setLightbox({ src: item.src, alt: item.alt })}>
                <span className={styles.browserChrome}><i /><i /><i /><b>clouva.com.ar</b></span>
                <span className={styles.galleryImage}>
                  <Image src={item.src} alt={item.alt} fill sizes="(max-width: 800px) 100vw, 33vw" />
                </span>
                <span className={styles.galleryCaption}>{item.title}<em>{copy.gallery.enlarge}<ArrowUpRight size={14} /></em></span>
              </button>
            ))}
          </div>
        </motion.section>

        <motion.section {...reveal} id="stack" className={styles.section} aria-labelledby="stack-title">
          <div className={styles.sectionHeading}>
            <div><span className={styles.sectionIndex}>{copy.stack.index}</span><h2 id="stack-title">{copy.stack.title}</h2></div>
            <p>{copy.stack.intro}</p>
          </div>
          <div className={styles.stackGrid}>
            {stackGroups.map((group) => {
              const Icon = stackIcons[group.key];
              return (
                <article className={styles.stackCard} key={group.key}>
                  <div className={styles.stackTitle}><Icon size={19} /><span>{copy.stack.labels[group.key]}</span></div>
                  <div className={styles.stackItems}>{group.items.map((item) => <strong key={item}>{item}</strong>)}</div>
                </article>
              );
            })}
          </div>
        </motion.section>

        <motion.section {...reveal} className={styles.section} aria-labelledby="thinking-title">
          <div className={styles.sectionHeading}>
            <div><span className={styles.sectionIndex}>{copy.thinking.index}</span><h2 id="thinking-title">{copy.thinking.title}</h2></div>
            <p>{copy.thinking.intro}</p>
          </div>
          <div className={styles.thinkingGrid}>
            {copy.thinking.items.map(([title, description], index) => (
              <article className={styles.thinkingCard} key={title}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <Check size={17} />
                <h3>{title}</h3>
                <p>{description}</p>
              </article>
            ))}
          </div>
        </motion.section>

        <motion.section {...reveal} id="system" className={styles.section} aria-labelledby="system-title">
          <div className={styles.sectionHeading}>
            <div><span className={styles.sectionIndex}>{copy.system.index}</span><h2 id="system-title">{copy.system.title}</h2></div>
            <p>{copy.system.intro}</p>
          </div>
          <PortfolioSystemMap centerLabel={copy.system.center} labels={copy.system.domainLabels} />
        </motion.section>

        <motion.section {...reveal} id="process" className={styles.section} aria-labelledby="process-title">
          <div className={styles.sectionHeading}>
            <div><span className={styles.sectionIndex}>{copy.process.index}</span><h2 id="process-title">{copy.process.title}</h2></div>
            <p>{copy.process.intro}</p>
          </div>
          <div className={styles.processRail}>
            {copy.process.steps.map(([number, title, description], index) => (
              <article className={styles.processStep} key={number}>
                <span>{number}</span>
                <div><strong>{title}</strong><p>{description}</p></div>
                {index < copy.process.steps.length - 1 ? <ChevronRight size={17} aria-hidden="true" /> : null}
              </article>
            ))}
          </div>
        </motion.section>

        <motion.section {...reveal} className={styles.section} aria-labelledby="journey-title">
          <div className={styles.sectionHeadingCompact}>
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

        <motion.section {...reveal} className={styles.sourceSection} aria-labelledby="source-title">
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

        <section id="contact" className={styles.contact} aria-labelledby="contact-title">
          <span className={styles.sectionIndex}>{copy.contact.index}</span>
          <h2 id="contact-title">{copy.contact.title}</h2>
          <p>{copy.contact.body}</p>
          <div className={styles.contactActions}>
            <a href={PORTFOLIO_LINKS.github} target="_blank" rel="noreferrer"><Github size={18} />{copy.contact.github}<ArrowUpRight size={15} /></a>
            <a href={PORTFOLIO_LINKS.clouva} target="_blank" rel="noreferrer"><Sparkles size={18} />{copy.contact.clouva}<ArrowUpRight size={15} /></a>
            {PORTFOLIO_LINKS.linkedin ? <a href={PORTFOLIO_LINKS.linkedin} target="_blank" rel="noreferrer">LinkedIn<ArrowUpRight size={15} /></a> : null}
            {PORTFOLIO_LINKS.email ? <a href={`mailto:${PORTFOLIO_LINKS.email}`}>Email<ArrowUpRight size={15} /></a> : null}
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
