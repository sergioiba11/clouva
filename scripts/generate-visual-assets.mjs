// One-off ops script: runs the exact same reserve -> generate -> upload ->
// finalize sequence as app/api/admin/visual-system/generate/route.ts, but
// invoked directly with the service-role key instead of over HTTP, since
// there's no logged-in admin browser session in this environment.
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const SCOPE = "visual_redesign_2026";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

function hashFor(value) {
  return createHash("sha256").update(value).digest("hex");
}

const PRICING = {
  "gemini-3.1-flash-lite-image": { input: 0.1, output: 0.4, image: { "1K": 0.02, "2K": 0.03, "4K": 0.06 } },
  "gemini-3.1-flash-image": { input: 0.3, output: 2.5, image: { "1K": 0.039, "2K": 0.06, "4K": 0.12 } },
  "gemini-3-pro-image": { input: 2, output: 12, image: { "1K": 0.24, "2K": 0.24, "4K": 0.48 } },
};

function estimateCost(model, resolution) {
  const p = PRICING[model];
  return p.image[resolution] + (2000 / 1e6) * p.input + (500 / 1e6) * p.output;
}

function finalCost(model, resolution, usage) {
  const p = PRICING[model];
  const inputCost = ((usage?.promptTokenCount ?? 0) / 1e6) * p.input;
  const outputCost = (((usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0)) / 1e6) * p.output;
  return Number((inputCost + outputCost + p.image[resolution]).toFixed(6));
}

async function generateImage({ prompt, model, aspectRatio }) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio } },
    }),
  });
  const raw = await response.text();
  const data = JSON.parse(raw);
  if (!response.ok) throw new Error(data.error?.message ?? `Gemini HTTP ${response.status}`);
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const imagePart = parts.find((p) => p.inlineData?.data);
  if (!imagePart) throw new Error(`Sin imagen (finishReason=${data.candidates?.[0]?.finishReason})`);
  return {
    bytes: Buffer.from(imagePart.inlineData.data, "base64"),
    mimeType: imagePart.inlineData.mimeType ?? "image/png",
    usageMetadata: data.usageMetadata ?? null,
  };
}

async function uploadToGcs(bytes, mimeType, pathPrefix) {
  // Node's @google-cloud/storage needs Application Default Credentials,
  // which aren't set up in this shell (only `gcloud auth login` is) -- use
  // the already-authenticated gcloud CLI instead, same workaround as the
  // earlier Supabase->GCS storage migration in this session.
  const { execFile } = await import("node:child_process");
  const { writeFile, unlink, mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);

  const bucketName = process.env.CLOUVA_GENERATED_MEDIA_BUCKET ?? "clouva-generated-media";
  const ext = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
  const objectPath = `${pathPrefix.replace(/\/+$/, "")}/${crypto.randomUUID()}.${ext}`;

  const dir = await mkdtemp(path.join(tmpdir(), "clouva-visual-"));
  const localPath = path.join(dir, `asset.${ext}`);
  await writeFile(localPath, bytes);
  try {
    // On Windows, `gcloud` is a .cmd shim -- execFile needs shell:true to
    // resolve it (plain execFile only spawns real executables directly).
    await execFileAsync("gcloud", [
      "storage", "cp", localPath, `gs://${bucketName}/${objectPath}`,
      "--content-type", mimeType,
    ], { shell: true });
  } finally {
    await unlink(localPath).catch(() => {});
  }
  return `https://storage.googleapis.com/${bucketName}/${objectPath}`;
}

