"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  CLOUVA_MAP_STYLE_URL,
  loadMapLibre,
  type ClouvaMap,
  type ClouvaMapMarker,
} from "@/lib/maplibre-browser";

function safeAccent(value: string | null | undefined) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : "#7ddfff";
}

function createMarker(label: string, accent: string, compact: boolean) {
  const parts = label.split(",").map((part) => part.trim()).filter(Boolean);
  const locality = (parts[0] || label).toLocaleUpperCase("es-AR");
  const context = parts.slice(1).join(" · ").toLocaleUpperCase("es-AR");
  const root = document.createElement("div");
  root.className = `clouva-location-marker${compact ? " clouva-location-marker--compact" : ""}`;
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
  if (context && !compact) {
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
      { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[longitude - lonDelta, latitude], [longitude + lonDelta, latitude]] } },
      { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[longitude, latitude - latDelta], [longitude, latitude + latDelta]] } },
    ],
  };
}

export function PlayerLocationMap({ latitude, longitude, label, accent, className = "", compact = false }: {
  latitude: number | null;
  longitude: number | null;
  label: string;
  accent?: string | null;
  className?: string;
  compact?: boolean;
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
    let map: ClouvaMap | null = null;
    let marker: ClouvaMapMarker | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let didLoad = false;

    setReady(false);
    void loadMapLibre().then((maplibregl) => {
      if (cancelled || !containerRef.current) return;
      map = new maplibregl.Map({
        container: containerRef.current,
        style: process.env.NEXT_PUBLIC_CLOUVA_MAP_STYLE_URL || CLOUVA_MAP_STYLE_URL,
        center: [Number(longitude), Number(latitude)],
        zoom: compact ? 10.6 : (window.matchMedia("(max-width: 640px)").matches ? 8.8 : 10.2),
        pitch: compact ? 10 : 18,
        bearing: compact ? -3 : -7,
        interactive: false,
        dragPan: false,
        scrollZoom: false,
        boxZoom: false,
        dragRotate: false,
        keyboard: false,
        doubleClickZoom: false,
        touchZoomRotate: false,
        attributionControl: false,
      });

      map.on("load", () => {
        if (cancelled || !map) return;
        didLoad = true;
        try {
          map.addSource("clouva-location-axis", { type: "geojson", data: locationGeometry(Number(latitude), Number(longitude)) });
          map.addLayer({
            id: "clouva-location-axis",
            type: "line",
            source: "clouva-location-axis",
            paint: { "line-color": color, "line-width": 1, "line-opacity": compact ? 0.18 : 0.28, "line-dasharray": [2, 3] },
          });
          map.addSource("clouva-location-point", {
            type: "geojson",
            data: { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [Number(longitude), Number(latitude)] } },
          });
          map.addLayer({
            id: "clouva-location-glow",
            type: "circle",
            source: "clouva-location-point",
            paint: { "circle-radius": compact ? 14 : 18, "circle-color": color, "circle-opacity": 0.12, "circle-blur": 0.85 },
          });
        } catch {
          // Decorative layers are optional. The basemap and DOM beacon still render.
        }
        marker = new maplibregl.Marker({ element: createMarker(label, color, compact), anchor: "center" })
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
  }, [color, compact, label, latitude, longitude, validCoordinates]);

  if (!validCoordinates || !label.trim()) return null;

  return (
    <div
      className={`player-location-map pointer-events-none overflow-hidden ${className}`}
      style={{ ["--clouva-map-accent" as string]: color } as CSSProperties}
      role="img"
      aria-label={`Mapa de la localidad pública ${label}`}
    >
      <div ref={containerRef} className={`absolute inset-0 transition-opacity duration-700 ${ready ? "opacity-100" : "opacity-0"}`} />
      <div className={`absolute inset-0 transition-opacity duration-700 ${ready ? "opacity-100" : "opacity-0"} bg-[linear-gradient(rgba(255,255,255,.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.025)_1px,transparent_1px)] bg-[size:46px_46px] mix-blend-screen`} />
      <div className={`absolute inset-0 transition-opacity duration-700 ${ready ? "opacity-100" : "opacity-0"} bg-[radial-gradient(circle_at_72%_46%,color-mix(in_srgb,var(--clouva-map-accent)_20%,transparent),transparent_24%)]`} />
      <div className={`pointer-events-auto absolute bottom-1.5 right-2 z-20 flex max-w-[92%] flex-wrap justify-end gap-x-1 rounded-md bg-[#05070b]/76 px-1.5 py-0.5 text-[7px] leading-3 text-white/30 backdrop-blur-sm transition-opacity duration-500 ${ready ? "opacity-100" : "opacity-0"}`}>
        <a href="https://openfreemap.org/" target="_blank" rel="noreferrer" className="hover:text-white/55">OpenFreeMap</a>
        <span>©</span><a href="https://openmaptiles.org/" target="_blank" rel="noreferrer" className="hover:text-white/55">OpenMapTiles</a>
        <span>Data</span><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="hover:text-white/55">OpenStreetMap</a>
      </div>
      <style jsx global>{`
        .player-location-map .maplibregl-map,
        .player-location-map .maplibregl-canvas-container,
        .player-location-map .maplibregl-canvas { width: 100%; height: 100%; }
        .player-location-map .maplibregl-canvas { position: absolute; inset: 0; }
        .clouva-location-marker { position: relative; display: flex; align-items: center; gap: .78rem; color: var(--clouva-location-accent); filter: drop-shadow(0 0 12px color-mix(in srgb, var(--clouva-location-accent) 55%, transparent)); }
        .clouva-location-marker--compact { gap: .42rem; }
        .clouva-location-beacon { position: relative; width: 2.7rem; height: 2.7rem; flex: 0 0 2.7rem; }
        .clouva-location-marker--compact .clouva-location-beacon { width: 2.05rem; height: 2.05rem; flex-basis: 2.05rem; }
        .clouva-location-beacon__halo,.clouva-location-beacon__ring,.clouva-location-beacon__core { position: absolute; inset: 50% auto auto 50%; border-radius: 999px; transform: translate(-50%, -50%); }
        .clouva-location-beacon__halo { width: 2.65rem; height: 2.65rem; background: radial-gradient(circle, color-mix(in srgb, var(--clouva-location-accent) 24%, transparent), transparent 67%); animation: clouva-location-breathe 2.9s ease-in-out infinite; }
        .clouva-location-marker--compact .clouva-location-beacon__halo { width: 2rem; height: 2rem; }
        .clouva-location-beacon__ring { width: 1.2rem; height: 1.2rem; border: 1px solid color-mix(in srgb, var(--clouva-location-accent) 78%, white 8%); animation: clouva-location-ring 2.9s ease-out infinite; }
        .clouva-location-marker--compact .clouva-location-beacon__ring { width: .92rem; height: .92rem; }
        .clouva-location-beacon__core { width: .46rem; height: .46rem; background: var(--clouva-location-accent); box-shadow: 0 0 5px white, 0 0 15px var(--clouva-location-accent), 0 0 30px var(--clouva-location-accent); animation: clouva-location-flicker 3.35s steps(1,end) infinite; }
        .clouva-location-marker--compact .clouva-location-beacon__core { width: .38rem; height: .38rem; }
        .clouva-location-label { display: grid; gap: .08rem; min-width: 8rem; padding: .32rem .48rem .36rem; border-left: 1px solid color-mix(in srgb, var(--clouva-location-accent) 70%, transparent); background: linear-gradient(90deg, rgba(3,7,11,.76), rgba(3,7,11,.12)); backdrop-filter: blur(4px); }
        .clouva-location-marker--compact .clouva-location-label { min-width: auto; padding: .22rem .34rem .24rem; background: rgba(3,7,11,.44); }
        .clouva-location-label strong { font-size: .7rem; line-height: 1; letter-spacing: .19em; font-weight: 800; white-space: nowrap; }
        .clouva-location-marker--compact .clouva-location-label strong { font-size: .54rem; letter-spacing: .13em; }
        .clouva-location-label small { margin-top: .18rem; max-width: 15rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: rgba(255,255,255,.56); font-size: .46rem; line-height: 1.2; letter-spacing: .12em; }
        @keyframes clouva-location-ring { 0% { opacity: .88; transform: translate(-50%,-50%) scale(.5); } 72%,100% { opacity: 0; transform: translate(-50%,-50%) scale(2.45); } }
        @keyframes clouva-location-breathe { 0%,100% { opacity: .48; transform: translate(-50%,-50%) scale(.84); } 50% { opacity: .96; transform: translate(-50%,-50%) scale(1.16); } }
        @keyframes clouva-location-flicker { 0%,6%,10%,31%,36%,40%,63%,66%,84%,88%,100% { opacity: 1; transform: translate(-50%,-50%) scale(1); } 7%,34%,64%,86% { opacity: .46; transform: translate(-50%,-50%) scale(.76); } 8%,35%,65%,87% { opacity: .86; transform: translate(-50%,-50%) scale(1.2); } }
        @media (prefers-reduced-motion: reduce) {
          .clouva-location-beacon__halo,.clouva-location-beacon__ring,.clouva-location-beacon__core { animation: none; }
          .clouva-location-beacon__ring { opacity: .55; transform: translate(-50%,-50%) scale(1.15); }
        }
      `}</style>
    </div>
  );
}
