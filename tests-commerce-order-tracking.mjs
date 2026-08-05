import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

const checkout = read("./app/api/commerce/checkout/route.ts");
const orderApi = read("./app/api/commerce/orders/[id]/route.ts");
const orderPage = read("./app/pedido/[id]/page.tsx");

test("commerce checkout returns to the protected canonical order page", () => {
  assert.match(checkout, /source=commerce&token=/);
  assert.match(checkout, /success: `\$\{orderUrl\}&return=success`/);
  assert.match(checkout, /failure: `\$\{orderUrl\}&return=failure`/);
  assert.match(checkout, /pending: `\$\{orderUrl\}&return=pending`/);
});

test("canonical order API accepts only the checkout token or the real buyer", () => {
  assert.match(orderApi, /checkoutToken === order\.checkout_token/);
  assert.match(orderApi, /admin\.auth\.getUser\(accessToken\)/);
  assert.match(orderApi, /authData\.user\?\.id === order\.buyer_id/);
  assert.match(orderApi, /No tenés acceso a este pedido/);
  assert.match(orderApi, /from\("commerce_order_items"\)/);
  assert.match(orderApi, /from\("commerce_shipments"\)/);
  assert.match(orderApi, /from\("commerce_order_events"\)/);
  assert.doesNotMatch(orderApi, /checkout_token:\s*order\.checkout_token/);
  assert.doesNotMatch(orderApi, /buyer_id:\s*order\.buyer_id/);
});

test("one order screen preserves legacy links and recognizes commerce orders", () => {
  assert.match(orderPage, /search\.get\("source"\) === "commerce"/);
  assert.match(orderPage, /\/api\/commerce\/orders\//);
  assert.match(orderPage, /\/api\/orders\//);
  assert.match(orderPage, /CommerceOrderView/);
  assert.match(orderPage, /LegacyOrderView/);
});

test("canonical order tracking shows products variants shipment and events", () => {
  assert.match(orderPage, /variantDescription\(item\)/);
  assert.match(orderPage, /item\.sku_snapshot/);
  assert.match(orderPage, /shipment\.tracking_number/);
  assert.match(orderPage, /shipment\.tracking_url/);
  assert.match(orderPage, /shipment\.address_line_1/);
  assert.match(orderPage, /events\.map/);
  assert.match(orderPage, /fulfillmentCopy\(order\.fulfillment_status\)/);
  assert.match(orderPage, /stock_conflict/);
});
