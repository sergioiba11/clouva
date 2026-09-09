import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

const migration = read("./supabase/migrations/20260908232945_commerce_creator_product_concepts.sql");
const server = read("./lib/creator-commerce/server.ts");
const projectStatus = read("./lib/creator-commerce/project-status.ts");
const conceptCollection = read("./app/api/creator-commerce/projects/[id]/concepts/route.ts");
const conceptItem = read("./app/api/creator-commerce/projects/[id]/concepts/[conceptId]/route.ts");
const conceptPrepare = read("./app/api/creator-commerce/projects/[id]/concepts/[conceptId]/prepare-product/route.ts");
const identity = read("./app/api/creator-commerce/projects/[id]/generate-identity/route.ts");
const listingCopy = read("./app/api/creator-commerce/projects/[id]/concepts/[conceptId]/listing-copy/route.ts");
const campaign = read("./app/api/creator-commerce/projects/[id]/campaign/route.ts");
const projectAssets = read("./app/api/creator-commerce/project-assets/route.ts");
const merchClient = read("./app/crear/merch/MerchCreatorClient.tsx");
const productImages = read("./app/api/creator-commerce/product-images/route.ts");
const bridge = read("./app/mi-flow/crear-prenda/CreatorProjectBridge.tsx");
const projectCreate = read("./app/api/creator-commerce/projects/route.ts");
const projectPatch = read("./app/api/creator-commerce/projects/[id]/route.ts");

test("creator project owns many product concepts while concepts own one canonical commerce product", () => {
  assert.match(migration, /create table if not exists public\.commerce_creator_product_concepts/);
  assert.match(migration, /project_id uuid not null references public\.commerce_creator_projects/);
  assert.match(migration, /drop index if exists public\.commerce_products_creator_project_unique/);
  assert.match(migration, /create index if not exists commerce_products_creator_project_idx/);
  assert.match(migration, /create unique index if not exists commerce_products_creator_concept_unique/);
  assert.match(migration, /on public\.commerce_products\(creator_concept_id\)/);
});

test("legacy single-product creator projects are backfilled instead of discarded", () => {
  assert.match(migration, /p\.commerce_product_id is not null/);
  assert.match(migration, /'primary'/);
  assert.match(migration, /backfilled_from_project/);
  assert.match(migration, /set creator_concept_id = c\.id/);
});

test("product concepts keep creative, commerce and production state separate", () => {
  assert.match(migration, /creative_config jsonb/);
  assert.match(migration, /design_overrides jsonb/);
  assert.match(migration, /reference_assets jsonb/);
  assert.match(migration, /generated_assets jsonb/);
  assert.match(migration, /approved_assets jsonb/);
  assert.match(migration, /commerce_draft jsonb/);
  assert.match(migration, /variants_draft jsonb/);
  assert.match(migration, /listing_copy jsonb/);
  assert.match(migration, /production_status text/);
  assert.match(migration, /production_data jsonb/);
});

test("product concept RLS is enabled and scoped to the owning creator project", () => {
  assert.match(migration, /alter table public\.commerce_creator_product_concepts enable row level security/);
  for (const command of ["select", "insert", "update", "delete"]) {
    assert.match(migration, new RegExp(`commerce_creator_concepts_${command}_own`));
  }
  assert.match(migration, /p\.id = project_id and p\.user_id = \(select auth\.uid\(\)\)/);
});

test("adding products to a drop creates concepts only, never parallel commerce products", () => {
  assert.match(conceptCollection, /from\("commerce_creator_product_concepts"\)/);
  assert.doesNotMatch(conceptCollection, /from\("commerce_products"\)\.insert/);
  assert.match(merchClient, /Todavía son conceptos creativos, no Commerce/);
});

test("preparing a concept is idempotent at the concept boundary", () => {
  assert.match(server, /eq\("creator_concept_id", concept\.id\)/);
  assert.match(server, /creator_concept_id: concept\.id/);
  assert.match(server, /const concurrent = await supabase[\s\S]*eq\("creator_concept_id", concept\.id\)/);
  assert.match(conceptPrepare, /prepareCreatorConceptProduct/);
  assert.match(conceptPrepare, /status !== "approved"/);
});

test("creator variants stay in canonical commerce variants and carry concept lineage", () => {
  assert.match(server, /from\("commerce_product_variants"\)/);
  assert.match(server, /creatorScopedSku/);
  assert.match(merchClient, /creator_concept_id: concept\.id/);
  assert.doesNotMatch(server, /merch_inventory|creator_inventory/);
});

test("drop generation is per concept so one failure does not collapse the collection", () => {
  assert.match(merchClient, /for \(const concept of concepts\)/);
  assert.match(merchClient, /generateConcept\(concept, true\)/);
  assert.match(merchClient, /status: "failed"/);
  assert.match(merchClient, /Reintentar generación/);
});

