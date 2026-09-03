"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type MapLike = { remove: () => void; resize: () => void; setCenter: (center: [number, number]) => void };
type MarkerLike = { setLngLat: (coordinates: [number, number]) => MarkerLike; addTo: (map: MapLike) => MarkerLike; remove: () => void };
type MapLibreNamespace = { Map: new (options: Record<string, unknown>) => MapLike; Marker: new (options: Record<string, unknown>) => MarkerLike };

declare global { interface Window { maplibregl?: MapLibreNamespace } }

const VERSION = "5.7.1";
const STYLE_URL = "https://tiles.openfreemap.org/styles/dark";
let loader: Promise<MapLibreNamespace> | null = null;

function loadMapLibre() {
  if (typeof window === "undefined") return Promise.reject(new Error("browser required"));
  if (window.maplibregl) return Promise.resolve(window.maplibregl);
  if (loader) return loader;
  loader = new Promise<MapLibreNamespace>((resolve, reject) => {
    if (!document.querySelector(`link[data-clouva-trusted-map="${VERSION}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = `https://unpkg.com/maplibre-gl@${VERSION}/dist/maplibre-gl.css`;
      link.dataset.clouvaTrustedMap = VERSION;
      document.head.appendChild(link);
    }
    const existing = document.querySelector<HTMLScriptElement>(`script[data-clouva-maplibre="${VERSION}"]`);
    const script = existing || document.createElement("script");
    const finish = () => window.maplibregl ? resolve(window.maplibregl) : reject(new Error("MapLibre unavailable"));
    script.addEventListener("load", finish, { once: true });
    script.addEventListener("error", () => reject(new Error("MapLibre load failed")), { once: true });
    if (!existing) {
      script.src = `https://unpkg.com/maplibre-gl@${VERSION}/dist/maplibre-gl.js`;
      script.async = true;
      script.crossOrigin = "anonymous";
      script.dataset.clouvaMaplibre = VERSION;
      document.head.appendChild(script);
    }
  }).catch((error) => { loader = null; throw error; });
  return loader;
}

export type TrustedMapLocation = {
  userId: string;
  latitude: number | null;
  longitude: number | null;
  status: string;
  updatedAt: string;
  player: { display_name?: string | null; username?: string | null; accent_color?: string | null; profile_image_url?: string | null } | null;
};

function safeAccent(value: string | null | undefined) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : "#7ddfff";
}

function makeMarker(location: TrustedMapLocation) {
  const accent = safeAccent(location.player?.accent_color);
  const root = document.createElement("div");
  root.className = "trusted-map-marker";
  root.style.setProperty("--trusted-accent", accent);
  const dot = document.createElement("span");
  dot.className = `trusted-map-marker__dot ${location.status === "sharing" ? "is-live" : "is-paused"}`;
  const label = document.createElement("span");
  label.className = "trusted-map-marker__label";
  label.textContent = location.player?.display_name || location.player?.username || "Player";
  root.append(dot, label);
  return root;
}

