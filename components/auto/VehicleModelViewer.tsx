"use client";

import { useEffect, useRef } from "react";
import {
  Box3,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
  BoxGeometry,
  Object3D,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

type Props = {
  modelUrl?: string | null;
  partMeshMap?: Record<string, unknown> | null;
  selectedPartKey?: string | null;
  onSelectPart?: (partKey: string) => void;
};

function material(hex: number, roughness = 0.55) {
  return new MeshStandardMaterial({ color: hex, roughness, metalness: 0.15 });
}

function tag(object: Object3D, partKey: string) {
  object.userData.partKey = partKey;
  object.traverse((child) => { child.userData.partKey = child.userData.partKey || partKey; });
  return object;
}

function proceduralVehicle() {
  const root = new Group();
  root.name = "CLOUVA Auto nivel 1";

  const body = tag(new Mesh(new BoxGeometry(4.2, 0.8, 1.75), material(0x5b32a8, 0.38)), "body");
  body.position.y = 0.85;
  root.add(body);

  const cabin = tag(new Mesh(new BoxGeometry(2.05, 0.75, 1.55), material(0x23212d, 0.22)), "interior");
  cabin.position.set(-0.25, 1.55, 0);
  root.add(cabin);

  const bumper = tag(new Mesh(new BoxGeometry(0.25, 0.48, 1.85), material(0x17151e)), "front_bumper");
  bumper.position.set(2.18, 0.72, 0);
  root.add(bumper);

  for (const z of [-0.68, 0.68]) {
    const light = tag(new Mesh(new BoxGeometry(0.1, 0.24, 0.36), material(0xccecff, 0.15)), "headlights");
    light.position.set(2.12, 1.02, z);
    root.add(light);
  }

  const wheelGeometry = new CylinderGeometry(0.48, 0.48, 0.3, 32);
  const wheelMaterial = material(0x111115, 0.78);
  for (const x of [-1.35, 1.35]) {
    for (const z of [-0.94, 0.94]) {
      const wheel = tag(new Mesh(wheelGeometry, wheelMaterial.clone()), x > 0 ? "front_tires" : "rear_tires");
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

export function VehicleModelViewer({ modelUrl, partMeshMap, selectedPartKey, onSelectPart }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef(selectedPartKey);
  selectedRef.current = selectedPartKey;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new Scene();
    scene.background = new Color(0x08070c);
    const camera = new PerspectiveCamera(42, 1, 0.05, 100);
    camera.position.set(6.6, 3.5, 6.6);
    const renderer = new WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = "srgb" as never;
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.touchAction = "none";
    host.appendChild(renderer.domElement);

    scene.add(new HemisphereLight(0xb7c8ff, 0x140d1e, 2.4));
    const key = new DirectionalLight(0xffffff, 3.1);
    key.position.set(4, 7, 5);
    scene.add(key);
    const rim = new DirectionalLight(0x9b7bff, 2.1);
    rim.position.set(-5, 3, -4);
    scene.add(rim);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 3.2;
    controls.maxDistance = 12;
    controls.target.set(0, 0.85, 0);

    let vehicleRoot: Object3D | null = null;
    const addRoot = (root: Object3D) => {
      vehicleRoot = root;
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
      if (!vehicleRoot || !onSelectPart) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObject(vehicleRoot, true)[0]?.object;
      let cursor: Object3D | null = hit ?? null;
      while (cursor && !cursor.userData.partKey) cursor = cursor.parent;
      const partKey = cursor?.userData.partKey;
      if (typeof partKey === "string") onSelectPart(partKey);
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
  }, [modelUrl, onSelectPart, partMeshMap]);

  return <div ref={hostRef} className="h-full min-h-[300px] w-full overflow-hidden rounded-[26px]" aria-label="Gemelo digital 3D del vehículo" />;
}
