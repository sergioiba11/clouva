import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) throw new Error("Missing Supabase server credentials");
  return createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function POST(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  const accessToken = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
  if (!accessToken) return NextResponse.json({ error: "Missing access token" }, { status: 401 });

  const supabase = getAdminClient();
  const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
  if (userError || !userData.user) return NextResponse.json({ error: "Invalid session" }, { status: 401 });

  const body = await request.json();
  const itemId = typeof body?.itemId === "string" ? body.itemId : "";
  const hoodState = body?.hoodState === "up" ? "up" : body?.hoodState === "down" ? "down" : null;
  if (!itemId || !hoodState) return NextResponse.json({ error: "Falta itemId o hoodState" }, { status: 400 });

  const { data: item, error: itemError } = await supabase
    .from("clothing_items")
    .select("id,user_id,status,wearable,rigged,fit_status,hood_supported,hood_up_model_url,hood_down_model_url")
    .eq("id", itemId)
    .eq("user_id", userData.user.id)
    .maybeSingle();

  if (itemError) return NextResponse.json({ error: itemError.message }, { status: 500 });
  if (!item) return NextResponse.json({ error: "Pieza no encontrada" }, { status: 404 });
  if (item.status !== "ready" || !item.wearable || !item.rigged || item.fit_status !== "fitted") {
    return NextResponse.json({ error: "La pieza todavía no está lista para usar" }, { status: 409 });
  }
  if (!item.hood_supported || !item.hood_up_model_url || !item.hood_down_model_url) {
    return NextResponse.json({ error: "Esta pieza todavía no tiene las dos variantes de capucha" }, { status: 409 });
  }

  const { data: updated, error: updateError } = await supabase
    .from("clothing_items")
    .update({ hood_state: hoodState, updated_at: new Date().toISOString() })
    .eq("id", itemId)
    .eq("user_id", userData.user.id)
    .select("id,hood_state,hood_supported,hood_up_model_url,hood_down_model_url")
    .single();

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
  return NextResponse.json({ item: updated });
}
