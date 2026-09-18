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
  addListener: (
    eventName: string,
    handler: (event: { latLng?: { lat: () => number; lng: () => number } }) => void,
  ) => MapListener;
};
type OverlayLike = {
  setMap: (map: MapLike | null) => void;
  setOptions?: (options: Record<string, unknown>) => void;
};
type MarkerLike = OverlayLike & {
  addListener: (eventName: string, handler: () => void) => MapListener;
};
type PolylineLike = OverlayLike & {
  addListener: (eventName: string, handler: () => void) => MapListener;
  setPath?: (path: LatLngLiteral[]) => void;
};
type PolygonLike = OverlayLike & {
  getPath: () => MapPath;
  addListener: (eventName: string, handler: () => void) => MapListener;
};
type GoogleMapsNamespace = {
  Map: new (element: HTMLElement, options: Record<string, unknown>) => MapLike;
  Marker: new (options: Record<string, unknown>) => MarkerLike;
  Polyline: new (options: Record<string, unknown>) => PolylineLike;
  Polygon: new (options: Record<string, unknown>) => PolygonLike;
  SymbolPath: {
    CIRCLE: unknown;
    FORWARD_CLOSED_ARROW: unknown;
  };
};

type CameraOverlay = {
  marker: MarkerLike;
  headingLine: PolylineLike | null;
  listeners: MapListener[];
};

type FeatureOverlay = {
  overlay: MarkerLike | PolylineLike | PolygonLike;
  polygon: PolygonLike | null;
  listeners: MapListener[];
  featureType: StructureSpatialFeatureRecord["feature_type"];
  geometryType: StructureSpatialFeatureRecord["geometry"]["type"];
};

type MapsWindow = Window & {
  google?: { maps?: GoogleMapsNamespace };
  __clouvaMapsPromise?: Promise<void>;
};

function mapsWindow() {
  return window as unknown as MapsWindow;
}

