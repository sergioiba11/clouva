import type { Metadata } from "next";
import { AvatarAnalyzerPreviewV42 } from "@/components/library/AvatarAnalyzerPreviewV42";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Avatar Analyzer V4.2 | CLOUVA",
  description: "Analizá y revisá la anatomía modular e incremental de tu avatar activo.",
};

export default function AvatarAnalyzerLandingPage() {
  return (
    <main className={styles.page}>
      <AvatarAnalyzerPreviewV42 />
    </main>
  );
}
