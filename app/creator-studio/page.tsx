import { CreatorStudioBootstrap } from "@/components/creator-studio/CreatorStudioBootstrap";
import { CreatorStudioV2Panel } from "@/components/creator-studio/CreatorStudioV2Panel";

// Esta pantalla es 100% auth-gated y client-rendered (CreatorStudioBootstrap depende de la
// sesión del usuario). El Full Route Cache de Next.js la estaba sirviendo como HTML
// estático con stale-time casi infinito, así que cada deploy nuevo quedaba invisible hasta
// que ese cache expiraba. Forzamos render dinámico para que siempre sirva el build actual.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "CLOUVA Creator Studio",
  description: "Panel integrado de Meshy, Blender y Unreal Engine 5 para crear contenido 3D compatible con CLOUVA.",
};

export default function CreatorStudioPage() {
  return (
    <>
      <CreatorStudioBootstrap />
      <CreatorStudioV2Panel />
    </>
  );
}
