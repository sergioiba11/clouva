export const FLOW_USD_VALUE = 1 as const;

export type FlowRegionKey =
  | "patagonia"
  | "argentina"
  | "latam"
  | "north-america"
  | "europe"
  | "asia-pacific"
  | "africa"
  | "oceania"
  | "global";

export type FlowRegion = {
  key: FlowRegionKey;
  label: string;
  glow: string;
  glowSoft: string;
  edge: string;
  assetUrl: string | null;
};

const FLOW_COIN_ASSET_BASE_URL = (
  process.env.NEXT_PUBLIC_CLOUVA_FLOW_ASSET_BASE_URL ??
  "https://storage.googleapis.com/clouva-generated-media/admin-assets/brand"
).replace(/\/+$/, "");

function flowCoinAsset(fileName: string) {
  return `${FLOW_COIN_ASSET_BASE_URL}/${fileName}`;
}

const SOUTH_AMERICA_ASSET = flowCoinAsset("01_flows_sudamerica.png");

const FLOW_REGIONS: Record<FlowRegionKey, FlowRegion> = {
  patagonia: {
    key: "patagonia",
    label: "Sur · Patagonia",
    glow: "#8de9ff",
    glowSoft: "rgba(141, 233, 255, 0.28)",
    edge: "#d7f8ff",
    assetUrl: SOUTH_AMERICA_ASSET,
  },
  argentina: {
    key: "argentina",
    label: "Argentina",
    glow: "#7ed7ff",
    glowSoft: "rgba(126, 215, 255, 0.24)",
    edge: "#d7f3ff",
    assetUrl: SOUTH_AMERICA_ASSET,
  },
  latam: {
    key: "latam",
    label: "Sudamérica",
    glow: "#7ed7ff",
    glowSoft: "rgba(126, 215, 255, 0.24)",
    edge: "#d7f3ff",
    assetUrl: SOUTH_AMERICA_ASSET,
  },
  "north-america": {
    key: "north-america",
    label: "Norteamérica",
    glow: "#55b8ff",
    glowSoft: "rgba(85, 184, 255, 0.24)",
    edge: "#d6efff",
    assetUrl: flowCoinAsset("02_flows_norteamerica.png"),
  },
  europe: {
    key: "europe",
    label: "Europa",
    glow: "#d65cff",
    glowSoft: "rgba(214, 92, 255, 0.22)",
    edge: "#f3d7ff",
    assetUrl: flowCoinAsset("03_flows_europa.png"),
  },
  "asia-pacific": {
    key: "asia-pacific",
    label: "Asia",
    glow: "#ff5dc8",
    glowSoft: "rgba(255, 93, 200, 0.23)",
    edge: "#ffd7f1",
    assetUrl: flowCoinAsset("05_flows_asia.png"),
  },
  africa: {
    key: "africa",
    label: "África",
    glow: "#ffb13b",
    glowSoft: "rgba(255, 177, 59, 0.23)",
    edge: "#ffe4b5",
    assetUrl: flowCoinAsset("04_flows_africa.png"),
  },
  oceania: {
    key: "oceania",
    label: "Oceanía",
    glow: "#48e6ef",
    glowSoft: "rgba(72, 230, 239, 0.23)",
    edge: "#d3fbff",
    assetUrl: flowCoinAsset("06_flows_oceania.png"),
  },
  global: {
    key: "global",
    label: "CLOUVA Global",
    glow: "#a58bff",
    glowSoft: "rgba(165, 139, 255, 0.24)",
    edge: "#e3dcff",
    assetUrl: null,
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

  if (/chile|uruguay|paraguay|bolivia|peru|brasil|brazil|colombia|venezuela|ecuador|guyana|suriname|guayana francesa|french guiana|sudamerica|south america/.test(text)) {
    return FLOW_REGIONS.latam;
  }

  if (/mexico|estados unidos|united states|usa|canada|guatemala|belize|honduras|salvador|nicaragua|costa rica|panama|cuba|dominicana|dominican republic|puerto rico|jamaica|haiti|bahamas|barbados|trinidad|tobago|caribbean|caribe|central america|centroamerica|north america|norteamerica/.test(text)) {
    return FLOW_REGIONS["north-america"];
  }

  if (/espana|spain|france|francia|italia|italy|germany|alemania|portugal|united kingdom|reino unido|england|ireland|netherlands|belgium|switzerland|sweden|norway|denmark|finland|poland|europe|europa/.test(text)) {
    return FLOW_REGIONS.europe;
  }

  if (/australia|new zealand|nueva zelanda|papua new guinea|papua nueva guinea|fiji|samoa|tonga|oceania|oceanía/.test(text)) {
    return FLOW_REGIONS.oceania;
  }

  if (/japan|japon|china|korea|corea|india|singapore|singapur|philippines|filipinas|indonesia|thailand|tailandia|vietnam|malaysia|malasia|asia/.test(text)) {
    return FLOW_REGIONS["asia-pacific"];
  }

  if (/africa|south africa|sudafrica|nigeria|kenya|ghana|morocco|marruecos|egypt|egipto|ethiopia|etiopia|tanzania|uganda|senegal|algeria|argelia|tunisia|tunez/.test(text)) {
    return FLOW_REGIONS.africa;
  }

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
