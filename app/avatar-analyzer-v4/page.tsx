import type { Metadata } from "next";
import { AvatarAnalyzerPreview } from "@/components/library/AvatarAnalyzerPreview";
import { AvatarAnalyzerResidualMetrics } from "@/components/library/AvatarAnalyzerResidualMetrics";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Avatar Analyzer V4.1 | CLOUVA",
  description: "Analizá y revisá la anatomía técnica de tu avatar activo.",
};

export default function AvatarAnalyzerLandingPage() {
  return (
    <main className={styles.page}>
      <AvatarAnalyzerPreview />
      <AvatarAnalyzerResidualMetrics />
    </main>
  );
}