test("Gemini generations inherit project identity and concept-specific overrides", () => {
  assert.match(productImages, /design_system,reference_assets/);
  assert.match(productImages, /product_template,design_overrides/);
  assert.match(productImages, /DESIGN SYSTEM DEL DROP \(heredado\)/);
  assert.match(productImages, /OVERRIDES DE ESTE PRODUCTO/);
  assert.match(productImages, /MODO DISEÑO EXACTO/);
  assert.match(productImages, /preservá estrictamente el artwork master/);
});

test("artwork master and product references share the existing project asset pipeline", () => {
  assert.match(projectAssets, /"artwork_master"/);
  assert.match(projectAssets, /"product_reference"/);
  assert.match(projectAssets, /"inspiration_reference"/);
  assert.match(projectAssets, /uploadGeneratedMediaObject/);
  assert.match(merchClient, /Artwork Master/);
  assert.match(merchClient, /Product Reference opcional/);
});

test("identity generation is a proposal and requires an explicit save", () => {
  assert.match(identity, /persisted: false/);
  assert.match(merchClient, /Propuesta IA — todavía no guardada/);
  assert.match(merchClient, /Aplicar al editor/);
  assert.match(merchClient, /Guardar identidad/);
  assert.match(merchClient, /design_system: design/);
});

test("listing copy stays draft until the user explicitly approves it", () => {
  assert.match(listingCopy, /status: "draft"/);
  assert.match(merchClient, /Aprobar copy/);
  assert.match(merchClient, /status: approveCopy \? "approved" : "draft"/);
  assert.match(merchClient, /const useApprovedCopy = listing\.status === "approved"/);
});

test("bulk prepare and publish use independent user selections", () => {
  assert.match(merchClient, /prepareSelection/);
  assert.match(merchClient, /publishSelection/);
  assert.match(merchClient, /prepareSelection\.has\(concept\.id\)/);
  assert.match(merchClient, /publishSelection\.has\(concept\.id\)/);
  assert.match(merchClient, /Preparar seleccionados/);
  assert.match(merchClient, /Publicar seleccionados/);
});

test("campaign assets are project-level, retryable by kind and persist partial success", () => {
  assert.match(campaign, /collection_cover/);
  assert.match(campaign, /campaign_group/);
  assert.match(campaign, /campaign_story/);
  assert.match(campaign, /campaign_social_square/);
  assert.match(campaign, /target\?: unknown/);
  assert.match(campaign, /failures\.push/);
  assert.match(campaign, /generated_assets: currentAssets/);
  assert.match(merchClient, /Regenerar sólo este/);
});

test("creator project status is derived from creative concepts, not commerce status", () => {
  assert.match(projectStatus, /deriveCreatorProjectStatus/);
  assert.match(projectStatus, /status === "generating" \|\| status === "pending"/);
  assert.match(projectStatus, /status === "commerce_ready" \|\| status === "published"/);
  assert.match(projectStatus, /status === "review" \|\| status === "failed"/);
  assert.match(conceptCollection, /syncCreatorProjectStatus/);
  assert.match(conceptItem, /syncCreatorProjectStatus/);
  assert.match(conceptPrepare, /syncCreatorProjectStatus/);
});

test("publishing a creator product reuses canonical commerce publications", () => {
  assert.match(merchClient, /\/api\/commerce\/products\/\$\{product\.id\}\/publications/);
  assert.match(merchClient, /channel: "clouva_market"/);
  assert.match(merchClient, /creator_project_id: active\.id, creator_concept_id: concept\.id/);
  assert.doesNotMatch(merchClient, /merch_publications|creator_publications/);
});

test("garment flow returns the finalized GLB to the exact product concept", () => {
  assert.match(bridge, /creatorConceptId/);
  assert.match(bridge, /\/api\/clothing\/finalize/);
  assert.match(bridge, /clothingItemId/);
  assert.match(bridge, /project: projectId, concept: conceptId/);
  assert.match(merchClient, /creatorConceptId=\$\{encodeURIComponent\(concept\.id\)\}/);
  assert.match(merchClient, /clothing_item_id: clothingItemId/);
});

test("non-garment custom concepts do not require Garment Flow", () => {
  assert.match(merchClient, /key: "custom"/);
  assert.match(merchClient, /GARMENT_TEMPLATES\.has\(concept\.product_template\)/);
});

test("seller context is revalidated on the server for project creation and edits", () => {
  assert.match(projectCreate, /assertCreatorSellerAccess/);
  assert.match(projectPatch, /assertCreatorSellerAccess/);
  assert.match(server, /No tenés permiso para vender como ese Player/);
  assert.match(server, /No tenés permiso para vender como ese Studio/);
  assert.match(server, /No tenés permiso para usar ese Business \/ Spot/);
});
