import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";

const TOKEN_RE = /^[A-Za-z0-9_-]{32,160}$/;

function cleanValue(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 4096) : "";
}

function tokenFromValue(value: string) {
  if (TOKEN_RE.test(value)) return value;

  try {
    const url = new URL(value);
    const match = url.pathname.match(/^\/q\/([^/?#]+)/i);
    const token = match?.[1] ? decodeURIComponent(match[1]) : "";
    return TOKEN_RE.test(token) ? token : null;
  } catch {
    return null;
  }
}

function externalProvider(value: string) {
  const lower = value.toLowerCase();
  if (lower.includes("mercadopago") || lower.includes("mpago.la")) return "mercado_pago";
  if (value.startsWith("000201")) return "emvco";
  if (/^https?:\/\//i.test(value)) return "web_qr";
  return "unknown";
}

export async function POST(request: NextRequest) {
  try {
    await requireUser(request);
    const body = await request.json().catch(() => ({}));
    const value = cleanValue(body?.value);
    if (!value) return NextResponse.json({ error: "El QR está vacío." }, { status: 400 });

    const publicToken = tokenFromValue(value);
    if (!publicToken) {
      return NextResponse.json({
        kind: "external",
        supported: false,
        provider: externalProvider(value),
        message: "QR externo reconocido. CLOUVA todavía no tiene un rail de liquidación confirmado para este QR; no se descontó ningún FLOW.",
      });
    }

    const admin = createAdminSupabase();
    const { data: registry, error: registryError } = await admin
      .from("clouva_qr_registry")
      .select("entity_type,entity_id,status,is_canonical,destination_path")
      .eq("public_token", publicToken)
      .eq("status", "ACTIVE")
      .eq("is_canonical", true)
      .maybeSingle();
    if (registryError) throw new Error(registryError.message);

    if (!registry) {
      return NextResponse.json({
        kind: "external",
        supported: false,
        provider: externalProvider(value),
        message: "El código no corresponde a un QR CLOUVA activo y no hay un rail externo compatible confirmado. No se descontó ningún FLOW.",
      });
    }

    if (registry.entity_type !== "USER") {
      return NextResponse.json({
        kind: "clouva",
        supported: false,
        entityType: registry.entity_type,
        publicToken,
        href: `/q/${encodeURIComponent(publicToken)}`,
        message: "El QR pertenece al ecosistema CLOUVA, pero este tipo de entidad todavía no recibe pagos FLOW desde la billetera personal.",
      });
    }

    const { data: player, error: playerError } = await admin
      .from("players")
      .select("id,slug,username,display_name,profile_image_url,is_published,publication_status,privacy_status")
      .eq("owner_user_id", registry.entity_id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (playerError) throw new Error(playerError.message);
    if (!player) {
      return NextResponse.json({ error: "El QR es válido, pero su Player receptor no está disponible." }, { status: 404 });
    }

    const isPublic = Boolean(
      player.is_published &&
      player.publication_status === "published" &&
      player.privacy_status !== "private",
    );

    return NextResponse.json({
      kind: "clouva",
      supported: true,
      entityType: "USER",
      publicToken,
      href: `/q/${encodeURIComponent(publicToken)}`,
      recipient: {
        playerId: player.id,
        displayName: isPublic ? player.display_name || "Player CLOUVA" : "Player CLOUVA",
        username: isPublic ? player.username : null,
        profileImageUrl: isPublic ? player.profile_image_url : null,
      },
    });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo resolver el QR." },
      { status },
    );
  }
}
