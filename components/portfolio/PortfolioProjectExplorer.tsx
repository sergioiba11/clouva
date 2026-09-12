"use client";

import Image from "next/image";
import Link from "next/link";
import {
  ArrowUpRight,
  Bot,
  Box,
  CircleUserRound,
  CloudCog,
  Home,
  Layers3,
  ShoppingBag,
  Sparkles,
  WalletCards,
} from "lucide-react";
import type { PortfolioLocale, PortfolioStatus } from "@/lib/portfolio/portfolio-data";
import {
  PORTFOLIO_V2_COPY,
  PROJECT_ARCHITECTURE_OVERRIDES,
  PROJECT_MEDIA_OVERRIDES,
  PROJECT_PRIMARY_IDS,
  PROJECT_V2_DETAILS,
} from "@/lib/portfolio/portfolio-v2-data";
import styles from "@/app/portafolio/portfolio.module.css";
import v2 from "@/app/portafolio/portfolio-v2.module.css";

const projectIcons = {
  clouva: Sparkles,
  home: Home,
  player: CircleUserRound,
  flow: WalletCards,
  creator: Box,
  assets: Layers3,
  ai: Bot,
  commerce: ShoppingBag,
  brand: CloudCog,
} as const;

type ProjectView = {
  readonly id: string;
  readonly status: PortfolioStatus;
  readonly route?: string;
  readonly tags: readonly string[];
  readonly media?: string;
  readonly mediaAlt?: string;
  readonly title: string;
  readonly eyebrow: string;
  readonly summary: string;
  readonly result: string;
  readonly bullets: readonly string[];
  readonly architecture?: readonly string[];
};

type Props = {
  locale: PortfolioLocale;
  projects: readonly ProjectView[];
  labels: {
    open: string;
    authenticated: string;
    evidence: string;
    details: string;
  };
  onOpenMedia: (src: string, alt: string) => void;
};

function StatusLegend({ locale }: { locale: PortfolioLocale }) {
  const copy = PORTFOLIO_V2_COPY[locale];
  return (
    <div className={v2.statusLegend} aria-label={copy.status.title}>
      <span className={v2.statusLegendTitle}>{copy.status.title}</span>
      <div className={v2.statusLegendItems}>
        {copy.status.items.map(([status, description]) => (
          <span className={v2.statusLegendItem} key={status}>
            <b className={`${styles.statusBadge} ${styles[`status${status.replace(/\s/g, "")}`]}`}>{status}</b>
            <small>{description}</small>
          </span>
        ))}
      </div>
    </div>
  );
}

