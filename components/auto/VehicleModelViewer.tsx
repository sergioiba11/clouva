"use client";

import { useEffect, useRef } from "react";
import {
  Box3,
  BoxGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  FogExp2,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import {
  DEFAULT_VEHICLE_SHOW,
  DEFAULT_VEHICLE_TUNING,
  type VehicleShowConfig,
  type VehicleTuningConfig,
} from "@/lib/auto/visual-config";

type Props = {
  modelUrl?: string | null;
  partMeshMap?: Record<string, unknown> | null;
  selectedPartKey?: string | null;
  onSelectPart?: (partKey: string) => void;
  tuningConfig?: VehicleTuningConfig;
  showConfig?: VehicleShowConfig;
  audioAnalyser?: AnalyserNode | null;
  showMode?: boolean;
  className?: string;
};

function material(hex: number, roughness = 0.55, metalness = 0.15) {
  return new MeshStandardMaterial({ color: hex, roughness, metalness });
}

function tag<T extends Object3D>(object: T, partKey: string, tuningRole?: string) {
  object.userData.partKey = partKey;
  if (tuningRole) object.userData.tuningRole = tuningRole;
  object.traverse((child) => {
    child.userData.partKey = child.userData.partKey || partKey;
    if (tuningRole) child.userData.tuningRole = child.userData.tuningRole || tuningRole;
  });
  return object;
}

function proceduralVehicle() {
  const root = new Group();
  root.name = "CLOUVA Auto nivel 1";

  const body = tag(new Mesh(new BoxGeometry(4.2, 0.8, 1.75), material(0x5b32a8, 0.38, 0.28)), "body", "body");
  body.name = "clouva_body";
  body.position.y = 0.85;
  root.add(body);

  const cabin = tag(new Mesh(new BoxGeometry(2.05, 0.75, 1.55), material(0x23212d, 0.22, 0.35)), "interior", "glass");
  cabin.name = "clouva_window_cabin";
  cabin.position.set(-0.25, 1.55, 0);
  root.add(cabin);

  const bumper = tag(new Mesh(new BoxGeometry(0.25, 0.48, 1.85), material(0x17151e, 0.48, 0.22)), "front_bumper", "body");
  bumper.name = "clouva_front_bumper";
  bumper.position.set(2.18, 0.72, 0);
  root.add(bumper);

  for (const z of [-0.68, 0.68]) {
    const light = tag(new Mesh(new BoxGeometry(0.1, 0.24, 0.36), material(0xccecff, 0.15, 0.12)), "headlights", "headlight");
    light.name = z < 0 ? "clouva_headlight_left" : "clouva_headlight_right";
    light.position.set(2.12, 1.02, z);
    root.add(light);
  }

  const wheelGeometry = new CylinderGeometry(0.48, 0.48, 0.3, 32);
  for (const x of [-1.35, 1.35]) {
    for (const z of [-0.94, 0.94]) {
      const wheel = tag(new Mesh(wheelGeometry, material(0x111115, 0.78, 0.18)), x > 0 ? "front_tires" : "rear_tires", "wheel");
      wheel.name = `clouva_wheel_${x}_${z}`;
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(x, 0.48, z);
      root.add(wheel);
    }
  }

  return root;
}

function normalizeModel(object: Object3D) {
  const box = new Box3().setFromObject(object);
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  const longest = Math.max(size.x, size.y, size.z) || 1;
  object.scale.setScalar(4.7 / longest);
  object.position.sub(center.multiplyScalar(4.7 / longest));
  const normalized = new Box3().setFromObject(object);
  object.position.y -= normalized.min.y - 0.05;
}

function applyMeshMap(root: Object3D, map: Record<string, unknown> | null | undefined) {
  if (!map) return;
  const byMesh = new Map<string, string>();
  for (const [key, value] of Object.entries(map)) {
    if (typeof value === "string") byMesh.set(key, value);
    if (Array.isArray(value)) {
      for (const meshName of value) if (typeof meshName === "string") byMesh.set(meshName, key);
    }
  }
  root.traverse((child) => {
    const mapped = byMesh.get(child.name);
    if (mapped) child.userData.partKey = mapped;
  });
}

function inferTuningRole(object: Object3D) {
  if (typeof object.userData.tuningRole === "string") return object.userData.tuningRole as string;
  const key = typeof object.userData.partKey === "string" ? object.userData.partKey : "";
  const name = object.name.toLowerCase();
  if (key === "front_tires" || key === "rear_tires" || /(wheel|rim|tire|tyre|llanta|rueda)/.test(name)) return "wheel";
  if (key === "headlights" || /(headlight|headlamp|optica|light_front)/.test(name)) return "headlight";
  if (/(glass|window|windshield|windscreen|parabris|ventana)/.test(name)) return "glass";
  if (key === "body" || key === "front_bumper" || /(body|paint|shell|carrocer|bumper|hood|bonnet|fender|door)/.test(name)) return "body";
  return null;
}

function cloneMaterials(root: Object3D) {
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    if (Array.isArray(object.material)) object.material = object.material.map((entry) => entry.clone());
    else object.material = object.material.clone();
    object.userData.__clouvaBaseScale = object.scale.clone();
    const role = inferTuningRole(object);
    if (role) object.userData.tuningRole = role;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    object.userData.__clouvaBaseColors = materials.map((entry) => ("color" in entry && entry.color instanceof Color ? entry.color.clone() : null));
    object.userData.__clouvaBaseOpacity = materials.map((entry) => entry.opacity);
  });
}

