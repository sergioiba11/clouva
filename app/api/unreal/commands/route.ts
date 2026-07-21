import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function tokenMatches(received: string | null, expected: string | undefined) {
  if (!received || !expected) return false;
  const left = createHash("sha256").update(received).digest();
  const right = createHash("sha256").update(expected).digest();
  return timingSafeEqual(left, right);
}

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Faltan credenciales de Supabase");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function authorize(request: NextRequest) {
  const auth = request.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  return tokenMatches(token, process.env.CLOUVA_BRIDGE_TOKEN);
}

export async function GET(request: NextRequest) {
  try {
    if (!authorize(request)) return NextResponse.json({ error: "Token del bridge inválido" }, { status: 401 });
    const supabase = admin();
    const { data, error } = await supabase
      .from("unreal_import_commands")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ command: null });

    const { data: claimed, error: claimError } = await supabase
      .from("unreal_import_commands")
      .update({ status: "claimed", progress: 5, claimed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("status", "pending")
      .select("*")
      .maybeSingle();
    if (claimError) throw claimError;
    return NextResponse.json({ command: claimed ?? null });
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : String(cause) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!authorize(request)) return NextResponse.json({ error: "Token del bridge inválido" }, { status: 401 });
    const body = await request.json();
    const id = typeof body?.id === "string" ? body.id : "";
    const status = typeof body?.status === "string" ? body.status : "";
    if (!id || !["claimed", "downloading", "importing", "succeeded", "failed"].includes(status)) {
      return NextResponse.json({ error: "Actualización de comando inválida" }, { status: 400 });
    }
    const progress = Math.max(0, Math.min(100, Number(body?.progress ?? 0)));
    const patch = {
      status,
      progress,
      result: body?.result && typeof body.result === "object" ? body.result : null,
      error: typeof body?.error === "string" ? body.error.slice(0, 4000) : null,
      completed_at: ["succeeded", "failed"].includes(status) ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    };
    const supabase = admin();
    const { error } = await supabase.from("unreal_import_commands").update(patch).eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : String(cause) }, { status: 500 });
  }
}
