export type ClouvaMap = {
  on: (event: string, handler: (event?: unknown) => void) => void;
  addSource: (id: string, source: Record<string, unknown>) => void;
  addLayer: (layer: Record<string, unknown>) => void;
  resize: () => void;
  remove: () => void;
  setCenter: (center: [number, number]) => void;
};

export type ClouvaMapMarker = {
  setLngLat: (coordinates: [number, number]) => ClouvaMapMarker;
  addTo: (map: ClouvaMap) => ClouvaMapMarker;
  remove: () => void;
};

export type MapLibreNamespace = {
  Map: new (options: Record<string, unknown>) => ClouvaMap;
  Marker: new (options: Record<string, unknown>) => ClouvaMapMarker;
};

declare global {
  interface Window {
    maplibregl?: MapLibreNamespace;
  }
}

export const CLOUVA_MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/dark";

const MAPLIBRE_VERSION = "5.7.1";
const MAPLIBRE_SCRIPT = `https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.js`;
const MAPLIBRE_STYLES = `https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.css`;
let mapLibrePromise: Promise<MapLibreNamespace> | null = null;

function ensureMapLibreStyles() {
  if (document.querySelector(`link[data-clouva-maplibre="${MAPLIBRE_VERSION}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = MAPLIBRE_STYLES;
  link.dataset.clouvaMaplibre = MAPLIBRE_VERSION;
  document.head.appendChild(link);
}

export function getLoadedMapLibre() {
  return typeof window === "undefined" ? undefined : window.maplibregl;
}

export function loadMapLibre(): Promise<MapLibreNamespace> {
  if (typeof window === "undefined") return Promise.reject(new Error("MapLibre requires a browser."));
  if (window.maplibregl) return Promise.resolve(window.maplibregl);
  if (mapLibrePromise) return mapLibrePromise;

  ensureMapLibreStyles();
  mapLibrePromise = new Promise<MapLibreNamespace>((resolve, reject) => {
    const selector = `script[data-clouva-maplibre="${MAPLIBRE_VERSION}"]`;
    const existing = document.querySelector<HTMLScriptElement>(selector);
    const script = existing || document.createElement("script");
    const finish = () => window.maplibregl ? resolve(window.maplibregl) : reject(new Error("MapLibre did not initialize."));
    const fail = () => reject(new Error("MapLibre could not be loaded."));

    script.addEventListener("load", finish, { once: true });
    script.addEventListener("error", fail, { once: true });
    if (!existing) {
      script.src = MAPLIBRE_SCRIPT;
      script.async = true;
      script.crossOrigin = "anonymous";
      script.dataset.clouvaMaplibre = MAPLIBRE_VERSION;
      document.head.appendChild(script);
    }
  }).catch((error) => {
    mapLibrePromise = null;
    throw error;
  });

  return mapLibrePromise;
}
