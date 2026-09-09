import { requireUser } from "@/lib/server/supabase";

type AuthedSupabase = Awaited<ReturnType<typeof requireUser>>["supabase"];

export type CreatorProjectStatus = "draft" | "generating" | "review" | "approved" | "commerce_ready";

export function deriveCreatorProjectStatus(statuses: string[]): CreatorProjectStatus {
  if (!statuses.length) return "draft";
  if (statuses.some((status) => status === "generating" || status === "pending")) return "generating";
  if (statuses.some((status) => status === "commerce_ready" || status === "published")) return "commerce_ready";
  if (statuses.some((status) => status === "review" || status === "failed")) return "review";
  if (statuses.every((status) => status === "approved")) return "approved";
  if (statuses.some((status) => status === "approved")) return "review";
  return "draft";
}

export async function syncCreatorProjectStatus(supabase: AuthedSupabase, projectId: string) {
  const concepts = await supabase
    .from("commerce_creator_product_concepts")
    .select("status")
    .eq("project_id", projectId);
  if (concepts.error) throw new Error(concepts.error.message);

  const status = deriveCreatorProjectStatus((concepts.data ?? []).map((concept) => String(concept.status || "draft")));
  const project = await supabase
    .from("commerce_creator_projects")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", projectId)
    .select("id,status")
    .maybeSingle();
  if (project.error) throw new Error(project.error.message);
  return status;
}
