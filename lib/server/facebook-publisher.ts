import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptFacebookSecret, type FacebookEncryptedSecret } from "@/core/integrations/facebook/crypto";
import { publishFacebookPagePost } from "@/core/integrations/facebook/client";
import { enqueueFacebookPublisherBatch } from "@/lib/server/cloud-tasks";

export const FACEBOOK_MARKETPLACE_CREATE_URL = "https://www.facebook.com/marketplace/create/item";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
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

function sha(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function channelForDestination(type: string) {
  if (type === "group") return "facebook_group";
  if (type === "page") return "facebook_page";
  return "facebook_marketplace";
}

function nowIso() {
  return new Date().toISOString();
}

async function audit(admin: SupabaseClient, args: {
  userId: string;
  spotId: string;
  batchId?: string | null;
  jobId?: string | null;
  action: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  metadata?: JsonRecord;
}) {
  const { error } = await admin.from("publication_audit_log").insert({
    user_id: args.userId,
    spot_id: args.spotId,
    batch_id: args.batchId ?? null,
    job_id: args.jobId ?? null,
    action: args.action,
    from_status: args.fromStatus ?? null,
    to_status: args.toStatus ?? null,
    metadata: args.metadata ?? {},
  });
  if (error) console.error("facebook publisher audit failed", error.message);
}

export async function ensureMarketplaceDestination(admin: SupabaseClient, userId: string, spotId: string) {
  const existing = await admin.from("facebook_destinations")
    .select("id,user_id,spot_id,name,type,facebook_url,facebook_id,enabled,last_published_at,cooldown_minutes,notes,created_at,updated_at")
    .eq("user_id", userId)
    .eq("spot_id", spotId)
    .eq("type", "marketplace")
    .eq("facebook_id", "marketplace")
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data) return existing.data;

  const inserted = await admin.from("facebook_destinations").insert({
    user_id: userId,
    spot_id: spotId,
    name: "Facebook Marketplace",
    type: "marketplace",
    facebook_url: FACEBOOK_MARKETPLACE_CREATE_URL,
    facebook_id: "marketplace",
    enabled: true,
    cooldown_minutes: 1440,
    metadata: { source: "clouva_default" },
  }).select("id,user_id,spot_id,name,type,facebook_url,facebook_id,enabled,last_published_at,cooldown_minutes,notes,created_at,updated_at").single();
  if (inserted.error) throw new Error(inserted.error.message);
  return inserted.data;
}

async function ensureMarketplaceConfigs(
  admin: SupabaseClient,
  userId: string,
  spotId: string,
  productIds: string[],
) {
  if (!productIds.length) return;
  const marketplace = await ensureMarketplaceDestination(admin, userId, spotId);
  const existing = await admin.from("publication_product_destinations")
    .select("product_id")
    .eq("user_id", userId)
    .eq("spot_id", spotId)
    .eq("destination_id", marketplace.id)
    .in("product_id", productIds);
  if (existing.error) throw new Error(existing.error.message);
  const found = new Set((existing.data ?? []).map((row) => String(row.product_id)));
  const missing = productIds.filter((id) => !found.has(id));
  if (!missing.length) return;
  const { error } = await admin.from("publication_product_destinations").insert(missing.map((productId) => ({
    user_id: userId,
    spot_id: spotId,
    product_id: productId,
    destination_id: marketplace.id,
    enabled: true,
    metadata: { source: "default_marketplace" },
  })));
  if (error) throw new Error(error.message);
}

function imagesForProduct(product: JsonRecord, config: JsonRecord, variant: JsonRecord | null) {
  const configured = stringUrls(config.image_urls);
  const variantImages = stringUrls(variant?.image_urls);
  const productGallery = stringUrls(product.gallery);
  const base = configured.length ? configured : variantImages.length ? variantImages : productGallery;
  const primary = short(config.primary_image_url, 2000)
    || short(variant?.primary_image_url, 2000)
    || short(product.cover_url, 2000)
    || base[0]
    || "";
  return primary
    ? [primary, ...base.filter((url) => url !== primary)].slice(0, 10)
    : base.slice(0, 10);
}

