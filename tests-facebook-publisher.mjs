import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

test("facebook publisher keeps commerce_products canonical and adds durable queue tables", () => {
  const sql = read("./supabase/migrations/20260920123500_facebook_publication_batches.sql");
  assert.match(sql, /create table if not exists public\.publication_batches/i);
  assert.match(sql, /create table if not exists public\.publication_jobs/i);
  assert.match(sql, /create table if not exists public\.facebook_destinations/i);
  assert.match(sql, /create table if not exists public\.publication_variants/i);
  assert.match(sql, /publication_jobs_owner_select/i);
  assert.match(sql, /supabase_realtime add table public\.publication_jobs/i);
  assert.doesNotMatch(sql, /create table[^;]+commerce_products/i);
});

test("marketplace and groups stop at explicit user confirmation", () => {
  const service = read("./lib/server/facebook-publisher.ts");
  assert.match(service, /destinationType === "marketplace" \|\| destinationType === "group"/);
  assert.match(service, /status: "waiting_confirmation"/);
  assert.match(service, /USER_CONFIRMATION_REQUIRED/);
  assert.match(service, /confirmFacebookPublicationJob/);
  assert.match(service, /status: "published"/);
});

test("page publishing is isolated to the official Graph API path", () => {
  const capabilities = read("./lib/commerce/channel-capabilities.ts");
  const client = read("./core/integrations/facebook/client.ts");
  const config = read("./core/integrations/facebook/config.ts");
  assert.match(capabilities, /facebook_page/);
  assert.match(capabilities, /canPublishAutomatically: true/);
  assert.match(client, /graph\.facebook\.com/);
  assert.match(client, /attached_media/);
  assert.match(config, /pages_manage_posts/);
});

test("publish all UI and durable Cloud Tasks runner are wired", () => {
  const page = read("./app/mi-spot/publicador/page.tsx");
  const tasks = read("./lib/server/cloud-tasks.ts");
  const worker = read("./app/api/internal/facebook-publisher/process/route.ts");
  assert.match(page, /PUBLICAR TODO/);
  assert.match(page, /Reintentar fallidos/);
  assert.match(page, /Facebook requiere tu intervención/);
  assert.match(tasks, /clouva-facebook-publisher/);
  assert.match(worker, /processFacebookPublicationBatch/);
});