async function runOne(entry) {
  const promptHash = hashFor(entry.prompt);
  const inputHash = hashFor(JSON.stringify({ references: [], aspectRatio: entry.aspectRatio }));
  const idempotencyKey = hashFor([entry.assetKey, promptHash, inputHash, entry.model, entry.resolution].join("::"));

  const { data: reusable } = await admin
    .from("ai_image_generation_jobs")
    .select("id, output_path")
    .eq("prompt_hash", promptHash).eq("input_hash", inputHash).eq("model", entry.model).eq("resolution", entry.resolution)
    .eq("status", "completed").not("output_path", "is", null).maybeSingle();
  if (reusable?.output_path) {
    console.log(`REUSED  ${entry.assetKey} -> ${reusable.output_path}`);
    return { assetKey: entry.assetKey, url: reusable.output_path, cost: 0 };
  }

  const estimatedCostUsd = estimateCost(entry.model, entry.resolution);
  const { data: reserveRows, error: reserveError } = await admin.rpc("reserve_ai_image_budget", {
    p_scope: SCOPE, p_estimated_cost_usd: estimatedCostUsd, p_use_reserve: false,
  });
  if (reserveError) throw new Error(`reserve rpc: ${reserveError.message}`);
  const reservation = Array.isArray(reserveRows) ? reserveRows[0] : reserveRows;
  if (!reservation.allowed) {
    console.error(`BLOCKED ${entry.assetKey}: ${reservation.reason}`);
    return { assetKey: entry.assetKey, blocked: reservation.reason };
  }

  const { data: job, error: jobError } = await admin.from("ai_image_generation_jobs").upsert({
    scope: SCOPE, purpose: entry.purpose, page: entry.page, asset_type: entry.section,
    prompt_hash: promptHash, input_hash: inputHash, idempotency_key: idempotencyKey,
    model: entry.model, resolution: entry.resolution, estimated_cost_usd: estimatedCostUsd, status: "generating",
  }, { onConflict: "idempotency_key" }).select("id").single();
  if (jobError) throw new Error(`job upsert: ${jobError.message}`);

  // Same two-stage split as the API route: a generateImage() failure means
  // Gemini never billed us (release, $0). Once it returns, Google already
  // charged for the call -- finalize that spend immediately, before the
  // upload step, so an upload failure can never masquerade as a free retry.
  let generated;
  try {
    generated = await generateImage({ prompt: entry.prompt, model: entry.model, aspectRatio: entry.aspectRatio });
  } catch (err) {
    await admin.rpc("release_ai_image_budget", { p_scope: SCOPE, p_estimated_cost_usd: estimatedCostUsd });
    await admin.from("ai_image_generation_jobs").update({ status: "failed", error_code: String(err).slice(0, 200) }).eq("id", job.id);
    console.error(`FAIL    ${entry.assetKey}: ${err}`);
    return { assetKey: entry.assetKey, error: String(err) };
  }

  const actualCostUsd = finalCost(entry.model, entry.resolution, generated.usageMetadata);
  await admin.rpc("finalize_ai_image_budget", { p_scope: SCOPE, p_estimated_cost_usd: estimatedCostUsd, p_actual_cost_usd: actualCostUsd });

  try {
    const url = await uploadToGcs(generated.bytes, generated.mimeType, `${entry.outputPathPrefix}/${entry.assetKey}`);
    await admin.from("ai_image_generation_jobs").update({
      status: "completed", actual_cost_usd: actualCostUsd, output_path: url, completed_at: new Date().toISOString(),
    }).eq("id", job.id);
    console.log(`OK      ${entry.assetKey} -> ${url}  ($${actualCostUsd.toFixed(4)})`);
    return { assetKey: entry.assetKey, url, cost: actualCostUsd };
  } catch (err) {
    await admin.from("ai_image_generation_jobs").update({ status: "failed", actual_cost_usd: actualCostUsd, error_code: String(err).slice(0, 200) }).eq("id", job.id);
    console.error(`FAIL (billed, not saved) ${entry.assetKey}: ${err}`);
    return { assetKey: entry.assetKey, error: String(err), cost: actualCostUsd };
  }
}

const { readFileSync } = await import("node:fs");
const manifestPath = process.argv[2];
const entries = JSON.parse(readFileSync(manifestPath, "utf8"));
const results = [];
for (const entry of entries) {
  results.push(await runOne(entry));
}
console.log("\n=== RESULTS ===");
console.log(JSON.stringify(results, null, 2));
