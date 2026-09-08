import { Merch3DAttachClient } from "./Merch3DAttachClient";

export const dynamic = "force-dynamic";

export default async function Merch3DPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Merch3DAttachClient projectId={id} />;
}