function buildPayload(product: JsonRecord, config: JsonRecord, destination: JsonRecord, variant: JsonRecord | null) {
  const productMetadata = record(product.metadata);
  const title = short(variant?.title, 300) || short(product.name, 300);
  const description = short(variant?.description, 5000)
    || short(config.custom_text, 5000)
    || short(product.description, 5000);
  const priceOverride = variant?.price_override;
  const price = Number(priceOverride ?? product.price ?? 0);
  const imageUrls = imagesForProduct(product, config, variant);
  const payload = {
    title,
    description,
    price,
    currency: short(product.currency, 3).toUpperCase() || "ARS",
    category: short(variant?.category, 160) || short(productMetadata.category, 160) || null,
    condition: short(variant?.condition, 80) || short(productMetadata.condition, 80) || "used_like_new",
    location: short(variant?.location_text, 240) || short(productMetadata.location, 240) || null,
    imageUrls,
    primaryImageUrl: imageUrls[0] ?? null,
    destination: {
      id: String(destination.id),
      type: String(destination.type),
      name: String(destination.name),
      url: destination.facebook_url ? String(destination.facebook_url) : null,
      facebookId: destination.facebook_id ? String(destination.facebook_id) : null,
    },
    variantId: variant?.id ? String(variant.id) : null,
  };
  return { payload, contentHash: sha(payload) };
}

async function mirrorPublication(admin: SupabaseClient, args: {
  userId: string;
  productId: string;
  destination: JsonRecord;
  payload: JsonRecord;
  status: "needs_user_action" | "published" | "failed";
  externalUrl?: string | null;
  externalId?: string | null;
  error?: string | null;
}) {
  const channel = channelForDestination(String(args.destination.type));
  const destinationKey = String(args.destination.id);
  const existing = await admin.from("commerce_product_publications")
    .select("id,published_at,metadata")
    .eq("product_id", args.productId)
    .eq("target_type", "marketplace")
    .eq("channel", channel)
    .eq("destination_key", destinationKey)
    .eq("placement", "merch")
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);

  const imageUrls = stringUrls(args.payload.imageUrls);
  const row = {
    product_id: args.productId,
    target_type: "marketplace",
    target_player_id: null,
    target_space_id: null,
    placement: "merch",
    is_visible: args.status === "published",
    display_order: 0,
    source: "facebook_publisher",
    created_by_user_id: args.userId,
    channel,
    destination_key: destinationKey,
    destination_label: short(args.destination.name, 200) || null,
    destination_url: short(args.destination.facebook_url, 2000) || null,
    publication_mode: String(args.destination.type) === "page" ? "automatic" : "assisted",
    status: args.status,
    external_id: args.externalId ?? null,
    external_url: args.externalUrl ?? null,
    published_at: args.status === "published" ? (existing.data?.published_at ?? nowIso()) : existing.data?.published_at ?? null,
    last_sync_at: nowIso(),
    channel_title: short(args.payload.title, 300),
    channel_description: short(args.payload.description, 5000),
    price_snapshot: Number(args.payload.price ?? 0),
    currency_snapshot: short(args.payload.currency, 3),
    error: args.error ?? null,
    metadata: {
      ...record(existing.data?.metadata),
      publisher: "mi_spot_facebook",
      image_url: imageUrls[0] ?? null,
      image_urls: imageUrls,
      content_hash: sha(args.payload),
    },
    updated_at: nowIso(),
  };

  const result = existing.data?.id
    ? await admin.from("commerce_product_publications").update(row).eq("id", existing.data.id)
    : await admin.from("commerce_product_publications").insert(row);
  if (result.error) throw new Error(result.error.message);
}

