import "server-only";

import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/server/supabase";
import type { AgentConversation } from "./types";

function userScopedSupabase(accessToken: string): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Faltan las variables públicas de Supabase en Cloud Run.");

  return createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export type AuthenticatedAgentRequest = {
  accessToken: string;
  user: User;
  supabase: SupabaseClient;
};

export async function authenticateAgentRequest(request: Request): Promise<AuthenticatedAgentRequest> {
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  if (!match?.[1]) throw Object.assign(new Error("Sesión requerida."), { status: 401 });

  const accessToken = match[1];
  const supabase = userScopedSupabase(accessToken);
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data.user) throw Object.assign(new Error("Sesión inválida."), { status: 401 });
  const { data: profile, error: profileError } = await createAdminSupabase()
    .from("profiles")
    .select("is_blocked")
    .eq("id", data.user.id)
    .maybeSingle();
  if (profileError) throw new Error(profileError.message);
  if (profile?.is_blocked) throw Object.assign(new Error("Esta cuenta fue bloqueada."), { status: 403 });
  return { accessToken, user: data.user, supabase };
}

export async function resolveAgentConversation(args: {
  supabase: SupabaseClient;
  userId: string;
  conversationId?: string | null;
  requestedStudioId?: string | null;
  title: string;
}): Promise<AgentConversation> {
  const requestedId = args.conversationId?.trim() || null;
  if (requestedId) {
    const { data, error } = await args.supabase
      .from("ai_conversations")
      .select("id,studio_id")
      .eq("id", requestedId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return { id: data.id, studioId: data.studio_id };
  }

  const { data, error } = await args.supabase
    .from("ai_conversations")
    .insert({
      user_id: args.userId,
      project_key: "clouva",
      studio_id: args.requestedStudioId?.trim() || null,
      title: args.title.trim().slice(0, 72) || "Nueva conversación",
    })
    .select("id,studio_id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "No se pudo crear la conversación.");
  return { id: data.id, studioId: data.studio_id };
}

export async function requireAgentConversation(args: {
  supabase: SupabaseClient;
  conversationId: string;
}): Promise<AgentConversation> {
  const { data, error } = await args.supabase
    .from("ai_conversations")
    .select("id,studio_id")
    .eq("id", args.conversationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw Object.assign(new Error("La conversación no existe o no te pertenece."), { status: 404 });
  return { id: data.id, studioId: data.studio_id };
}

export async function assertNoPendingAgentAction(args: {
  supabase: SupabaseClient;
  userId: string;
  conversationId: string;
}) {
  const results = await Promise.all(
    (["pending", "executing"] as const).map((status) => args.supabase
      .from("ai_messages")
      .select("id")
      .eq("conversation_id", args.conversationId)
      .eq("user_id", args.userId)
      .contains("metadata", { pendingAction: { status } })
      .limit(1)),
  );
  const failed = results.find((result) => result.error);
  if (failed?.error) throw new Error(failed.error.message);
  if (results.some((result) => result.data?.length)) {
    throw Object.assign(
      new Error("Hay una acción pendiente o en ejecución en esta conversación. Esperá a que termine, confirmala o cancelala antes de pedir otra."),
      { status: 409 },
    );
  }
}

export function agentHttpStatus(error: unknown, fallback = 500): number {
  if (typeof error === "object" && error && "status" in error && typeof error.status === "number") {
    return error.status;
  }
  return fallback;
}
