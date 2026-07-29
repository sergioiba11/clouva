import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, createUserSupabase, readBearerToken } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value: unknown, max = 1000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function safeLinks(value: unknown) {
  const source = Array.isArray(value) ? value : typeof value === "string" ? value.split(/\r?\n/) : [];
  return source
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => {
      try { return new URL(item).protocol === "https:"; } catch { return false; }
    })
    .slice(0, 12);
}

function rateKey(request: NextRequest, userId?: string) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const agent = request.headers.get("user-agent") || "unknown";
  const salt = process.env.FORM_RATE_LIMIT_SALT || process.env.INTERNAL_RECONCILIATION_SECRET || "clouva-public-form";
  return createHash("sha256").update(`${salt}:${forwarded}:${agent}:${userId || "guest"}`).digest("hex");
}

async function resolveStudio(admin: ReturnType<typeof createAdminSupabase>, slug: string) {
  const normalized = slug.toLowerCase();
  const { data: alias } = await admin
    .from("public_slug_aliases")
    .select("entity_id")
    .eq("entity_type", "studio")
    .eq("normalized_alias", normalized)
    .maybeSingle();
  let query = admin.from("studios").select("id,slug,name,is_published,publication_status");
  query = alias ? query.eq("id", alias.entity_id) : query.eq("slug", normalized);
  const { data, error } = await query.eq("is_published", true).eq("publication_status", "published").maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await context.params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (text(body.website, 200)) return NextResponse.json({ submitted: true }, { status: 201 });

    const admin = createAdminSupabase();
    const studio = await resolveStudio(admin, slug);
    if (!studio) return NextResponse.json({ error: "No encontramos ese Estudio." }, { status: 404 });

    const accessToken = readBearerToken(request);
    let userId: string | undefined;
    if (accessToken) {
      const userClient = createUserSupabase(accessToken);
      const { data, error } = await userClient.auth.getUser(accessToken);
      if (error || !data.user) return NextResponse.json({ error: "Sesión inválida." }, { status: 401 });
      userId = data.user.id;
    }

    const { data: allowed, error: rateError } = await admin.rpc("consume_public_form_rate_limit", {
      p_action: `studio_application:${studio.id}`,
      p_key_hash: rateKey(request, userId),
      p_limit: 5,
      p_window_seconds: 3600,
    });
    if (rateError) throw new Error(rateError.message);
    if (!allowed) return NextResponse.json({ error: "Alcanzaste el límite de solicitudes. Probá más tarde." }, { status: 429 });

    const artistName = text(body.artist_name, 100);
    const contactEmail = text(body.contact_email, 200).toLowerCase();
    const presentation = text(body.presentation, 3000);
    const reason = text(body.reason, 2000);
    if (!artistName || !presentation || !reason) {
      return NextResponse.json({ error: "Completá nombre artístico, presentación y motivo." }, { status: 400 });
    }
    if (!userId && !validEmail(contactEmail)) {
      return NextResponse.json({ error: "Ingresá un correo válido para recibir respuesta." }, { status: 400 });
    }

    let playerId: string | null = null;
    let clouvaProfileUrl = text(body.clouva_profile_url, 500) || null;
    if (userId) {
      const { data: owned } = await admin.from("players").select("id,slug").eq("owner_user_id", userId).maybeSingle();
      if (owned) {
        playerId = owned.id;
        clouvaProfileUrl = `https://clouva.com.ar/${owned.slug}`;
      } else {
        const { data: member } = await admin.from("player_members").select("player_id,player:players(slug)").eq("user_id", userId).eq("status", "active").limit(1).maybeSingle();
        if (member) {
          playerId = member.player_id;
          const related = member.player as unknown as { slug?: string } | null;
          if (related?.slug) clouvaProfileUrl = `https://clouva.com.ar/${related.slug}`;
        }
      }
    }

    if (playerId) {
      const { data: duplicate } = await admin
        .from("studio_applications")
        .select("id,status")
        .eq("studio_id", studio.id)
        .eq("player_id", playerId)
        .in("status", ["submitted", "in_review"])
        .maybeSingle();
      if (duplicate) return NextResponse.json({ error: "Ya tenés una solicitud activa para este Estudio." }, { status: 409 });
    } else if (contactEmail) {
      const { data: duplicate } = await admin
        .from("studio_applications")
        .select("id")
        .eq("studio_id", studio.id)
        .eq("contact_email", contactEmail)
        .in("status", ["submitted", "in_review"])
        .maybeSingle();
      if (duplicate) return NextResponse.json({ error: "Ya existe una solicitud activa con ese correo." }, { status: 409 });
    }

    const { data: application, error: insertError } = await admin
      .from("studio_applications")
      .insert({
        studio_id: studio.id,
        user_id: userId || null,
        player_id: playerId,
        artist_name: artistName,
        category: text(body.category, 100) || null,
        instagram_url: text(body.instagram_url, 500) || null,
        clouva_profile_url: clouvaProfileUrl,
        contact_email: contactEmail || null,
        presentation,
        activity: text(body.activity, 2000) || null,
        reason,
        material_links: safeLinks(body.material_links),
        availability: text(body.availability, 500) || null,
        message: text(body.message, 2000) || null,
        status: "submitted",
      })
      .select("id,status,created_at")
      .single();
    if (insertError) throw new Error(insertError.message);

    return NextResponse.json({ application, submitted: true }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo enviar la solicitud.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
