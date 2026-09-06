import assert from "node:assert/strict";
import test from "node:test";
import { parseUniversalQr, classifyParsedQr } from "./core/flows/qr/parse.ts";
import { formatFlowUnits, flowStringToUnits, parseDecimalToUnits, quoteLocalAmountToFlowUnits } from "./core/flows/money/units.ts";

const MP_EMV = "00020101021143540016com.mercadolibre0130https://mpago.la/pos/10368058550150011273265943055204970053030325802AR5906Prueba6004CABA6304FA22";

test("FLOW base units preserve exact decimal amounts", () => {
  assert.equal(flowStringToUnits("0.01"), 10_000n);
  assert.equal(flowStringToUnits("0.10"), 100_000n);
  assert.equal(flowStringToUnits("1"), 1_000_000n);
  assert.equal(flowStringToUnits("5.74"), 5_740_000n);
  assert.equal(formatFlowUnits(5_740_000n), "5.74");
  assert.throws(() => flowStringToUnits("0.0000001"), /precisión/i);
});

test("merchant quote uses integer math and rounds FLOW upward", () => {
  assert.equal(quoteLocalAmountToFlowUnits("8500.00", "1480.84"), 5_739_986n);
  assert.equal(formatFlowUnits(5_739_986n), "5.739986");
});

test("money parser rejects imprecise or malformed merchant amounts", () => {
  assert.equal(parseDecimalToUnits("8500.25", 2), 850_025n);
  assert.throws(() => parseDecimalToUnits("8500.251", 2), /precisión/i);
  assert.throws(() => parseDecimalToUnits("NaN", 2), /inválido/i);
});

test("official Mercado Pago EMV fixture parses merchant and ARS hints", () => {
  const parsed = parseUniversalQr(MP_EMV);
  assert.equal(parsed.valid, true);
  assert.equal(parsed.type, "mercadopago");
  assert.equal(parsed.providerHint, "mercadopago");
  assert.equal(parsed.currency, "ARS");
  assert.equal(parsed.country, "AR");
  assert.equal(parsed.merchant?.name, "Prueba");
  assert.equal(parsed.executable, false);
});

test("corrupted EMV CRC fails closed", () => {
  const parsed = parseUniversalQr(`${MP_EMV.slice(0, -1)}3`);
  assert.equal(parsed.valid, false);
  assert.equal(parsed.executable, false);
  assert.match(parsed.errors.join(" "), /CRC/i);
});

test("sandbox kiosk QR is payable only when sandbox is explicitly enabled", () => {
  const parsed = parseUniversalQr("CLOUVA-SANDBOX:KIOSK:KIOSCO_PEPE:ARS:8500.00");
  assert.equal(parsed.type, "sandbox_merchant");
  assert.equal(parsed.amount, "8500.00");
  assert.equal(classifyParsedQr(parsed, { sandboxEnabled: false }).capability, "NOT_AUTHORIZED");
  assert.equal(classifyParsedQr(parsed, { sandboxEnabled: true }).capability, "PAYABLE");
});

test("Mercado Pago links are detected but never marked executable by parsing alone", () => {
  const parsed = parseUniversalQr("https://mpago.la/pos/123456");
  assert.equal(parsed.type, "mercadopago");
  assert.equal(parsed.executable, false);
  assert.equal(classifyParsedQr(parsed, { mercadopagoResolverEnabled: false }).capability, "NOT_AUTHORIZED");
});

test("CLOUVA QR stays on the internal rail", () => {
  const parsed = parseUniversalQr("https://clouva.com.ar/q/example-token");
  assert.equal(parsed.type, "clouva");
  assert.equal(classifyParsedQr(parsed).capability, "RESOLVABLE");
});

test("plain 22-digit bank destination is detected conservatively", () => {
  const parsed = parseUniversalQr("0000003100098765432100");
  assert.equal(parsed.type, "bank_destination");
  assert.equal(classifyParsedQr(parsed).capability, "UNSUPPORTED");
});

test("http payment links are not trusted as executable URLs", () => {
  const parsed = parseUniversalQr("http://evil.example/pay");
  assert.equal(parsed.type, "unknown");
  assert.equal(parsed.executable, false);
});

test("oversized payload fails closed", () => {
  const parsed = parseUniversalQr("A".repeat(5000));
  assert.equal(parsed.valid, false);
  assert.equal(parsed.type, "unknown");
});
