import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAdminEmail, isAuthError, requireUser } from "@/lib/server/supabase";
import { workspaceDeviceTokenBox } from "@/core/crypto/secret-box";
import { pairOverGateway } from "@/lib/clouva-ai/workspace-gateway";

// Task 9 of the CLOUVA AI Orchestrator plan — "Conectar mi Workspace". This
// route performs the exact same `pair` handshake over the Gateway that
// CLOUVA Mobile already does (mobile/src/transport/pairing.ts's
// pairOverGateway, Desktop's side is electron/controlServer/pairing.ts's
// completePairing) — zero Gateway/Desktop protocol changes. This route is
// just a second, server-side client of that same handshake; Desktop sees no
// difference between a browser-triggered pairing and a phone-triggered one.
//
// Runs in this same Next.js app, wherever it's deployed (Cloud Run today —
// see the memory correction: this was mis-recorded as Railway earlier in
// the plan, corrected mid-Task-9). Nothing here is Cloud-Run-specific.
//
// Admin-gated the same way "project" mode (GitHub access) already is —
// pairing a real Desktop into CLOUVA AI's tool access is the same trust
// tier as repo write access, not a general end-user feature yet.
//
// workspace_links has RLS enabled with ZERO policies (see the Task 8
// migration) — every read/write here goes through createAdminSupabase()
// and enforces `user_id` scoping in this file's own queries, on purpose.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const DEVICE_LABEL = "CLOUVA Cloud";

function requireAdmin(email: string | null | undefined) {
  if (!isAdminEmail(email)) {
    const error = new Error("Tu usuario no está autorizado para conectar un Workspace.") as Error & { status?: number };
    error.status = 403;
    throw error;
  }
}

function redact(row: {
  id: string;
  workspace_id: string;
  device_id: string;
  label: string;
  permissions: string[];
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    deviceId: row.device_id,
    label: row.label,
    permissions: row.permissions,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revoked: row.revoked_at !== null,
  };
}

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    requireAdmin(user.email);

    const admin = createAdminSupabase();
    const { data, error } = await admin
      .from("workspace_links")
      .select("id,workspace_id,device_id,label,permissions,created_at,last_used_at,revoked_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, links: (data ?? []).map(redact) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo consultar el Workspace conectado.";
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    requireAdmin(user.email);

    const body = (await request.json().catch(() => ({}))) as { workspaceId?: string; code?: string };
    const workspaceId = body.workspaceId?.trim();
    const code = body.code?.trim();
    if (!workspaceId || !code) {
      return NextResponse.json({ error: "Faltan workspaceId o código de pareo." }, { status: 400 });
    }

    const gatewayUrl = process.env.CLOUVA_CONTROL_GATEWAY_URL?.trim();
    if (!gatewayUrl) throw new Error("Falta CLOUVA_CONTROL_GATEWAY_URL (la URL /relay del Gateway de CLOUVA Workspace).");

    const result = await pairOverGateway({ gatewayUrl, workspaceId, code, deviceName: DEVICE_LABEL });
    const secret = workspaceDeviceTokenBox.encrypt(result.token);
    const admin = createAdminSupabase();

    // One active link per (user, workspace) — see the Task 8 migration's
    // unique partial index. Revoking the old row first (rather than
    // upserting over it) keeps a real audit trail of past pairings instead
    // of silently overwriting one. Known gap: this isn't one atomic
    // transaction — if the insert below fails after this revoke succeeds,
    // the user is left with no active link and has to just retry (the old
    // Desktop-side device token also stays valid until revoked from
    // Desktop's own Devices page; this route doesn't reach back to un-revoke
    // it). Acceptable for a manual, human-driven re-pairing action.
    await admin
      .from("workspace_links")
      .update({ revoked_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .eq("workspace_id", workspaceId)
      .is("revoked_at", null);

    const { data: inserted, error: insertError } = await admin
      .from("workspace_links")
      .insert({
        user_id: user.id,
        workspace_id: workspaceId,
        device_id: result.device.id,
        label: DEVICE_LABEL,
        permissions: result.device.permissions,
        device_token_ciphertext: secret.ciphertext,
        device_token_iv: secret.iv,
        device_token_auth_tag: secret.authTag,
      })
      .select("id,workspace_id,device_id,label,permissions,created_at,last_used_at,revoked_at")
      .single();

    if (insertError || !inserted) throw new Error(insertError?.message ?? "No se pudo guardar el pareo.");

    await admin.from("project_events").insert({
      user_id: user.id,
      project_key: "clouva",
      event_type: "workspace_pair",
      component: "workspace-link",
      summary: `Workspace conectado (${workspaceId.slice(0, 8)}…)`,
      payload: { workspaceId, deviceId: result.device.id },
    }).then(undefined, (error) => {
      console.error("workspace-link: failed to log project_events", error);
    });

    return NextResponse.json({ ok: true, link: redact(inserted) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo parear el Workspace.";
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    requireAdmin(user.email);

    const id = new URL(request.url).searchParams.get("id")?.trim();
    if (!id) return NextResponse.json({ error: "Falta el id del link a revocar." }, { status: 400 });

    const admin = createAdminSupabase();
    const { data, error } = await admin
      .from("workspace_links")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", user.id)
      .is("revoked_at", null)
      .select("id")
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) return NextResponse.json({ error: "Ese link no existe o ya estaba revocado." }, { status: 404 });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo revocar el Workspace.";
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: message }, { status });
  }
}
