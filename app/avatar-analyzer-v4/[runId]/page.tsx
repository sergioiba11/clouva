import AvatarAnalyzerV4Diagnostics from "@/components/library/AvatarAnalyzerV4Diagnostics";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ runId: string }> };

export default async function AvatarAnalyzerV4Page({ params }: PageProps) {
  const { runId } = await params;
  const worker = process.env.BLENDER_WORKER_URL?.replace(/\/$/, "");
  if (!worker || !/^[a-f0-9]{32}$/.test(runId)) notFound();
  const response = await fetch(`${worker}/avatar/analyze-v4/result/${runId}`, { cache: "no-store" });
  if (!response.ok) notFound();
  const result = await response.json();
  return (
    <AvatarAnalyzerV4Diagnostics
      result={result}
      assetBaseUrl={`${worker}/avatar/analyze-v4/result/${runId}/asset`}
    />
  );
}
