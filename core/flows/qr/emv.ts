const MAX_EMV_LENGTH = 4096;

export type EmvField = { id: string; value: string };

function crc16CcittFalse(input: string) {
  let crc = 0xffff;
  for (let index = 0; index < input.length; index += 1) {
    crc ^= input.charCodeAt(index) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

export function parseEmvFields(raw: string) {
  if (!raw || raw.length > MAX_EMV_LENGTH) throw new Error("QR EMV vacío o demasiado largo.");
  const fields: EmvField[] = [];
  let cursor = 0;
  while (cursor < raw.length) {
    if (cursor + 4 > raw.length) throw new Error("QR EMV truncado.");
    const id = raw.slice(cursor, cursor + 2);
    const lengthText = raw.slice(cursor + 2, cursor + 4);
    if (!/^\d{2}$/.test(id) || !/^\d{2}$/.test(lengthText)) throw new Error("QR EMV con tag o longitud inválidos.");
    const length = Number(lengthText);
    const start = cursor + 4;
    const end = start + length;
    if (end > raw.length) throw new Error("QR EMV con longitud fuera de rango.");
    fields.push({ id, value: raw.slice(start, end) });
    cursor = end;
  }
  return fields;
}

export function validateEmvCrc(raw: string, fields: EmvField[]) {
  const crcField = fields.find((field) => field.id === "63");
  if (!crcField) return { present: false, valid: true };
  if (!/^[0-9A-Fa-f]{4}$/.test(crcField.value)) return { present: true, valid: false };
  const crcOffset = raw.lastIndexOf("6304");
  if (crcOffset < 0 || crcOffset + 8 !== raw.length) return { present: true, valid: false };
  return { present: true, valid: crc16CcittFalse(raw.slice(0, crcOffset + 4)) === crcField.value.toUpperCase() };
}

function fieldMap(fields: EmvField[]) {
  return Object.fromEntries(fields.map((field) => [field.id, field.value]));
}

function merchantAccountText(fields: EmvField[]) {
  return fields
    .filter((field) => Number(field.id) >= 26 && Number(field.id) <= 51)
    .map((field) => field.value)
    .join(" ");
}

export function parseEmvMerchantQr(raw: string) {
  const fields = parseEmvFields(raw);
  const map = fieldMap(fields);
  if (map["00"] !== "01") throw new Error("El payload no declara formato EMV QR 01.");
  const crc = validateEmvCrc(raw, fields);
  if (!crc.valid) throw new Error("CRC del QR EMV inválido.");

  const merchantAccounts = merchantAccountText(fields);
  const lower = merchantAccounts.toLowerCase();
  const providerHint = lower.includes("mercadolibre") || lower.includes("mercadopago") || lower.includes("mpago")
    ? "mercadopago"
    : lower.includes("coelsa")
      ? "coelsa"
      : null;

  return {
    fields,
    map,
    crc,
    merchantAccountText: merchantAccounts,
    providerHint,
    country: map["58"] || null,
    merchantName: map["59"] || null,
    merchantCity: map["60"] || null,
    mcc: map["52"] || null,
    currencyNumeric: map["53"] || null,
    amount: map["54"] || null,
    dynamic: map["01"] === "12",
  };
}

export function emvCurrencyCodeToIso(value: string | null | undefined) {
  if (!value) return null;
  if (value === "032") return "ARS";
  if (value === "152") return "CLP";
  if (value === "840") return "USD";
  return null;
}
