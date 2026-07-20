import Link from "next/link";
import { CreatorStudioBootstrap } from "@/components/creator-studio/CreatorStudioBootstrap";

// Esta pantalla depende de la sesión y del avatar activo. Forzamos render dinámico para
// evitar que Next.js sirva una versión vieja del Creator Studio después de un deploy.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "CLOUVA Creator Studio",
  description: "Vestí y riggeá prendas y accesorios 3D compatibles con el avatar CLOUVA.",
};

export default function CreatorStudioPage() {
  return (
    <>
      <CreatorStudioBootstrap />
      <Link
        href="/creator-studio/body-fit-test"
        className="fixed bottom-5 right-5 z-[60] rounded-full border border-cyan-300/35 bg-[#0b1015]/95 px-4 py-3 text-xs font-black uppercase tracking-[0.1em] text-cyan-100 shadow-2xl shadow-black/60 backdrop-blur-xl transition hover:border-cyan-200 hover:bg-cyan-500/15"
      >
        Probar cuerpo → Meshy
      </Link>
    </>
  );
}
