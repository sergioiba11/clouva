export const FLOW_USD_VALUE = 1 as const;

export type FlowRegionKey =
  | "patagonia"
  | "argentina"
  | "latam"
  | "north-america"
  | "europe"
  | "asia-pacific"
  | "africa"
  | "global";

export type FlowRegion = {
  key: FlowRegionKey;
  label: string;
  glow: string;
  glowSoft: string;
  edge: string;
};

const FLOW_REGIONS: Record<FlowRegionKey, FlowRegion> = {
  patagonia: {
    key: "patagonia",
    label: "Sur · Patagonia",
    glow: "#8de9ff",
    glowSoft: "rgba(141, 233, 255, 0.28)",
    edge: "#d7f8ff",
  },
  argentina: {
    key: "argentina",
    label: "Argentina",
    glow: "#7ed7ff",
    glowSoft: "rgba(126, 215, 255, 0.24)",
    edge: "#d7f3ff",
  },
  latam: {
    key: "latam",
    label: "Latinoamérica",
    glow: "#a98cff",
    glowSoft: "rgba(169, 140, 255, 0.25)",
    edge: "#e3d8ff",
  },
  "north-america": {
    key: "north-america",
    label: "Norteamérica",
    glow: "#ff8bd4",
    glowSoft: "rgba(255, 139, 212, 0.24)",
    edge: "#ffd8f0",
  },
  europe: {
    key: "europe",
    label: "Europa",
    glow: "#bff58b",
    glowSoft: "rgba(191, 245, 139, 0.22)",
    edge: "#ebffd7",
  },
  "asia-pacific": {
    key: "asia-pacific",
    label: "Asia · Pacífico",
    glow: "#ffd271",
    glowSoft: "rgba(255, 210, 113, 0.23)",
    edge: "#fff0c9",
  },
  africa: {
    key: "africa",
    label: "África",
    glow: "#ff9b70",
    glowSoft: "rgba(255, 155, 112, 0.23)",
    edge: "#ffe0d2",
  },
  global: {
    key: "global",
    label: "CLOUVA Global",
    glow: "#a58bff",
    glowSoft: "rgba(165, 139, 255, 0.24)",
    edge: "#e3dcff",
  },
};

function clean(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function getFlowRegion(...locationParts: Array<string | null | undefined>): FlowRegion {
  const text = clean(locationParts.filter(Boolean).join(" · "));

  if (/patagonia|neuquen|zapala|rio negro|chubut|santa cruz|tierra del fuego|ushuaia|bariloche/.test(text)) {
    return FLOW_REGIONS.patagonia;
  }
  if (/argentina|buenos aires|cordoba|rosario|mendoza|salta|jujuy|tucuman|corrientes|entre rios|misiones|santa fe|san juan|san luis|la pampa|formosa|chaco|catamarca|la rioja|santiago del estero/.test(text)) {
    return FLOW_REGIONS.argentina;
  }
  if (/mexico|chile|uruguay|paraguay|bolivia|peru|brasil|brazil|colombia|venezuela|ecuador|guatemala|honduras|salvador|nicaragua|costa rica|panama|cuba|dominicana|puerto rico|latinoamerica|latin america/.test(text)) {
    return FLOW_REGIONS.latam;
  }
  if (/estados unidos|united states|usa|canada/.test(text)) return FLOW_REGIONS["north-america"];
  if (/espana|spain|france|francia|italia|italy|germany|alemania|portugal|united kingdom|reino unido|england|ireland|netherlands|belgium|switzerland|sweden|norway|denmark|finland|poland|europe|europa/.test(text)) {
    return FLOW_REGIONS.europe;
  }
  if (/japan|japon|china|korea|corea|india|australia|new zealand|nueva zelanda|singapore|singapur|philippines|filipinas|indonesia|thailand|tailandia|vietnam|asia|pacific|pacifico/.test(text)) {
    return FLOW_REGIONS["asia-pacific"];
  }
  if (/africa|south africa|sudafrica|nigeria|kenya|ghana|morocco|marruecos|egypt|egipto/.test(text)) return FLOW_REGIONS.africa;

  return FLOW_REGIONS.global;
}

export function normalizeFlowBalance(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.trunc(numeric));
}

export function flowLabel(balance: number) {
  return balance === 1 ? "FLOW" : "FLOWS";
}

export function flowsToUsd(balance: number) {
  return normalizeFlowBalance(balance) * FLOW_USD_VALUE;
}
