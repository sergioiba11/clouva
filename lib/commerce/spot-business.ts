export const SPOT_MODULES = [
  "dashboard",
  "products",
  "catalog",
  "variants",
  "inventory",
  "scanner",
  "barcode",
  "codes",
  "pos",
  "sales",
  "orders",
  "customers",
  "services",
  "bookings",
  "content",
  "finance",
  "settings",
] as const;

export type SpotModule = (typeof SPOT_MODULES)[number];

export type SpotBusinessAnalysis = {
  businessType: string;
  businessCategories: string[];
  suggestedModules: SpotModule[];
  suggestedProductAttributes: string[];
  suggestedServiceAttributes: string[];
  suggestedInventoryMode: "none" | "simple" | "variants" | "locations";
  suggestedSalesChannels: string[];
  suggestedBrandTone: string;
  suggestedDescription: string;
  suggestedColorDirection: string;
  suggestedHomeSections: string[];
};

const MODULE_SET = new Set<string>(SPOT_MODULES);

function text(value: unknown, max = 240) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function textArray(value: unknown, maxItems = 16, maxLength = 80) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => text(item, maxLength)).filter(Boolean))).slice(0, maxItems);
}

export function sanitizeSpotBusinessAnalysis(value: unknown): SpotBusinessAnalysis {
  const root = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const inventoryMode = text(root.suggestedInventoryMode, 24);
  const modules = textArray(root.suggestedModules, SPOT_MODULES.length, 32)
    .filter((module): module is SpotModule => MODULE_SET.has(module));

  return {
    businessType: text(root.businessType, 80) || "general_business",
    businessCategories: textArray(root.businessCategories, 10, 80),
    suggestedModules: modules.length ? modules : ["dashboard", "products", "orders", "finance", "settings"],
    suggestedProductAttributes: textArray(root.suggestedProductAttributes, 16, 80),
    suggestedServiceAttributes: textArray(root.suggestedServiceAttributes, 16, 80),
    suggestedInventoryMode: inventoryMode === "none" || inventoryMode === "simple" || inventoryMode === "variants" || inventoryMode === "locations"
      ? inventoryMode
      : "simple",
    suggestedSalesChannels: textArray(root.suggestedSalesChannels, 12, 80),
    suggestedBrandTone: text(root.suggestedBrandTone, 200),
    suggestedDescription: text(root.suggestedDescription, 800),
    suggestedColorDirection: text(root.suggestedColorDirection, 180),
    suggestedHomeSections: textArray(root.suggestedHomeSections, 12, 80),
  };
}

export const QUICK_SPOT_INTENTS = [
  "Vender productos",
  "Ofrecer servicios",
  "Vender productos + servicios",
  "Tengo un negocio físico",
  "Tengo una marca",
  "Soy creador/artista",
  "Tengo un Estudio",
  "Otro",
] as const;