export async function getFacebookPublisherOverview(
  admin: SupabaseClient,
  userId: string,
  spotId: string,
) {
  const productsResult = await admin.from("commerce_products")
    .select("id,name,description,price,currency,stock,status,cover_url,gallery,metadata,updated_at")
    .eq("spot_id", spotId)
    .order("updated_at", { ascending: false });
  if (productsResult.error) throw new Error(productsResult.error.message);
  const products = productsResult.data ?? [];
  const productIds = products.map((product) => String(product.id));
  await ensureMarketplaceConfigs(admin, userId, spotId, productIds);

  const [destinations, configs, variants, connection, latestBatch, todayJobs] = await Promise.all([
    admin.from("facebook_destinations")
      .select("id,name,type,facebook_url,facebook_id,enabled,last_published_at,cooldown_minutes,notes,created_at,updated_at")
      .eq("user_id", userId).eq("spot_id", spotId).order("type").order("created_at"),
    admin.from("publication_product_destinations")
      .select("id,product_id,destination_id,variant_id,enabled,custom_text,primary_image_url,image_urls,frequency_minutes,metadata,updated_at")
      .eq("user_id", userId).eq("spot_id", spotId),
    admin.from("publication_variants")
      .select("id,product_id,name,title,description,price_override,category,condition,location_text,primary_image_url,image_urls,active,metadata,updated_at")
      .eq("user_id", userId).eq("spot_id", spotId).eq("active", true).order("updated_at", { ascending: false }),
    admin.from("commerce_facebook_connections")
      .select("status,facebook_user_id,display_name,token_expires_at,scopes,last_verified_at,attention_reason")
      .eq("user_id", userId).maybeSingle(),
    admin.from("publication_batches")
      .select("id,status,scheduled_at,started_at,completed_at,total_jobs,published_jobs,failed_jobs,attention_jobs,skipped_jobs,created_at,updated_at")
      .eq("user_id", userId).eq("spot_id", spotId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("publication_jobs")
      .select("id,status,created_at")
      .eq("user_id", userId).eq("spot_id", spotId)
      .gte("created_at", new Date(new Date().setHours(0, 0, 0, 0)).toISOString()),
  ]);
  for (const result of [destinations, configs, variants, connection, latestBatch, todayJobs]) {
    if (result.error) throw new Error(result.error.message);
  }

  let latestJobs: unknown[] = [];
  if (latestBatch.data?.id) {
    const jobs = await admin.from("publication_jobs")
      .select("id,batch_id,product_id,channel,destination_id,status,attempts,scheduled_at,started_at,completed_at,published_url,error_code,error_message,intervention_url,payload,created_at,updated_at")
      .eq("batch_id", latestBatch.data.id)
      .order("created_at");
    if (jobs.error) throw new Error(jobs.error.message);
    latestJobs = jobs.data ?? [];
  }

  const jobs = todayJobs.data ?? [];
  return {
    products,
    destinations: destinations.data ?? [],
    productDestinations: configs.data ?? [],
    variants: variants.data ?? [],
    facebook: connection.data ?? {
      status: "not_connected",
      facebook_user_id: null,
      display_name: null,
      token_expires_at: null,
      scopes: [],
      last_verified_at: null,
      attention_reason: null,
    },
    today: {
      published: jobs.filter((job) => job.status === "published").length,
      pending: jobs.filter((job) => ["queued","opening","filling","uploading_media","publishing","retrying"].includes(job.status)).length,
      failed: jobs.filter((job) => job.status === "failed").length,
      attention: jobs.filter((job) => job.status === "waiting_confirmation").length,
    },
    latestBatch: latestBatch.data ? { ...latestBatch.data, jobs: latestJobs } : null,
  };
}

export async function createFacebookPublicationBatch(admin: SupabaseClient, args: {
  userId: string;
  spotId: string;
  productIds: string[];
  idempotencyKey: string;
  scheduledAt?: string | null;
}) {
  const productIds = Array.from(new Set(args.productIds.map((id) => id.trim()).filter(Boolean)));
  if (!productIds.length) throw new Error("Seleccioná al menos un producto.");

  const existing = await admin.from("publication_batches")
    .select("*")
    .eq("user_id", args.userId)
    .eq("idempotency_key", args.idempotencyKey)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data) {
    if (existing.data.status === "failed") {
      const queued = await admin.from("publication_jobs")
        .select("id", { count: "exact", head: true })
        .eq("batch_id", existing.data.id)
        .in("status", ["queued","retrying"]);
      if (!queued.error && (queued.count ?? 0) > 0) {
        await admin.from("publication_batches").update({ status: "queued", updated_at: nowIso() }).eq("id", existing.data.id);
        await enqueueFacebookPublisherBatch(String(existing.data.id), 0);
      }
    }
    return { batch: existing.data, duplicate: true };
  }

  const productsResult = await admin.from("commerce_products")
    .select("id,name,description,price,currency,stock,status,cover_url,gallery,metadata")
    .eq("spot_id", args.spotId)
    .in("id", productIds);
  if (productsResult.error) throw new Error(productsResult.error.message);
  const products = productsResult.data ?? [];
  if (products.length !== productIds.length) throw new Error("Uno o más productos no pertenecen a este Spot.");
  await ensureMarketplaceConfigs(admin, args.userId, args.spotId, productIds);

  const [configsResult, destinationsResult, variantsResult] = await Promise.all([
    admin.from("publication_product_destinations")
      .select("*").eq("user_id", args.userId).eq("spot_id", args.spotId)
      .in("product_id", productIds).eq("enabled", true),
    admin.from("facebook_destinations")
      .select("*").eq("user_id", args.userId).eq("spot_id", args.spotId).eq("enabled", true),
    admin.from("publication_variants")
      .select("*").eq("user_id", args.userId).eq("spot_id", args.spotId).eq("active", true)
      .in("product_id", productIds),
  ]);
  for (const result of [configsResult, destinationsResult, variantsResult]) {
    if (result.error) throw new Error(result.error.message);
  }

  const destinations = new Map((destinationsResult.data ?? []).map((row) => [String(row.id), row as JsonRecord]));
  const productsById = new Map(products.map((row) => [String(row.id), row as JsonRecord]));
  const variants = new Map((variantsResult.data ?? []).map((row) => [String(row.id), row as JsonRecord]));

  const candidates = (configsResult.data ?? []).flatMap((configRow) => {
    const config = configRow as JsonRecord;
    const destination = destinations.get(String(config.destination_id));
    const product = productsById.get(String(config.product_id));
    if (!destination || !product) return [];
    const variant = config.variant_id ? variants.get(String(config.variant_id)) ?? null : null;
    const built = buildPayload(product, config, destination, variant);
    return [{
      config,
      destination,
      product,
      variant,
      ...built,
      channel: channelForDestination(String(destination.type)),
    }];
  });

  if (!candidates.length) throw new Error("Los productos seleccionados no tienen destinos Facebook activos.");

  const oldestCooldown = Math.max(0, ...candidates.map((item) => Number(item.config.frequency_minutes ?? item.destination.cooldown_minutes ?? 0)));
  const recentSince = new Date(Date.now() - oldestCooldown * 60_000).toISOString();
  const recentResult = await admin.from("publication_jobs")
    .select("product_id,destination_id,content_hash,completed_at,status")
    .eq("user_id", args.userId)
    .eq("spot_id", args.spotId)
    .eq("status", "published")
    .in("product_id", productIds)
    .gte("completed_at", recentSince);
  if (recentResult.error) throw new Error(recentResult.error.message);
  const recent = recentResult.data ?? [];

  const scheduledAt = args.scheduledAt ? new Date(args.scheduledAt) : null;
  if (scheduledAt && Number.isNaN(scheduledAt.getTime())) throw new Error("Fecha de programación inválida.");
  const batchResult = await admin.from("publication_batches").insert({
    user_id: args.userId,
    spot_id: args.spotId,
    status: "queued",
    idempotency_key: args.idempotencyKey,
    scheduled_at: scheduledAt?.toISOString() ?? null,
    metadata: { product_ids: productIds },
  }).select("*").single();
  if (batchResult.error) throw new Error(batchResult.error.message);
  const batch = batchResult.data;

  const jobs = candidates.map((item) => {
    const cooldown = Number(item.config.frequency_minutes ?? item.destination.cooldown_minutes ?? 0);
    const cutoff = Date.now() - cooldown * 60_000;
    const duplicate = recent.some((row) =>
      String(row.product_id) === String(item.product.id)
      && String(row.destination_id) === String(item.destination.id)
      && String(row.content_hash) === item.contentHash
      && row.completed_at
      && new Date(row.completed_at).getTime() >= cutoff
    );
    return {
      batch_id: batch.id,
      user_id: args.userId,
      spot_id: args.spotId,
      product_id: item.product.id,
      channel: item.channel,
      destination_id: item.destination.id,
      variant_id: item.variant?.id ?? null,
      status: duplicate ? "skipped" : "queued",
      scheduled_at: scheduledAt?.toISOString() ?? null,
      completed_at: duplicate ? nowIso() : null,
      error_code: duplicate ? "RECENT_DUPLICATE" : null,
      error_message: duplicate ? "Se omitió porque el mismo contenido ya fue publicado recientemente en este destino." : null,
      content_hash: item.contentHash,
      idempotency_key: sha([batch.id, item.product.id, item.destination.id, item.contentHash]),
      payload: item.payload,
      intervention_url: null,
      metadata: {
        cooldown_minutes: cooldown,
        product_name: item.product.name,
        destination_name: item.destination.name,
      },
    };
  });

  const jobsResult = await admin.from("publication_jobs").insert(jobs).select("id,status");
  if (jobsResult.error) {
    await admin.from("publication_batches").delete().eq("id", batch.id);
    throw new Error(jobsResult.error.message);
  }
  const skippedJobs = (jobsResult.data ?? []).filter((job) => job.status === "skipped").length;
  const runnableJobs = jobs.length - skippedJobs;
  const updateResult = await admin.from("publication_batches").update({
    total_jobs: jobs.length,
    skipped_jobs: skippedJobs,
    status: runnableJobs ? "queued" : "completed",
    completed_at: runnableJobs ? null : nowIso(),
    updated_at: nowIso(),
  }).eq("id", batch.id).select("*").single();
  if (updateResult.error) throw new Error(updateResult.error.message);

  await audit(admin, {
    userId: args.userId,
    spotId: args.spotId,
    batchId: batch.id,
    action: "batch_created",
    toStatus: runnableJobs ? "queued" : "completed",
    metadata: { total_jobs: jobs.length, skipped_jobs: skippedJobs },
  });

  if (runnableJobs) {
    const delay = scheduledAt ? Math.max(0, Math.ceil((scheduledAt.getTime() - Date.now()) / 1000)) : 0;
    try {
      await enqueueFacebookPublisherBatch(String(batch.id), delay);
    } catch (error) {
      await admin.from("publication_batches").update({
        status: "failed",
        metadata: {
          product_ids: productIds,
          queue_error: error instanceof Error ? error.message : "No se pudo encolar el lote.",
        },
        updated_at: nowIso(),
      }).eq("id", batch.id);
      throw error;
    }
  }

  return { batch: updateResult.data, duplicate: false };
}

