import { StructureWorkspace } from "@/components/structures/StructureWorkspace";

export default async function StructureExportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <StructureWorkspace structureId={id} initialTab="export" />;
}
