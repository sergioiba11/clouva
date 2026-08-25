import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const migration = read("./supabase/migrations/20260823212921_clouva_qr_registry_users.sql");
const spaceMigration = read("./supabase/migrations/20260825014451_space_qr_registry.sql");
const qrService = read("./lib/server/clouva-qr.ts");
const resolver = read("./app/q/[identifierId]/page.tsx");
const selfApi = read("./app/api/clouva-qr/route.ts");
const spaceQrApi = read("./app/api/spaces/[spaceId]/qr/route.ts");
const userQrApi = read("./app/api/studios/[slug]/commerce/user-qr/route.ts");
const userSearchApi = read("./app/api/studios/[slug]/commerce/users/route.ts");
const scanRoute = read("./app/api/studios/[slug]/commerce/scan/route.ts");
const panel = read("./components/commerce/ClouvaQrEnginePanel.tsx");
const spacePanel = read("./components/commerce/SpaceQrPanel.tsx");
const account = read("./components/account/AccountMenu.tsx");
const myQr = read("./components/account/MyQrCard.tsx");

test("canonical registry supports product, variant, physical item, user and Space QR identities", () => {
  assert.match(migration, /create table if not exists public\.clouva_qr_registry/);
  for (const type of ["PRODUCT", "VARIANT", "ITEM", "USER"]) assert.match(migration, new RegExp(`'${type}'`));
  assert.match(spaceMigration, /'SPACE'/);
  assert.match(migration, /clouva_qr_registry_public_token_unique/);
  assert.match(migration, /clouva_qr_registry_active_canonical_entity_unique/);
  assert.match(migration, /where status = 'ACTIVE' and is_canonical/);
});

test("existing product QR identifiers are preserved and synchronized into the shared resolver", () => {
  assert.match(migration, /from public\.commerce_product_identifiers identifier/);
  assert.match(migration, /source_identifier_id/);
  assert.match(migration, /sync_commerce_qr_to_clouva_registry/);
  assert.match(migration, /identifier\.identifier_type = 'clouva_qr'/);
  assert.doesNotMatch(migration, /delete from public\.commerce_product_identifiers/);
});

test("user/item/Space allocator is idempotent and concurrency safe", () => {
  assert.match(migration, /get_or_create_clouva_qr/);
  assert.match(spaceMigration, /p_entity_type not in \('USER', 'ITEM', 'SPACE'\)/);
  assert.match(spaceMigration, /pg_advisory_xact_lock/);
  assert.match(spaceMigration, /entity_type = p_entity_type[\s\S]*entity_id = p_entity_id[\s\S]*status = 'ACTIVE'[\s\S]*is_canonical/);
  assert.match(spaceMigration, /exception when unique_violation/);
  assert.match(spaceMigration, /destination_path = p_destination_path/);
  assert.match(spaceMigration, /grant execute on function public\.get_or_create_clouva_qr[\s\S]*to service_role/);
  assert.match(qrService, /getOrCreateClouvaQr/);
  assert.match(qrService, /"SPACE"/);
});

test("public resolver routes USER and SPACE QR while keeping product legacy compatibility", () => {
  assert.match(resolver, /from\("clouva_qr_registry"\)/);
  assert.match(resolver, /registry\?\.entity_type === "USER"/);
  assert.match(resolver, /registry\?\.entity_type === "SPACE"/);
  assert.match(resolver, /from\("players"\)/);
  assert.match(resolver, /\.eq\("owner_user_id", registry\.entity_id\)/);
  assert.match(resolver, /public_slug_aliases/);
  assert.match(resolver, /\/spaces\//);
  assert.match(resolver, /commerce_product_identifiers/);
  assert.ok(resolver.includes('/^[0-9a-f-]{36}$/i'));
});

test("each authenticated account can get its permanent QR and export PNG/SVG", () => {
  assert.match(selfApi, /entityType: "USER"/);
  assert.match(selfApi, /owner_user_id/);
  assert.match(myQr, /QRCode\.toDataURL/);
  assert.match(myQr, /QRCode\.toString/);
  assert.match(myQr, /Compartir/);
  assert.match(myQr, /clouva-qr-.*\.png/);
  assert.match(account, /href="\/mi-qr"/);
});

test("each administered Space gets one permanent QR with view/copy/download/print actions", () => {
  assert.match(spaceQrApi, /requireSpaceAdminPlan/);
  assert.match(spaceQrApi, /entityType: "SPACE"/);
  assert.match(spaceQrApi, /QRCode\.toDataURL/);
  assert.match(spaceQrApi, /\/studios\//);
  assert.match(spaceQrApi, /\/spaces\//);
  assert.match(spacePanel, /Copiar enlace/);
  assert.match(spacePanel, /Descargar QR/);
  assert.match(spacePanel, /Imprimir QR/);
});

test("MI SPOT QR engine creates garment QR labels and user QR without duplicating active codes", () => {
  assert.match(panel, /Prenda \/ producto/);
  assert.match(panel, /Usuario/);
  assert.match(panel, /identifierTypes: \["clouva_qr"\]/);
  assert.match(panel, /generate_all_variants/);
  assert.match(panel, /QR existentes reutilizados/);
  assert.match(panel, /commerce\/labels/);
  assert.match(panel, /Etiqueta PDF/);
  assert.match(panel, /Imprimir etiqueta 40 × 30 mm/);
  assert.match(userSearchApi, /requireManagedSpot/);
  assert.match(userQrApi, /getOrCreateClouvaQr/);
  assert.match(userQrApi, /entityType: "USER"/);
});

test("the existing commerce scanner recognizes the shared CLOUVA QR resolver", () => {
  assert.match(scanRoute, /function clouvaQrToken/);
  assert.match(scanRoute, /from\("clouva_qr_registry"\)/);
  assert.match(scanRoute, /registry\?\.entity_type === "USER"/);
  assert.match(scanRoute, /registry\?\.entity_type === "ITEM"/);
  assert.match(scanRoute, /registry\?\.entity_type === "PRODUCT"/);
  assert.match(scanRoute, /registry\?\.entity_type === "VARIANT"/);
  assert.match(scanRoute, /public_url/);
  assert.doesNotMatch(scanRoute, /email/);
});

test("QR values encode only the stable public resolver token", () => {
  assert.match(qrService, /\/q\/\$\{encodeURIComponent\(publicToken\)\}/);
  assert.doesNotMatch(qrService, /\/q\/\$\{.*entityId/);
  assert.match(spaceMigration, /replace\(gen_random_uuid\(\)::text, '-', ''\) \|\| replace\(gen_random_uuid\(\)::text, '-', ''\)/);
});
