import Link from "next/link";
import { Compass, Sparkles, ShoppingBag, ArrowRight } from "lucide-react";
import { PublicShell } from "@/components/public/PublicShell";
import { VISUAL_ASSETS } from "@/lib/visual-assets";

const FEATURES = [
  {
    title: "La Matrix",
    description: "Descubrí Players, Estudios y proyectos conectados por la música y la creación.",
    href: "/matrix",
    cta: "Explorar La Matrix",
    Icon: Compass,
    imageKey: "landing-card-matrix-01",
  },
  {
    title: "Perfil profesional con CLOUVA AI",
    description: "Creá tu página pública con copy generado por IA a partir de tus datos reales -- sin inventar nada.",
    href: "/login",
    cta: "Crear mi perfil",
    Icon: Sparkles,
    imageKey: "landing-card-profile-01",
  },
  {
    title: "Tienda",
    description: "Merch, ediciones limitadas y drops de la comunidad CLOUVA.",
    href: "/tienda",
    cta: "Ir a la tienda",
    Icon: ShoppingBag,
    imageKey: "landing-card-store-01",
  },
] as const;

export function PublicLanding() {
  return (
    <PublicShell brand="CLOUVA" brandHref="/">
      <section
        className="relative flex min-h-[80vh] flex-col items-center justify-center overflow-hidden px-4 py-20 sm:py-28"
        data-visual-asset="public-landing-hero-01"
      >
        <div
          className="absolute inset-0 -z-10 bg-cover bg-center"
          style={{ backgroundImage: `url(${VISUAL_ASSETS["public-landing-hero-01"]})` }}
          aria-hidden="true"
        />
        <div
          className="absolute inset-x-0 bottom-0 -z-10 h-1/3 bg-gradient-to-t from-[#07060b] to-transparent"
          aria-hidden="true"
        />
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-violet-300">Bienvenido a CLOUVA</p>
          <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-6xl">
            Tu identidad. Tu comunidad. Tu escenario.
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-white/65">
            Creá tu perfil profesional, conectá con Players y Estudios, y hacé crecer tu proyecto dentro de La Matrix.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/login"
              className="inline-flex items-center gap-2 rounded-full bg-violet-500 px-6 py-3 text-sm font-semibold text-black transition hover:bg-violet-400"
            >
              Crear mi cuenta
              <ArrowRight size={16} />
            </Link>
            <Link
              href="/matrix"
              className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.03] px-6 py-3 text-sm font-medium text-white/85 transition hover:border-violet-400/50"
            >
              <Compass size={16} />
              Explorar La Matrix
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-5xl gap-4 px-4 pb-20 sm:grid-cols-3 sm:px-6">
        {FEATURES.map(({ title, description, href, cta, Icon, imageKey }) => (
          <Link
            key={title}
            href={href}
            className="group overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03] transition hover:-translate-y-1 hover:border-violet-400/40"
          >
            <div
              className="relative h-32 w-full bg-cover bg-center"
              style={{ backgroundImage: `url(${VISUAL_ASSETS[imageKey]})` }}
              aria-hidden="true"
            >
              <span className="absolute bottom-3 left-3 inline-grid h-9 w-9 place-items-center rounded-xl bg-black/50 text-violet-200 backdrop-blur">
                <Icon size={17} />
              </span>
            </div>
            <div className="p-6">
              <h2 className="text-lg font-semibold">{title}</h2>
              <p className="mt-2 text-sm text-white/55">{description}</p>
              <span className="mt-5 inline-flex items-center gap-1 text-sm font-medium text-violet-300 group-hover:text-violet-200">
                {cta}
                <ArrowRight size={14} />
              </span>
            </div>
          </Link>
        ))}
      </section>
    </PublicShell>
  );
}