function loadGoogleMaps() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Google Maps requiere navegador."));
  }
  const browser = mapsWindow();
  if (browser.google?.maps) return Promise.resolve();
  if (browser.__clouvaMapsPromise) return browser.__clouvaMapsPromise;

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) return Promise.reject(new Error("Falta NEXT_PUBLIC_GOOGLE_MAPS_API_KEY."));

  browser.__clouvaMapsPromise = new Promise<void>((resolve, reject) => {
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

  return browser.__clouvaMapsPromise;
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

function headingEndpoint(node: StructureCameraNodeRecord, lengthMeters = 7): LatLngLiteral | null {
  if (node.latitude == null || node.longitude == null || node.heading == null) return null;
  const radians = node.heading * Math.PI / 180;
  const latitudeRadians = node.latitude * Math.PI / 180;
  const cosine = Math.max(1e-8, Math.abs(Math.cos(latitudeRadians)));
  const dLat = (Math.cos(radians) * lengthMeters / 6_378_137) * (180 / Math.PI);
  const dLon = (Math.sin(radians) * lengthMeters / (6_378_137 * cosine)) * (180 / Math.PI);
  return { lat: node.latitude + dLat, lng: node.longitude + dLon };
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

function clearCameraLayer(layer: Map<string, CameraOverlay>) {
  for (const record of layer.values()) {
    record.marker.setMap(null);
    record.headingLine?.setMap(null);
    for (const listener of record.listeners) listener.remove();
  }
  layer.clear();
}

function clearFeatureLayer(layer: Map<string, FeatureOverlay>) {
  for (const record of layer.values()) {
    record.overlay.setMap(null);
    for (const listener of record.listeners) listener.remove();
  }
  layer.clear();
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
  onSetOriginFromMap: (point: LatLngLiteral) => Promise<unknown>;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLike | null>(null);
  const cameraLayerRef = useRef<Map<string, CameraOverlay>>(new Map());
  const featureLayerRef = useRef<Map<string, FeatureOverlay>>(new Map());
  const clickListenerRef = useRef<MapListener | null>(null);
  const draftOverlayRef = useRef<OverlayLike | null>(null);
  const selectImageRef = useRef(onSelectImage);
  const selectFeatureRef = useRef(onSelectFeature);
  const createFeatureRef = useRef(onCreateFeature);
  const updateFeatureRef = useRef(onUpdateFeature);
  const setOriginRef = useRef(onSetOriginFromMap);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftPoints, setDraftPoints] = useState<LatLngLiteral[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => { selectImageRef.current = onSelectImage; }, [onSelectImage]);
  useEffect(() => { selectFeatureRef.current = onSelectFeature; }, [onSelectFeature]);
  useEffect(() => { createFeatureRef.current = onCreateFeature; }, [onCreateFeature]);
  useEffect(() => { updateFeatureRef.current = onUpdateFeature; }, [onUpdateFeature]);
  useEffect(() => { setOriginRef.current = onSetOriginFromMap; }, [onSetOriginFromMap]);

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
        if (cancelled || !hostRef.current || !mapsWindow().google?.maps) return;
        if (!mapRef.current) {
          mapRef.current = new mapsWindow().google!.maps!.Map(hostRef.current, {
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
      .catch((reason) => {
        setError(reason instanceof Error ? reason.message : "Google Maps no pudo cargar.");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready || !mapRef.current || !center) return;
    mapRef.current.setCenter(center);
    if (structure.map_zoom != null) mapRef.current.setZoom(structure.map_zoom);
    mapRef.current.setMapTypeId(structure.map_type ?? "satellite");
  }, [ready, center?.lat, center?.lng, structure.map_type, structure.map_zoom]);

  // Permanent camera layer: rebuild only when camera data changes, never on selection.
  useEffect(() => {
    if (!ready || !mapRef.current || !mapsWindow().google?.maps) return;
    const layer = cameraLayerRef.current;
    clearCameraLayer(layer);

    const maps = mapsWindow().google!.maps!;
    for (const node of cameraNodes) {
      if (node.latitude == null || node.longitude == null) continue;

      const marker = new maps.Marker({
        map: mapRef.current,
        position: { lat: node.latitude, lng: node.longitude },
        title: "Cámara de evidencia",
        zIndex: 20,
        icon: {
          path: maps.SymbolPath.CIRCLE,
          scale: 6,
          fillColor: "#8b5cf6",
          fillOpacity: 1,
          strokeColor: "#05030a",
          strokeWeight: 2,
        },
      });
      const listeners: MapListener[] = [
        marker.addListener("click", () => selectImageRef.current(node.image_id)),
      ];

      const endpoint = headingEndpoint(node);
      const headingLine = endpoint
        ? new maps.Polyline({
            map: mapRef.current,
            path: [
              { lat: node.latitude, lng: node.longitude },
              endpoint,
            ],
            strokeColor: "#a78bfa",
            strokeOpacity: 0.7,
            strokeWeight: 2,
            icons: [{
              icon: { path: maps.SymbolPath.FORWARD_CLOSED_ARROW },
              offset: "100%",
            }],
          })
        : null;

      layer.set(node.image_id, { marker, headingLine, listeners });
    }

    return () => clearCameraLayer(layer);
  }, [ready, cameraNodes]);

  // Selection changes only marker/heading highlight and map focus; the layer remains mounted.
  useEffect(() => {
    if (!ready || !mapsWindow().google?.maps) return;
    const maps = mapsWindow().google!.maps!;

    for (const [imageId, record] of cameraLayerRef.current.entries()) {
      const selected = imageId === selectedImageId;
      record.marker.setOptions?.({
        zIndex: selected ? 100 : 20,
        icon: {
          path: maps.SymbolPath.CIRCLE,
          scale: selected ? 8 : 6,
          fillColor: selected ? "#ffffff" : "#8b5cf6",
          fillOpacity: 1,
          strokeColor: "#05030a",
          strokeWeight: 2,
        },
      });
      record.headingLine?.setOptions?.({
        strokeColor: selected ? "#ffffff" : "#a78bfa",
        strokeOpacity: selected ? 1 : 0.7,
        strokeWeight: selected ? 3 : 2,
      });
    }

    if (!mapRef.current || !selectedImageId) return;
    const selectedNode = cameraNodes.find((node) => node.image_id === selectedImageId);
    if (selectedNode?.latitude == null || selectedNode.longitude == null) return;
    mapRef.current.setCenter({ lat: selectedNode.latitude, lng: selectedNode.longitude });
  }, [ready, cameraNodes, selectedImageId]);

  // Permanent feature layer: rebuild only when persisted geometry changes.
  useEffect(() => {
    if (!ready || !mapRef.current || !mapsWindow().google?.maps) return;
    const layer = featureLayerRef.current;
    clearFeatureLayer(layer);

    const maps = mapsWindow().google!.maps!;
    for (const feature of spatialFeatures) {
      const points = geometryPoints(feature);
      if (!points.length) continue;

      const listeners: MapListener[] = [];
      if (feature.geometry.type === "Point") {
        const marker = new maps.Marker({
          map: mapRef.current,
          position: points[0],
          title: feature.name ?? feature.feature_type,
          zIndex: 10,
          icon: {
            path: maps.SymbolPath.CIRCLE,
            scale: 5,
            fillColor: "#f8fafc",
            fillOpacity: 0.95,
            strokeColor: "#05030a",
            strokeWeight: 2,
          },
        });
        listeners.push(marker.addListener("click", () => selectFeatureRef.current(feature.id)));
        layer.set(feature.id, {
          overlay: marker,
          polygon: null,
          listeners,
          featureType: feature.feature_type,
          geometryType: feature.geometry.type,
        });
        continue;
      }

      if (feature.geometry.type === "LineString") {
        const line = new maps.Polyline({
          map: mapRef.current,
          path: points,
          strokeColor: "#e2e8f0",
          strokeOpacity: 0.65,
          strokeWeight: 2,
          clickable: true,
        });
        listeners.push(line.addListener("click", () => selectFeatureRef.current(feature.id)));
        layer.set(feature.id, {
          overlay: line,
          polygon: null,
          listeners,
          featureType: feature.feature_type,
          geometryType: feature.geometry.type,
        });
        continue;
      }

      const polygon = new maps.Polygon({
        map: mapRef.current,
        paths: points,
        strokeColor: feature.feature_type === "building_footprint" ? "#a78bfa" : "#e2e8f0",
        strokeOpacity: 0.8,
        strokeWeight: 2,
        fillColor: feature.feature_type === "building_footprint" ? "#7c3aed" : "#ffffff",
        fillOpacity: 0.08,
        clickable: true,
        editable: false,
      });
      listeners.push(polygon.addListener("click", () => selectFeatureRef.current(feature.id)));

      const path = polygon.getPath();
      const persist = () => {
        void updateFeatureRef.current(feature.id, {
          geometry: pathToPolygonGeometry(path),
        });
      };
      listeners.push(path.addListener("set_at", persist));
      listeners.push(path.addListener("insert_at", persist));
      listeners.push(path.addListener("remove_at", persist));

      layer.set(feature.id, {
        overlay: polygon,
        polygon,
        listeners,
        featureType: feature.feature_type,
        geometryType: feature.geometry.type,
      });
    }

    return () => clearFeatureLayer(layer);
  }, [ready, spatialFeatures]);

  // Feature selection/edit mode updates options only; geometry objects stay alive.
  useEffect(() => {
    if (!ready || !mapsWindow().google?.maps) return;
    const maps = mapsWindow().google!.maps!;

    for (const [featureId, record] of featureLayerRef.current.entries()) {
      const selected = featureId === selectedFeatureId;
      if (record.geometryType === "Point") {
        record.overlay.setOptions?.({
          zIndex: selected ? 90 : 10,
          icon: {
            path: maps.SymbolPath.CIRCLE,
            scale: selected ? 7 : 5,
            fillColor: selected ? "#22d3ee" : "#f8fafc",
            fillOpacity: 0.95,
            strokeColor: "#05030a",
            strokeWeight: 2,
          },
        });
      } else if (record.geometryType === "LineString") {
        record.overlay.setOptions?.({
          strokeColor: selected ? "#22d3ee" : "#e2e8f0",
          strokeOpacity: selected ? 1 : 0.65,
          strokeWeight: selected ? 4 : 2,
        });
      } else {
        record.overlay.setOptions?.({
          strokeColor: selected
            ? "#22d3ee"
            : record.featureType === "building_footprint" ? "#a78bfa" : "#e2e8f0",
          strokeOpacity: selected ? 1 : 0.8,
          strokeWeight: selected ? 4 : 2,
          fillColor: record.featureType === "building_footprint" ? "#7c3aed" : "#ffffff",
          fillOpacity: selected ? 0.18 : 0.08,
          editable: editMode === "edit" && selected,
        });
      }
    }
  }, [ready, selectedFeatureId, editMode]);

  useEffect(() => {
    if (!ready || !mapRef.current) return;
    clickListenerRef.current?.remove();
    clickListenerRef.current = null;

    const active = originPickActive
      || editMode === "point"
      || editMode === "footprint"
      || editMode === "measure";

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
        void setOriginRef.current(point);
        return;
      }

      if (editMode === "point") {
        void createFeatureRef.current({
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
  }, [ready, editMode, originPickActive]);

  useEffect(() => {
    if (!ready || !mapRef.current || !mapsWindow().google?.maps) return;
    draftOverlayRef.current?.setMap(null);
    draftOverlayRef.current = null;
    if (!draftPoints.length) return;

    const draft = new mapsWindow().google!.maps!.Polyline({
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
      const created = await createFeatureRef.current({
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
      if (created !== false) setDraftPoints([]);
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
            <p className="mt-1 text-xs text-white/35">
              Configurá la key del frontend con restricción de dominio.
            </p>
          </div>
        </div>
      ) : null}

      <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap gap-2">
        <span className="rounded-full border border-white/10 bg-black/70 px-3 py-1.5 text-[10px] uppercase tracking-[0.14em] text-white/70 backdrop-blur">
          Google {structure.map_type === "roadmap" ? "Maps" : "Satellite"}
        </span>
        {originPickActive ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-cyan-300/20 bg-cyan-400/10 px-3 py-1.5 text-[10px] text-cyan-100 backdrop-blur">
            <Crosshair className="h-3 w-3" />
            Tocá el origen
          </span>
        ) : null}
      </div>

      {editMode === "measure" && draftPoints.length ? (
        <div className="absolute bottom-3 left-3 rounded-xl border border-cyan-300/20 bg-black/80 px-3 py-2 text-xs text-cyan-100 backdrop-blur">
          <span className="inline-flex items-center gap-1.5">
            <Ruler className="h-3.5 w-3.5" />
            {metersBetween(structure, draftPoints).toFixed(2)} m
          </span>
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
          <button
            type="button"
            onClick={() => setDraftPoints([])}
            className="rounded-lg border border-white/10 p-2 text-white/60"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
