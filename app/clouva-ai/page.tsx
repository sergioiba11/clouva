import { ClouvaAIChat } from "@/components/clouva-ai/ClouvaAIChat";
import styles from "./page.module.css";

export default function ClouvaAIPage() {
  return (
    <main className={styles.page}>
      <ClouvaAIChat />
    </main>
  );
}
