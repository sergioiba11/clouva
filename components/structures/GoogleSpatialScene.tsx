"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  localMetersToCoordinates,
  type StructureCameraNodeRecord,
  type StructureImageRecord,
  type StructureRecord,
  type StructureSurfaceRecord,
} from "@/lib/structures/spatial";

type GoogleSpatialMode = "map" | "satellite";
type LocalPoint = { x: number; y: number };
type Blockout = { footprint?: LocalPoint[] };

type LatLngLiteral = { lat: number; lng: number };

type GoogleBounds = {
  extend: (point: LatLngLiteral) => GoogleBounds;
  contains: (point: LatLngLiteral) => boolean;
};

type GoogleMapInstance = {
  fitBounds: (
    bounds: GoogleBounds,
    padding?: number | { top: number; right: number; bottom: number; left: number },
  ) => void;
  getBounds: () => GoogleBounds | null;
  panTo: (point: LatLngLiteral) => void;
  setCenter: (point: LatLngLiteral) => void;
  setMapTypeId: (mapTypeId: string) => void;
  setOptions: (options: Record<string, unknown>) => void;
  setZoom: (zoom: number) => void;
};

type GoogleMapOverlay = {
  setMap: (map: GoogleMapInstance | null) => void;
  addListener?: (eventName: string, handler: () => void) => { remove?: () => void };
};

type GoogleMapsNamespace = {
  importLibrary: (name: string) => Promise<unknown>;
  Map: new (element: HTMLElement, options: Record<string, unknown>) => GoogleMapInstance;
  LatLngBounds: new () => GoogleBounds;
  Circle: new (options: Record<string, unknown>) => GoogleMapOverlay;
  Polygon: new (options: Record<string, unknown>) => GoogleMapOverlay;
  Polyline: new (options: Record<string, unknown>) => GoogleMapOverlay;
  RenderingType?: { VECTOR?: unknown };
};

type GoogleMapsGlobal = {
  maps: GoogleMapsNamespace;
};

let googleMapsLoadPromise: Promise<GoogleMapsGlobal> | null = null;

function browserGoogle() {
  if (typeof window === "undefined") return null;
  return (window as unknown as { google?: GoogleMapsGlobal }).google ?? null;
}

function loadGoogleMaps(apiKey: string) {
  const loaded = browserGoogle();
  if (loaded?.maps?.importLibrary) return Promise.resolve(loaded);
  if (googleMapsLoadPromise) return googleMapsLoadPromise;

  googleMapsLoadPromise = new Promise<GoogleMapsGlobal>((resolve, reject) => {
    const finish = () => {
      const google = browserGoogle();
      if (google?.maps?.importLibrary) {
        resolve(google);
      } else {
        googleMapsLoadPromise = null;
        reject(new Error("Google Maps se cargó sin exponer importLibrary()."));
      }
    };

    const fail = () => {
      googleMapsLoadPromise = null;
      reject(new Error("No se pudo cargar Google Maps JavaScript API."));
    };

    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-clouva-google-maps="true"]',
    );
    if (existing) {
      existing.addEventListener("load", finish, { once: true });
      existing.addEventListener("error", fail, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src =
      "https://maps.googleapis.com/maps/api/js?key=" +
      encodeURIComponent(apiKey) +
      "&v=weekly&loading=async";
    script.async = true;
    script.defer = true;
    script.dataset.clouvaGoogleMaps = "true";
    script.addEventListener("load", finish, { once: true });
    script.addEventListener("error", fail, { once: true });
    document.head.appendChild(script);
  });

  return googleMapsLoadPromise;
}

