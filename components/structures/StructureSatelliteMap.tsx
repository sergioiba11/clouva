"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Crosshair, Loader2, MapPin, Ruler, X } from "lucide-react";
import {
  geoToLocalMeters,
  type StructureCameraNodeRecord,
  type StructureRecord,
  type StructureSpatialFeatureRecord,
} from "@/lib/structures/spatial";

export type SpatialEditMode = "select" | "point" | "footprint" | "measure" | "edit";

type LatLngLiteral = { lat: number; lng: number };
type MapListener = { remove: () => void };
type MapPath = {
  getArray: () => Array<{ lat: () => number; lng: () => number }>;
  addListener: (eventName: string, handler: () => void) => MapListener;
};
type MapLike = {
  setCenter: (center: LatLngLiteral) => void;
  setZoom: (zoom: number) => void;
  setMapTypeId: (mapType: string) => void;
  addListener: (eventName: string, handler: (event: { latLng?: { lat: () => number; lng: () => number } }) => void) => MapListener;
};
type OverlayLike = {
  setMap: (map: MapLike | null) => void;
};
type PolygonLike = OverlayLike & {
  getPath: () => MapPath;
  addListener: (eventName: string, handler: () => void) => MapListener;
};
type GoogleMapsNamespace = {
  Map: new (element: HTMLElement, options: Record<string, unknown>) => MapLike;
  Marker: new (options: Record<string, unknown>) => OverlayLike & { addListener: (eventName: string, handler: () => void) => MapListener };
  Polyline: new (options: Record<string, unknown>) => OverlayLike & { setPath?: (path: LatLngLiteral[]) => void };
  Polygon: new (options: Record<string, unknown>) => PolygonLike;
  SymbolPath: { FORWARD_CLOSED_ARROW: unknown };
};

declare global {
  interface Window {
    google?: { maps: GoogleMapsNamespace };
    __clouvaMapsPromise?: Promise<void>;
  }
}