function averageBand(values: Uint8Array, from: number, to: number) {
  const start = Math.max(0, Math.min(values.length - 1, Math.floor(from)));
  const end = Math.max(start + 1, Math.min(values.length, Math.ceil(to)));
  let total = 0;
  for (let index = start; index < end; index += 1) total += values[index] ?? 0;
  return total / Math.max(1, end - start) / 255;
}

function readAudioBands(analyser: AnalyserNode | null, cache: { values: Uint8Array<ArrayBuffer> | null }) {
  if (!analyser) return { bass: 0, mid: 0, treble: 0, overall: 0 };
  if (!cache.values || cache.values.length !== analyser.frequencyBinCount) {
    cache.values = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
  }
  analyser.getByteFrequencyData(cache.values);
  const nyquist = analyser.context.sampleRate / 2;
  const binFor = (hz: number) => (hz / nyquist) * cache.values!.length;
  const bass = averageBand(cache.values, binFor(30), binFor(180));
  const mid = averageBand(cache.values, binFor(180), binFor(2600));
  const treble = averageBand(cache.values, binFor(2600), binFor(12000));
  return { bass, mid, treble, overall: (bass + mid + treble) / 3 };
}

export function VehicleModelViewer({
  modelUrl,
  partMeshMap,
  selectedPartKey,
  onSelectPart,
  tuningConfig = DEFAULT_VEHICLE_TUNING,
  showConfig = DEFAULT_VEHICLE_SHOW,
  audioAnalyser = null,
  showMode = false,
  className = "",
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef(selectedPartKey);
  const onSelectPartRef = useRef(onSelectPart);
  const tuningRef = useRef(tuningConfig);
  const showRef = useRef(showConfig);
  const analyserRef = useRef(audioAnalyser);
  const showModeRef = useRef(showMode);

  selectedRef.current = selectedPartKey;
  onSelectPartRef.current = onSelectPart;
  tuningRef.current = tuningConfig;
  showRef.current = showConfig;
  analyserRef.current = audioAnalyser;
  showModeRef.current = showMode;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new Scene();
    scene.background = new Color(0x08070c);
    scene.fog = new FogExp2(0x08070c, 0.035);

    const camera = new PerspectiveCamera(42, 1, 0.05, 100);
    camera.position.set(6.6, 3.5, 6.6);

    const renderer = new WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.touchAction = "none";
    host.appendChild(renderer.domElement);

    const hemi = new HemisphereLight(0xb7c8ff, 0x140d1e, 2.4);
    scene.add(hemi);
    const key = new DirectionalLight(0xffffff, 3.1);
    key.position.set(4, 7, 5);
    scene.add(key);
    const rim = new DirectionalLight(0x9b7bff, 2.1);
    rim.position.set(-5, 3, -4);
    scene.add(rim);

    const floorMaterial = new MeshStandardMaterial({ color: 0x0b0910, roughness: 0.74, metalness: 0.2 });
    const floor = new Mesh(new PlaneGeometry(30, 30), floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;
    scene.add(floor);

    const neonMaterial = new MeshBasicMaterial({ color: 0x8b5cff, transparent: true, opacity: 0.28, depthWrite: false });
    const neonPlane = new Mesh(new PlaneGeometry(4.9, 2.25), neonMaterial);
    neonPlane.rotation.x = -Math.PI / 2;
    neonPlane.position.y = 0.018;
    scene.add(neonPlane);

    const underglow = new PointLight(0x8b5cff, 2.2, 7, 2);
    underglow.position.set(0, 0.42, 0);
    scene.add(underglow);

    const headlightLeft = new PointLight(0xe8f6ff, 0, 8, 2);
    headlightLeft.position.set(2.7, 1, -0.62);
    scene.add(headlightLeft);
    const headlightRight = headlightLeft.clone();
    headlightRight.position.z = 0.62;
    scene.add(headlightRight);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 3.2;
    controls.maxDistance = 12;
    controls.target.set(0, 0.85, 0);

    let vehicleRoot: Object3D | null = null;
    let baseRootY = 0;
    let lastTuning = "";
    let lastScene = "";
    const audioCache: { values: Uint8Array<ArrayBuffer> | null } = { values: null };

    const addRoot = (root: Object3D) => {
      cloneMaterials(root);
      vehicleRoot = root;
      baseRootY = root.position.y;
      scene.add(root);
    };

    if (modelUrl) {
      const loader = new GLTFLoader();
      loader.setMeshoptDecoder(MeshoptDecoder);
      loader.load(
        modelUrl,
        (gltf) => {
          normalizeModel(gltf.scene);
          applyMeshMap(gltf.scene, partMeshMap);
          addRoot(gltf.scene);
        },
        undefined,
        () => addRoot(proceduralVehicle()),
      );
    } else {
      addRoot(proceduralVehicle());
    }

    const raycaster = new Raycaster();
    const pointer = new Vector2();
    const onPointer = (event: PointerEvent) => {
      if (!vehicleRoot || !onSelectPartRef.current) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObject(vehicleRoot, true)[0]?.object;
      let cursor: Object3D | null = hit ?? null;
      while (cursor && !cursor.userData.partKey) cursor = cursor.parent;
      const partKey = cursor?.userData.partKey;
      if (typeof partKey === "string") onSelectPartRef.current(partKey);
    };
    renderer.domElement.addEventListener("pointerup", onPointer);

    const resize = () => {
      const width = Math.max(host.clientWidth, 1);
      const height = Math.max(host.clientHeight, 1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    let frame = 0;
    const render = () => {
      const tuning = tuningRef.current;
      const show = showRef.current;
      const liveShow = showModeRef.current;
      const tuningSignature = JSON.stringify(tuning);
      const sceneSignature = `${show.scene}:${tuning.neonColor}`;

      if (vehicleRoot && tuningSignature !== lastTuning) {
        lastTuning = tuningSignature;
        vehicleRoot.traverse((object) => {
          if (!(object instanceof Mesh)) return;
          const role = typeof object.userData.tuningRole === "string" ? object.userData.tuningRole : inferTuningRole(object);
          const baseScale = object.userData.__clouvaBaseScale as Vector3 | undefined;
          if (role === "wheel" && baseScale) {
            object.scale.set(baseScale.x * tuning.wheelScale, baseScale.y * tuning.wheelScale, baseScale.z * tuning.wheelScale);
          }
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          const baseColors = object.userData.__clouvaBaseColors as Array<Color | null> | undefined;
          const baseOpacity = object.userData.__clouvaBaseOpacity as number[] | undefined;
          materials.forEach((entry, index) => {
            if ("color" in entry && entry.color instanceof Color) {
              const original = baseColors?.[index];
              if (original) entry.color.copy(original);
              if (role === "body") entry.color.set(tuning.bodyColor);
              if (role === "glass") entry.color.lerp(new Color(0x05050a), tuning.windowTint);
            }
            if (role === "glass") {
              entry.transparent = tuning.windowTint > 0.08;
              entry.opacity = Math.max(0.28, (baseOpacity?.[index] ?? 1) * (1 - tuning.windowTint * 0.48));
            }
            if (entry instanceof MeshStandardMaterial && role === "headlight") {
              entry.emissive.set(tuning.headlights ? 0xdaf5ff : 0x000000);
              entry.emissiveIntensity = tuning.headlights ? 1.9 : 0;
            }
          });
        });
        neonMaterial.color.set(tuning.neonColor);
        underglow.color.set(tuning.neonColor);
        controls.autoRotate = tuning.autoRotate || liveShow;
        headlightLeft.intensity = tuning.headlights ? 1.8 : 0;
        headlightRight.intensity = tuning.headlights ? 1.8 : 0;
      }

      if (sceneSignature !== lastScene) {
        lastScene = sceneSignature;
        if (show.scene === "ice") {
          scene.background = new Color(0x07121b);
          scene.fog = new FogExp2(0x07121b, 0.03);
          hemi.color.set(0xc9efff);
          rim.color.set(0x70d8ff);
          floorMaterial.color.set(0x071017);
        } else if (show.scene === "blackout") {
          scene.background = new Color(0x010102);
          scene.fog = new FogExp2(0x010102, 0.045);
          hemi.color.set(0x746d83);
          rim.color.set(0xa38cff);
          floorMaterial.color.set(0x030304);
        } else {
          scene.background = new Color(0x08070c);
          scene.fog = new FogExp2(0x08070c, 0.035);
          hemi.color.set(0xb7c8ff);
          rim.color.set(0x9b7bff);
          floorMaterial.color.set(0x0b0910);
        }
      }

      const bands = liveShow ? readAudioBands(analyserRef.current, audioCache) : { bass: 0, mid: 0, treble: 0, overall: 0 };
      const energy = show.reactivity;
      const bass = bands.bass * energy;
      const mid = bands.mid * energy;
      const treble = bands.treble * energy;

      if (vehicleRoot) {
        vehicleRoot.position.y = baseRootY + tuning.rideHeight + (liveShow ? bass * show.bassBounce * 0.095 : 0);
        vehicleRoot.traverse((object) => {
          if (!(object instanceof Mesh)) return;
          const selected = selectedRef.current && object.userData.partKey === selectedRef.current;
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const entry of materials) {
            if (entry instanceof MeshStandardMaterial) {
              if (selected) {
                entry.emissive.set(0x7c5cff);
                entry.emissiveIntensity = 0.9;
              } else if (object.userData.tuningRole === "headlight") {
                entry.emissive.set(tuning.headlights ? 0xdaf5ff : 0x000000);
                entry.emissiveIntensity = tuning.headlights ? 1.9 : 0;
              } else {
                entry.emissive.set(0x000000);
                entry.emissiveIntensity = 0;
              }
            }
          }
        });
      }

      controls.autoRotate = tuning.autoRotate || liveShow;
      controls.autoRotateSpeed = liveShow ? Math.max(0.1, show.autoRotateSpeed) : 0.55;
      const neonBase = tuning.neonEnabled ? tuning.neonIntensity : 0;
      neonMaterial.opacity = Math.min(0.86, neonBase * (0.17 + mid * show.midGlow * 0.48 + bass * 0.18));
      neonPlane.visible = tuning.neonEnabled;
      underglow.visible = tuning.neonEnabled;
      underglow.intensity = neonBase * (1.35 + mid * show.midGlow * 4.2 + treble * show.trebleFlash * 2.1);
      rim.intensity = 2.1 + (liveShow ? treble * show.trebleFlash * 4.5 : 0);
      key.intensity = 3.1 + (liveShow ? bands.overall * 1.8 : 0);
      const targetFov = 42 - (liveShow ? bass * show.cameraPulse * 3.4 : 0);
      if (Math.abs(camera.fov - targetFov) > 0.015) {
        camera.fov += (targetFov - camera.fov) * 0.16;
        camera.updateProjectionMatrix();
      }

      controls.update();
      renderer.render(scene, camera);
      frame = window.requestAnimationFrame(render);
    };
    render();

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener("pointerup", onPointer);
      controls.dispose();
      scene.traverse((object) => {
        if (object instanceof Mesh) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((entry) => entry.dispose());
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [modelUrl, partMeshMap]);

  return <div ref={hostRef} className={`h-full min-h-[300px] w-full overflow-hidden rounded-[26px] ${className}`} aria-label="Gemelo digital 3D del vehículo" />;
}
