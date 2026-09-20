import { NextRequest, NextResponse } from "next/server";
import { requireSpotAccess } from "@/lib/server/commerce-spot";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function short(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function urls(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => /^https?:\/\//i.test(item))))
    .slice(0, 10);
}

async function requireProduct(admin: ReturnType<typeof createAdminSupabase>, spotId: string, productId: string) {
  const result = await admin.from("commerce_products").select("id").eq("id", productId).eq("spot_id", spotId).maybeSingle();
  if (result.error) throw new Error(result.error.message);
  if (!result.data) throw Object.assign(new Error("El producto no pertenece a este Spot."), { status: 404 });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ spotId: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { spotId } = await params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = short(body.action, 60);
    const admin = createAdminSupabase();
    await requireSpotAccess({ admin, userId: user.id, spotId, capability: "content" });

    if (action === "save_destination") {
      const id = short(body.id, 80);
      const type = short(body.type, 30) || "group";
      if (!["group","marketplace"].includes(type)) {
        return NextResponse.json({ error: "Las Páginas se agregan mediante CONECTAR FACEBOOK." }, { status: 400 });
      }
      const name = short(body.name, 200);
      const facebookUrl = short(body.facebookUrl, 2000) || null;
      const cooldownMinutes = Math.max(0, Math.min(43200, Math.trunc(Number(body.cooldownMinutes ?? 1440))));
      if (!name) return NextResponse.json({ error: "Poné un nombre para el destino." }, { status: 400 });
      if (type === "group" && (!facebookUrl || !/^https?:\/\/(www\.)?facebook\.com\//i.test(facebookUrl))) {
        return NextResponse.json({ error: "Pegá la URL válida del grupo de Facebook." }, { status: 400 });
      }
      const row = {
        name,
        type,
        facebook_url: type === "marketplace" ? "https://www.facebook.com/marketplace/create/item" : facebookUrl,
        enabled: body.enabled !== false,
        cooldown_minutes: cooldownMinutes,
        notes: short(body.notes, 1200) || null,
        updated_at: new Date().toISOString(),
      };
      if (id) {
        const result = await admin.from("facebook_destinations").update(row)
          .eq("id", id).eq("user_id", user.id).eq("spot_id", spotId)
          .select("id,name,type,facebook_url,facebook_id,enabled,last_published_at,cooldown_minutes,notes,updated_at")
          .maybeSingle();
        if (result.error) throw new Error(result.error.message);
        if (!result.data) throw Object.assign(new Error("Destino no encontrado."), { status: 404 });
        return NextResponse.json({ destination: result.data });
      }
      const result = await admin.from("facebook_destinations").insert({
        user_id: user.id,
        spot_id: spotId,
        ...row,
        facebook_id: null,
        metadata: { source: "user" },
      }).select("id,name,type,facebook_url,facebook_id,enabled,last_published_at,cooldown_minutes,notes,updated_at").single();
      if (result.error) throw new Error(result.error.message);
      return NextResponse.json({ destination: result.data }, { status: 201 });
    }

    if (action === "set_product_destination") {
      const productId = short(body.productId, 80);
      const destinationId = short(body.destinationId, 80);
      if (!productId || !destinationId) return NextResponse.json({ error: "Falta producto o destino." }, { status: 400 });
      await requireProduct(admin, spotId, productId);
      const destination = await admin.from("facebook_destinations").select("id")
        .eq("id", destinationId).eq("user_id", user.id).eq("spot_id", spotId).maybeSingle();
      if (destination.error) throw new Error(destination.error.message);
      if (!destination.data) throw Object.assign(new Error("Destino inválido."), { status: 404 });

      const variantId = short(body.variantId, 80) || null;
      if (variantId) {
        const variant = await admin.from("publication_variants").select("id")
          .eq("id", variantId).eq("user_id", user.id).eq("spot_id", spotId).eq("product_id", productId).maybeSingle();
        if (variant.error) throw new Error(variant.error.message);
        if (!variant.data) return NextResponse.json({ error: "Variante inválida." }, { status: 400 });
      }

      const result = await admin.from("publication_product_destinations").upsert({
        user_id: user.id,
        spot_id: spotId,
        product_id: productId,
        destination_id: destinationId,
        variant_id: variantId,
        enabled: body.enabled !== false,
        custom_text: short(body.customText, 5000) || null,
        primary_image_url: short(body.primaryImageUrl, 2000) || null,
        image_urls: urls(body.imageUrls),
        frequency_minutes: body.frequencyMinutes == null || body.frequencyMinutes === ""
          ? null
          : Math.max(0, Math.min(43200, Math.trunc(Number(body.frequencyMinutes)))),
        metadata: {},
        updated_at: new Date().toISOString(),
      }, { onConflict: "product_id,destination_id" })
        .select("id,product_id,destination_id,variant_id,enabled,custom_text,primary_image_url,image_urls,frequency_minutes,updated_at")
        .single();
      if (result.error) throw new Error(result.error.message);
      return NextResponse.json({ productDestination: result.data });
    }

    if (action === "save_variant") {
      const productId = short(body.productId, 80);
      const id = short(body.id, 80);
      if (!productId) return NextResponse.json({ error: "Falta el producto." }, { status: 400 });
      await requireProduct(admin, spotId, productId);
      const name = short(body.name, 160) || "Publicación alternativa";
      const price = body.priceOverride == null || body.priceOverride === "" ? null : Number(body.priceOverride);
      if (price != null && (!Number.isFinite(price) || price < 0)) {
        return NextResponse.json({ error: "Precio de variante inválido." }, { status: 400 });
      }
      const row = {
        name,
        title: short(body.title, 300) || null,
        description: short(body.description, 5000) || null,
        price_override: price,
        category: short(body.category, 160) || null,
        condition: short(body.condition, 80) || null,
        location_text: short(body.location, 240) || null,
        primary_image_url: short(body.primaryImageUrl, 2000) || null,
        image_urls: urls(body.imageUrls),
        active: body.active !== false,
        metadata: {},
        updated_at: new Date().toISOString(),
      };
      const result = id
        ? await admin.from("publication_variants").update(row)
            .eq("id", id).eq("user_id", user.id).eq("spot_id", spotId).eq("product_id", productId)
            .select("*").maybeSingle()
        : await admin.from("publication_variants").insert({
            user_id: user.id,
            spot_id: spotId,
            product_id: productId,
            ...row,
          }).select("*").single();
      if (result.error) throw new Error(result.error.message);
      if (!result.data) throw Object.assign(new Error("Variante no encontrada."), { status: 404 });
      return NextResponse.json({ variant: result.data }, { status: id ? 200 : 201 });
    }

    if (action === "delete_variant") {
      const id = short(body.id, 80);
      if (!id) return NextResponse.json({ error: "Falta la variante." }, { status: 400 });
      const { error } = await admin.from("publication_variants").update({
        active: false,
        updated_at: new Date().toISOString(),
      }).eq("id", id).eq("user_id", user.id).eq("spot_id", spotId);
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Acción de configuración inválida." }, { status: 400 });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({
      error: error instanceof Error ? error.message : "No se pudo guardar la configuración.",
    }, { status });
  }
}
