import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSpotAccess } from "@/lib/server/commerce-spot";

export type PublisherAdmin = SupabaseClient;
export type PublisherChannel = "facebook_marketplace" | "facebook_group" | "facebook_page";

function statusError(message: string, status: number, code?: string) {
  const error = new Error(message) as Error & { status?: number; code?: string };
  error.status = status;
  if (code) error.code = code;
  return error;
}

function short(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function stringUrls(value: unknown, limit = 24) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => /^https?:\/\//i.test(item))))
    .slice(0, limit);
}

function imageUrls(product: Record<string, unknown>) {
  const gallery = stringUrls(product.gallery);
  const cover = typeof product.cover_url === "string" && /^https?:\/\//i.test(product.cover_url)
    ? product.cover_url
    : null;
  return cover ? [cover, ...gallery.filter((url) => url !== cover)] : gallery;
}

function channelForType(type: string): PublisherChannel {
  if (type === "marketplace") return "facebook_marketplace";
  if (type === "group") return "facebook_group";
  return "facebook_page";
}

function hashContent(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export async function resolveBusinessPublisherAccess(args: {
  admin: PublisherAdmin;
  userId: string;
  spaceId: string;
}) {
  const { data: space, error } = await args.admin
    .from("spaces")
    .select("id,slug,name,type,business_kind,status,owner_player_id,legacy_commerce_spot_id")
    .eq("id", args.spaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!space || space.status !== "active") throw statusError("El Bisnes no existe.", 404);

  const isBusiness =
    space.business_kind === "digital_business"
    || space.business_kind === "physical_business"
    || (space.type === "business" && space.business_kind !== "studio");
  if (!isBusiness || !space.legacy_commerce_spot_id) {
    throw statusError("Este Space no tiene un Bisnes comercial activo.", 404);
  }

  const access = await requireSpotAccess({
    admin: args.admin,
    userId: args.userId,
    spotId: String(space.legacy_commerce_spot_id),
    capability: "content",
  });

  return { space, spot: access.spot, role: access.role };
}

export async function getFacebookPublisherOverview(args: {
  admin: PublisherAdmin;
  userId: string;
  spaceId: string;
}) {
  const context = await resolveBusinessPublisherAccess(args);
  const spotId = String(context.spot.id);

  const [productsResult, destinationsResult, variantsResult, configsResult, batchesResult, connectionResult] = await Promise.all([
    args.admin
      .from("commerce_products")
      .select("id,name,description,price,currency,stock,status,cover_url,gallery,metadata,updated_at")
      .eq("spot_id", spotId)
      .order("updated_at", { ascending: false }),
    args.admin
      .from("facebook_destinations")
      .select("id,name,type,facebook_url,facebook_id,enabled,last_published_at,cooldown_minutes,notes,created_at,updated_at")
      .eq("spot_id", spotId)
      .eq("user_id", args.userId)
      .order("type")
      .order("name"),
    args.admin
      .from("publication_variants")
      .select("id,product_id,name,title,description,price_override,currency,primary_image_url,image_urls,content_hash,active,created_at,updated_at")
      .eq("spot_id", spotId)
      .eq("user_id", args.userId)
      .eq("active", true)
      .order("updated_at", { ascending: false }),
    args.admin
      .from("facebook_product_destinations")
      .select("id,product_id,destination_id,publication_variant_id,enabled,custom_text,primary_image_url,image_urls,created_at,updated_at")
      .eq("spot_id", spotId)
      .eq("user_id", args.userId),
    args.admin
      .from("publication_batches")
      .select("id,status,scheduled_at,started_at,completed_at,total_jobs,published_jobs,failed_jobs,attention_jobs,skipped_jobs,idempotency_key,metadata,created_at,updated_at")
      .eq("spot_id", spotId)
      .eq("user_id", args.userId)
      .order("created_at", { ascending: false })
      .limit(20),
    args.admin
      .from("facebook_connections")
      .select("id,status,facebook_user_id,facebook_name,scopes,expires_at,last_verified_at,updated_at")
      .eq("spot_id", spotId)
      .eq("user_id", args.userId)
      .maybeSingle(),
  ]);
  for (const result of [productsResult, destinationsResult, variantsResult, configsResult, batchesResult, connectionResult]) {
    if (result.error) throw new Error(result.error.message);
  }

  const batches = batchesResult.data ?? [];
  const batchIds = batches.map((batch) => batch.id);
  let jobs: Record<string, unknown>[] = [];
  if (batchIds.length) {
    const result = await args.admin
      .from("publication_jobs")
      .select("id,batch_id,product_id,publication_variant_id,destination_id,channel,status,attempts,scheduled_at,started_at,completed_at,published_url,error_code,error_message,content_hash,payload,created_at,updated_at")
      .in("batch_id", batchIds)
      .eq("user_id", args.userId)
      .order("created_at", { ascending: false })
      .limit(300);
    if (result.error) throw new Error(result.error.message);
    jobs = result.data ?? [];
  }

  const productIds = (productsResult.data ?? []).map((product) => product.id);
  let history: Record<string, unknown>[] = [];
  if (productIds.length) {
    const result = await args.admin
      .from("commerce_product_publications")
      .select("id,product_id,channel,destination_key,destination_label,destination_url,status,external_url,published_at,channel_title,channel_description,price_snapshot,currency_snapshot,metadata,updated_at")
      .in("product_id", productIds)
      .in("channel", ["facebook_marketplace", "facebook_group", "facebook_page"])
      .order("updated_at", { ascending: false })
      .limit(300);
    if (result.error) throw new Error(result.error.message);
    history = result.data ?? [];
  }

  return {
    space: context.space,
    spot: { id: context.spot.id, name: context.spot.name, timezone: context.spot.timezone, currency: context.spot.currency },
    connection: connectionResult.data ?? { status: "not_connected" },
    products: productsResult.data ?? [],
    destinations: destinationsResult.data ?? [],
    variants: variantsResult.data ?? [],
    configs: configsResult.data ?? [],
    batches,
    jobs,
    history,
  };
}

export async function saveFacebookDestination(args: {
  admin: PublisherAdmin;
  userId: string;
  spaceId: string;
  destination?: {
    id?: string;
    name?: string;
    type?: string;
    facebookUrl?: string | null;
    facebookId?: string | null;
    enabled?: boolean;
    cooldownMinutes?: number;
    notes?: string | null;
  };
}) {
  const context = await resolveBusinessPublisherAccess(args);
  const spotId = String(context.spot.id);
  const input = args.destination ?? {};
  const type = short(input.type, 30).toLowerCase();
  if (!["marketplace", "group", "page"].includes(type)) throw statusError("Destino de Facebook inválido.", 400);

  const name = short(input.name, 180) || (type === "marketplace" ? "Facebook Marketplace" : "");
  if (!name) throw statusError("Poné un nombre para el destino.", 400);

  const facebookUrl = input.facebookUrl ? short(input.facebookUrl, 2000) : null;
  if (facebookUrl) {
    try {
      const parsed = new URL(facebookUrl);
      if (!/(^|\.)facebook\.com$/i.test(parsed.hostname)) throw new Error("host");
    } catch {
      throw statusError("La URL debe ser de facebook.com.", 400);
    }
  }

  const row = {
    spot_id: spotId,
    user_id: args.userId,
    name,
    type,
    facebook_url: facebookUrl,
    facebook_id: short(input.facebookId, 300) || null,
    enabled: input.enabled !== false,
    cooldown_minutes: Math.max(0, Math.trunc(Number(input.cooldownMinutes) || 0)),
    notes: short(input.notes, 1000) || null,
    updated_at: new Date().toISOString(),
  };

  const result = input.id
    ? await args.admin.from("facebook_destinations").update(row).eq("id", input.id).eq("user_id", args.userId).eq("spot_id", spotId).select("*").single()
    : await args.admin.from("facebook_destinations").insert(row).select("*").single();
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

export async function saveFacebookProductDestination(args: {
  admin: PublisherAdmin;
  userId: string;
  spaceId: string;
  productId: string;
  destinationId?: string | null;
  destinationType?: "marketplace" | "group" | "page";
  enabled?: boolean;
  variantId?: string | null;
  customText?: string | null;
  primaryImageUrl?: string | null;
  imageUrls?: string[];
}) {
  const context = await resolveBusinessPublisherAccess(args);
  const spotId = String(context.spot.id);

  const { data: product, error: productError } = await args.admin
    .from("commerce_products")
    .select("id,spot_id")
    .eq("id", args.productId)
    .eq("spot_id", spotId)
    .maybeSingle();
  if (productError) throw new Error(productError.message);
  if (!product) throw statusError("El producto no pertenece a SIZ 8340.", 404);

  let destinationId = args.destinationId || null;
  if (!destinationId && args.destinationType === "marketplace") {
    const existing = await args.admin
      .from("facebook_destinations")
      .select("id")
      .eq("spot_id", spotId)
      .eq("user_id", args.userId)
      .eq("type", "marketplace")
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    if (existing.data?.id) destinationId = existing.data.id;
    else {
      const created = await args.admin.from("facebook_destinations").insert({
        spot_id: spotId,
        user_id: args.userId,
        name: "Facebook Marketplace",
        type: "marketplace",
        facebook_url: "https://www.facebook.com/marketplace/create/item",
        enabled: true,
        cooldown_minutes: 0,
      }).select("id").single();
      if (created.error) throw new Error(created.error.message);
      destinationId = created.data.id;
    }
  }
  if (!destinationId) throw statusError("Falta el destino.", 400);

  const { data: destination, error: destinationError } = await args.admin
    .from("facebook_destinations")
    .select("id,spot_id,user_id")
    .eq("id", destinationId)
    .eq("spot_id", spotId)
    .eq("user_id", args.userId)
    .maybeSingle();
  if (destinationError) throw new Error(destinationError.message);
  if (!destination) throw statusError("El destino no pertenece a este Bisnes.", 404);

  if (args.variantId) {
    const variant = await args.admin
      .from("publication_variants")
      .select("id")
      .eq("id", args.variantId)
      .eq("product_id", args.productId)
      .eq("user_id", args.userId)
      .maybeSingle();
    if (variant.error) throw new Error(variant.error.message);
    if (!variant.data) throw statusError("La variante de publicación no corresponde al producto.", 400);
  }

  const row = {
    spot_id: spotId,
    user_id: args.userId,
    product_id: args.productId,
    destination_id: destinationId,
    publication_variant_id: args.variantId || null,
    enabled: args.enabled !== false,
    custom_text: short(args.customText, 5000) || null,
    primary_image_url: short(args.primaryImageUrl, 2000) || null,
    image_urls: stringUrls(args.imageUrls),
    updated_at: new Date().toISOString(),
  };

  const existing = await args.admin
    .from("facebook_product_destinations")
    .select("id")
    .eq("user_id", args.userId)
    .eq("product_id", args.productId)
    .eq("destination_id", destinationId)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  const result = existing.data?.id
    ? await args.admin.from("facebook_product_destinations").update(row).eq("id", existing.data.id).select("*").single()
    : await args.admin.from("facebook_product_destinations").insert(row).select("*").single();
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

export async function savePublicationVariant(args: {
  admin: PublisherAdmin;
  userId: string;
  spaceId: string;
  variant?: {
    id?: string;
    productId?: string;
    name?: string;
    title?: string | null;
    description?: string | null;
    priceOverride?: number | null;
    currency?: string | null;
    primaryImageUrl?: string | null;
    imageUrls?: string[];
    active?: boolean;
  };
}) {
  const context = await resolveBusinessPublisherAccess(args);
  const spotId = String(context.spot.id);
  const input = args.variant ?? {};
  const productId = short(input.productId, 80);
  if (!productId) throw statusError("Falta el producto.", 400);

  const product = await args.admin
    .from("commerce_products")
    .select("id")
    .eq("id", productId)
    .eq("spot_id", spotId)
    .maybeSingle();
  if (product.error) throw new Error(product.error.message);
  if (!product.data) throw statusError("El producto no pertenece a este Bisnes.", 404);

  const payloadForHash = {
    title: short(input.title, 300) || null,
    description: short(input.description, 5000) || null,
    price: typeof input.priceOverride === "number" && Number.isFinite(input.priceOverride) ? input.priceOverride : null,
    primaryImageUrl: short(input.primaryImageUrl, 2000) || null,
    imageUrls: stringUrls(input.imageUrls),
  };
  const row = {
    spot_id: spotId,
    user_id: args.userId,
    product_id: productId,
    name: short(input.name, 160) || "Variante",
    title: payloadForHash.title,
    description: payloadForHash.description,
    price_override: payloadForHash.price,
    currency: short(input.currency, 3).toUpperCase() || null,
    primary_image_url: payloadForHash.primaryImageUrl,
    image_urls: payloadForHash.imageUrls,
    content_hash: hashContent(payloadForHash),
    active: input.active !== false,
    updated_at: new Date().toISOString(),
  };
  const result = input.id
    ? await args.admin.from("publication_variants").update(row).eq("id", input.id).eq("user_id", args.userId).eq("spot_id", spotId).select("*").single()
    : await args.admin.from("publication_variants").insert(row).select("*").single();
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

export async function createPublicationBatch(args: {
  admin: PublisherAdmin;
  userId: string;
  spaceId: string;
  productIds: string[];
  scheduledAt?: string | null;
  idempotencyKey?: string | null;
}) {
  const context = await resolveBusinessPublisherAccess(args);
  const spotId = String(context.spot.id);
  const productIds = Array.from(new Set(args.productIds.map((id) => short(id, 80)).filter(Boolean))).slice(0, 100);
  if (!productIds.length) throw statusError("Seleccioná al menos un producto.", 400);

  const idempotencyKey = short(args.idempotencyKey, 180) || randomUUID();
  const existingBatch = await args.admin
    .from("publication_batches")
    .select("*")
    .eq("spot_id", spotId)
    .eq("user_id", args.userId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (existingBatch.error) throw new Error(existingBatch.error.message);
  if (existingBatch.data) return { batch: existingBatch.data, duplicate: true };

  const [productsResult, configsResult, destinationsResult, variantsResult] = await Promise.all([
    args.admin
      .from("commerce_products")
      .select("id,name,description,price,currency,stock,status,cover_url,gallery,metadata")
      .eq("spot_id", spotId)
      .in("id", productIds),
    args.admin
      .from("facebook_product_destinations")
      .select("*")
      .eq("spot_id", spotId)
      .eq("user_id", args.userId)
      .eq("enabled", true)
      .in("product_id", productIds),
    args.admin
      .from("facebook_destinations")
      .select("*")
      .eq("spot_id", spotId)
      .eq("user_id", args.userId)
      .eq("enabled", true),
    args.admin
      .from("publication_variants")
      .select("*")
      .eq("spot_id", spotId)
      .eq("user_id", args.userId)
      .eq("active", true)
      .in("product_id", productIds),
  ]);
  for (const result of [productsResult, configsResult, destinationsResult, variantsResult]) {
    if (result.error) throw new Error(result.error.message);
  }

  const productMap = new Map((productsResult.data ?? []).map((row) => [String(row.id), row as Record<string, unknown>]));
  const destinationMap = new Map((destinationsResult.data ?? []).map((row) => [String(row.id), row as Record<string, unknown>]));
  const variantMap = new Map((variantsResult.data ?? []).map((row) => [String(row.id), row as Record<string, unknown>]));
  const scheduledAt = args.scheduledAt && !Number.isNaN(Date.parse(args.scheduledAt))
    ? new Date(args.scheduledAt).toISOString()
    : new Date().toISOString();

  const jobs = [];
  for (const config of configsResult.data ?? []) {
    const product = productMap.get(String(config.product_id));
    const destination = destinationMap.get(String(config.destination_id));
    if (!product || !destination) continue;
    const variant = config.publication_variant_id ? variantMap.get(String(config.publication_variant_id)) : null;
    const baseImages = imageUrls(product);
    const configuredImages = stringUrls(config.image_urls);
    const variantImages = variant ? stringUrls(variant.image_urls) : [];
    const images = variantImages.length ? variantImages : configuredImages.length ? configuredImages : baseImages;
    const primaryImage = short(variant?.primary_image_url, 2000)
      || short(config.primary_image_url, 2000)
      || images[0]
      || null;
    const title = short(variant?.title, 300) || short(product.name, 300);
    const description = short(config.custom_text, 5000)
      || short(variant?.description, 5000)
      || short(product.description, 5000);
    const price = Number.isFinite(Number(variant?.price_override)) && variant?.price_override != null
      ? Number(variant.price_override)
      : Number(product.price);
    const currency = short(variant?.currency, 3).toUpperCase() || short(product.currency, 3).toUpperCase() || "ARS";
    const contentHash = hashContent({
      productId: product.id,
      destinationId: destination.id,
      title,
      description,
      price,
      currency,
      images,
    });

    jobs.push({
      spot_id: spotId,
      user_id: args.userId,
      product_id: product.id,
      publication_variant_id: variant?.id ?? null,
      destination_id: destination.id,
      channel: channelForType(String(destination.type)),
      status: "queued",
      attempts: 0,
      scheduled_at: scheduledAt,
      content_hash: contentHash,
      idempotency_key: hashContent({ idempotencyKey, productId: product.id, destinationId: destination.id, contentHash }),
      payload: {
        title,
        description,
        price,
        currency,
        images,
        primary_image_url: primaryImage,
        destination_name: destination.name,
        destination_url: destination.facebook_url,
        destination_type: destination.type,
      },
    });
  }

  if (!jobs.length) {
    throw statusError("Los productos seleccionados todavía no tienen destinos de Facebook activos. Entrá en Editar publicación y elegí Marketplace o grupos.", 409, "NO_FACEBOOK_DESTINATIONS");
  }

  const { data: batch, error: batchError } = await args.admin
    .from("publication_batches")
    .insert({
      spot_id: spotId,
      user_id: args.userId,
      status: "queued",
      scheduled_at: scheduledAt,
      total_jobs: jobs.length,
      idempotency_key: idempotencyKey,
      metadata: { product_ids: productIds, source: "business_facebook_publisher" },
    })
    .select("*")
    .single();
  if (batchError) throw new Error(batchError.message);

  const jobRows = jobs.map((job) => ({ ...job, batch_id: batch.id }));
  const inserted = await args.admin.from("publication_jobs").insert(jobRows).select("*");
  if (inserted.error) {
    await args.admin.from("publication_batches").delete().eq("id", batch.id);
    throw new Error(inserted.error.message);
  }

  for (const job of inserted.data ?? []) {
    const destination = destinationMap.get(String(job.destination_id));
    const payload = job.payload as Record<string, unknown>;
    const existing = await args.admin
      .from("commerce_product_publications")
      .select("id,metadata")
      .eq("product_id", job.product_id)
      .eq("target_type", "marketplace")
      .eq("channel", job.channel)
      .eq("destination_key", String(job.destination_id))
      .eq("placement", "merch")
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    const publicationRow = {
      product_id: job.product_id,
      target_type: "marketplace",
      target_player_id: null,
      target_space_id: null,
      placement: "merch",
      is_visible: true,
      display_order: 0,
      source: "facebook_publisher",
      created_by_user_id: args.userId,
      channel: job.channel,
      destination_key: String(job.destination_id),
      destination_label: destination?.name ?? null,
      destination_url: destination?.facebook_url ?? null,
      publication_mode: job.channel === "facebook_page" ? "automatic" : "assisted",
      status: "ready",
      channel_title: payload.title ?? null,
      channel_description: payload.description ?? null,
      price_snapshot: payload.price ?? null,
      currency_snapshot: payload.currency ?? null,
      stock_snapshot: productMap.get(String(job.product_id))?.stock ?? null,
      error: null,
      metadata: {
        ...(existing.data?.metadata && typeof existing.data.metadata === "object" ? existing.data.metadata : {}),
        publisher_job_id: job.id,
        publisher_batch_id: batch.id,
        image_url: payload.primary_image_url ?? null,
        image_urls: payload.images ?? [],
        content_hash: job.content_hash,
      },
      updated_at: new Date().toISOString(),
    };
    const publicationResult = existing.data?.id
      ? await args.admin.from("commerce_product_publications").update(publicationRow).eq("id", existing.data.id)
      : await args.admin.from("commerce_product_publications").insert(publicationRow);
    if (publicationResult.error) throw new Error(publicationResult.error.message);
  }

  await args.admin.from("publication_audit_log").insert({
    spot_id: spotId,
    user_id: args.userId,
    batch_id: batch.id,
    action: "batch_created",
    details: { total_jobs: jobs.length, product_ids: productIds, scheduled_at: scheduledAt },
  });

  return { batch: { ...batch, total_jobs: jobs.length }, jobs: inserted.data ?? [], duplicate: false };
}

export async function refreshPublicationBatchSummary(admin: PublisherAdmin, batchId: string) {
  const { data: batch, error: batchError } = await admin
    .from("publication_batches")
    .select("id,status")
    .eq("id", batchId)
    .maybeSingle();
  if (batchError) throw new Error(batchError.message);
  if (!batch) return null;

  const { data: jobs, error: jobsError } = await admin
    .from("publication_jobs")
    .select("status")
    .eq("batch_id", batchId);
  if (jobsError) throw new Error(jobsError.message);

  const rows = jobs ?? [];
  const count = (statuses: string[]) => rows.filter((job) => statuses.includes(String(job.status))).length;
  const published = count(["published"]);
  const failed = count(["failed"]);
  const attention = count(["waiting_confirmation"]);
  const skipped = count(["skipped"]);
  const active = count(["queued", "opening", "filling", "uploading_media", "publishing", "retrying"]);
  let status = String(batch.status);
  let completedAt: string | null = null;
  if (status !== "paused" && status !== "cancelled") {
    if (active > 0) status = "running";
    else if (failed > 0 || attention > 0) {
      status = "partial";
      completedAt = new Date().toISOString();
    } else {
      status = "completed";
      completedAt = new Date().toISOString();
    }
  }

  const update = await admin
    .from("publication_batches")
    .update({
      status,
      total_jobs: rows.length,
      published_jobs: published,
      failed_jobs: failed,
      attention_jobs: attention,
      skipped_jobs: skipped,
      ...(completedAt ? { completed_at: completedAt } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", batchId)
    .select("*")
    .single();
  if (update.error) throw new Error(update.error.message);
  return update.data;
}

export async function controlPublicationBatch(args: {
  admin: PublisherAdmin;
  userId: string;
  spaceId: string;
  batchId: string;
  action: "pause" | "resume" | "cancel" | "retry_failed";
}) {
  const context = await resolveBusinessPublisherAccess(args);
  const spotId = String(context.spot.id);
  const batch = await args.admin
    .from("publication_batches")
    .select("*")
    .eq("id", args.batchId)
    .eq("spot_id", spotId)
    .eq("user_id", args.userId)
    .maybeSingle();
  if (batch.error) throw new Error(batch.error.message);
  if (!batch.data) throw statusError("El lote no existe.", 404);

  const now = new Date().toISOString();
  if (args.action === "pause") {
    await args.admin.from("publication_batches").update({ status: "paused", paused_at: now, updated_at: now }).eq("id", args.batchId);
  } else if (args.action === "resume") {
    await args.admin.from("publication_batches").update({ status: "queued", paused_at: null, completed_at: null, updated_at: now }).eq("id", args.batchId);
  } else if (args.action === "cancel") {
    await args.admin.from("publication_batches").update({ status: "cancelled", cancelled_at: now, updated_at: now }).eq("id", args.batchId);
    await args.admin
      .from("publication_jobs")
      .update({ status: "skipped", completed_at: now, error_code: "BATCH_CANCELLED", error_message: "Lote cancelado por el usuario.", updated_at: now })
      .eq("batch_id", args.batchId)
      .in("status", ["queued", "retrying"]);
  } else {
    await args.admin
      .from("publication_jobs")
      .update({ status: "retrying", completed_at: null, error_code: null, error_message: null, updated_at: now })
      .eq("batch_id", args.batchId)
      .eq("status", "failed");
    await args.admin.from("publication_batches").update({ status: "queued", completed_at: null, updated_at: now }).eq("id", args.batchId);
  }

  await args.admin.from("publication_audit_log").insert({
    spot_id: spotId,
    user_id: args.userId,
    batch_id: args.batchId,
    action: `batch_${args.action}`,
    details: {},
  });
  return refreshPublicationBatchSummary(args.admin, args.batchId);
}

export async function confirmPublicationJob(args: {
  admin: PublisherAdmin;
  userId: string;
  spaceId: string;
  jobId: string;
  publishedUrl?: string | null;
}) {
  const context = await resolveBusinessPublisherAccess(args);
  const spotId = String(context.spot.id);
  const jobResult = await args.admin
    .from("publication_jobs")
    .select("*,facebook_destinations!inner(id,name,type,facebook_url)")
    .eq("id", args.jobId)
    .eq("spot_id", spotId)
    .eq("user_id", args.userId)
    .maybeSingle();
  if (jobResult.error) throw new Error(jobResult.error.message);
  if (!jobResult.data) throw statusError("La publicación no existe.", 404);
  if (jobResult.data.status === "published") return jobResult.data;
  if (jobResult.data.status !== "waiting_confirmation") {
    throw statusError("Este job no está esperando confirmación.", 409);
  }

  const url = short(args.publishedUrl, 2000) || null;
  if (url) {
    try { new URL(url); } catch { throw statusError("La URL publicada no es válida.", 400); }
  }
  const now = new Date().toISOString();
  const updated = await args.admin
    .from("publication_jobs")
    .update({
      status: "published",
      published_url: url,
      completed_at: now,
      error_code: null,
      error_message: null,
      updated_at: now,
    })
    .eq("id", args.jobId)
    .select("*")
    .single();
  if (updated.error) throw new Error(updated.error.message);

  await args.admin
    .from("facebook_destinations")
    .update({ last_published_at: now, updated_at: now })
    .eq("id", jobResult.data.destination_id)
    .eq("user_id", args.userId);

  await args.admin
    .from("commerce_product_publications")
    .update({
      status: "published",
      external_url: url,
      published_at: now,
      last_sync_at: now,
      error: null,
      updated_at: now,
    })
    .eq("product_id", jobResult.data.product_id)
    .eq("channel", jobResult.data.channel)
    .eq("destination_key", String(jobResult.data.destination_id))
    .eq("placement", "merch");

  await args.admin.from("publication_audit_log").insert({
    spot_id: spotId,
    user_id: args.userId,
    batch_id: jobResult.data.batch_id,
    job_id: jobResult.data.id,
    action: "job_confirmed_published",
    details: { published_url: url },
  });

  await refreshPublicationBatchSummary(args.admin, jobResult.data.batch_id);
  return updated.data;
}

export async function failPublicationJob(admin: PublisherAdmin, jobId: string, code: string, message: string) {
  const now = new Date().toISOString();
  const result = await admin
    .from("publication_jobs")
    .update({
      status: "failed",
      completed_at: now,
      error_code: short(code, 120) || "PUBLISH_FAILED",
      error_message: short(message, 2000) || "No se pudo completar la publicación.",
      updated_at: now,
    })
    .eq("id", jobId)
    .select("*")
    .single();
  if (result.error) throw new Error(result.error.message);
  await refreshPublicationBatchSummary(admin, result.data.batch_id);
  return result.data;
}

export async function markPublicationJobWaiting(admin: PublisherAdmin, job: Record<string, unknown>, reason: string) {
  const now = new Date().toISOString();
  const update = await admin
    .from("publication_jobs")
    .update({
      status: "waiting_confirmation",
      error_code: "USER_CONFIRMATION_REQUIRED",
      error_message: short(reason, 2000),
      updated_at: now,
    })
    .eq("id", job.id)
    .select("*")
    .single();
  if (update.error) throw new Error(update.error.message);

  await admin
    .from("commerce_product_publications")
    .update({
      status: "needs_user_action",
      error: short(reason, 2000),
      last_sync_at: now,
      updated_at: now,
    })
    .eq("product_id", job.product_id)
    .eq("channel", job.channel)
    .eq("destination_key", String(job.destination_id))
    .eq("placement", "merch");

  await refreshPublicationBatchSummary(admin, String(job.batch_id));
  return update.data;
}
