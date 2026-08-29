"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";

const INTRO_MARKS = ["A", "B", "C", "D", "E", "F"] as const;
type IntroMarkId = (typeof INTRO_MARKS)[number];
type MarkId = IntroMarkId | "FINAL";

const MARK_LABELS: Record<MarkId, string> = {
  A: "Continuidad",
  B: "Espacio negativo",
  C: "Rotacional",
  D: "Infinito oculto",
  E: "Ojo oculto",
  F: "Abstracto CLOUVA",
  FINAL: "Símbolo CLOUVA",
};

function DiamondCore({ filled = true }: { filled?: boolean }) {
  return (
    <motion.path
      d="M50 43 L57 50 L50 57 L43 50 Z"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={filled ? 0 : 3.5}
      strokeLinejoin="round"
      initial={{ scale: 0.72, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.34, ease: [0.2, 0.8, 0.2, 1] }}
      style={{ transformOrigin: "50px 50px" }}
    />
  );
}

function MarkGraphic({ id }: { id: IntroMarkId }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 5.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  if (id === "A") {
    return (
      <>
        <motion.path
          {...common}
          d="M50 50 C39 35 26 29 20 38 C14 47 23 57 36 55 C41 54 46 52 50 50 C54 48 59 46 64 45 C77 43 86 53 80 62 C74 71 61 65 50 50 C39 62 41 78 50 80 C59 78 61 62 50 50 C39 38 41 22 50 20 C59 22 61 38 50 50"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 0.46, ease: "easeInOut" }}
        />
        <DiamondCore />
      </>
    );
  }

  if (id === "B") {
    const petals = [
      { cx: 36, cy: 36, rotate: -45 },
      { cx: 64, cy: 36, rotate: 45 },
      { cx: 36, cy: 64, rotate: 45 },
      { cx: 64, cy: 64, rotate: -45 },
    ];

    return (
      <>
        {petals.map((petal, index) => (
          <motion.ellipse
            key={`${petal.cx}-${petal.cy}`}
            cx={petal.cx}
            cy={petal.cy}
            rx="13"
            ry="18"
            fill="currentColor"
            initial={{ scale: 0.55, opacity: 0, rotate: petal.rotate - 16 }}
            animate={{ scale: 1, opacity: 1, rotate: petal.rotate }}
            transition={{ duration: 0.34, delay: index * 0.025, ease: [0.2, 0.8, 0.2, 1] }}
            style={{ transformBox: "fill-box", transformOrigin: "center" }}
          />
        ))}
        <DiamondCore />
      </>
    );
  }

  if (id === "C") {
    return (
      <>
        <motion.path
          {...common}
          d="M50 49 C41 44 36 34 40 25 C43 18 51 16 57 20 C64 25 64 35 58 43 C56 46 53 48 50 49 Z M51 50 C56 41 66 36 75 40 C82 43 84 51 80 57 C75 64 65 64 57 58 C54 56 52 53 51 50 Z M50 51 C59 56 64 66 60 75 C57 82 49 84 43 80 C36 75 36 65 42 57 C44 54 47 52 50 51 Z M49 50 C44 59 34 64 25 60 C18 57 16 49 20 43 C25 36 35 36 43 42 C46 44 48 47 49 50 Z"
          initial={{ pathLength: 0, rotate: -20, opacity: 0 }}
          animate={{ pathLength: 1, rotate: 0, opacity: 1 }}
          transition={{ duration: 0.44, ease: [0.2, 0.8, 0.2, 1] }}
          style={{ transformOrigin: "50px 50px" }}
        />
        <DiamondCore />
      </>
    );
  }

  if (id === "D") {
    return (
      <>
        <motion.path
          {...common}
          d="M49 50 C41 39 33 33 25 34 C16 35 14 46 20 52 C27 59 38 55 49 50 C60 45 71 41 78 48 C84 54 82 65 73 66 C65 67 57 61 49 50"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 0.4, ease: "easeInOut" }}
        />
        <motion.path
          {...common}
          d="M50 48 C42 40 41 29 47 22 C53 15 64 19 66 28 C68 36 61 44 50 48 M50 52 C42 60 41 71 47 78 C53 85 64 81 66 72 C68 64 61 56 50 52"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 0.38, delay: 0.06, ease: "easeInOut" }}
        />
        <DiamondCore />
      </>
    );
  }

  if (id === "E") {
    return (
      <>
        <motion.path
          {...common}
          strokeWidth={7}
          d="M50 20 C58 20 64 26 66 34 C75 34 82 40 82 49 C82 58 75 64 66 66 C64 75 58 82 50 82 C42 82 36 75 34 66 C25 64 18 58 18 49 C18 40 25 34 34 34 C36 26 42 20 50 20 Z"
          initial={{ pathLength: 0, scale: 0.86, opacity: 0 }}
          animate={{ pathLength: 1, scale: 1, opacity: 1 }}
          transition={{ duration: 0.42, ease: [0.2, 0.8, 0.2, 1] }}
          style={{ transformOrigin: "50px 50px" }}
        />
        <DiamondCore filled={false} />
      </>
    );
  }

  return (
    <>
      <motion.path
        {...common}
        d="M23 37 Q50 15 77 37"
        initial={{ pathLength: 0, y: 5, opacity: 0 }}
        animate={{ pathLength: 1, y: 0, opacity: 1 }}
        transition={{ duration: 0.36, ease: [0.2, 0.8, 0.2, 1] }}
      />
      <motion.path
        {...common}
        d="M23 63 Q50 85 77 63"
        initial={{ pathLength: 0, y: -5, opacity: 0 }}
        animate={{ pathLength: 1, y: 0, opacity: 1 }}
        transition={{ duration: 0.36, ease: [0.2, 0.8, 0.2, 1] }}
      />
      <DiamondCore />
    </>
  );
}

