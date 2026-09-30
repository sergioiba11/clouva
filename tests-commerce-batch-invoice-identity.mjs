import assert from "node:assert/strict";
import test from "node:test";
import {
  bestInvoiceAnchor,
  compatibleInvoiceLine,
  compatibleProductView,
  mergeClusterGroups,
  physicalProductName,
} from "./lib/server/commerce-product-batch-recognition.ts";

const group = (name, model) => ({ name, model, brand: "SONY" });
const invoice = [
  { description: "PS4", quantity: 4 },
  { description: "Cable PS4", quantity: 2 },
];

test("a PS4 cable cannot consume the joystick invoice line", () => {
  const cable = group("PS4", "Cable USB Fast Charge");
  assert.equal(compatibleInvoiceLine(cable, invoice[0]), false);
  assert.equal(compatibleInvoiceLine(cable, invoice[1]), true);
  assert.equal(bestInvoiceAnchor(cable, invoice).invoiceIndex, 2);
  assert.equal(physicalProductName(cable), "Cable USB Fast Charge para PS4");
});

test("a controller remains distinct from the cable line", () => {
  const controller = group("Wireless Controller", "DualShock 4");
  assert.equal(compatibleInvoiceLine(controller, invoice[1]), false);
  assert.equal(physicalProductName(controller), "Wireless Controller");
});

test("a cable photo cannot be attached as the controller's back", () => {
  const controller = { ...group("Wireless Controller", "DualShock 4"), identifier: { type: "upc_a", value: "711719870258" } };
  assert.equal(compatibleProductView(controller, ["Apple USB-C Charge Cable"], []), false);
  assert.equal(compatibleProductView(controller, ["Wireless Controller DualShock 4"], [
    { name: "", model: "", identifier: { type: "upc_a", value: "190198914507" } },
  ]), false);
  assert.equal(compatibleProductView(controller, ["PS4 Wireless Controller"], []), true);
});

test("the same barcode remains recorded on every photographed box", () => {
  const photos = [48, 49, 50, 51].map((sourceIndex) => ({
    groupKey: `controller-${sourceIndex}`, name: "Wireless Controller", brand: "PlayStation", model: "DualShock 4",
    packageKind: "retail_package", unitCount: 1, confidence: 1, needsReview: false,
    identifier: { type: "upc_a", value: "711719870258" },
    visibleIdentifiers: [{ type: "upc_a", value: "711719870258", source: "box", confidence: 1, sourceIndex }],
    images: [{ sourceIndex, role: "Detalle" }],
  }));
  const merged = mergeClusterGroups(photos, 4, 1, false);
  assert.deepEqual(merged.visibleIdentifiers.map((code) => code.sourceIndex).sort(), [48, 49, 50, 51]);
  assert.equal(merged.unitCount, 4);
});
