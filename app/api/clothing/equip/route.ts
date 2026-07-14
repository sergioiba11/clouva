import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SLOTS = ["top_id", "bottom_id", "shoes_id", "accessory_id"] as const;

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) throw new Error("Missing Supabase server credentials");
  return createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function GET(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  const accessToken = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
  if (!accessToken) return NextResponse.json({ error: "Missing access token" }, { status: 401 });

  const supabase = getAdminClient();
  const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
  if (userError || !userData.user) return NextResponse.json({ error: "Invalid session" }, { status: 401 });

  const { data, error } = await supabase.from("user_outfits").select("*").eq("user_id", userData.user.id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ outfit: data ?? null });
}

export async function POST(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  const accessToken = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
  if (!accessToken) return NextResponse.json({ error: "Missing access token" }, { status: 401 });

  const supabase = getAdminClient();
  const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
  if (userError || !userData.user) return NextResponse.json({ error: "Invalid session" }, { status: 401 });

  const body = await request.json();
  const patch: Record<string, string | null> = {};
  for (const slot of SLOTS) {
    if (slot in body) patch[slot] = body[slot] ?? null;
  }

  const idsToVerify = Object.values(patch).filter((value): value is string => Boolean(value));
  if (idsToVerify.length > 0) {
    const { data: candidates, error: verifyError } = await supabase
      .from("clothing_items")
      .select("id,wearable,fit_status,rigged,user_id")
      .in("id", idsToVerify);
    if (verifyError) return NextResponse.json({ error: verifyError.message }, { status: 500 });
    const invalid = (candidates ?? []).find(
      (row) => row.user_id !== userData.user.id || !row.wearable || row.fit_status !== "fitted" || !row.rigged,
    );
    if (invalid) {
      return NextResponse.json({ error: "Esta pieza todavía no pasó el ajuste automático, no se puede equipar." }, { status: 409 });
    }
  }

  const { data, error } = await supabase
    .from("user_outfits")
    .upsert({ user_id: userData.user.id, ...patch, updated_at: new Date().toISOString() })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ outfit: data });
}
