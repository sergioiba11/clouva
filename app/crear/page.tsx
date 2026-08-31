import type { Metadata } from "next";
import Link from "next/link";
import {
  Bot,
  Boxes,
  CircleUserRound,
  ImagePlay,
  Palette,
  Shirt,
  Sparkles,
} from "lucide-react";

export const metadata: Metadata = {
  title: "Crear | CLOUVA",
  description: "La puerta principal para crear dentro de CLOUVA.",
};

const creativeTools = [
  {
    title: "Imagen / Video",
    description: "Abrí el Media Creator actual para generar y trabajar contenido visual.",
    href: "/crear/media",
    icon: ImagePlay,
  },
  {
    title: "CLOUVA AI / Trébol",
    description: "Entrá al asistente y las herramientas de IA de CLOUVA.",
    href: "/clouva-ai",
    icon: Bot,
  },
  {
    title: "Creator Studio 3D",
    description: "Prendas, accesorios, objetos GLB y pipeline 3D especializado.",
    href: "/creator-studio",
    icon: Boxes,
  },
  {
    title: "Avatar",
    description: "Abrí tu identidad 3D y sus herramientas existentes.",
    href: "/mi-flow/avatar",
    icon: CircleUserRound,
  },
  {
    title: "Ropa y accesorios",
    description: "Creá prendas conectadas con Creator Studio, armario y avatar.",
    href: "/mi-flow/crear-prenda",
    icon: Shirt,
  },
  {
    title: "Centro creativo",
    description: "Abrí el centro creativo y las herramientas que ya forman parte de CLOUVA.",
    href: "/mi-flow/creative",
    icon: Palette,
  },
] as const;

export default function CrearPage() {
  return (
    <main className="min-h-screen bg-[#05030a] px-4 py-10 text-white sm:px-6 lg:px-8">
      <section className="mx-auto w-full max-w-6xl">
        <div className="flex flex-col gap-5 border-b border-white/10 pb-8 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-violet-300">
              <Sparkles className="h-4 w-4" /> CLOUVA · Crear
            </div>
            <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Hacé cosas.</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/55 sm:text-base">
              Crear es la puerta principal a las herramientas creativas reales de CLOUVA. Elegí qué querés construir y entrá al sistema especializado correspondiente.
            </p>
          </div>
          <Link href="/biblioteca" className="inline-flex w-fit items-center rounded-full border border-white/15 px-4 py-2 text-sm text-white/70 transition hover:border-violet-400/40 hover:text-white">
            Biblioteca
          </Link>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {creativeTools.map((tool) => {
            const Icon = tool.icon;
            return (
              <Link
                key={tool.href}
                href={tool.href}
                className="group rounded-[1.75rem] border border-white/10 bg-white/[0.035] p-6 transition hover:-translate-y-0.5 hover:border-violet-400/35 hover:bg-violet-500/[0.06]"
              >
                <span className="grid h-11 w-11 place-items-center rounded-2xl border border-violet-400/20 bg-violet-500/10 text-violet-200">
                  <Icon className="h-5 w-5" />
                </span>
                <h2 className="mt-5 text-xl font-semibold">{tool.title}</h2>
                <p className="mt-2 text-sm leading-6 text-white/50">{tool.description}</p>
                <span className="mt-5 inline-flex text-sm font-medium text-violet-300 transition group-hover:text-violet-200">Abrir →</span>
              </Link>
            );
          })}
        </div>
      </section>
    </main>
  );
}