export async function getPublicationBatch(admin: SupabaseClient, userId: string, spotId: string, batchId: string) {
  const batch = await admin.from("publication_batches").select("*")
    .eq("id", batchId).eq("user_id", userId).eq("spot_id", spotId).maybeSingle();
  if (batch.error) throw new Error(batch.error.message);
  if (!batch.data) throw Object.assign(new Error("El lote no existe."), { status: 404 });
  const jobs = await admin.from("publication_jobs")
    .select("id,batch_id,product_id,channel,destination_id,status,attempts,scheduled_at,started_at,completed_at,published_url,error_code,error_message,intervention_url,payload,metadata,created_at,updated_at")
    .eq("batch_id", batchId).eq("user_id", userId).order("created_at");
  if (jobs.error) throw new Error(jobs.error.message);
  return { batch: batch.data, jobs: jobs.data ?? [] };
}

async function recalculateBatch(admin: SupabaseClient, batchId: string) {
  const jobsResult = await admin.from("publication_jobs").select("status").eq("batch_id", batchId);
  if (jobsResult.error) throw new Error(jobsResult.error.message);
  const statuses = (jobsResult.data ?? []).map((job) => String(job.status));
  const counts = {
    total_jobs: statuses.length,
    published_jobs: statuses.filter((status) => status === "published").length,
    failed_jobs: statuses.filter((status) => status === "failed").length,
    attention_jobs: statuses.filter((status) => status === "waiting_confirmation").length,
    skipped_jobs: statuses.filter((status) => status === "skipped").length,
  };
  const active = statuses.some((status) => ["queued","opening","filling","uploading_media","publishing","retrying"].includes(status));
  let status = active ? "running" : "completed";
  if (!active && counts.failed_jobs && !counts.published_jobs && !counts.attention_jobs) status = "failed";
  else if (!active && (counts.failed_jobs || counts.attention_jobs)) status = "partial";
  const update = await admin.from("publication_batches").update({
    ...counts,
    status,
    completed_at: active ? null : nowIso(),
    updated_at: nowIso(),
  }).eq("id", batchId).select("*").single();
  if (update.error) throw new Error(update.error.message);
  return update.data;
}

