import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const pass = request.nextUrl.searchParams.get("pass")?.trim() || "";
    if (!pass) return NextResponse.json({ error: "Falta el pase." }, { status: 400 });

    const admin = createAdminSupabase();
    const { data, error } = await admin
      .from("ratcraft_access_passes")
      .select("public_token,minecraft_name,edition,plan_code,price_usd,amount,currency,status,whitelist_status,paid_at,created_at")
      .eq("public_token", pass)
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) return NextResponse.json({ error: "No encontramos ese pase." }, { status: 404 });

    return NextResponse.json({ pass: data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo consultar el pase." }, { status });
  }
}
