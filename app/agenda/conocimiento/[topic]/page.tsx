import { notFound } from "next/navigation";
import { AgendaKnowledgeDetail } from "@/components/agenda/AgendaKnowledgeDetail";

export default async function AgendaKnowledgeTopicPage({ params }: { params: Promise<{ topic: string }> }) {
  const { topic } = await params;
  if (topic !== "lunar" && topic !== "numerologia" && topic !== "astrologia") notFound();
  return <AgendaKnowledgeDetail topic={topic} />;
}
