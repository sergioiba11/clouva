import { SpaceCommerceWorkspace } from "@/components/commerce/SpaceCommerceWorkspace";

export default async function StudioCommercePage({ params }: { params: Promise<{ studioId: string }> }) {
  const { studioId } = await params;
  return <SpaceCommerceWorkspace commerceScopeId={studioId} />;
}
