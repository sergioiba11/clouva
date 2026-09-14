"use client";

import Link from "next/link";
import { ArrowLeft, Leaf, UserRound } from "lucide-react";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { GeneticsBottomNav } from "@/components/genetics/GeneticsBottomNav";
import styles from "./genetics.module.css";

export function GeneticsShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() || "/geneticas";
  const isRoot = pathname === "/geneticas";

  return (
    <div className={styles.shell}>
      <div className={styles.atmosphere} aria-hidden="true" />
      <header className={styles.moduleHeader}>
        <div className={styles.headerSide}>
          {!isRoot ? (
            <Link href="/geneticas" className={styles.iconButton} aria-label="Volver a descubrir">
              <ArrowLeft size={20} />
            </Link>
          ) : (
            <span className={styles.brandLeaf} aria-hidden="true"><Leaf size={21} /></span>
          )}
        </div>
        <Link href="/geneticas" className={styles.brandBlock} aria-label="CLOUVA Genéticas">
          <strong>CLOUVA</strong>
          <span>GENETICS · CULTIVA CONCIENCIA</span>
        </Link>
        <div className={`${styles.headerSide} ${styles.headerSideRight}`}>
          <Link href="/geneticas/perfil" className={styles.iconButton} aria-label="Abrir perfil de genéticas">
            <UserRound size={20} />
          </Link>
        </div>
      </header>

      <main className={styles.main}>{children}</main>
      <GeneticsBottomNav />
    </div>
  );
}
