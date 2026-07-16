"use client";

import { useEffect, useRef } from "react";
import {
  ACESFilmicToneMapping,
  AmbientLight,
  Box3,
  BoxGeometry,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  Mesh,
  MeshPhysicalMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  TorusGeometry,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { buildProceduralClouvaAvatar } from "@/lib/avatar-engine/procedural-clouva";
import { normalizeAvatarObject } from "@/lib/avatar-engine/frame-avatar";
import { useActiveAvatarStore } from "@/lib/avatar-engine/active-avatar-store";

export type TryOnAdjustments = {
  scale: number;
  length: number;
  width: number;
  x: number;
  y: number;
  rotation: number;
  height: number;
  distance: number;
  sleeveLength: number;
  legLength: number;
  waistHeight: number;
  neckSize: number;
  hoodSize: number;
};

type Props = {
  category: string;
  fit: "Slim" | "Regular" | "Oversize";
  pose: "T-Pose" | "Idle" | "Walk";
  view: "Frente" | "Lateral" | "Espalda";
  background: string;
  showBody: boolean;
  garmentOnly: boolean;
  adjustments: TryOnAdjustments;
  imageUrl?: string | null;
};

const materialFor = (texture: Texture | null) =>
  new MeshPhysicalMaterial({
    color: texture ? 0xffffff : 0x6f42c1,
    map: texture,
    roughness: 0.68,
    metalness: 0.04,
    clearcoat: 0.12,
    side: DoubleSide,
    transparent: true,
    opacity: 0.9,
  });

function addMesh(group: Group, geometry: any, material: MeshPhysicalMaterial, position: [number, number, number], scale?: [number, number, number], rotation?: [number, number, number]) {
  const mesh = new Mesh(geometry, material);
  mesh.position.set(...position);
  if (scale) mesh.scale.set(...scale);
  if (rotation) mesh.rotation.set(...rotation);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function buildPreview(category: string, bodyHeight: number, texture: Texture | null): Group {
  const group = new Group();
  group.name = "clouva-smart-preview";
  const mat = materialFor(texture);
  const h = bodyHeight;

  if (category === "hoodie" || category === "campera" || category === "remera") {
    addMesh(group, new CapsuleGeometry(h * 0.11, h * 0.18, 8, 18), mat, [0, h * 0.55, h * 0.018], [1.35, 1, 0.72]);
    addMesh(group, new CapsuleGeometry(h * 0.045, h * 0.16, 6, 12), mat, [-h * 0.145, h * 0.55, 0], [0.8, 1, 0.8], [0, 0, 0.1]);
    addMesh(group, new CapsuleGeometry(h * 0.045, h * 0.16, 6, 12), mat, [h * 0.145, h * 0.55, 0], [0.8, 1, 0.8], [0, 0, -0.1]);
    if (category === "hoodie") {
      addMesh(group, new SphereGeometry(h * 0.105, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.72), mat, [0, h * 0.755, -h * 0.045], [1, 1.05, 0.78], [Math.PI, 0, 0]);
    }
  } else if (category === "baggy") {
    addMesh(group, new CylinderGeometry(h * 0.145, h * 0.17, h * 0.12, 24), mat, [0, h * 0.42, 0]);
    addMesh(group, new CapsuleGeometry(h * 0.072, h * 0.25, 8, 16), mat, [-h * 0.075, h * 0.255, 0], [1.18, 1, 1.05]);
    addMesh(group, new CapsuleGeometry(h * 0.072, h * 0.25, 8, 16), mat, [h * 0.075, h * 0.255, 0], [1.18, 1, 1.05]);
  } else if (category === "zapatillas") {
    addMesh(group, new CapsuleGeometry(h * 0.045, h * 0.08, 6, 12), mat, [-h * 0.07, h * 0.035, h * 0.04], [1.15, 0.55, 1.5], [Math.PI / 2, 0, 0]);
    addMesh(group, new CapsuleGeometry(h * 0.045, h * 0.08, 6, 12), mat, [h * 0.07, h * 0.035, h * 0.04], [1.15, 0.55, 1.5], [Math.PI / 2, 0, 0]);
  } else if (category === "gorra") {
    addMesh(group, new SphereGeometry(h * 0.105, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), mat, [0, h * 0.865, 0], [1.12, 0.75, 1.08]);
    addMesh(group, new BoxGeometry(h * 0.16, h * 0.018, h * 0.07), mat, [0, h * 0.82, h * 0.085], [1, 1, 1], [-0.12, 0, 0]);
  } else if (category === "cadena") {
    addMesh(group, new TorusGeometry(h * 0.09, h * 0.009, 10, 40), mat, [0, h * 0.69, h * 0.055], [1, 1.25, 0.7], [Math.PI / 2, 0, 0]);
  } else if (category === "lentes") {
    addMesh(group, new TorusGeometry(h * 0.045, h * 0.006, 8, 24), mat, [-h * 0.05, h * 0.8, h * 0.09]);
    addMesh(group, new TorusGeometry(h * 0.045, h * 0.006, 8, 24), mat, [h * 0.05, h * 0.8, h * 0.09]);
    addMesh(group, new BoxGeometry(h * 0.04, h * 0.008, h * 0.008), mat, [0, h * 0.8, h * 0.09]);
  } else if (category === "mochila") {
    addMesh(group, new CapsuleGeometry(h * 0.11, h * 0.2, 8, 18), mat, [0, h * 0.55, -h * 0.12], [1.05, 1, 0.62]);
  } else if (category === "aros") {
    addMesh(group, new TorusGeometry(h * 0.025, h * 0.005, 8, 22), mat, [-h * 0.105, h * 0.77, 0]);
    addMesh(group, new TorusGeometry(h * 0.025, h * 0.005, 8, 22), mat, [h * 0.105, h * 0.77, 0]);
  } else if (category === "guantes") {
    addMesh(group, new SphereGeometry(h * 0.045, 16, 12), mat, [-h * 0.19, h * 0.43, 0], [0.7, 1.15, 0.6]);
    addMesh(group, new SphereGeometry(h * 0.045, 16, 12), mat, [h * 0.19, h * 0.43, 0], [0.7, 1.15, 0.6]);
  } else if (category === "pulseras") {
    addMesh(group, new TorusGeometry(h * 0.035, h * 0.007, 8, 24), mat, [-h * 0.19, h * 0.46, 0], [1, 1, 0.8], [Math.PI / 2, 0, 0]);
    addMesh(group, new TorusGeometry(h * 0.035, h * 0.007, 8, 24), mat, [h * 0.19, h * 0.46, 0], [1, 1, 0.8], [Math.PI / 2, 0, 0]);
  } else if (category === "anillos") {
    addMesh(group, new TorusGeometry(h * 0.014, h * 0.003, 8, 20), mat, [h * 0.2, h * 0.405, h * 0.005], [1, 1, 0.8], [Math.PI / 2, 0, 0]);
  } else {
    addMesh(group, new ConeGeometry(h * 0.1, h * 0.22, 20), mat, [0, h * 0.55, 0]);
  }

  return group;
}

function setPose(root: Object3D, pose: Props["pose"]) {
  const bones: Record<string, Object3D> = {};
  root.traverse((object) => {
    const key = object.name.toLowerCase().replace(/[^a-z0-9]/g, "");
    bones[key] = object;
  });
  const find = (...names: string[]) => Object.entries(bones).find(([key]) => names.some((name) => key.includes(name)))?.[1];
  const leftArm = find("leftarm", "upperarml");
  const rightArm = find("rightarm", "upperarmr");
  const leftLeg = find("leftupleg", "thighl");
  const rightLeg = find("rightupleg", "thighr");
  if (leftArm) leftArm.rotation.z = pose === "T-Pose" ? Math.PI / 2 : pose === "Walk" ? 0.18 : 0.08;
  if (rightArm) rightArm.rotation.z = pose === "T-Pose" ? -Math.PI / 2 : pose === "Walk" ? -0.18 : -0.08;
  if (leftLeg) leftLeg.rotation.x = pose === "Walk" ? 0.18 : 0;
  if (rightLeg) rightLeg.rotation.x = pose === "Walk" ? -0.18 : 0;
}

export function SmartTryOnViewer({ category, fit, pose, view, background, showBody, garmentOnly, adjustments, imageUrl }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const avatar = useActiveAvatarStore((state) => state.avatar);
  const stateRef = useRef({ category, fit, pose, view, background, showBody, garmentOnly, adjustments, imageUrl });
  stateRef.current = { category, fit, pose, view, background, showBody, garmentOnly, adjustments, imageUrl };

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let disposed = false;
    let frame = 0;
    let avatarRoot: Object3D | null = null;
    let previewRoot: Group | null = null;
    let texture: Texture | null = null;
    let lastSignature = "";

    const scene = new Scene();
    scene.background = new Color(background);
    const camera = new PerspectiveCamera(30, 1, 0.01, 100);
    const renderer = new WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.4));
    renderer.shadowMap.enabled = true;
    Object.assign(renderer.domElement.style, { width: "100%", height: "100%", display: "block", touchAction: "none" });
    mount.appendChild(renderer.domElement);

    scene.add(new HemisphereLight(0xffffff, 0x241034, 2.1));
    scene.add(new AmbientLight(0xffffff, 0.85));
    const key = new DirectionalLight(0xffffff, 3.1);
    key.position.set(3, 5, 4);
    key.castShadow = true;
    scene.add(key);
    const rim = new DirectionalLight(0x8b5cf6, 2.2);
    rim.position.set(-3, 3, -3);
    scene.add(rim);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 1.6;
    controls.maxDistance = 5.5;
    controls.target.set(0, 1, 0);

    const rebuildPreview = (height: number) => {
      if (previewRoot) {
        scene.remove(previewRoot);
        previewRoot.traverse((object: any) => {
          object.geometry?.dispose?.();
          object.material?.dispose?.();
        });
      }
      previewRoot = buildPreview(stateRef.current.category, height, texture);
      scene.add(previewRoot);
    };

    const finalizeAvatar = (root: Object3D) => {
      if (disposed) return;
      normalizeAvatarObject(root);
      avatarRoot = root;
      scene.add(root);
      const box = new Box3().setFromObject(root);
      const size = box.getSize(new Vector3());
      const center = box.getCenter(new Vector3());
      root.position.sub(center);
      root.position.y += size.y / 2;
      const height = Math.max(size.y, 1);
      camera.position.set(0, height * 0.52, height * 1.55);
      controls.target.set(0, height * 0.5, 0);
      controls.minDistance = height * 0.75;
      controls.maxDistance = height * 2.4;
      controls.update();
      rebuildPreview(height);
      setPose(root, stateRef.current.pose);
    };

    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const url = avatar.modelUrl || avatar.fallbackUrl;
    if (url) {
      loader.load(url, (gltf) => finalizeAvatar(gltf.scene), undefined, () => finalizeAvatar(buildProceduralClouvaAvatar()));
    } else {
      finalizeAvatar(buildProceduralClouvaAvatar());
    }

    const loadTexture = (url: string | null | undefined) => {
      texture?.dispose();
      texture = null;
      if (!url) return;
      new TextureLoader().load(url, (loaded) => {
        loaded.colorSpace = SRGBColorSpace;
        texture = loaded;
        if (avatarRoot) {
          const h = new Box3().setFromObject(avatarRoot).getSize(new Vector3()).y || 1;
          rebuildPreview(h);
        }
      });
    };
    loadTexture(imageUrl);

    const resize = () => {
      const rect = mount.getBoundingClientRect();
      const width = Math.max(rect.width, 1);
      const height = Math.max(rect.height, 1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(mount);

    const animate = () => {
      if (disposed) return;
      const current = stateRef.current;
      scene.background = new Color(current.background);

      const signature = `${current.category}|${current.imageUrl ?? ""}`;
      if (signature !== lastSignature) {
        const imageChanged = !lastSignature || !lastSignature.endsWith(`|${current.imageUrl ?? ""}`);
        lastSignature = signature;
        if (imageChanged) loadTexture(current.imageUrl);
        if (avatarRoot) {
          const h = new Box3().setFromObject(avatarRoot).getSize(new Vector3()).y || 1;
          rebuildPreview(h);
        }
      }

      if (avatarRoot) {
        avatarRoot.visible = current.showBody && !current.garmentOnly;
        const viewRotation = current.view === "Frente" ? 0 : current.view === "Lateral" ? -Math.PI / 2 : Math.PI;
        avatarRoot.rotation.y = viewRotation;
        setPose(avatarRoot, current.pose);
      }

      if (previewRoot) {
        previewRoot.visible = true;
        const fitScale = current.fit === "Slim" ? 0.92 : current.fit === "Oversize" ? 1.12 : 1;
        const a = current.adjustments;
        previewRoot.scale.set((a.width / 100) * (a.scale / 100) * fitScale, (a.length / 100) * (a.scale / 100), (1 + a.distance / 100) * (a.scale / 100) * fitScale);
        previewRoot.position.set(a.x / 100, (a.y + a.height) / 100, a.distance / 250);
        const viewRotation = current.view === "Frente" ? 0 : current.view === "Lateral" ? -Math.PI / 2 : Math.PI;
        previewRoot.rotation.y = viewRotation + (a.rotation * Math.PI) / 180;
      }

      controls.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      texture?.dispose();
      scene.traverse((object: any) => {
        object.geometry?.dispose?.();
        if (Array.isArray(object.material)) object.material.forEach((material: any) => material.dispose?.());
        else object.material?.dispose?.();
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [avatar.modelUrl, avatar.fallbackUrl]);

  return <div ref={mountRef} style={{ width: "100%", height: "100%", minHeight: 500 }} aria-label="Vista previa 3D real sobre el avatar CLOUVA" />;
}