function loadGoogleMaps() {
  if (typeof window === "undefined") return Promise.reject(new Error("Google Maps requiere navegador."));
  if (window.google?.maps) return Promise.resolve();
  if (window.__clouvaMapsPromise) return window.__clouvaMapsPromise;

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) return Promise.reject(new Error("Falta NEXT_PUBLIC_GOOGLE_MAPS_API_KEY."));

  window.__clouvaMapsPromise = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById("clouva-google-maps");
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Google Maps no pudo cargar.")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.id = "clouva-google-maps";
    script.async = true;
    script.defer = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly`;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Google Maps no pudo cargar."));
    document.head.appendChild(script);
  });
  return window.__clouvaMapsPromise;
}

function pointFromEvent(event: { latLng?: { lat: () => number; lng: () => number } }) {
  if (!event.latLng) return null;
  return { lat: event.latLng.lat(), lng: event.latLng.lng() };
}

function geometryPoints(feature: StructureSpatialFeatureRecord) {
  const geometry = feature.geometry;
  if (geometry.type === "Point") {
    return [{ lat: geometry.coordinates[1], lng: geometry.coordinates[0] }];
  }
  if (geometry.type === "LineString") {
    return geometry.coordinates.map(([lng, lat]) => ({ lat, lng }));
  }
  const ring = geometry.coordinates[0] ?? [];
  return ring.map(([lng, lat]) => ({ lat, lng }));
}

function pathToPolygonGeometry(path: MapPath) {
  const pairs = path.getArray().map((point) => [point.lng(), point.lat()] as [number, number]);
  if (pairs.length) {
    const first = pairs[0];
    const last = pairs[pairs.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) pairs.push([...first]);
  }
  return { type: "Polygon" as const, coordinates: [pairs] };
}

function metersBetween(structure: StructureRecord, points: LatLngLiteral[]) {
  if (points.length < 2) return 0;
  const originLat = structure.origin_latitude ?? points[0].lat;
  const originLon = structure.origin_longitude ?? points[0].lng;
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const a = geoToLocalMeters({
      lat: points[index - 1].lat,
      lon: points[index - 1].lng,
      originLat,
      originLon,
      northRotationDeg: structure.north_rotation_deg,
    });
    const b = geoToLocalMeters({
      lat: points[index].lat,
      lon: points[index].lng,
      originLat,
      originLon,
      northRotationDeg: structure.north_rotation_deg,
    });
    total += Math.hypot(b.x - a.x, b.z - a.z);
  }
  return total;
}

export function StructureSatelliteMap({
  structure,
  cameraNodes,
  spatialFeatures,
  selectedImageId,
  selectedFeatureId,
  editMode,
  originPickActive,
  onSelectImage,
  onSelectFeature,
  onCreateFeature,
  onUpdateFeature,
  onSetOriginFromMap,
}: {
  structure: StructureRecord;
  cameraNodes: StructureCameraNodeRecord[];
  spatialFeatures: StructureSpatialFeatureRecord[];
  selectedImageId: string | null;
  selectedFeatureId: string | null;
  editMode: SpatialEditMode;
  originPickActive: boolean;
  onSelectImage: (imageId: string) => void;
  onSelectFeature: (featureId: string | null) => void;
  onCreateFeature: (payload: {
    featureType: StructureSpatialFeatureRecord["feature_type"];
    name?: string;
    geometry: StructureSpatialFeatureRecord["geometry"];
    properties?: Record<string, unknown>;
  }) => Promise<unknown>;
  onUpdateFeature: (featureId: string, patch: Record<string, unknown>) => Promise<unknown>;
  onSetOriginFromMap: (point: LatLngLiteral) => Promise<void>;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLike | null>(null);
  const overlaysRef = useRef<OverlayLike[]>([]);
  const listenersRef = useRef<MapListener[]>([]);
  const clickListenerRef = useRef<MapListener | null>(null);
  const draftOverlayRef = useRef<OverlayLike | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftPoints, setDraftPoints] = useState<LatLngLiteral[]>([]);
  const [saving, setSaving] = useState(false);

  const center = useMemo<LatLngLiteral | null>(() => {
    if (structure.origin_latitude != null && structure.origin_longitude != null) {
      return { lat: structure.origin_latitude, lng: structure.origin_longitude };
    }
    const first = cameraNodes.find((node) => node.latitude != null && node.longitude != null);
    return first?.latitude != null && first.longitude != null
      ? { lat: first.latitude, lng: first.longitude }
      : null;
  }, [cameraNodes, structure.origin_latitude, structure.origin_longitude]);

  useEffect(() => {
    let cancelled = false;
    void loadGoogleMaps()
      .then(() => {
        if (cancelled || !hostRef.current || !window.google?.maps) return;
        if (!mapRef.current) {
          mapRef.current = new window.google.maps.Map(hostRef.current, {
            center: center ?? { lat: -38.9, lng: -70.0 },
            zoom: structure.map_zoom ?? 19,
            mapTypeId: structure.map_type ?? "satellite",
            disableDefaultUI: true,
            zoomControl: true,
            mapTypeControl: false,
            streetViewControl: false,
            rotateControl: true,
            fullscreenControl: true,
            clickableIcons: false,
          });
        }
        setReady(true);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Google Maps no pudo cargar."));
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!mapRef.current || !center) return;
    mapRef.current.setCenter(center);
    if (structure.map_zoom != null) mapRef.current.setZoom(structure.map_zoom);
    mapRef.current.setMapTypeId(structure.map_type ?? "satellite");
  }, [center?.lat, center?.lng, structure.map_type, structure.map_zoom]);

  useEffect(() => {
    if (!mapRef.current || !selectedImageId) return;
    const selectedNode = cameraNodes.find((node) => node.image_id === selectedImageId);
    if (selectedNode?.latitude == null || selectedNode.longitude == null) return;
    mapRef.current.setCenter({ lat: selectedNode.latitude, lng: selectedNode.longitude });
  }, [cameraNodes, selectedImageId]);

  useEffect(() => {
    if (!ready || !mapRef.current || !window.google?.maps) return;
    for (const overlay of overlaysRef.current) overlay.setMap(null);
    for (const listener of listenersRef.current) listener.remove();
    overlaysRef.current = [];
    listenersRef.current = [];
    const maps = window.google.maps;
    const map = mapRef.current;

    for (const node of cameraNodes) {
      if (node.latitude == null || node.longitude == null) continue;
      const selected = node.image_id === selectedImageId;
      const marker = new maps.Marker({
        map,
        position: { lat: node.latitude, lng: node.longitude },
        title: "Cámara de evidencia",
        zIndex: selected ? 100 : 20,
        icon: {
          path: 0,
          scale: selected ? 8 : 6,
          fillColor: selected ? "#ffffff" : "#8b5cf6",
          fillOpacity: 1,
          strokeColor: "#05030a",
          strokeWeight: 2,
        },
      });
      overlaysRef.current.push(marker);
      listenersRef.current.push(marker.addListener("click", () => onSelectImage(node.image_id)));

      if (node.heading != null) {
        const radians = node.heading * Math.PI / 180;
        const lengthMeters = selected ? 10 : 7;
        const dLat = (Math.cos(radians) * lengthMeters / 6_378_137) * (180 / Math.PI);
        const dLon = (Math.sin(radians) * lengthMeters / (6_378_137 * Math.cos(node.latitude * Math.PI / 180))) * (180 / Math.PI);
        const line = new maps.Polyline({
          map,
          path: [
            { lat: node.latitude, lng: node.longitude },
            { lat: node.latitude + dLat, lng: node.longitude + dLon },
          ],
          strokeColor: selected ? "#ffffff" : "#a78bfa",
          strokeOpacity: selected ? 1 : 0.7,
          strokeWeight: selected ? 3 : 2,
          icons: [{ icon: { path: maps.SymbolPath.FORWARD_CLOSED_ARROW }, offset: "100%" }],
        });
        overlaysRef.current.push(line);
      }
    }

    for (const feature of spatialFeatures) {
      const points = geometryPoints(feature);
      const selected = feature.id === selectedFeatureId;
      if (!points.length) continue;

      if (feature.geometry.type === "Point") {
        const marker = new maps.Marker({
          map,
          position: points[0],
          title: feature.name ?? feature.feature_type,
          zIndex: selected ? 90 : 10,
          icon: {
            path: 0,
            scale: selected ? 7 : 5,
            fillColor: selected ? "#22d3ee" : "#f8fafc",
            fillOpacity: 0.95,
            strokeColor: "#05030a",
            strokeWeight: 2,
          },
        });
        overlaysRef.current.push(marker);
        listenersRef.current.push(marker.addListener("click", () => onSelectFeature(feature.id)));
      } else if (feature.geometry.type === "LineString") {
        const line = new maps.Polyline({
          map,
          path: points,
          strokeColor: selected ? "#22d3ee" : "#e2e8f0",
          strokeOpacity: selected ? 1 : 0.65,
          strokeWeight: selected ? 4 : 2,
          clickable: true,
        });
        overlaysRef.current.push(line);
        listenersRef.current.push((line as unknown as { addListener: (eventName: string, handler: () => void) => MapListener }).addListener("click", () => onSelectFeature(feature.id)));
      } else {
        const polygon = new maps.Polygon({
          map,
          paths: points,
          strokeColor: selected ? "#22d3ee" : feature.feature_type === "building_footprint" ? "#a78bfa" : "#e2e8f0",
          strokeOpacity: selected ? 1 : 0.8,
          strokeWeight: selected ? 4 : 2,
          fillColor: feature.feature_type === "building_footprint" ? "#7c3aed" : "#ffffff",
          fillOpacity: selected ? 0.18 : 0.08,
          clickable: true,
          editable: editMode === "edit" && selected,
        });
        overlaysRef.current.push(polygon);
        listenersRef.current.push(polygon.addListener("click", () => onSelectFeature(feature.id)));

        if (editMode === "edit" && selected) {
          const path = polygon.getPath();
          const persist = () => { void onUpdateFeature(feature.id, { geometry: pathToPolygonGeometry(path) }); };
          listenersRef.current.push(path.addListener("set_at", persist));
          listenersRef.current.push(path.addListener("insert_at", persist));
          listenersRef.current.push(path.addListener("remove_at", persist));
        }
      }
    }

    return () => {
      for (const overlay of overlaysRef.current) overlay.setMap(null);
      for (const listener of listenersRef.current) listener.remove();
      overlaysRef.current = [];
      listenersRef.current = [];
    };
  }, [ready, cameraNodes, spatialFeatures, selectedImageId, selectedFeatureId, editMode, onSelectImage, onSelectFeature, onUpdateFeature]);

  useEffect(() => {
    if (!ready || !mapRef.current || !window.google?.maps) return;
    clickListenerRef.current?.remove();
    clickListenerRef.current = null;

    const active = originPickActive || editMode === "point" || editMode === "footprint" || editMode === "measure";
    if (!active) {
      setDraftPoints([]);
      draftOverlayRef.current?.setMap(null);
      draftOverlayRef.current = null;
      return;
    }

    clickListenerRef.current = mapRef.current.addListener("click", (event) => {
      const point = pointFromEvent(event);
      if (!point) return;
      if (originPickActive) {
        void onSetOriginFromMap(point);
        return;
      }
      if (editMode === "point") {
        void onCreateFeature({
          featureType: "reference_point",
          name: "Punto de referencia",
          geometry: { type: "Point", coordinates: [point.lng, point.lat] },
        });
        return;
      }
      setDraftPoints((current) => [...current, point]);
    });

    return () => {
      clickListenerRef.current?.remove();
      clickListenerRef.current = null;
    };
  }, [ready, editMode, originPickActive, onCreateFeature, onSetOriginFromMap]);

  useEffect(() => {
    if (!ready || !mapRef.current || !window.google?.maps) return;
    draftOverlayRef.current?.setMap(null);
    draftOverlayRef.current = null;
    if (!draftPoints.length) return;
    const draft = new window.google.maps.Polyline({
      map: mapRef.current,
      path: draftPoints,
      strokeColor: editMode === "measure" ? "#22d3ee" : "#ffffff",
      strokeOpacity: 0.95,
      strokeWeight: 3,
    });
    draftOverlayRef.current = draft;
    return () => {
      draft.setMap(null);
      if (draftOverlayRef.current === draft) draftOverlayRef.current = null;
    };
  }, [ready, draftPoints, editMode]);

  async function closeFootprint() {
    if (draftPoints.length < 3 || saving) return;
    setSaving(true);
    try {
      await onCreateFeature({
        featureType: "building_footprint",
        name: "Huella principal",
        geometry: {
          type: "Polygon",
          coordinates: [[
            ...draftPoints.map((point) => [point.lng, point.lat] as [number, number]),
            [draftPoints[0].lng, draftPoints[0].lat],
          ]],
        },
        properties: { volume_enabled: false },
      });
      setDraftPoints([]);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="relative h-full min-h-[430px] w-full overflow-hidden rounded-[1.6rem] border border-white/10 bg-[#07050b]">
      <div ref={hostRef} className="absolute inset-0" />
      {!ready && !error ? (
        <div className="absolute inset-0 grid place-items-center bg-[#07050b]">
          <Loader2 className="h-6 w-6 animate-spin text-violet-300" />
        </div>
      ) : null}
      {error ? (
        <div className="absolute inset-0 grid place-items-center bg-[#07050b] p-6 text-center">
          <div>
            <MapPin className="mx-auto h-6 w-6 text-violet-300" />
            <p className="mt-3 text-sm text-white/70">{error}</p>
            <p className="mt-1 text-xs text-white/35">Configurá la key del frontend con restricción de dominio.</p>
          </div>
        </div>
      ) : null}

      <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap gap-2">
        <span className="rounded-full border border-white/10 bg-black/70 px-3 py-1.5 text-[10px] uppercase tracking-[0.14em] text-white/70 backdrop-blur">
          Google {structure.map_type === "roadmap" ? "Maps" : "Satellite"}
        </span>
        {originPickActive ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-cyan-300/20 bg-cyan-400/10 px-3 py-1.5 text-[10px] text-cyan-100 backdrop-blur">
            <Crosshair className="h-3 w-3" /> Tocá el origen
          </span>
        ) : null}
      </div>

      {editMode === "measure" && draftPoints.length ? (
        <div className="absolute bottom-3 left-3 rounded-xl border border-cyan-300/20 bg-black/80 px-3 py-2 text-xs text-cyan-100 backdrop-blur">
          <span className="inline-flex items-center gap-1.5"><Ruler className="h-3.5 w-3.5" /> {metersBetween(structure, draftPoints).toFixed(2)} m</span>
        </div>
      ) : null}

      {editMode === "footprint" && draftPoints.length ? (
        <div className="absolute bottom-3 left-3 flex gap-2 rounded-xl border border-white/10 bg-black/80 p-2 backdrop-blur">
          <button
            type="button"
            onClick={() => void closeFootprint()}
            disabled={draftPoints.length < 3 || saving}
            className="rounded-lg bg-white px-3 py-2 text-[10px] font-semibold text-black disabled:opacity-40"
          >
            {saving ? "Guardando…" : `Cerrar huella · ${draftPoints.length} puntos`}
          </button>
          <button type="button" onClick={() => setDraftPoints([])} className="rounded-lg border border-white/10 p-2 text-white/60">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
