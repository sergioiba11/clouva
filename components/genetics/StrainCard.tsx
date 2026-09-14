"use client";

import Link from "next/link";
import { Heart } from "lucide-react";
import type { MouseEvent } from "react";
import type { Strain } from "@/lib/genetics/types";
import styles from "./genetics.module.css";

export function StrainCard({
  strain,
  favorite = false,
  onFavorite,
}: {
  strain: Strain;
  favorite?: boolean;
  onFavorite?: (strain: Strain) => void;
}) {
  const toggleFavorite = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onFavorite?.(strain);
  };

  return (
    <Link href={`/geneticas/${encodeURIComponent(strain.slug)}`} className={styles.strainCard}>
      <div className={styles.strainMedia}>
        {strain.hero_image ? <img src={strain.hero_image} alt={`Vista de ${strain.name}`} loading="lazy" /> : <span className={styles.strainFallback} aria-hidden="true" />}
        {onFavorite ? (
          <button type="button" onClick={toggleFavorite} className={styles.favoriteButton} aria-label={favorite ? `Quitar ${strain.name} de guardadas` : `Guardar ${strain.name}`}>
            <Heart size={18} fill={favorite ? "currentColor" : "none"} />
          </button>
        ) : null}
        <span className={styles.strainMediaShade} aria-hidden="true" />
      </div>
      <div className={styles.strainCardBody}>
        <strong>{strain.name}</strong>
        <span>{strain.subtitle || strain.strain_type || "Genética"}</span>
        <div>{strain.tags.slice(0, 3).map((tag) => <em key={tag}>{tag}</em>)}</div>
      </div>
    </Link>
  );
}
