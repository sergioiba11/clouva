import { StrainDetail } from "@/components/genetics/GeneticsPages";

export default async function StrainPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <StrainDetail slug={decodeURIComponent(slug)} />;
}
