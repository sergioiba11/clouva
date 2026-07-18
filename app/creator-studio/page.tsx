import { CreatorStudioBootstrap } from "@/components/creator-studio/CreatorStudioBootstrap";

// Esta pantalla depende de la sesión y del avatar activo. Forzamos render dinámico para
// evitar que Next.js sirva una versión vieja del Creator Studio después de un deploy.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "CLOUVA Creator Studio",
  description: "Vestí y riggeá prendas y accesorios 3D compatibles con el avatar CLOUVA.",
};

export default function CreatorStudioPage() {
  return <CreatorStudioBootstrap />;
}
