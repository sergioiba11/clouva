"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

const MARKS = [
  { id: "A", name: "Continuidad" },
  { id: "B", name: "Espacio negativo" },
  { id: "C", name: "Rotacional" },
  { id: "D", name: "Infinito oculto" },
  { id: "E", name: "Ojo oculto" },
  { id: "F", name: "Abstracto CLOUVA" },
] as const;

type MarkId = (typeof MARKS)[number]["id"];

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
      transition={{ duration: 0.45, ease: [0.2, 0.8, 0.2, 1] }}
      style={{ transformOrigin: "50px 50px" }}
    />
  );
}

function MarkGraphic({ id }: { id: MarkId }) {
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
          transition={{ duration: 0.75, ease: "easeInOut" }}
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
            initial={{ scale: 0.45, opacity: 0, rotate: petal.rotate - 20 }}
            animate={{ scale: 1, opacity: 1, rotate: petal.rotate }}
            transition={{ duration: 0.5, delay: index * 0.045, ease: [0.2, 0.8, 0.2, 1] }}
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
          initial={{ pathLength: 0, rotate: -24, opacity: 0 }}
          animate={{ pathLength: 1, rotate: 0, opacity: 1 }}
          transition={{ duration: 0.72, ease: [0.2, 0.8, 0.2, 1] }}
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
          transition={{ duration: 0.62, ease: "easeInOut" }}
        />
        <motion.path
          {...common}
          d="M50 48 C42 40 41 29 47 22 C53 15 64 19 66 28 C68 36 61 44 50 48 M50 52 C42 60 41 71 47 78 C53 85 64 81 66 72 C68 64 61 56 50 52"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.12, ease: "easeInOut" }}
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
          initial={{ pathLength: 0, scale: 0.82, opacity: 0 }}
          animate={{ pathLength: 1, scale: 1, opacity: 1 }}
          transition={{ duration: 0.65, ease: [0.2, 0.8, 0.2, 1] }}
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
        initial={{ pathLength: 0, y: 6, opacity: 0 }}
        animate={{ pathLength: 1, y: 0, opacity: 1 }}
        transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}
      />
      <motion.path
        {...common}
        d="M23 63 Q50 85 77 63"
        initial={{ pathLength: 0, y: -6, opacity: 0 }}
        animate={{ pathLength: 1, y: 0, opacity: 1 }}
        transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}
      />
      <DiamondCore />
    </>
  );
}

export function AnimatedClouvaMark({ className = "" }: { className?: string }) {
  const prefersReducedMotion = useReducedMotion();
  const [index, setIndex] = useState(MARKS.length - 1);
  const [playing, setPlaying] = useState(true);

  const mark = MARKS[index];
  const next = useCallback(() => setIndex((current) => (current + 1) % MARKS.length), []);
  const previous = useCallback(() => setIndex((current) => (current - 1 + MARKS.length) % MARKS.length), []);

  useEffect(() => {
    if (!playing || prefersReducedMotion) return;
    const timer = window.setInterval(next, 2300);
    return () => window.clearInterval(timer);
  }, [next, playing, prefersReducedMotion]);

  const status = useMemo(() => `${mark.id} · ${mark.name}`, [mark]);

  return (
    <div className={`flex w-full flex-col items-center ${className}`}>
      <div className="relative grid w-full max-w-[28rem] place-items-center">
        <button
          type="button"
          onClick={next}
          className="group relative grid aspect-square w-full place-items-center rounded-[2.5rem] text-white outline-none focus-visible:ring-2 focus-visible:ring-violet-300/80"
          aria-label={`Símbolo CLOUVA: ${status}. Tocar para ver la siguiente forma.`}
        >
          <div
            className="absolute inset-[18%] rounded-full bg-violet-500/[0.08] blur-3xl transition-opacity duration-700 group-hover:opacity-90"
            aria-hidden="true"
          />
          <AnimatePresence mode="wait" initial={false}>
            <motion.svg
              key={mark.id}
              viewBox="0 0 100 100"
              className="relative h-[72%] w-[72%] overflow-visible"
              role="img"
              aria-label={status}
              initial={{ opacity: 0, scale: 0.86, rotate: -8 }}
              animate={{ opacity: 1, scale: 1, rotate: 0 }}
              exit={{ opacity: 0, scale: 1.12, rotate: 8 }}
              transition={{ duration: prefersReducedMotion ? 0 : 0.46, ease: [0.2, 0.8, 0.2, 1] }}
            >
              <MarkGraphic id={mark.id} />
            </motion.svg>
          </AnimatePresence>
        </button>
      </div>

      <div className="mt-1 flex min-h-11 items-center justify-center gap-1.5" aria-label="Variantes del símbolo CLOUVA">
        {MARKS.map((item, itemIndex) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setIndex(itemIndex)}
            className="grid h-11 w-8 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-violet-300/80"
            aria-label={`Ver ${item.id}: ${item.name}`}
            aria-current={itemIndex === index ? "true" : undefined}
          >
            <span
              className={`block rounded-full transition-all duration-300 ${
                itemIndex === index ? "h-1.5 w-5 bg-white" : "h-1.5 w-1.5 bg-white/30"
              }`}
            />
          </button>
        ))}
      </div>

      <div className="mt-1 flex items-center gap-1 text-white/55">
        <button
          type="button"
          onClick={previous}
          className="grid h-11 w-11 place-items-center rounded-full transition hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/80"
          aria-label="Forma anterior"
        >
          <ChevronLeft size={18} />
        </button>
        <button
          type="button"
          onClick={() => setPlaying((current) => !current)}
          className="grid h-11 w-11 place-items-center rounded-full transition hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/80"
          aria-label={playing ? "Pausar animación" : "Reproducir animación"}
        >
          {playing ? <Pause size={15} /> : <Play size={15} />}
        </button>
        <span className="min-w-24 text-center text-[10px] font-medium uppercase tracking-[0.22em] text-white/40">
          {status}
        </span>
        <button
          type="button"
          onClick={next}
          className="grid h-11 w-11 place-items-center rounded-full transition hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/80"
          aria-label="Siguiente forma"
        >
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}