export function TrustedMap({ locations }: { locations: TrustedMapLocation[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLike | null>(null);
  const markerRefs = useRef<MarkerLike[]>([]);
  const [ready, setReady] = useState(false);
  const visible = useMemo(() => locations.filter((item) => Number.isFinite(item.latitude) && Number.isFinite(item.longitude)), [locations]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let cancelled = false;
    let observer: ResizeObserver | null = null;
    void loadMapLibre().then((maplibre) => {
      if (cancelled || !containerRef.current) return;
      const first = visible[0];
      mapRef.current = new maplibre.Map({
        container: containerRef.current,
        style: process.env.NEXT_PUBLIC_CLOUVA_MAP_STYLE_URL || STYLE_URL,
        center: first ? [Number(first.longitude), Number(first.latitude)] : [-58.3816, -34.6037],
        zoom: first ? 12.5 : 3.5,
        pitch: 20,
        bearing: -4,
        attributionControl: false,
        dragRotate: false,
        touchPitch: false,
      });
      setReady(true);
      observer = new ResizeObserver(() => mapRef.current?.resize());
      observer.observe(containerRef.current);
    }).catch(() => setReady(false));
    return () => {
      cancelled = true;
      observer?.disconnect();
      markerRefs.current.forEach((marker) => marker.remove());
      markerRefs.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!ready || !mapRef.current || !window.maplibregl) return;
    markerRefs.current.forEach((marker) => marker.remove());
    markerRefs.current = visible.map((location) => new window.maplibregl!.Marker({ element: makeMarker(location), anchor: "center" })
      .setLngLat([Number(location.longitude), Number(location.latitude)])
      .addTo(mapRef.current!));
    if (visible[0]) mapRef.current.setCenter([Number(visible[0].longitude), Number(visible[0].latitude)]);
  }, [ready, visible]);

  return (
    <div className="trusted-map relative min-h-[360px] overflow-hidden rounded-[28px] border border-white/10 bg-[#05070b] sm:min-h-[520px]">
      <div ref={containerRef} className={`absolute inset-0 transition-opacity duration-500 ${ready ? "opacity-100" : "opacity-0"}`} />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.025)_1px,transparent_1px)] bg-[size:48px_48px] opacity-35" />
      {!visible.length ? <div className="absolute inset-0 grid place-items-center px-8 text-center"><div><p className="text-sm font-semibold text-white/75">Todavía no hay una señal activa</p><p className="mt-2 text-xs leading-5 text-white/35">Cuando una conexión aceptada comparta ubicación, su luz va a aparecer acá.</p></div></div> : null}
      <div className="absolute bottom-2 right-2 z-10 rounded-md bg-[#05070b]/80 px-2 py-1 text-[8px] text-white/38 backdrop-blur">
        <a className="hover:text-white/65" href="https://openfreemap.org/" target="_blank" rel="noreferrer">OpenFreeMap</a>
        <span> · © </span><a className="hover:text-white/65" href="https://openmaptiles.org/" target="_blank" rel="noreferrer">OpenMapTiles</a>
        <span> · Data </span><a className="hover:text-white/65" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>
      </div>
      <style jsx global>{`
        .trusted-map .maplibregl-map,.trusted-map .maplibregl-canvas-container,.trusted-map .maplibregl-canvas{width:100%;height:100%}.trusted-map .maplibregl-canvas{position:absolute;inset:0}
        .trusted-map-marker{display:flex;align-items:center;gap:.42rem;color:white;filter:drop-shadow(0 0 12px color-mix(in srgb,var(--trusted-accent) 55%,transparent))}
        .trusted-map-marker__dot{position:relative;width:.68rem;height:.68rem;border-radius:999px;background:var(--trusted-accent);box-shadow:0 0 5px white,0 0 14px var(--trusted-accent),0 0 34px var(--trusted-accent)}
        .trusted-map-marker__dot::before,.trusted-map-marker__dot::after{content:"";position:absolute;inset:50% auto auto 50%;border-radius:999px;transform:translate(-50%,-50%)}
        .trusted-map-marker__dot::before{width:2.4rem;height:2.4rem;background:radial-gradient(circle,color-mix(in srgb,var(--trusted-accent) 25%,transparent),transparent 68%);animation:trusted-breathe 2.8s ease-in-out infinite}
        .trusted-map-marker__dot::after{width:1rem;height:1rem;border:1px solid color-mix(in srgb,var(--trusted-accent) 75%,white 10%);animation:trusted-ring 2.9s ease-out infinite}
        .trusted-map-marker__dot.is-live{animation:trusted-flicker 3.4s steps(1,end) infinite}.trusted-map-marker__dot.is-paused{opacity:.55;filter:saturate(.5)}
        .trusted-map-marker__label{max-width:10rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border-left:1px solid color-mix(in srgb,var(--trusted-accent) 55%,transparent);background:linear-gradient(90deg,rgba(3,7,11,.76),rgba(3,7,11,.08));padding:.28rem .45rem;font-size:.62rem;font-weight:800;letter-spacing:.12em;text-transform:uppercase}
        @keyframes trusted-breathe{0%,100%{opacity:.45;transform:translate(-50%,-50%) scale(.8)}50%{opacity:1;transform:translate(-50%,-50%) scale(1.18)}}
        @keyframes trusted-ring{0%{opacity:.85;transform:translate(-50%,-50%) scale(.5)}72%,100%{opacity:0;transform:translate(-50%,-50%) scale(2.6)}}
        @keyframes trusted-flicker{0%,7%,11%,33%,38%,62%,66%,87%,100%{opacity:1}8%,35%,64%,88%{opacity:.42}9%,36%,65%,89%{opacity:.9}}
        @media(prefers-reduced-motion:reduce){.trusted-map-marker__dot,.trusted-map-marker__dot::before,.trusted-map-marker__dot::after{animation:none!important}}
      `}</style>
    </div>
  );
}
