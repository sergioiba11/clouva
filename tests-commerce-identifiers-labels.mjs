import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  parseCommerceLabelOptions,
  renderCommerceLabelPng,
  renderCommerceLabelsPdf,
  renderCommerceLabelSvg,
} from "./lib/server/commerce-labels.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const migration = read("./supabase/migrations/20260823060200_commerce_identifier_registry_labels.sql");
const codesRoute = read("./app/api/studios/[slug]/commerce/codes/route.ts");
const labelRoute = read("./app/api/studios/[slug]/commerce/labels/[identifierId]/route.ts");
const batchLabelRoute = read("./app/api/studios/[slug]/commerce/labels/route.ts");
const qrResolver = read("./app/q/[identifierId]/page.tsx");
const dashboard = read("./components/commerce/SpotCommerceDashboard.tsx");

const labelRecord = {
  productName: "Remera Vida de Flows",
  variantLabel: "Negra · M",
  sku: "IGL-VDF-BLK-M",
  price: 3000,
  currency: "ARS",
  barcode: { type: "code_128", value: "CLV123456789012345678" },
  qr: { value: "https://clouva.com.ar/q/random-public-token" },
};

test("identifiers persist in the canonical product registry with provenance and lifecycle", () => {
  assert.match(migration, /alter table public\.commerce_product_identifiers/);
  assert.match(migration, /origin in \('manufacturer', 'imported', 'manual', 'clouva_generated'\)/);
  assert.match(migration, /status in \('active', 'disabled', 'replaced'\)/);
  assert.match(migration, /replaces_identifier_id uuid references public\.commerce_product_identifiers/);
  assert.match(migration, /create table if not exists public\.commerce_product_identifier_events/);
  assert.match(migration, /commerce_product_identifier_events_immutable/);
  assert.doesNotMatch(migration, /commerce_(?:label|barcode|qr)_files/);
});

test("active commercial codes are globally unique and conflicts return their existing product", () => {
  assert.match(migration, /commerce_product_identifiers_active_code_unique[\s\S]*status = 'active'/);
  assert.match(migration, /'conflict', true[\s\S]*'product'/);
  assert.match(codesRoute, /status: 409/);
  assert.match(codesRoute, /El código ya pertenece a otro producto/);
});

test("CLOUVA QR uses an unpredictable public token and never exposes the internal id", () => {
  assert.match(codesRoute, /randomBytes\(24\)\.toString\("base64url"\)/);
  assert.match(codesRoute, /buildClouvaQrUrl\(siteUrl, token!/);
  assert.match(migration, /public_token text/);
  assert.match(migration, /commerce_product_identifiers_public_token_unique/);
  assert.match(qrResolver, /\.eq\("public_token", publicToken\)/);
  assert.match(qrResolver, /\.eq\("status", "active"\)/);
  assert.match(qrResolver, /destination_path\?\.startsWith\("\/"\)/);
});

test("variant generation is idempotent and preserves active identifiers", () => {
  assert.match(codesRoute, /generate_all_variants/);
  assert.match(codesRoute, /status: "kept"/);
  assert.match(codesRoute, /\["sku", "code_128", "clouva_qr"\]/);
  assert.match(codesRoute, /catalog_variant_id === \(variant\?\.catalog_variant_id \?\? null\)/);
  assert.match(dashboard, /Generar identificadores para todas las variantes/);
  assert.match(dashboard, /Los códigos activos se conservaron/);
});

test("scanner, product detail and Codes share the same identifier services", () => {
  assert.match(dashboard, /Identificación y etiquetas/);
  assert.match(dashboard, /ESCANEAR/);
  assert.match(dashboard, /CREAR CÓDIGO/);
  assert.match(dashboard, /ETIQUETAS/);
  assert.match(dashboard, /HISTORIAL/);
  assert.match(dashboard, /Crear producto con este código/);
  assert.match(dashboard, /Abrir producto/);
  assert.match(dashboard, /Imprimir etiqueta/);
  assert.match(codesRoute, /create_commerce_product_identifier/);
});

test("single and batch label endpoints derive files from canonical identifiers", () => {
  assert.match(labelRoute, /loadCommerceLabelForIdentifier/);
  assert.match(labelRoute, /renderCommerceLabelPng/);
  assert.match(labelRoute, /renderCommerceLabelsPdf/);
  assert.match(batchLabelRoute, /loadCommerceLabelsForListing/);
  assert.match(batchLabelRoute, /Usá PDF para imprimir varias variantes juntas/);
  assert.match(batchLabelRoute, /page: options\.page/);
});

test("SVG, PNG and PDF render at every initial physical label size", async () => {
  for (const size of ["30x20", "40x30", "50x30"]) {
    const options = { format: "svg", layout: "full", page: "label", size, copies: 1, marginMm: 8, showPrice: true, showSku: true, showQr: true };
    const svg = await renderCommerceLabelSvg(labelRecord, options);
    const png = await renderCommerceLabelPng(svg);
    const pdf = await renderCommerceLabelsPdf([svg], { ...options, format: "pdf" });
    const [width, height] = size.split("x");
    assert.match(svg, new RegExp(`width="${width}mm" height="${height}mm"`));
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(pdf.subarray(0, 8).toString(), "%PDF-1.4");
  }
});

test("A4 uses real points, automatic grid and multiple copies", async () => {
  const options = { format: "pdf", layout: "combined", page: "a4", size: "40x30", copies: 20, marginMm: 8, showPrice: false, showSku: true, showQr: true };
  const svg = await renderCommerceLabelSvg(labelRecord, options);
  const pdf = await renderCommerceLabelsPdf([svg], options);
  assert.ok(pdf.includes(Buffer.from("/MediaBox [0 0 595.276 841.890]")));
  assert.ok(pdf.includes(Buffer.from("/Count 1")));
  assert.ok(pdf.length > 50_000);
});

test("label options enforce safe supported formats, sizes and copy bounds", () => {
  const options = parseCommerceLabelOptions(new URLSearchParams("format=exe&layout=bad&page=a4&size=99x99&copies=999&marginMm=-2"));
  assert.deepEqual(options, { format: "svg", layout: "full", page: "a4", size: "40x30", copies: 200, marginMm: 0, showPrice: true, showSku: true, showQr: true });
});