function finiteNumber(value: unknown) {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function validCoordinate(latitude: unknown, longitude: unknown): LatLngLiteral | null {
  const lat = finiteNumber(latitude);
  const lng = finiteNumber(longitude);
  if (lat == null || lng == null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

function validLocalPoint(point: unknown): LocalPoint | null {
  if (!point || typeof point !== "object") return null;
  const record = point as Record<string, unknown>;
  const x = finiteNumber(record.x);
  const y = finiteNumber(record.y);
  return x == null || y == null ? null : { x, y };
}

function surfacePoints(surface: StructureSurfaceRecord) {
  const geometry = surface.geometry;
  if (!geometry || typeof geometry !== "object") return [] as LocalPoint[];
  const record = geometry as Record<string, unknown>;
  const candidates = [record.points, record.footprint, record.polygon];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    const points = candidate
      .map(validLocalPoint)
      .filter((point): point is LocalPoint => point != null);
    if (points.length >= 3) return points;
  }
  return [] as LocalPoint[];
}

function imageTone(image: StructureImageRecord | undefined) {
  if (!image) return "#a78bfa";
  if (image.placement_status === "blocked") return "#ef4444";
  if (image.placement_status === "needs_review") return "#f59e0b";
  if (image.spatial_source === "manual" || image.manual_verified) return "#22d3ee";
  if (image.spatial_source === "inferred_cloud") return "#fbbf24";
  return "#a78bfa";
}

function localDirectionPoint(
  local: LocalPoint,
  heading: number,
  distanceMeters: number,
): LocalPoint {
  const angle = heading * Math.PI / 180;
  return {
    x: local.x + Math.sin(angle) * distanceMeters,
    y: local.y + Math.cos(angle) * distanceMeters,
  };
}

function localToGeo(origin: LatLngLiteral, point: LocalPoint): LatLngLiteral {
  const result = localMetersToCoordinates(
    { latitude: origin.lat, longitude: origin.lng },
    point,
  );
  return { lat: result.latitude, lng: result.longitude };
}

export function GoogleSpatialScene({
  mode,
  structure,
  images,
  cameraNodes,
  surfaces,
  blockout,
  selectedImageId,
  onSelectImage,
}: {
  mode: GoogleSpatialMode;
  structure: StructureRecord;
  images: StructureImageRecord[];
  cameraNodes: StructureCameraNodeRecord[];
  surfaces: StructureSurfaceRecord[];
  blockout: Blockout;
  selectedImageId: string | null;
  onSelectImage: (id: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<GoogleMapInstance | null>(null);
  const mapsRef = useRef<GoogleMapsNamespace | null>(null);
  const overlaysRef = useRef<GoogleMapOverlay[]>([]);
  const [readyVersion, setReadyVersion] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() ?? "";
  const mapId = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID?.trim() ?? "";

  const imageById = useMemo(
    () => new Map(images.map((image) => [image.id, image])),
    [images],
  );

  const transformOrigin = useMemo(
    () =>
      validCoordinate(structure.origin_latitude, structure.origin_longitude)
      ?? validCoordinate(structure.latitude, structure.longitude),
    [
      structure.latitude,
      structure.longitude,
      structure.origin_latitude,
      structure.origin_longitude,
    ],
  );

  const cameraCoordinates = useMemo(() => {
    return cameraNodes
      .map((node) => {
        const x = finiteNumber(node.local_x);
        const y = finiteNumber(node.local_y);
        if (transformOrigin && x != null && y != null) {
          return {
            imageId: node.image_id,
            node,
            local: { x, y },
            geo: localToGeo(transformOrigin, { x, y }),
          };
        }

        const image = imageById.get(node.image_id);
        const direct =
          validCoordinate(node.latitude, node.longitude)
          ?? validCoordinate(image?.latitude, image?.longitude);
        if (!direct) return null;

        return {
          imageId: node.image_id,
          node,
          local: null,
          geo: direct,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item != null);
  }, [cameraNodes, imageById, transformOrigin]);

  const mapCenter = useMemo(() => {
    if (transformOrigin) return transformOrigin;
    if (!cameraCoordinates.length) return null;
    const lat = cameraCoordinates.reduce((sum, item) => sum + item.geo.lat, 0) / cameraCoordinates.length;
    const lng = cameraCoordinates.reduce((sum, item) => sum + item.geo.lng, 0) / cameraCoordinates.length;
    return { lat, lng };
  }, [cameraCoordinates, transformOrigin]);

  const footprintLocal = useMemo(
    () =>
      (Array.isArray(blockout.footprint) ? blockout.footprint : [])
        .map(validLocalPoint)
        .filter((point): point is LocalPoint => point != null),
    [blockout.footprint],
  );

  const footprintGeo = useMemo(
    () => transformOrigin
      ? footprintLocal.map((point) => localToGeo(transformOrigin, point))
      : [],
    [footprintLocal, transformOrigin],
  );

  const surfacePolygons = useMemo(
    () => {
      if (!transformOrigin) return [];
      return surfaces
        .map((surface) => ({
          surface,
          points: surfacePoints(surface).map((point) => localToGeo(transformOrigin, point)),
        }))
        .filter((item) => item.points.length >= 3);
    },
    [surfaces, transformOrigin],
  );

  const localSpan = useMemo(() => {
    const localPoints: LocalPoint[] = [
      ...footprintLocal,
      ...cameraCoordinates
        .map((item) => item.local)
        .filter((point): point is LocalPoint => point != null),
    ];
    if (!localPoints.length) return 50;
    const xs = localPoints.map((point) => point.x);
    const ys = localPoints.map((point) => point.y);
    return Math.max(
      12,
      Math.max(...xs) - Math.min(...xs),
      Math.max(...ys) - Math.min(...ys),
    );
  }, [cameraCoordinates, footprintLocal]);

  const allGeoPoints = useMemo(() => {
    const points: LatLngLiteral[] = [
      ...cameraCoordinates.map((item) => item.geo),
      ...footprintGeo,
      ...surfacePolygons.flatMap((item) => item.points),
    ];
    if (transformOrigin) points.push(transformOrigin);
    return points;
  }, [cameraCoordinates, footprintGeo, surfacePolygons, transformOrigin]);

  const fitAll = useCallback(() => {
    const map = mapRef.current;
    const maps = mapsRef.current;
    if (!map || !maps || !allGeoPoints.length) return;

    if (allGeoPoints.length === 1) {
      map.setCenter(allGeoPoints[0]);
      map.setZoom(19);
      return;
    }

    const bounds = new maps.LatLngBounds();
    allGeoPoints.forEach((point) => bounds.extend(point));
    map.fitBounds(bounds, { top: 72, right: 54, bottom: 54, left: 54 });
  }, [allGeoPoints]);

  useEffect(() => {
    if (!apiKey || !mapCenter || !containerRef.current) return;

    let cancelled = false;
    setLoadError(null);

    void loadGoogleMaps(apiKey)
      .then(async (google) => {
        await google.maps.importLibrary("maps");
        if (cancelled || !containerRef.current) return;

        mapsRef.current = google.maps;
        const options: Record<string, unknown> = {
          center: mapCenter,
          zoom: 19,
          mapTypeId: mode === "satellite" ? "satellite" : "roadmap",
          disableDefaultUI: true,
          zoomControl: true,
          fullscreenControl: false,
          streetViewControl: false,
          mapTypeControl: false,
          clickableIcons: false,
          gestureHandling: "greedy",
          tilt: 0,
          heading: 0,
        };
        if (mapId) options.mapId = mapId;
        if (google.maps.RenderingType?.VECTOR) {
          options.renderingType = google.maps.RenderingType.VECTOR;
        }

        mapRef.current = new google.maps.Map(containerRef.current, options);
        setReadyVersion((value) => value + 1);
      })
      .catch((error) => {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : "No se pudo cargar Google Maps.");
      });

    return () => {
      cancelled = true;
      overlaysRef.current.forEach((overlay) => overlay.setMap(null));
      overlaysRef.current = [];
      mapRef.current = null;
      mapsRef.current = null;
    };
  }, [apiKey, mapCenter?.lat, mapCenter?.lng, mapId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setMapTypeId(mode === "satellite" ? "satellite" : "roadmap");
    map.setOptions({ tilt: 0, heading: 0 });
  }, [mode, readyVersion]);

  useEffect(() => {
    const map = mapRef.current;
    const maps = mapsRef.current;
    if (!map || !maps) return;

    overlaysRef.current.forEach((overlay) => overlay.setMap(null));
    overlaysRef.current = [];
    const nextOverlays: GoogleMapOverlay[] = [];

    if (footprintGeo.length >= 3) {
      nextOverlays.push(new maps.Polygon({
        map,
        paths: footprintGeo,
        clickable: false,
        strokeColor: "#c4b5fd",
        strokeOpacity: 0.95,
        strokeWeight: 2,
        fillColor: "#7c3aed",
        fillOpacity: mode === "satellite" ? 0.12 : 0.08,
        zIndex: 2,
      }));
    }

    for (const item of surfacePolygons) {
      nextOverlays.push(new maps.Polygon({
        map,
        paths: item.points,
        clickable: false,
        strokeColor: "#8b5cf6",
        strokeOpacity: 0.48,
        strokeWeight: 1,
        fillColor: "#7c3aed",
        fillOpacity: 0.035,
        zIndex: 3,
      }));
    }

    const baseFovLength = Math.max(6, Math.min(26, localSpan * 0.075));

    for (const item of cameraCoordinates) {
      const image = imageById.get(item.imageId);
      const selected = item.imageId === selectedImageId;
      const tone = imageTone(image);
      const heading = finiteNumber(item.node.heading ?? image?.heading);
      const fov = Math.max(24, Math.min(110, finiteNumber(item.node.fov ?? image?.fov) ?? 55));

      if (transformOrigin && item.local && heading != null) {
        const length = selected ? baseFovLength * 1.25 : baseFovLength;
        const halfFov = fov / 2;
        const center = localToGeo(
          transformOrigin,
          localDirectionPoint(item.local, heading, length),
        );
        const left = localToGeo(
          transformOrigin,
          localDirectionPoint(item.local, heading - halfFov, length),
        );
        const right = localToGeo(
          transformOrigin,
          localDirectionPoint(item.local, heading + halfFov, length),
        );

        nextOverlays.push(new maps.Polygon({
          map,
          paths: [item.geo, left, right],
          clickable: false,
          strokeColor: tone,
          strokeOpacity: selected ? 0.78 : 0.32,
          strokeWeight: selected ? 2 : 1,
          fillColor: tone,
          fillOpacity: selected ? 0.12 : 0.045,
          zIndex: selected ? 8 : 4,
        }));
        nextOverlays.push(new maps.Polyline({
          map,
          path: [item.geo, center],
          clickable: false,
          strokeColor: selected ? "#ffffff" : tone,
          strokeOpacity: selected ? 1 : 0.72,
          strokeWeight: selected ? 3 : 1.5,
          zIndex: selected ? 10 : 5,
        }));
      }

      const nodeCircle = new maps.Circle({
        map,
        center: item.geo,
        radius: selected ? 1.65 : 1.08,
        clickable: true,
        strokeColor: selected ? "#ffffff" : tone,
        strokeOpacity: 1,
        strokeWeight: selected ? 3 : 2,
        fillColor: tone,
        fillOpacity: selected ? 1 : 0.88,
        zIndex: selected ? 20 : 12,
      });
      nodeCircle.addListener?.("click", () => onSelectImage(item.imageId));
      nextOverlays.push(nodeCircle);

      if (selected) {
        nextOverlays.push(new maps.Circle({
          map,
          center: item.geo,
          radius: 2.65,
          clickable: false,
          strokeColor: tone,
          strokeOpacity: 0.8,
          strokeWeight: 2,
          fillColor: tone,
          fillOpacity: 0.09,
          zIndex: 18,
        }));
      }
    }

    overlaysRef.current = nextOverlays;

    return () => {
      nextOverlays.forEach((overlay) => overlay.setMap(null));
      if (overlaysRef.current === nextOverlays) overlaysRef.current = [];
    };
  }, [
    cameraCoordinates,
    footprintGeo,
    imageById,
    localSpan,
    mode,
    onSelectImage,
    readyVersion,
    selectedImageId,
    surfacePolygons,
    transformOrigin,
  ]);

  useEffect(() => {
    if (!readyVersion) return;
    const frame = requestAnimationFrame(() => fitAll());
    return () => cancelAnimationFrame(frame);
  }, [fitAll, readyVersion]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedImageId) return;
    const selected = cameraCoordinates.find((item) => item.imageId === selectedImageId);
    if (!selected) return;
    const visible = map.getBounds();
    if (visible && !visible.contains(selected.geo)) {
      map.panTo(selected.geo);
    }
  }, [cameraCoordinates, readyVersion, selectedImageId]);

  if (!apiKey) {
    return (
      <div className="grid h-[500px] w-full place-items-center rounded-[1.7rem] border border-white/10 bg-[#07050b] text-center">
        <div>
          <p className="text-sm font-semibold text-white/70">Google Maps no está configurado.</p>
          <p className="mt-2 text-xs text-white/35">ESPACIAL sigue disponible sin Maps API.</p>
        </div>
      </div>
    );
  }

  if (!mapCenter) {
    return (
      <div className="grid h-[500px] w-full place-items-center rounded-[1.7rem] border border-white/10 bg-[#07050b] text-center">
        <div>
          <p className="text-sm font-semibold text-white/70">Esta estructura todavía no tiene origen geográfico.</p>
          <p className="mt-2 text-xs text-white/35">Agregá coordenadas reales o usá ESPACIAL.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-[500px] w-full overflow-hidden rounded-[1.7rem] border border-white/10 bg-[#07050b]">
      <div ref={containerRef} className="absolute inset-0" />

      {!readyVersion && !loadError ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-[#07050b]/85">
          <div className="flex items-center gap-2 text-xs text-white/55">
            <Loader2 className="h-4 w-4 animate-spin text-cyan-300" />
            Cargando Google Maps…
          </div>
        </div>
      ) : null}

      {loadError ? (
        <div className="absolute inset-0 grid place-items-center bg-[#07050b]/90 px-6 text-center">
          <p className="max-w-md text-sm text-red-200">{loadError}</p>
        </div>
      ) : null}

      <div className="pointer-events-none absolute left-3 top-3 rounded-full border border-white/10 bg-black/70 px-3 py-1.5 text-[10px] uppercase tracking-[0.16em] text-white/70 backdrop-blur">
        {mode === "satellite" ? "Satélite · cámaras reales" : "Mapa · cámaras reales"}
      </div>

      <button
        type="button"
        onClick={fitAll}
        disabled={!readyVersion}
        className="absolute right-3 top-3 rounded-full border border-white/15 bg-black/75 px-3 py-1.5 text-[10px] font-medium text-white/80 backdrop-blur transition hover:border-white/30 hover:text-white disabled:opacity-35"
      >
        Encuadrar todo
      </button>

      <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-2 rounded-full border border-white/10 bg-black/70 px-3 py-1.5 text-[10px] text-white/65 backdrop-blur">
        <span>{cameraCoordinates.length} cámaras georreferenciadas</span>
        <span className="h-1 w-1 rounded-full bg-white/25" />
        <span>{footprintGeo.length >= 3 ? "footprint activo" : "sin footprint geográfico"}</span>
      </div>

      <div className="pointer-events-none absolute bottom-3 right-3 flex items-center gap-2 rounded-full border border-white/10 bg-black/70 px-3 py-1.5 text-[9px] text-white/55 backdrop-blur">
        <span className="h-2 w-2 rounded-full bg-violet-400" /> metadatos
        <span className="h-2 w-2 rounded-full bg-amber-300" /> IA
        <span className="h-2 w-2 rounded-full bg-cyan-300" /> manual
      </div>
    </div>
  );
}
