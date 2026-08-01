import type { RegionStats as RegionStatsType } from "./view-model";
import styles from "./avatar-analyzer-wizard.module.css";

/** Conteo real por región -- nunca la longitud de una lista ya filtrada.
 * Ver getRegionStats() en view-model.ts: recorre todos los landmarks. */
export function RegionStats({ label, stats }: { label: string; stats: RegionStatsType }) {
  return (
    <div className={styles.regionStats}>
      <div className={styles.regionStatsHeader}>
        <strong>{label}</strong>
        <span>{stats.total} totales</span>
      </div>
      <div className={styles.regionStatsGrid}>
        <span className={styles.statVerified}>{stats.verified} verificados</span>
        <span className={styles.statPending}>{stats.pending} pendientes</span>
        <span className={styles.statBlocking}>{stats.blocking} bloqueantes</span>
        <span className={styles.statInfo}>{stats.informational} informativos</span>
        <span className={styles.statInternal}>{stats.internal} internos</span>
        <span className={styles.statSurface}>{stats.surface} superficiales</span>
      </div>
    </div>
  );
}
