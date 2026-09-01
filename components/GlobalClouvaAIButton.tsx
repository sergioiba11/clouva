"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { X } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { ClouvaAICompactPanel } from "@/components/clouva-ai/ClouvaAICompactPanel";
import { useClouvaAIAssistant } from "@/components/clouva-ai/ClouvaAIAssistantProvider";
import styles from "./GlobalClouvaAIButton.module.css";

const MASCOT_SRC = "/assets/clouva-ai/trebol-mascot.png";
const POSITION_STORAGE_KEY = "clouva-ai-launcher-position";
const VIEWPORT_PADDING = 10;
const DRAG_THRESHOLD = 5;

type LauncherPosition = { x: number; y: number };

type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  moved: boolean;
};

export function GlobalClouvaAIButton() {
  const { user, loading } = useAuth();
  const { open, toggleAssistant, closeAssistant } = useClouvaAIAssistant();
  const launcherRef = useRef<HTMLButtonElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const positionRef = useRef<LauncherPosition | null>(null);
  const suppressClickRef = useRef(false);
  const [position, setPosition] = useState<LauncherPosition | null>(null);
  const [dragging, setDragging] = useState(false);

  const clampPosition = (x: number, y: number): LauncherPosition => {
    const launcher = launcherRef.current;
    const width = launcher?.offsetWidth ?? 0;
    const height = launcher?.offsetHeight ?? 0;
    const maxX = Math.max(VIEWPORT_PADDING, window.innerWidth - width - VIEWPORT_PADDING);
    const maxY = Math.max(VIEWPORT_PADDING, window.innerHeight - height - VIEWPORT_PADDING);

    return {
      x: Math.min(Math.max(x, VIEWPORT_PADDING), maxX),
      y: Math.min(Math.max(y, VIEWPORT_PADDING), maxY),
    };
  };

  const applyPosition = (next: LauncherPosition) => {
    positionRef.current = next;
    setPosition(next);
  };

  useEffect(() => {
    if (loading) return;

    const launcher = launcherRef.current;
    if (!launcher) return;

    let nextPosition: LauncherPosition | null = null;
    const saved = window.localStorage.getItem(POSITION_STORAGE_KEY);

    if (saved) {
      try {
        const parsed = JSON.parse(saved) as Partial<LauncherPosition>;
        if (Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) {
          nextPosition = clampPosition(parsed.x as number, parsed.y as number);
        }
      } catch {
        window.localStorage.removeItem(POSITION_STORAGE_KEY);
      }
    }

    if (!nextPosition) {
      const rect = launcher.getBoundingClientRect();
      nextPosition = clampPosition(rect.left, rect.top);
    }

    applyPosition(nextPosition);

    const handleResize = () => {
      const current = positionRef.current;
      if (!current) return;
      const clamped = clampPosition(current.x, current.y);
      applyPosition(clamped);
      window.localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(clamped));
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [loading]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      closeAssistant();
      const launcher = launcherRef.current;
      if (launcher?.getClientRects().length) launcher.focus();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [closeAssistant, open]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;

    const launcher = launcherRef.current;
    if (!launcher) return;

    const rect = launcher.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: rect.left,
      originY: rect.top,
      moved: false,
    };
    suppressClickRef.current = false;
    launcher.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;

    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    if (!drag.moved) {
      drag.moved = true;
      setDragging(true);
    }

    event.preventDefault();
    applyPosition(clampPosition(drag.originX + dx, drag.originY + dy));
  };

  const finishDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    if (launcherRef.current?.hasPointerCapture(event.pointerId)) {
      launcherRef.current.releasePointerCapture(event.pointerId);
    }

    suppressClickRef.current = drag.moved;
    dragRef.current = null;
    setDragging(false);

    const current = positionRef.current;
    if (current && drag.moved) {
      window.localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(current));
    }
  };

  const handleClick = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    toggleAssistant();
  };

  if (loading) return null;

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
        className={`${styles.launcher} ${dragging ? styles.dragging : ""}`}
        style={position ? { left: position.x, top: position.y, bottom: "auto" } : undefined}
        onClick={handleClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        aria-expanded={open}
        aria-label={open ? "Cerrar CLOUVA AI" : "Abrir CLOUVA AI"}
      >
        <Image src={MASCOT_SRC} alt="" width={48} height={48} priority draggable={false} />
        <span><b>CLOUVA AI</b><small>Lista para ayudarte</small></span>
      </button>
    </>
  );
}
