export const FLOW_UNITS_PER_FLOW = 1_000_000n;
export const FLOW_UNIT_DECIMALS = 6;

const DECIMAL_RE = /^([+-]?)(\d+)(?:\.(\d+))?$/;

export function parseDecimalToUnits(value: string | number, decimals: number, mode: "exact" | "ceil" = "exact") {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 12) throw new Error("Precisión decimal inválida.");
  const text = typeof value === "number" ? String(value) : value.trim();
  const match = text.match(DECIMAL_RE);
  if (!match) throw new Error("Monto decimal inválido.");
  const negative = match[1] === "-";
  const whole = BigInt(match[2]);
  const fraction = match[3] ?? "";
  const scale = 10n ** BigInt(decimals);
  const kept = fraction.slice(0, decimals).padEnd(decimals, "0");
  const discarded = fraction.slice(decimals);
  let units = whole * scale + BigInt(kept || "0");
  if (mode === "ceil" && !negative && /[1-9]/.test(discarded)) units += 1n;
  if (mode === "exact" && /[1-9]/.test(discarded)) throw new Error("El monto supera la precisión permitida.");
  return negative ? -units : units;
}

export function formatUnits(units: bigint | string, decimals: number, trim = true) {
  const value = typeof units === "bigint" ? units : BigInt(units);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const scale = 10n ** BigInt(decimals);
  const whole = absolute / scale;
  const fraction = (absolute % scale).toString().padStart(decimals, "0");
  const normalizedFraction = trim ? fraction.replace(/0+$/, "") : fraction;
  return `${negative ? "-" : ""}${whole}${normalizedFraction ? `.${normalizedFraction}` : ""}`;
}

export function formatFlowUnits(units: bigint | string) {
  return formatUnits(units, FLOW_UNIT_DECIMALS);
}

export function flowStringToUnits(value: string | number, mode: "exact" | "ceil" = "exact") {
  return parseDecimalToUnits(value, FLOW_UNIT_DECIMALS, mode);
}

/**
 * Divide two positive decimal strings and return FLOW base units, rounded UP.
 * Used for merchantAmount / localPerUsd when 1 FLOW = USD 1 reference.
 */
export function quoteLocalAmountToFlowUnits(localAmount: string, localPerUsd: string) {
  const amountMicros = parseDecimalToUnits(localAmount, 6, "ceil");
  const rateMicros = parseDecimalToUnits(localPerUsd, 6, "ceil");
  if (amountMicros <= 0n || rateMicros <= 0n) throw new Error("Monto o cotización inválidos.");
  const numerator = amountMicros * FLOW_UNITS_PER_FLOW;
  return (numerator + rateMicros - 1n) / rateMicros;
}

export function flowUnitsToReferenceUsd(units: bigint) {
  if (units < 0n) throw new Error("Las unidades FLOW no pueden ser negativas.");
  return formatFlowUnits(units);
}