function FinalClouvaMark() {
  const line = {
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  return (
    <>
      <motion.path
        {...line}
        strokeWidth="5.5"
        d="M20 34 Q50 11 80 34"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 0.52, ease: [0.2, 0.8, 0.2, 1] }}
      />
      <motion.path
        {...line}
        strokeWidth="5.5"
        d="M20 66 Q50 89 80 66"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 0.52, ease: [0.2, 0.8, 0.2, 1] }}
      />

      <motion.path
        {...line}
        strokeWidth="4.8"
        d="M50 50 C43 45 38 38 40 31 C42 25 49 24 53 28 C58 33 56 41 50 50 Z"
        initial={{ pathLength: 0, opacity: 0, scale: 0.78 }}
        animate={{ pathLength: 1, opacity: 1, scale: 1 }}
        transition={{ duration: 0.44, delay: 0.08, ease: [0.2, 0.8, 0.2, 1] }}
        style={{ transformOrigin: "50px 50px" }}
      />
      <motion.path
        {...line}
        strokeWidth="4.8"
        d="M50 50 C55 43 62 38 69 40 C75 42 76 49 72 53 C67 58 59 56 50 50 Z"
        initial={{ pathLength: 0, opacity: 0, scale: 0.78 }}
        animate={{ pathLength: 1, opacity: 1, scale: 1 }}
        transition={{ duration: 0.44, delay: 0.12, ease: [0.2, 0.8, 0.2, 1] }}
        style={{ transformOrigin: "50px 50px" }}
      />
      <motion.path
        {...line}
        strokeWidth="4.8"
        d="M50 50 C57 55 62 62 60 69 C58 75 51 76 47 72 C42 67 44 59 50 50 Z"
        initial={{ pathLength: 0, opacity: 0, scale: 0.78 }}
        animate={{ pathLength: 1, opacity: 1, scale: 1 }}
        transition={{ duration: 0.44, delay: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
        style={{ transformOrigin: "50px 50px" }}
      />
      <motion.path
        {...line}
        strokeWidth="4.8"
        d="M50 50 C45 57 38 62 31 60 C25 58 24 51 28 47 C33 42 41 44 50 50 Z"
        initial={{ pathLength: 0, opacity: 0, scale: 0.78 }}
        animate={{ pathLength: 1, opacity: 1, scale: 1 }}
        transition={{ duration: 0.44, delay: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
        style={{ transformOrigin: "50px 50px" }}
      />

      <motion.path
        d="M50 45 L55 50 L50 55 L45 50 Z"
        fill="currentColor"
        initial={{ scale: 0, rotate: -45, opacity: 0 }}
        animate={{ scale: 1, rotate: 0, opacity: 1 }}
        transition={{ duration: 0.38, delay: 0.32, ease: [0.2, 0.8, 0.2, 1] }}
        style={{ transformOrigin: "50px 50px" }}
      />
    </>
  );
}

export function AnimatedClouvaMark({ className = "" }: { className?: string }) {
  const prefersReducedMotion = useReducedMotion();
  const [markId, setMarkId] = useState<MarkId>(prefersReducedMotion ? "FINAL" : "A");

  useEffect(() => {
    if (prefersReducedMotion) {
      setMarkId("FINAL");
      return;
    }

    const sequence: MarkId[] = ["A", "B", "C", "D", "E", "F", "FINAL"];
    const timers = sequence.slice(1).map((id, index) =>
      window.setTimeout(() => setMarkId(id), (index + 1) * 620),
    );

    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [prefersReducedMotion]);

  const final = markId === "FINAL";

  return (
    <div className={`flex w-full flex-col items-center ${className}`}>
      <div className="relative grid w-full max-w-[28rem] place-items-center" aria-live="polite">
        <div
          className="relative grid aspect-square w-full place-items-center text-white"
          role="img"
          aria-label={final ? "Logo oficial de CLOUVA" : `Construyendo logo CLOUVA: ${MARK_LABELS[markId]}`}
        >
          <motion.div
            className="absolute inset-[18%] rounded-full bg-violet-500/[0.08] blur-3xl"
            aria-hidden="true"
            animate={{ opacity: final ? 0.72 : 0.38, scale: final ? 1.08 : 0.94 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
          />

          <AnimatePresence mode="wait" initial={false}>
            <motion.svg
              key={markId}
              viewBox="0 0 100 100"
              className="relative h-[72%] w-[72%] overflow-visible"
              initial={{ opacity: 0, scale: 0.88, rotate: -5 }}
              animate={{ opacity: 1, scale: final ? 1.04 : 1, rotate: 0 }}
              exit={{ opacity: 0, scale: 1.08, rotate: 5 }}
              transition={{ duration: prefersReducedMotion ? 0 : 0.28, ease: [0.2, 0.8, 0.2, 1] }}
            >
              {final ? <FinalClouvaMark /> : <MarkGraphic id={markId as IntroMarkId} />}
            </motion.svg>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
