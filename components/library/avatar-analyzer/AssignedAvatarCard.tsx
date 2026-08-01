import { AvatarAnalyzerViewer } from "./AvatarAnalyzerViewer";
import type { AssignedAvatarInfo, LatestAnalysisInfo } from "./types";
import styles from "./avatar-analyzer-wizard.module.css";

function formatDate(value?: string | null) {
  if (!value) return "Sin registrar";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Sin registrar" : parsed.toLocaleString("es-AR");
}

/** assignedAvatar = user.activeAvatar ?? officialClouvaAvatar -- ya es el
 * comportamiento real de /api/avatar/analyze/latest (buildAssignedAvatarInfo
 * sobre la fila is_active=true del usuario logueado). CLOUVA solo aparece
 * acá cuando la cuenta logueada ES la oficial; no hay ningún id hardcodeado. */
export function AssignedAvatarCard({
  avatar,
  avatarState,
  lastAnalysis,
  previewGlbUrl,
  analyzerProcessLabel,
}: {
  avatar: AssignedAvatarInfo | null;
  avatarState: "idle" | "loading" | "ready" | "failed";
  lastAnalysis: LatestAnalysisInfo | null;
  previewGlbUrl: string | null;
  analyzerProcessLabel: string;
}) {
  return (
    <section className={styles.assignedCard}>
      <AvatarAnalyzerViewer
        glbUrl={previewGlbUrl}
        landmarks={{}}
        stage="todos"
        showLandmarks={false}
        className={styles.assignedViewer}
        emptyLabel={avatarState === "loading" ? "Cargando avatar asignado…" : "Corré un análisis para ver el holograma."}
      />
      <dl className={styles.assignedGrid}>
        <div><dt>Nombre</dt><dd>{avatar?.name || "Avatar CLOUVA"}</dd></div>
        <div><dt>avatar_id</dt><dd className={styles.mono}>{avatar?.avatarId || "—"}</dd></div>
        <div><dt>Archivo GLB</dt><dd className={styles.mono}>{avatar?.glbPath || "—"}</dd></div>
        <div><dt>Estado del rig</dt><dd>{avatar?.rigStatus || "Sin datos"}</dd></div>
        <div><dt>Último análisis</dt><dd>{formatDate(lastAnalysis?.updatedAt || avatar?.updatedAt)}</dd></div>
        <div><dt>Estado del Analyzer</dt><dd>{analyzerProcessLabel}</dd></div>
      </dl>
    </section>
  );
}
