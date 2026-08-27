export const CREATOR_OBJECT_REFERENCE_ORDER = ["front", "back", "side"] as const;

export type CreatorObjectReferenceRole = (typeof CREATOR_OBJECT_REFERENCE_ORDER)[number];
export type CreatorObjectKind = "object" | "accessory";

export type CreatorObjectPreset = {
  key: string;
  slug: string;
  name: string;
  kind: CreatorObjectKind;
  category: string;
  description: string;
  economyKey?: string;
  assetRole?: string;
  texturePrompt?: string;
  attachmentProfile: {
    mode: "world" | "avatar";
    anchor?: string;
    pivot: "center" | "bottom-center";
    forwardAxis: "+Z" | "-Z";
    upAxis: "+Y";
    unit: "meter";
  };
};

export const CREATOR_OBJECT_PRESETS = {
  fllows: {
    key: "fllows",
    slug: "fllows-coin",
    name: "FLLOWS",
    kind: "object",
    category: "currency",
    description: "Moneda oficial FLLOWS de CLOUVA.",
    economyKey: "flows",
    assetRole: "currency-3d-official",
    texturePrompt: "Premium chrome-silver CLOUVA FLLOWS coin, polished metallic surface, electric violet emissive accents, crisp four-loop emblem, clean readable game currency asset, preserve the reference geometry exactly.",
    attachmentProfile: {
      mode: "world",
      pivot: "center",
      forwardAxis: "+Z",
      upAxis: "+Y",
      unit: "meter",
    },
  },
} as const satisfies Record<string, CreatorObjectPreset>;

export type CreatorObjectPresetKey = keyof typeof CREATOR_OBJECT_PRESETS;

export function getCreatorObjectPreset(value: string | null | undefined): CreatorObjectPreset | null {
  if (!value) return null;
  return CREATOR_OBJECT_PRESETS[value as CreatorObjectPresetKey] ?? null;
}
