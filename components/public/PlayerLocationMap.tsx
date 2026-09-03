"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

type MapLibreMap = {
  on: (event: string, handler: (event?: unknown) => void) => void;
  addSource: (id: string, source: Record<string, unknown>) => void;
  addLayer: (layer: Record<string, unknown>) => void;
  resize: () => void;
  remove: () => void;
};

type MapLibreMarker = {
  setLngLat: (coordinates: [number, number]) => MapLibreMarker;
  addTo: (map: MapLibreMap) => MapLibreMarker;
  remove: () => void;
};

type MapLibreNamespace = {
  Map: new (options: Record<string, unknown>) => MapLibreMap;
  Marker: new (options: Record<string, unknown>) => MapLibreMarker;
};

declare global {
  interface Window {
    maplibregl?: MapLibreNamespace;
  }
}

const MAPLIBRE_VERSION = "5.7.1";
const MAPLIBRE_SCRIPT = `https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.js`;
const MAPLIBRE_STYLES = `https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.css`;
const DEFAULT_MAP_STYLE = "https://tiles.openfreemap.org/styles/dark";
let mapLibrePromise: Promise<MapLibreNamespace> | null = null;

function safeAccent(value: string | null | undefined) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : "#7ddfff";
}

function ensureMapLibreStyles() {
  if (document.querySelector(`link[data-clouva-maplibre="${MAPLIBRE_VERSION}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = MAPLIBRE_STYLES;
  link.dataset.clouvaMaplibre = MAPLIBRE_VERSION;
  document.head.appendChild(link);
}

function loadMapLibre() {
  if (typeof window === "undefined") return Promise.reject(new Error("MapLibre requires a browser."));
  if (window.maplibregl) return Promise.resolve(window.maplibregl);
  if (mapLibrePromise) return mapLibrePromise;

  ensureMapLibreStyles();
  mapLibrePromise = new Promise<MapLibreNamespace>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[data-clouva-maplibre="${MAPLIBRE_VERSION}"]`);
    const script = existing || document.createElement("script");

    const finish = () => {
      if (window.maplibregl) resolve(window.maplibregl);
      else reject(new Error("MapLibre did not initialize."));
    };
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

function createMarker(label: string, accent: string) {
  const parts = label.split(",").map((part) => part.trim()).filter(Boolean);
  const locality = (parts[0] || label).toLocaleUpperCase("es-AR");
  const context = parts.slice(1).join(" · ").toLocaleUpperCase("es-AR");

  const root = document.createElement("div");
  root.className = "clouva-location-marker";
  root.style.setProperty("--clouva-location-accent", accent);

  const beacon = document.createElement("div");
  beacon.className = "clouva-location-beacon";
  for (const className of ["clouva-location-beacon__halo", "clouva-location-beacon__ring", "clouva-location-beacon__core"]) {
    const node = document.createElement("span");
    node.className = className;
    beacon.appendChild(node);
  }

  const text = document.createElement("div");
  text.className = "clouva-location-label";
  const title = document.createElement("strong");
  title.textContent = locality;
  text.appendChild(title);
  if (context) {
    const detail = document.createElement("small");
    detail.textContent = context;
    text.appendChild(detail);
  }

  root.append(beacon, text);
  return root;
}

function locationGeometry(latitude: number, longitude: number) {
  const latDelta = 0.09;
  const lonDelta = Math.max(0.09, 0.09 / Math.max(0.35, Math.cos(latitude * Math.PI / 180)));
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: [[longitude - lonDelta, latitude], [longitude + lonDelta, latitude]] },
      },
      {
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: [[longitude, latitude - latDelta], [longitude, latitude + latDelta]] },
      },
    ],
  };
}

