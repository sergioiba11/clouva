import type { SupabaseClient } from "@supabase/supabase-js";
import { publicKnowledgeProfile, type PlayerKnowledgeProfile } from "@/lib/knowledge/player-knowledge";

export async function loadPublicKnowledgeByPlayer(args: { admin: SupabaseClient; playerId: string }) {
  const { data, error } = await args.admin
    .from("player_knowledge_profiles")
    .select("player_id,birth_date,show_lunar,show_numerology,show_zodiac,knowledge_topics,teach_topics,created_at,updated_at")
    .eq("player_id", args.playerId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return publicKnowledgeProfile((data as PlayerKnowledgeProfile | null) ?? null);
}