function ProjectCard({
  project,
  index,
  locale,
  labels,
  onOpenMedia,
  primary,
}: {
  project: ProjectView;
  index: number;
  locale: PortfolioLocale;
  labels: Props["labels"];
  onOpenMedia: Props["onOpenMedia"];
  primary: boolean;
}) {
  const Icon = projectIcons[project.id as keyof typeof projectIcons] ?? Sparkles;
  const isAuthenticated = project.route === "/mi-flow" || project.route === "/crear";
  const architecture = PROJECT_ARCHITECTURE_OVERRIDES[project.id] ?? project.architecture;
  const mediaOverride = PROJECT_MEDIA_OVERRIDES[project.id];
  const mediaSrc = mediaOverride?.src ?? project.media;
  const copy = PORTFOLIO_V2_COPY[locale];
  const detail = PROJECT_V2_DETAILS[project.id as keyof typeof PROJECT_V2_DETAILS]?.[locale];
  const mediaAlt =
    mediaOverride?.altKey === "creatorEvidenceAlt"
      ? copy.creatorEvidenceAlt
      : project.mediaAlt || project.title;

  return (
    <article
      className={[
        styles.projectCard,
        v2.projectCardV2,
        primary ? v2.projectCardPrimary : v2.projectCardSecondary,
        project.status === "LIVE" ? v2.projectCardLive : "",
        project.id === "clouva" ? v2.projectCardFlagship : "",
      ].filter(Boolean).join(" ")}
    >
      <div className={styles.projectTopline}>
        <span className={styles.projectNumber}>{String(index + 1).padStart(2, "0")}</span>
        <span className={`${styles.statusBadge} ${styles[`status${project.status.replace(/\s/g, "")}`]}`}>
          {project.status}
        </span>
      </div>

      {mediaSrc ? (
        <>
          <button
            type="button"
            className={`${styles.projectMedia} ${v2.projectMediaV2} ${mediaOverride?.mode === "contain" ? v2.projectMediaContain : ""}`}
            onClick={() => onOpenMedia(mediaSrc, mediaAlt)}
            aria-label={`${labels.evidence}: ${project.title}`}
          >
            <Image
              src={mediaSrc}
              alt={mediaAlt}
              fill
              sizes={project.id === "clouva" ? "(max-width: 760px) 100vw, 80vw" : "(max-width: 760px) 100vw, 50vw"}
            />
            <span className={styles.mediaBadge}>{project.id === "creator" ? copy.evidenceNote : labels.evidence}</span>
          </button>
          {architecture ? (
            <div className={v2.architectureStrip} aria-label={`${labels.details}: ${project.title}`}>
              {architecture.map((step, stepIndex) => (
                <span key={step}>
                  <b>{step}</b>
                  {stepIndex < architecture.length - 1 ? <i>→</i> : null}
                </span>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <div className={`${styles.projectDiagram} ${v2.projectDiagramV2}`} aria-label={`${labels.details}: ${project.title}`}>
          <Icon size={34} strokeWidth={1.35} />
          {architecture ? (
            <div className={styles.miniPipeline}>
              {architecture.map((step, stepIndex) => (
                <span key={step}>
                  <b>{step}</b>
                  {stepIndex < architecture.length - 1 ? <i>→</i> : null}
                </span>
              ))}
            </div>
          ) : (
            <div className={styles.projectCloud}>
              <span>GCS</span><span>Supabase</span><span>public/</span>
            </div>
          )}
        </div>
      )}

      <div className={`${styles.projectBody} ${v2.projectBodyV2}`}>
        <span className={styles.eyebrow}>{project.eyebrow}</span>
        <div className={styles.projectTitleRow}>
          <h3>{project.title}</h3>
          <Icon size={20} strokeWidth={1.5} aria-hidden="true" />
        </div>

        <div className={v2.contextGrid}>
          <div>
            <span>{copy.context.problem}</span>
            <p>{detail?.problem ?? project.summary}</p>
          </div>
          <div>
            <span>{copy.context.built}</span>
            <p>{detail?.built ?? project.result}</p>
          </div>
          <div className={v2.contextSystem}>
            <span>{copy.context.system}</span>
            <p>{detail?.system ?? project.tags.join(" · ")}</p>
          </div>
        </div>

        <div className={`${styles.projectResult} ${v2.projectResultV2}`}>{project.result}</div>
        <ul className={`${styles.projectBullets} ${v2.projectBulletsV2}`}>
          {project.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}
        </ul>
        <div className={`${styles.tags} ${v2.tagsV2}`}>
          {project.tags.map((tag) => <span key={tag}>{tag}</span>)}
        </div>

        {project.route ? (
          <Link className={`${styles.projectLink} ${v2.projectLinkV2}`} href={project.route}>
            {isAuthenticated ? labels.authenticated : labels.open}
            <ArrowUpRight size={15} />
          </Link>
        ) : null}
      </div>
    </article>
  );
}

export function PortfolioProjectExplorer({ locale, projects, labels, onOpenMedia }: Props) {
  const copy = PORTFOLIO_V2_COPY[locale];
  const primary = projects.filter((project) => PROJECT_PRIMARY_IDS.has(project.id));
  const secondary = projects.filter((project) => !PROJECT_PRIMARY_IDS.has(project.id));

  return (
    <div className={v2.explorer}>
      <StatusLegend locale={locale} />

      <div className={v2.groupHeader}>
        <span>01</span>
        <strong>{copy.groups.primary}</strong>
        <i />
      </div>
      <div className={`${styles.projectGrid} ${v2.projectGridPrimary}`}>
        {primary.map((project, index) => (
          <ProjectCard
            key={project.id}
            project={project}
            index={index}
            locale={locale}
            labels={labels}
            onOpenMedia={onOpenMedia}
            primary
          />
        ))}
      </div>

      <div className={v2.groupHeader}>
        <span>02</span>
        <strong>{copy.groups.secondary}</strong>
        <i />
      </div>
      <div className={`${styles.projectGrid} ${v2.projectGridSecondary}`}>
        {secondary.map((project, index) => (
          <ProjectCard
            key={project.id}
            project={project}
            index={primary.length + index}
            locale={locale}
            labels={labels}
            onOpenMedia={onOpenMedia}
            primary={false}
          />
        ))}
      </div>
    </div>
  );
}
