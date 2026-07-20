import { BodyToMeshyExperiment } from "@/components/creator-studio/BodyToMeshyExperiment";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Prueba cuerpo a Meshy | CLOUVA",
  description: "Prueba aislada del contrato corporal de Blender antes de generar una pieza en Meshy.",
};

export default function BodyFitTestPage() {
  return <BodyToMeshyExperiment />;
}
