import type { Metadata } from "next";
import { StructureWorkspace } from "@/components/structures/StructureWorkspace";

export const metadata: Metadata = {
  title: "Structure | CLOUVA",
  description: "Base espacial de reconstrucción en CLOUVA Structures.",
};

export default async function StructurePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <StructureWorkspace structureId={id} initialTab="project" />;
}