async function queueNext(admin: SupabaseClient, batchId: string, delaySeconds = 0) {
  const batch = await admin.from("publication_batches").select("status").eq("id", batchId).maybeSingle();
  if (batch.error) throw new Error(batch.error.message);
  if (!batch.data || ["paused","cancelled","completed"].includes(String(batch.data.status))) return;
  await enqueueFacebookPublisherBatch(batchId, delaySeconds);
}

export async function processFacebookPublicationBatch(admin: SupabaseClient, batchId: string) {
  const batchResult = await admin.from("publication_batches").select("*").eq("id", batchId).maybeSingle();
  if (batchResult.error) throw new Error(batchResult.error.message);
  const batch = batchResult.data;
  if (!batch) throw new Error("El lote no existe.");
  if (["paused","cancelled","completed"].includes(String(batch.status))) return { batch, processed: false };

  if (batch.scheduled_at && new Date(batch.scheduled_at).getTime() > Date.now() + 1000) {
    await enqueueFacebookPublisherBatch(batchId, Math.ceil((new Date(batch.scheduled_at).getTime() - Date.now()) / 1000));
    return { batch, processed: false };
  }

  if (batch.status !== "running") {
    await admin.from("publication_batches").update({
      status: "running",
      started_at: batch.started_at ?? nowIso(),
      updated_at: nowIso(),
    }).eq("id", batchId);
  }

  const jobResult = await admin.from("publication_jobs")
    .select("*")
    .eq("batch_id", batchId)
    .in("status", ["queued","retrying"])
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (jobResult.error) throw new Error(jobResult.error.message);
  const job = jobResult.data;

  if (!job) return { batch: await recalculateBatch(admin, batchId), processed: false };

  const destinationResult = await admin.from("facebook_destinations").select("*").eq("id", job.destination_id).maybeSingle();
  if (destinationResult.error) throw new Error(destinationResult.error.message);
  const destination = destinationResult.data as JsonRecord | null;
  if (!destination || String(destination.user_id) !== String(batch.user_id)) {
    await admin.from("publication_jobs").update({
      status: "failed",
      completed_at: nowIso(),
      error_code: "DESTINATION_NOT_FOUND",
      error_message: "El destino ya no está disponible.",
      updated_at: nowIso(),
    }).eq("id", job.id);
    await queueNext(admin, batchId);
    return { batchId, jobId: job.id, status: "failed" };
  }

  const attempts = Number(job.attempts ?? 0) + 1;
  await admin.from("publication_jobs").update({
    status: "opening",
    attempts,
    started_at: job.started_at ?? nowIso(),
    error_code: null,
    error_message: null,
    updated_at: nowIso(),
  }).eq("id", job.id);
  await audit(admin, {
    userId: String(batch.user_id),
    spotId: String(batch.spot_id),
    batchId,
    jobId: String(job.id),
    action: "job_started",
    fromStatus: String(job.status),
    toStatus: "opening",
    metadata: { attempt: attempts },
  });

  const payload = record(job.payload);
  const destinationType = String(destination.type);

  if (destinationType === "marketplace" || destinationType === "group") {
    await admin.from("publication_jobs").update({ status: "filling", updated_at: nowIso() }).eq("id", job.id);
    await admin.from("publication_jobs").update({ status: "uploading_media", updated_at: nowIso() }).eq("id", job.id);
    const interventionUrl = destinationType === "marketplace"
      ? FACEBOOK_MARKETPLACE_CREATE_URL
      : short(destination.facebook_url, 2000);
    await admin.from("publication_jobs").update({
      status: "waiting_confirmation",
      intervention_url: interventionUrl || null,
      completed_at: null,
      error_code: "USER_CONFIRMATION_REQUIRED",
      error_message: "Facebook requiere tu intervención para confirmar esta publicación.",
      updated_at: nowIso(),
    }).eq("id", job.id);
    await mirrorPublication(admin, {
      userId: String(batch.user_id),
      productId: String(job.product_id),
      destination,
      payload,
      status: "needs_user_action",
    });
    await audit(admin, {
      userId: String(batch.user_id),
      spotId: String(batch.spot_id),
      batchId,
      jobId: String(job.id),
      action: "job_waiting_confirmation",
      fromStatus: "uploading_media",
      toStatus: "waiting_confirmation",
      metadata: { destination_type: destinationType },
    });
    await queueNext(admin, batchId);
    return { batchId, jobId: job.id, status: "waiting_confirmation" };
  }

  const encrypted = destination.encrypted_access_token as FacebookEncryptedSecret | null | undefined;
  if (!encrypted?.ciphertext) {
    await admin.from("publication_jobs").update({
      status: "waiting_confirmation",
      intervention_url: "/mi-spot/publicador/facebook?spotId=" + encodeURIComponent(String(batch.spot_id)),
      error_code: "FACEBOOK_CONNECTION_REQUIRED",
      error_message: "Facebook requiere tu intervención: conectá o renová la Página.",
      updated_at: nowIso(),
    }).eq("id", job.id);
    await queueNext(admin, batchId);
    return { batchId, jobId: job.id, status: "waiting_confirmation" };
  }

  await admin.from("publication_jobs").update({ status: "uploading_media", updated_at: nowIso() }).eq("id", job.id);
  await admin.from("publication_jobs").update({ status: "publishing", updated_at: nowIso() }).eq("id", job.id);

  try {
    const pageId = short(destination.facebook_id, 300);
    if (!pageId) throw new Error("La Página no tiene facebook_id.");
    const message = [short(payload.title, 300), short(payload.description, 5000), payload.price != null ? String(payload.currency || "") + " " + String(payload.price) : ""]
      .filter(Boolean).join("\n\n");
    const result = await publishFacebookPagePost({
      pageId,
      pageAccessToken: decryptFacebookSecret(encrypted),
      message,
      imageUrls: stringUrls(payload.imageUrls, 10),
    });
    await admin.from("publication_jobs").update({
      status: "published",
      published_url: result.externalUrl,
      completed_at: nowIso(),
      error_code: null,
      error_message: null,
      updated_at: nowIso(),
      metadata: { ...record(job.metadata), external_id: result.externalId },
    }).eq("id", job.id);
    await admin.from("facebook_destinations").update({
      last_published_at: nowIso(),
      updated_at: nowIso(),
    }).eq("id", destination.id);
    await mirrorPublication(admin, {
      userId: String(batch.user_id),
      productId: String(job.product_id),
      destination,
      payload,
      status: "published",
      externalUrl: result.externalUrl,
      externalId: result.externalId,
    });
    await audit(admin, {
      userId: String(batch.user_id),
      spotId: String(batch.spot_id),
      batchId,
      jobId: String(job.id),
      action: "job_published",
      fromStatus: "publishing",
      toStatus: "published",
      metadata: { external_id: result.externalId },
    });
    await queueNext(admin, batchId);
    return { batchId, jobId: job.id, status: "published", publishedUrl: result.externalUrl };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Facebook rechazó la publicación.";
    const requiresAttention = /token|permission|checkpoint|oauth|session|password|authorize|access/i.test(message);
    if (requiresAttention) {
      await admin.from("publication_jobs").update({
        status: "waiting_confirmation",
        intervention_url: "/mi-spot/publicador/facebook?spotId=" + encodeURIComponent(String(batch.spot_id)),
        error_code: "FACEBOOK_REQUIRES_ATTENTION",
        error_message: "Facebook requiere tu intervención. " + message,
        updated_at: nowIso(),
      }).eq("id", job.id);
    } else if (attempts < 3) {
      const delay = Math.min(900, 30 * Math.pow(2, attempts - 1));
      await admin.from("publication_jobs").update({
        status: "retrying",
        scheduled_at: new Date(Date.now() + delay * 1000).toISOString(),
        error_code: "PUBLISH_RETRY",
        error_message: message,
        updated_at: nowIso(),
      }).eq("id", job.id);
      await queueNext(admin, batchId, delay);
      return { batchId, jobId: job.id, status: "retrying" };
    } else {
      await admin.from("publication_jobs").update({
        status: "failed",
        completed_at: nowIso(),
        error_code: "PUBLISH_FAILED",
        error_message: message,
        updated_at: nowIso(),
      }).eq("id", job.id);
      await mirrorPublication(admin, {
        userId: String(batch.user_id),
        productId: String(job.product_id),
        destination,
        payload,
        status: "failed",
        error: message,
      });
    }
    await queueNext(admin, batchId);
    return { batchId, jobId: job.id, status: requiresAttention ? "waiting_confirmation" : "failed" };
  }
}

