import type { SupabaseClient } from "@supabase/supabase-js";

export type StudioMembershipActivation = {
  membershipId: string;
  status: "pending" | "active";
  playerId: string | null;
  needsPlayer: boolean;
  publicRole: string;
  area: string | null;
};

export async function activateStudioMembership(args: {
  admin: SupabaseClient;
  userId: string;
  studioId: string;
  planId: string;
  source?: string;
  subscriptionId?: string | null;
  forceActive?: boolean;
  returnPath?: string | null;
}) {
  const { data, error } = await args.admin.rpc("activate_studio_membership", {
    p_user_id: args.userId,
    p_studio_id: args.studioId,
    p_plan_id: args.planId,
    p_source: args.source || "direct",
    p_subscription_id: args.subscriptionId || null,
    p_force_active: args.forceActive || false,
    p_return_path: args.returnPath || null,
  });
  if (error) throw new Error(error.message);
  return data as StudioMembershipActivation;
}

export async function completePendingStudioJoins(args: {
  admin: SupabaseClient;
  userId: string;
  playerId: string;
}) {
  const { data, error } = await args.admin.rpc("complete_pending_studio_joins", {
    p_user_id: args.userId,
    p_player_id: args.playerId,
  });
  if (error) throw new Error(error.message);
  return Number(data || 0);
}
