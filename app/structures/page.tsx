import type { Metadata } from "next";
import { StructuresHome } from "@/components/structures/StructuresHome";

export const metadata: Metadata = {
  title: "Structures | CLOUVA",
  description: "Reconstrucción espacial de lugares reales a partir de evidencia visual.",
};

export default function StructuresPage() {
  return <StructuresHome />;
}
