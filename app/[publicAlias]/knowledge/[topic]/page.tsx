import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { GroundedKnowledgePanel } from "@/components/knowledge/GroundedKnowledgePanel";
import { loadPublicKnowledgeByPlayer } from "@/lib/server/knowledge/public-loader";
import { resolvePlayerAlias } from "@/lib/server/public-identity-data";
import { createAdminSupabase } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";

type Topic = "lunar" | "numerologia" | "astrologia";

function topicValue(topic: Topic, knowledge: NonNullable<Awaited<ReturnType<typeof loadPublicKnowledgeByPlayer>>>) {
  if (topic === "lunar" && knowledge.showLunar) return { heading: "Data de la Luna", value: "Luna" };
  if (topic === "numerologia" && knowledge.numerologyNumber !== null) return { heading: "Numerología", value: String(knowledge.numerologyNumber) };
  if (topic === "astrologia" && knowledge.zodiacSign) return { heading: "Astrología", value: knowledge.zodiacSign };
  return null;
}

export default async function PublicKnowledgeTopicPage({ params }: { params: Promise<{ publicAlias: string; topic: string }> }) {
  const { publicAlias, topic: rawTopic } = await params;
  if (rawTopic !== "lunar" && rawTopic !== "numerologia" && rawTopic !== "astrologia") notFound();
  const topic = rawTopic as Topic;
  const resolved = await resolvePlayerAlias(publicAlias).catch(() => null);
  if (!resolved) notFound();
  const knowledge = await loadPublicKnowledgeByPlayer({ admin: createAdminSupabase(), playerId: resolved.player.id }).catch(() => null);
  if (!knowledge) notFound();
  const detail = topicValue(topic, knowledge);
  if (!detail) notFound();

  return (
    <main className="min-h-screen bg-[#05040a] px-4 py-6 text-white sm:px-6 sm:py-10">
      <div className="mx-auto max-w-4xl">
        <Link href={`/${resolved.canonicalAlias}#conocimiento`} className="mb-5 inline-flex items-center gap-2 text-sm text-white/45 transition hover:text-white"><ArrowLeft size={16} /> Volver a {resolved.player.display_name}</Link>
        <GroundedKnowledgePanel alias={resolved.canonicalAlias} topic={topic} heading={detail.heading} value={detail.value} />
      </div>
    </main>
  );
}
