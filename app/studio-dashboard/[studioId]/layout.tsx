import { StudioDashboardDock } from "@/components/studio/StudioDashboardDock";

export default async function StudioDashboardLayout({ children, params }: { children: React.ReactNode; params: Promise<{ studioId: string }> }) {
  const { studioId } = await params;
  return <>
    {children}
    <StudioDashboardDock studioId={studioId} />
  </>;
}
