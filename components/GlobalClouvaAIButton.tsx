"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { ClouvaAICompactPanel } from "@/components/clouva-ai/ClouvaAICompactPanel";
import { useClouvaAIAssistant } from "@/components/clouva-ai/ClouvaAIAssistantProvider";
import styles from "./GlobalClouvaAIButton.module.css";

const MASCOT_SRC = "/assets/clouva-ai/trebol-mascot.png";

export function GlobalClouvaAIButton() {
  const pathname = usePathname();
  const { user, loading } = useAuth();
  const { open, toggleAssistant, closeAssistant } = useClouvaAIAssistant();
  const launcherRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      closeAssistant();
      launcherRef.current?.focus();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [closeAssistant, open]);

  if (pathname === "/clouva-ai" || loading) return null;

  return (
    <>
      {open && user ? <ClouvaAICompactPanel /> : null}
      {open && !user ? (
        <section className={styles.signedOut} role="dialog" aria-label="Ingresar a CLOUVA AI">
          <button type="button" onClick={closeAssistant} aria-label="Cerrar"><X size={17} /></button>
          <Image src={MASCOT_SRC} alt="Trébol" width={80} height={80} />
          <small>CLOUVA AI</small>
          <h2>Trébol quiere ayudarte.</h2>
          <p>Ingresá a tu cuenta para conversar, recuperar tu historial y trabajar sobre tu mundo CLOUVA.</p>
          <Link href="/login" onClick={closeAssistant}>Ingresar a CLOUVA</Link>
        </section>
      ) : null}
      <button
        ref={launcherRef}
        type="button"
        className={styles.launcher}
        onClick={toggleAssistant}
        aria-expanded={open}
        aria-label={open ? "Cerrar CLOUVA AI" : "Abrir CLOUVA AI"}
      >
        <Image src={MASCOT_SRC} alt="" width={48} height={48} priority />
        <span><b>CLOUVA AI</b><small>Lista para ayudarte</small></span>
      </button>
    </>
  );
}
