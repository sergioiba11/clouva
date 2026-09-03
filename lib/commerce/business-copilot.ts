export const BUSINESS_REQUEST_TYPES = [
  "sourcing",
  "procurement",
  "listing",
  "logistics",
  "operations",
  "vehicle",
] as const;

export type BusinessRequestType = (typeof BUSINESS_REQUEST_TYPES)[number];

export type BusinessIntent = {
  objective: string;
  item: string;
  category: string;
  descriptors: string[];
  visibleText: string[];
  quantity: number | null;
  targetPrice: string | null;
  destination: string | null;
  constraints: string[];
  unknowns: string[];
  searchQueries: string[];
};

export type BusinessPlanStep = {
  key: string;
  label: string;
  detail: string;
  status: "ready" | "needs_input" | "later";
};

export type StructuredBusinessCandidate = {
  supplierName: string | null;
  offerTitle: string;
  sourceIndex: number | null;
  priceAmount: number | null;
  currency: string | null;
  moq: number | null;
  shippingSummary: string | null;
  matchReason: string;
  risks: string[];
};

const REQUEST_TYPE_SET = new Set<string>(BUSINESS_REQUEST_TYPES);

function stringValue(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function stringArray(value: unknown, maxItems = 12, maxLength = 160) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => stringValue(item, maxLength)).filter(Boolean))).slice(0, maxItems);
}

function nullableNumber(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function nullableInt(value: unknown) {
  const number = nullableNumber(value);
  return number === null ? null : Math.round(number);
}

export function normalizeBusinessRequestType(value: unknown): BusinessRequestType {
  return typeof value === "string" && REQUEST_TYPE_SET.has(value) ? value as BusinessRequestType : "sourcing";
}

export function extractJsonValue(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1]?.trim();
  const source = fenced || trimmed;
  try {
    return JSON.parse(source);
  } catch {
    const objectStart = source.indexOf("{");
    const objectEnd = source.lastIndexOf("}");
    const arrayStart = source.indexOf("[");
    const arrayEnd = source.lastIndexOf("]");
    const objectCandidate = objectStart >= 0 && objectEnd > objectStart ? source.slice(objectStart, objectEnd + 1) : "";
    const arrayCandidate = arrayStart >= 0 && arrayEnd > arrayStart ? source.slice(arrayStart, arrayEnd + 1) : "";
    for (const candidate of [objectCandidate, arrayCandidate]) {
      if (!candidate) continue;
      try { return JSON.parse(candidate); } catch { /* keep trying */ }
    }
  }
  return null;
}

export function sanitizeBusinessAnalysis(value: unknown): {
  title: string;
  intent: BusinessIntent;
  plan: BusinessPlanStep[];
} {
  const root = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const rawIntent = root.intent && typeof root.intent === "object" && !Array.isArray(root.intent)
    ? root.intent as Record<string, unknown>
    : {};
  const rawPlan = Array.isArray(root.plan) ? root.plan : [];

  const intent: BusinessIntent = {
    objective: stringValue(rawIntent.objective, 500),
    item: stringValue(rawIntent.item, 240),
    category: stringValue(rawIntent.category, 120),
    descriptors: stringArray(rawIntent.descriptors, 16, 120),
    visibleText: stringArray(rawIntent.visibleText, 12, 100),
    quantity: nullableInt(rawIntent.quantity),
    targetPrice: stringValue(rawIntent.targetPrice, 120) || null,
    destination: stringValue(rawIntent.destination, 160) || null,
    constraints: stringArray(rawIntent.constraints, 12, 180),
    unknowns: stringArray(rawIntent.unknowns, 12, 180),
    searchQueries: stringArray(rawIntent.searchQueries, 8, 220),
  };

  const plan: BusinessPlanStep[] = rawPlan
    .map((step, index) => {
      const row = step && typeof step === "object" && !Array.isArray(step) ? step as Record<string, unknown> : {};
      const rawStatus = stringValue(row.status, 24);
      return {
        key: stringValue(row.key, 60) || `step_${index + 1}`,
        label: stringValue(row.label, 120) || `Paso ${index + 1}`,
        detail: stringValue(row.detail, 500),
        status: rawStatus === "needs_input" || rawStatus === "later" ? rawStatus : "ready",
      } satisfies BusinessPlanStep;
    })
    .filter((step) => Boolean(step.label))
    .slice(0, 12);

  return {
    title: stringValue(root.title, 180) || intent.item || "Nueva operación",
    intent,
    plan,
  };
}

export function sanitizeBusinessCandidates(value: unknown, sourceCount: number): StructuredBusinessCandidate[] {
  const root = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const rows = Array.isArray(root.candidates) ? root.candidates : Array.isArray(value) ? value : [];
  return rows.map((candidate) => {
    const row = candidate && typeof candidate === "object" && !Array.isArray(candidate)
      ? candidate as Record<string, unknown>
      : {};
    const rawIndex = nullableInt(row.sourceIndex);
    const sourceIndex = rawIndex !== null && rawIndex >= 0 && rawIndex < sourceCount ? rawIndex : null;
    return {
      supplierName: stringValue(row.supplierName, 180) || null,
      offerTitle: stringValue(row.offerTitle, 260) || "Opción encontrada",
      sourceIndex,
      priceAmount: nullableNumber(row.priceAmount),
      currency: stringValue(row.currency, 12).toUpperCase() || null,
      moq: nullableInt(row.moq),
      shippingSummary: stringValue(row.shippingSummary, 500) || null,
      matchReason: stringValue(row.matchReason, 700),
      risks: stringArray(row.risks, 8, 220),
    } satisfies StructuredBusinessCandidate;
  }).filter((candidate) => Boolean(candidate.offerTitle)).slice(0, 10);
}
