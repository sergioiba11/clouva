import { CreatorStudioBootstrap } from "@/components/creator-studio/CreatorStudioBootstrap";
import { CreatorStudioV2Panel } from "@/components/creator-studio/CreatorStudioV2Panel";

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