export async function updatePublicationBatch(admin: SupabaseClient, args: {
  userId: string;
  spotId: string;
  batchId: string;
  action: "pause" | "resume" | "cancel" | "retry_failed";
}) {
  const current = await admin.from("publication_batches").select("*")
    .eq("id", args.batchId).eq("user_id", args.userId).eq("spot_id", args.spotId).maybeSingle();
  if (current.error) throw new Error(current.error.message);
  if (!current.data) throw Object.assign(new Error("El lote no existe."), { status: 404 });

  if (args.action === "pause") {
    if (!["queued","running"].includes(String(current.data.status))) return current.data;
    const result = await admin.from("publication_batches").update({ status: "paused", updated_at: nowIso() })
      .eq("id", args.batchId).select("*").single();
    if (result.error) throw new Error(result.error.message);
    await audit(admin, { userId: args.userId, spotId: args.spotId, batchId: args.batchId, action: "batch_paused", fromStatus: String(current.data.status), toStatus: "paused" });
    return result.data;
  }

  if (args.action === "cancel") {
    await admin.from("publication_jobs").update({
      status: "skipped",
      completed_at: nowIso(),
      error_code: "BATCH_CANCELLED",
      error_message: "El lote fue cancelado por el usuario.",
      updated_at: nowIso(),
    }).eq("batch_id", args.batchId).in("status", ["queued","retrying"]);
    const result = await admin.from("publication_batches").update({
      status: "cancelled",
      completed_at: nowIso(),
      updated_at: nowIso(),
    }).eq("id", args.batchId).select("*").single();
    if (result.error) throw new Error(result.error.message);
    await audit(admin, { userId: args.userId, spotId: args.spotId, batchId: args.batchId, action: "batch_cancelled", fromStatus: String(current.data.status), toStatus: "cancelled" });
    return result.data;
  }

  if (args.action === "retry_failed") {
    const { error } = await admin.from("publication_jobs").update({
      status: "retrying",
      scheduled_at: nowIso(),
      completed_at: null,
      error_code: null,
      error_message: null,
      updated_at: nowIso(),
    }).eq("batch_id", args.batchId).eq("status", "failed");
    if (error) throw new Error(error.message);
  }

  const result = await admin.from("publication_batches").update({
    status: "queued",
    completed_at: null,
    updated_at: nowIso(),
  }).eq("id", args.batchId).select("*").single();
  if (result.error) throw new Error(result.error.message);
  await audit(admin, {
    userId: args.userId,
    spotId: args.spotId,
    batchId: args.batchId,
    action: args.action === "retry_failed" ? "batch_retry_failed" : "batch_resumed",
    fromStatus: String(current.data.status),
    toStatus: "queued",
  });
  await enqueueFacebookPublisherBatch(args.batchId, 0);
  return result.data;
}

