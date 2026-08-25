import { StudioVersionPreview } from "@/components/studio/StudioVersionPreview";

export const dynamic = "force-dynamic";

export default async function StudioIdentityPreviewPage({
  params,
}: {
  params: Promise<{ studioId: string }>;
}) {
  const { studioId } = await params;
  return <StudioVersionPreview studioId={studioId} />;
}
