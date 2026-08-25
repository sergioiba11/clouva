import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";

function getSupabaseUrl() {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!value) throw new Error("NEXT_PUBLIC_SUPABASE_URL no está configurada.");
  return value;
}

function getAnonKey() {
  const value = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!value) throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY no está configurada.");
  return value;
}

function getServiceRoleKey() {
  const value = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!value) throw new Error("SUPABASE_SERVICE_ROLE_KEY no está configurada.");
  return value;
}

export function readBearerToken(request: NextRequest) {
  const authorization = request.headers.get("authorization") ?? "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
}

export function createUserSupabase(accessToken: string): SupabaseClient {
  if (!accessToken) throw new Error("Sesión requerida.");

  return createClient(getSupabaseUrl(), getAnonKey(), {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export function createAdminSupabase(): SupabaseClient {
  return createClient(getSupabaseUrl(), getServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export async function requireUser(request: NextRequest): Promise<{
  accessToken: string;
  user: User;
  supabase: SupabaseClient;
}> {
  const accessToken = readBearerToken(request);
  if (!accessToken) throw new Error("Sesión requerida.");

  const supabase = createUserSupabase(accessToken);
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data.user) throw new Error("Sesión inválida.");

  // profiles.is_blocked existed since control_total.sql (2026-05-22) but
  // nothing ever actually enforced it -- checked here, the single choke
  // point nearly every authenticated API route already goes through, so a
  // block set from /admin/clientes actually takes effect everywhere.
  // Uses the service-role client, not the caller's own session, so this
  // can't be bypassed by a `profiles` RLS gap for the blocked user.
  const { data: profile } = await createAdminSupabase()
    .from("profiles")
    .select("is_blocked")
    .eq("id", data.user.id)
    .maybeSingle();
  if (profile?.is_blocked) throw new Error("Esta cuenta fue bloqueada.");

  return { accessToken, user: data.user, supabase };
}

/** True if `email` is in the CLOUVA_ADMIN_EMAILS allowlist (comma-separated,
 * case-insensitive). Shared by every clouva-ai route that gates a feature
 * (project/repo mode, GitHub access, Workspace pairing) behind admin status. */
export function isAdminEmail(email: string | null | undefined): boolean {
  const allowed = (process.env.CLOUVA_ADMIN_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return Boolean(email && allowed.includes(email.toLowerCase()));
}

export function isAuthError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /sesión requerida|sesión inválida|no autorizado|cuenta fue bloqueada/i.test(message);
}
