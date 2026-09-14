"use client";

import { Brain, Lightbulb, Smile, Sparkles, Zap } from "lucide-react";
import type { ComponentType } from "react";
import type { StrainEffects } from "@/lib/genetics/types";
import styles from "./genetics.module.css";

type Metric = {
  key: keyof StrainEffects;
  label: string;
  Icon: ComponentType<{ size?: number; strokeWidth?: number }>;
  tone: "gold" | "green";
};

const METRICS: Metric[] = [
  { key: "relaxation", label: "Relajación", Icon: Sparkles, tone: "gold" },
  { key: "creativity", label: "Creatividad", Icon: Lightbulb, tone: "gold" },
  { key: "energy", label: "Energía", Icon: Zap, tone: "green" },
  { key: "happiness", label: "Felicidad", Icon: Smile, tone: "gold" },
  { key: "focus", label: "Concentración", Icon: Brain, tone: "green" },
];

function point(cx: number, cy: number, radius: number, angle: number) {
  const radians = ((angle - 90) * Math.PI) / 180;
  return { x: cx + radius * Math.cos(radians), y: cy + radius * Math.sin(radians) };
}

function donutPath(start: number, end: number, inner: number, outer: number) {
  const a = point(160, 160, outer, start);
  const b = point(160, 160, outer, end);
  const c = point(160, 160, inner, end);
  const d = point(160, 160, inner, start);
  const large = end - start > 180 ? 1 : 0;
  return `M ${a.x} ${a.y} A ${outer} ${outer} 0 ${large} 1 ${b.x} ${b.y} L ${c.x} ${c.y} A ${inner} ${inner} 0 ${large} 0 ${d.x} ${d.y} Z`;
}

function arcPath(start: number, end: number, radius: number) {
  const a = point(160, 160, radius, start);
  const b = point(160, 160, radius, end);
  const large = end - start > 180 ? 1 : 0;
  return `M ${a.x} ${a.y} A ${radius} ${radius} 0 ${large} 1 ${b.x} ${b.y}`;
}

export function StrainEffectsWheel({ effects }: { effects: StrainEffects | null }) {
  return (
    <section className={styles.effectsSection} aria-labelledby="effects-title">
      <div className={styles.sectionKicker}>PERFIL VISUAL</div>
      <h2 id="effects-title">Cómo se siente esta ficha</h2>
      <div className={styles.wheel}>
        <svg viewBox="0 0 320 320" role="img" aria-label="Analizador circular de efectos">
          <defs>
            <filter id="genetics-glow"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
          </defs>
          {METRICS.map((metric, index) => {
            const start = -36 + index * 72 + 2.8;
            const end = -36 + (index + 1) * 72 - 2.8;
            const raw = effects?.[metric.key];
            const value = typeof raw === "number" ? Math.max(0, Math.min(10, raw)) : 0;
            const progressEnd = start + (end - start) * (value / 10);
            return (
              <g key={metric.key}>
                <path d={donutPath(start, end, 76, 145)} className={styles.wheelSegment} />
                {value > 0 ? (
                  <path
                    d={arcPath(start + 3, Math.max(start + 4, progressEnd - 3), 126)}
                    className={metric.tone === "gold" ? styles.wheelProgressGold : styles.wheelProgressGreen}
                    filter="url(#genetics-glow)"
                  />
                ) : null}
              </g>
            );
          })}
          <circle cx="160" cy="160" r="68" className={styles.wheelCenter} />
          <path d="M160 126c-10 12-17 24-17 38 10-3 16-9 17-18 1 9 7 15 17 18 0-14-7-26-17-38Z" className={styles.wheelLeaf} />
          <text x="160" y="176" textAnchor="middle" className={styles.wheelCenterText}>BUENAS IDEAS</text>
          <text x="160" y="190" textAnchor="middle" className={styles.wheelCenterText}>NATURALMENTE</text>
        </svg>

        {METRICS.map((metric, index) => {
          const angle = -90 + index * 72;
          const radians = (angle * Math.PI) / 180;
          const x = 50 + Math.cos(radians) * 35;
          const y = 50 + Math.sin(radians) * 35;
          const value = effects?.[metric.key];
          const Icon = metric.Icon;
          return (
            <div key={metric.key} className={styles.wheelLabel} style={{ left: `${x}%`, top: `${y}%` }}>
              <span>{metric.label}</span>
              <Icon size={18} strokeWidth={1.7} />
              <strong>{typeof value === "number" ? `${value}/10` : "—"}</strong>
            </div>
          );
        })}
      </div>
    </section>
  );
}
