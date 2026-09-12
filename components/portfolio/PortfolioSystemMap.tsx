"use client";

import { useState } from "react";
import { Boxes, CircleDollarSign, Cloud, Sparkles, UserRound } from "lucide-react";
import { systemDomains } from "@/lib/portfolio/portfolio-data";
import styles from "@/app/portafolio/portfolio.module.css";

const icons = {
  identity: UserRound,
  money: CircleDollarSign,
  creation: Sparkles,
  commerce: Boxes,
  infra: Cloud,
} as const;

type DomainId = (typeof systemDomains)[number]["id"];

type Props = {
  centerLabel: string;
  labels: Readonly<Record<DomainId, string>>;
};

export function PortfolioSystemMap({ centerLabel, labels }: Props) {
  const [active, setActive] = useState<DomainId>("creation");
  const selected = systemDomains.find((domain) => domain.id === active) ?? systemDomains[0];

  return (
    <div className={styles.systemMapLayout}>
      <div className={styles.systemMap} aria-label="CLOUVA system domains">
        <div className={styles.systemCore}>
          <span>C</span>
          <strong>{centerLabel}</strong>
          <small>Creative Operating System</small>
        </div>

        {systemDomains.map((domain, index) => {
          const Icon = icons[domain.id];
          return (
            <button
              type="button"
              key={domain.id}
              className={`${styles.systemNode} ${styles[`systemNode${index + 1}`]} ${active === domain.id ? styles.systemNodeActive : ""}`}
              onClick={() => setActive(domain.id)}
              aria-pressed={active === domain.id}
            >
              <Icon size={18} />
              <span>{labels[domain.id]}</span>
            </button>
          );
        })}
      </div>

      <aside className={styles.systemInspector} aria-live="polite">
        <span className={styles.inspectorLabel}>DOMAIN / {selected.id.toUpperCase()}</span>
        <h3>{labels[selected.id]}</h3>
        <div className={styles.inspectorNodes}>
          {selected.nodes.map((node, index) => (
            <div key={node}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{node}</strong>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
