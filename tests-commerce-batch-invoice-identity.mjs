import assert from "node:assert/strict";
import test from "node:test";
import {
  bestInvoiceAnchor,
  compatibleInvoiceLine,
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
