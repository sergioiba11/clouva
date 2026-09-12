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
import type { PortfolioStatus } from "@/lib/portfolio/portfolio-data";
import styles from "@/app/portafolio/portfolio.module.css";

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
  projects: readonly ProjectView[];
  labels: {
    open: string;
    authenticated: string;
    evidence: string;
    details: string;
  };
  onOpenMedia: (src: string, alt: string) => void;
};

export function PortfolioProjectExplorer({ projects, labels, onOpenMedia }: Props) {
  return (
    <div className={styles.projectGrid}>
      {projects.map((project, index) => {
        const Icon = projectIcons[project.id as keyof typeof projectIcons] ?? Sparkles;
        const isAuthenticated = project.route === "/mi-flow" || project.route === "/crear";
        const architecture = project.architecture;

        return (
          <article className={styles.projectCard} key={project.id}>
            <div className={styles.projectTopline}>
              <span className={styles.projectNumber}>{String(index + 1).padStart(2, "0")}</span>
              <span className={`${styles.statusBadge} ${styles[`status${project.status.replace(/\s/g, "")}`]}`}>
                {project.status}
              </span>
            </div>

            {project.media ? (
              <button
                type="button"
                className={styles.projectMedia}
                onClick={() => onOpenMedia(project.media as string, project.mediaAlt || project.title)}
                aria-label={`${labels.evidence}: ${project.title}`}
              >
                <Image
                  src={project.media}
                  alt={project.mediaAlt || ""}
                  fill
                  sizes="(max-width: 760px) 100vw, (max-width: 1180px) 50vw, 38vw"
                />
                <span className={styles.mediaBadge}>{labels.evidence}</span>
              </button>
            ) : (
              <div className={styles.projectDiagram} aria-label={`${labels.details}: ${project.title}`}>
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

            <div className={styles.projectBody}>
              <span className={styles.eyebrow}>{project.eyebrow}</span>
              <div className={styles.projectTitleRow}>
                <h3>{project.title}</h3>
                <Icon size={20} strokeWidth={1.5} aria-hidden="true" />
              </div>
              <p className={styles.projectSummary}>{project.summary}</p>
              <div className={styles.projectResult}>{project.result}</div>
              <ul className={styles.projectBullets}>
                {project.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}
              </ul>
              <div className={styles.tags}>
                {project.tags.map((tag) => <span key={tag}>{tag}</span>)}
              </div>

              {project.route ? (
                <Link className={styles.projectLink} href={project.route}>
                  {isAuthenticated ? labels.authenticated : labels.open}
                  <ArrowUpRight size={15} />
                </Link>
              ) : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}