export async function confirmFacebookPublicationJob(admin: SupabaseClient, args: {
  userId: string;
  spotId: string;
  jobId: string;
  publishedUrl?: string | null;
}) {
  const jobResult = await admin.from("publication_jobs").select("*")
    .eq("id", args.jobId).eq("user_id", args.userId).eq("spot_id", args.spotId).maybeSingle();
  if (jobResult.error) throw new Error(jobResult.error.message);
  const job = jobResult.data;
  if (!job) throw Object.assign(new Error("La publicación no existe."), { status: 404 });
  if (job.status === "published") return { job, duplicate: true };
  if (job.status !== "waiting_confirmation") {
    throw Object.assign(new Error("Este job no está esperando confirmación."), { status: 409 });
  }

  const destinationResult = await admin.from("facebook_destinations").select("*").eq("id", job.destination_id).single();
  if (destinationResult.error) throw new Error(destinationResult.error.message);
  const destination = destinationResult.data as JsonRecord;
  const publishedUrl = short(args.publishedUrl, 2000) || null;

  const update = await admin.from("publication_jobs").update({
    status: "published",
    published_url: publishedUrl,
    completed_at: nowIso(),
    error_code: null,
    error_message: null,
    updated_at: nowIso(),
  }).eq("id", job.id).select("*").single();
  if (update.error) throw new Error(update.error.message);

  await admin.from("facebook_destinations").update({
    last_published_at: nowIso(),
    updated_at: nowIso(),
  }).eq("id", destination.id);

  await mirrorPublication(admin, {
    userId: args.userId,
    productId: String(job.product_id),
    destination,
    payload: record(job.payload),
    status: "published",
    externalUrl: publishedUrl,
  });
  await audit(admin, {
    userId: args.userId,
    spotId: args.spotId,
    batchId: String(job.batch_id),
    jobId: String(job.id),
    action: "job_confirmed_by_user",
    fromStatus: "waiting_confirmation",
    toStatus: "published",
    metadata: publishedUrl ? { published_url: publishedUrl } : {},
  });
  await recalculateBatch(admin, String(job.batch_id));
  await queueNext(admin, String(job.batch_id));
  return { job: update.data, duplicate: false };
}