export function PlayerLocationMap({
  latitude,
  longitude,
  label,
  accent,
  className = "",
}: {
  latitude: number | null;
  longitude: number | null;
  label: string;
  accent?: string | null;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(false);
  const color = useMemo(() => safeAccent(accent), [accent]);
  const validCoordinates = Number.isFinite(latitude) && Number.isFinite(longitude)
    && Number(latitude) >= -90 && Number(latitude) <= 90
    && Number(longitude) >= -180 && Number(longitude) <= 180;

  useEffect(() => {
    if (!validCoordinates || !containerRef.current || !label.trim()) return;
    let cancelled = false;
    let map: MapLibreMap | null = null;
    let marker: MapLibreMarker | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let didLoad = false;

    setReady(false);
    void loadMapLibre().then((maplibregl) => {
      if (cancelled || !containerRef.current) return;

      map = new maplibregl.Map({
        container: containerRef.current,
        style: process.env.NEXT_PUBLIC_CLOUVA_MAP_STYLE_URL || DEFAULT_MAP_STYLE,
        center: [Number(longitude), Number(latitude)],
        zoom: window.matchMedia("(max-width: 640px)").matches ? 8.8 : 10.2,
        pitch: 18,
        bearing: -7,
        interactive: false,
        dragPan: false,
        scrollZoom: false,
        boxZoom: false,
        dragRotate: false,
        keyboard: false,
        doubleClickZoom: false,
        touchZoomRotate: false,
        attributionControl: { compact: true },
      });

      map.on("load", () => {
        if (cancelled || !map) return;
        didLoad = true;
        try {
          map.addSource("clouva-location-axis", {
            type: "geojson",
            data: locationGeometry(Number(latitude), Number(longitude)),
          });
          map.addLayer({
            id: "clouva-location-axis",
            type: "line",
            source: "clouva-location-axis",
            paint: {
              "line-color": color,
              "line-width": 1,
              "line-opacity": 0.28,
              "line-dasharray": [2, 3],
            },
          });
          map.addSource("clouva-location-point", {
            type: "geojson",
            data: {
              type: "Feature",
              properties: {},
              geometry: { type: "Point", coordinates: [Number(longitude), Number(latitude)] },
            },
          });
          map.addLayer({
            id: "clouva-location-glow",
            type: "circle",
            source: "clouva-location-point",
            paint: {
              "circle-radius": 18,
              "circle-color": color,
              "circle-opacity": 0.12,
              "circle-blur": 0.85,
            },
          });
        } catch {
          // The DOM beacon still renders if a custom map style rejects an optional overlay layer.
        }

        marker = new maplibregl.Marker({ element: createMarker(label, color), anchor: "center" })
          .setLngLat([Number(longitude), Number(latitude)])
          .addTo(map);
        setReady(true);
      });

      map.on("error", () => {
        if (!didLoad && !cancelled) setReady(false);
      });

      resizeObserver = new ResizeObserver(() => map?.resize());
      resizeObserver.observe(containerRef.current);
    }).catch(() => {
      if (!cancelled) setReady(false);
    });

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      marker?.remove();
      map?.remove();
    };
  }, [color, label, latitude, longitude, validCoordinates]);

  if (!validCoordinates || !label.trim()) return null;

  return (
    <div
      className={`player-location-map pointer-events-none overflow-hidden ${className}`}
      style={{ ["--clouva-map-accent" as string]: color } as CSSProperties}
      aria-hidden="true"
    >
      <div ref={containerRef} className={`absolute inset-0 transition-opacity duration-700 ${ready ? "opacity-100" : "opacity-0"}`} />
      <div className={`absolute inset-0 transition-opacity duration-700 ${ready ? "opacity-100" : "opacity-0"} bg-[linear-gradient(rgba(255,255,255,.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.025)_1px,transparent_1px)] bg-[size:46px_46px] mix-blend-screen`} />
      <div className={`absolute inset-0 transition-opacity duration-700 ${ready ? "opacity-100" : "opacity-0"} bg-[radial-gradient(circle_at_72%_46%,color-mix(in_srgb,var(--clouva-map-accent)_20%,transparent),transparent_24%)]`} />
      <style jsx global>{`
        .player-location-map .maplibregl-map,
        .player-location-map .maplibregl-canvas-container,
        .player-location-map .maplibregl-canvas { width: 100%; height: 100%; }
        .player-location-map .maplibregl-canvas { position: absolute; inset: 0; }
        .player-location-map .maplibregl-ctrl-bottom-right { right: .5rem; bottom: .35rem; opacity: .42; transform: scale(.82); transform-origin: right bottom; }
        .clouva-location-marker { position: relative; display: flex; align-items: center; gap: .78rem; color: var(--clouva-location-accent); filter: drop-shadow(0 0 12px color-mix(in srgb, var(--clouva-location-accent) 55%, transparent)); }
        .clouva-location-beacon { position: relative; width: 2.7rem; height: 2.7rem; flex: 0 0 2.7rem; }
        .clouva-location-beacon__halo,
        .clouva-location-beacon__ring,
        .clouva-location-beacon__core { position: absolute; inset: 50% auto auto 50%; border-radius: 999px; transform: translate(-50%, -50%); }
        .clouva-location-beacon__halo { width: 2.65rem; height: 2.65rem; background: radial-gradient(circle, color-mix(in srgb, var(--clouva-location-accent) 22%, transparent), transparent 67%); animation: clouva-location-breathe 2.6s ease-in-out infinite; }
        .clouva-location-beacon__ring { width: 1.2rem; height: 1.2rem; border: 1px solid color-mix(in srgb, var(--clouva-location-accent) 75%, white 8%); animation: clouva-location-ring 2.6s ease-out infinite; }
        .clouva-location-beacon__core { width: .46rem; height: .46rem; background: var(--clouva-location-accent); box-shadow: 0 0 6px white, 0 0 18px var(--clouva-location-accent), 0 0 34px var(--clouva-location-accent); }
        .clouva-location-label { display: grid; gap: .08rem; min-width: 8rem; padding: .32rem .48rem .36rem; border-left: 1px solid color-mix(in srgb, var(--clouva-location-accent) 70%, transparent); background: linear-gradient(90deg, rgba(3,7,11,.76), rgba(3,7,11,.12)); backdrop-filter: blur(4px); }
        .clouva-location-label strong { font-size: .7rem; line-height: 1; letter-spacing: .19em; font-weight: 800; white-space: nowrap; }
        .clouva-location-label small { margin-top: .18rem; max-width: 15rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: rgba(255,255,255,.56); font-size: .46rem; line-height: 1.2; letter-spacing: .12em; }
        @keyframes clouva-location-ring { 0% { opacity: .86; transform: translate(-50%,-50%) scale(.55); } 72%,100% { opacity: 0; transform: translate(-50%,-50%) scale(2.3); } }
        @keyframes clouva-location-breathe { 0%,100% { opacity: .5; transform: translate(-50%,-50%) scale(.88); } 50% { opacity: .95; transform: translate(-50%,-50%) scale(1.12); } }
        @media (prefers-reduced-motion: reduce) {
          .clouva-location-beacon__halo,
          .clouva-location-beacon__ring { animation: none; }
          .clouva-location-beacon__ring { opacity: .55; transform: translate(-50%,-50%) scale(1.15); }
        }
      `}</style>
    </div>
  );
}
