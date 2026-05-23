import { createClient } from "@supabase/supabase-js";
import { normalizeRole } from "@/lib/auth";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Missing Supabase environment variables");
}

const verifiedSupabaseUrl = supabaseUrl;
const verifiedSupabaseAnonKey = supabaseAnonKey;

type GuardResult =
  | { kind: "guest" }
  | { kind: "forbidden" }
  | { kind: "admin"; userId: string };

function extractAccessTokenFromCookieHeader(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(";").map((part) => part.trim());

  for (const cookie of cookies) {
    const eqIndex = cookie.indexOf("=");
    if (eqIndex < 0) continue;
    const name = cookie.slice(0, eqIndex);
    const value = decodeURIComponent(cookie.slice(eqIndex + 1));

    if (!name.startsWith("sb-") || !name.endsWith("-auth-token")) continue;

    try {
      const parsed = JSON.parse(value) as { access_token?: string };
      if (parsed?.access_token) return parsed.access_token;
    } catch {
      // Ignore malformed token cookie.
    }
  }

  return null;
}

export async function verifyAdminFromRequest(cookieHeader: string | null): Promise<GuardResult> {
  const accessToken = extractAccessTokenFromCookieHeader(cookieHeader);
  if (!accessToken) return { kind: "guest" };

  const supabase = createClient(verifiedSupabaseUrl, verifiedSupabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
  if (userError || !userData.user) return { kind: "guest" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userData.user.id)
    .maybeSingle();

  const normalizedRole = normalizeRole(profile?.role);
  if (normalizedRole !== "admin") return { kind: "forbidden" };

  return { kind: "admin", userId: userData.user.id };
}
