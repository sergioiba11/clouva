"use client";

import { useEffect, useRef } from "react";
import {
  ACESFilmicToneMapping,
  AmbientLight,
  Box3,
  BoxGeometry,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  Mesh,
  MeshPhysicalMaterial,
  Object3D,
  PerspectiveCamera,
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
import { defaultAvatarConfig } from "@/lib/avatar-engine/catalog";

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

function previewMaterial(texture: Texture | null) {
  return new MeshPhysicalMaterial({
    color: texture ? 0xffffff : 0x7448c8,
    map: texture,
    roughness: 0.72,
    metalness: 0.03,
    clearcoat: 0.08,
    side: DoubleSide,
    transparent: true,
    opacity: 0.92,
  });
}

function add(group: Group, geometry: any, material: MeshPhysicalMaterial, position: [number, number, number], scale: [number, number, number] = [1, 1, 1], rotation: [number, number, number] = [0, 0, 0]) {
  const mesh = new Mesh(geometry, material);
  mesh.position.set(...position);
  mesh.scale.set(...scale);
  mesh.rotation.set(...rotation);
  group.add(mesh);
}

function makePreview(category: string, height: number, texture: Texture | null) {
  const group = new Group();
  const material = previewMaterial(texture);
  const h = height;

  if (["hoodie", "campera", "remera"].includes(category)) {
    add(group, new CapsuleGeometry(h * 0.11, h * 0.18, 8, 18), material, [0, h * 0.55, h * 0.02], [1.35, 1, 0.72]);
    add(group, new CapsuleGeometry(h * 0.045, h * 0.16, 6, 12), material, [-h * 0.145, h * 0.55, 0], [0.8, 1, 0.8], [0, 0, 0.1]);
    add(group, new CapsuleGeometry(h * 0.045, h * 0.16, 6, 12), material, [h * 0.145, h * 0.55, 0], [0.8, 1, 0.8], [0, 0, -0.1]);
    if (category === "hoodie") add(group, new SphereGeometry(h * 0.105, 20, 16), material, [0, h * 0.75, -h * 0.05], [1, 1.05, 0.78]);
  } else if (category === "baggy") {
    add(group, new CylinderGeometry(h * 0.145, h * 0.17, h * 0.12, 24), material, [0, h * 0.42, 0]);
    add(group, new CapsuleGeometry(h * 0.072, h * 0.25, 8, 16), material, [-h * 0.075, h * 0.255, 0], [1.18, 1, 1.05]);
    add(group, new CapsuleGeometry(h * 0.072, h * 0.25, 8, 16), material, [h * 0.075, h * 0.255, 0], [1.18, 1, 1.05]);
  } else if (category === "zapatillas") {
    add(group, new BoxGeometry(h * 0.12, h * 0.06, h * 0.22), material, [-h * 0.07, h * 0.035, h * 0.05]);
    add(group, new BoxGeometry(h * 0.12, h * 0.06, h * 0.22), material, [h * 0.07, h * 0.035, h * 0.05]);
  } else if (category === "gorra") {
    add(group, new SphereGeometry(h * 0.105, 24, 14), material, [0, h * 0.86, 0], [1.12, 0.72, 1.08]);
    add(group, new BoxGeometry(h * 0.16, h * 0.018, h * 0.07), material, [0, h * 0.82, h * 0.085]);
  } else if (category === "cadena") {
    add(group, new TorusGeometry(h * 0.09, h * 0.009, 10, 40), material, [0, h * 0.69, h * 0.055], [1, 1.25, 0.7], [Math.PI / 2, 0, 0]);
  } else if (category === "lentes") {
    add(group, new TorusGeometry(h * 0.045, h * 0.006, 8, 24), material, [-h * 0.05, h * 0.8, h * 0.09]);
    add(group, new TorusGeometry(h * 0.045, h * 0.006, 8, 24), material, [h * 0.05, h * 0.8, h * 0.09]);
  } else if (category === "mochila") {
    add(group, new CapsuleGeometry(h * 0.11, h * 0.2, 8, 18), material, [0, h * 0.55, -h * 0.12], [1.05, 1, 0.62]);
  } else {
    add(group, new SphereGeometry(h * 0.04, 16, 12), material, [0, h * 0.5, 0]);
  }

  return group;
}

function applyPose(root: Object3D, pose: Props["pose"]) {
  root.traverse((object) => {
    const name = object.name.toLowerCase();
    if (name.includes("leftarm") || name.includes("upperarml")) object.rotation.z = pose === "T-Pose" ? Math.PI / 2 : pose === "Walk" ? 0.18 : 0.08;
    if (name.includes("rightarm") || name.includes("upperarmr")) object.rotation.z = pose === "T-Pose" ? -Math.PI / 2 : pose === "Walk" ? -0.18 : -0.08;
    if (name.includes("leftupleg") || name.includes("thighl")) object.rotation.x = pose === "Walk" ? 0.18 : 0;
    if (name.includes("rightupleg") || name.includes("thighr")) object.rotation.x = pose === "Walk" ? -0.18 : 0;
  });
}

export function SmartTryOnViewer(props: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const avatar = useActiveAvatarStore((state) => state.avatar);
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let disposed = false;
    let animationFrame = 0;
    let avatarRoot: Object3D | null = null;
    let previewRoot: Group | null = null;
    let texture: Texture | null = null;
    let lastCategory = propsRef.current.category;
    let lastImageUrl = propsRef.current.imageUrl ?? null;

    const scene = new Scene();
    const camera = new PerspectiveCamera(30, 1, 0.02, 100);
    const renderer = new WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.4));
    mount.appendChild(renderer.domElement);

    scene.add(new HemisphereLight(0xffffff, 0x241034, 2.1));
    scene.add(new AmbientLight(0xffffff, 0.85));
    const key = new DirectionalLight(0xffffff, 3.1);
    key.position.set(3, 5, 4);
    scene.add(key);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.target.set(0, 1, 0);

    const rebuildPreview = () => {
      if (!avatarRoot) return;
      if (previewRoot) scene.remove(previewRoot);
      const height = new Box3().setFromObject(avatarRoot).getSize(new Vector3()).y || 2.05;
      previewRoot = makePreview(propsRef.current.category, height, texture);
      scene.add(previewRoot);
    };

    const showAvatar = (root: Object3D) => {
      if (disposed) return;
      if (avatarRoot) scene.remove(avatarRoot);
      normalizeAvatarObject(root, { targetHeight: 2.05, frontRotationY: avatar.frontRotationY });
      avatarRoot = root;
      scene.add(root);
      camera.position.set(0, 1.05, 3.35);
      controls.target.set(0, 1.02, 0);
      controls.update();
      rebuildPreview();
    };

    // Mostrar una base inmediata para que nunca quede el visor vacío en celulares lentos.
    showAvatar(buildProceduralClouvaAvatar(defaultAvatarConfig));

    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const modelUrl = avatar.modelUrl || avatar.fallbackUrl;
    if (modelUrl) {
      loader.load(modelUrl, (gltf) => showAvatar(gltf.scene), undefined, () => {
        // La base procedural ya está visible; no dejamos la pantalla en blanco.
      });
    }

    const loadTexture = (url: string | null) => {
      texture?.dispose();
      texture = null;
      if (!url) {
        rebuildPreview();
        return;
      }
      new TextureLoader().load(url, (loaded) => {
        loaded.colorSpace = SRGBColorSpace;
        texture = loaded;
        rebuildPreview();
      }, undefined, () => rebuildPreview());
    };
    loadTexture(lastImageUrl);

    const resize = () => {
      const rect = mount.getBoundingClientRect();
      renderer.setSize(Math.max(rect.width, 1), Math.max(rect.height, 1), false);
      camera.aspect = Math.max(rect.width, 1) / Math.max(rect.height, 1);
      camera.updateProjectionMatrix();
      Object.assign(renderer.domElement.style, { width: "100%", height: "100%", display: "block", touchAction: "none" });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    resize();

    const animate = () => {
      if (disposed) return;
      const current = propsRef.current;
      scene.background = new Color(current.background);

      if (current.category !== lastCategory) {
        lastCategory = current.category;
        rebuildPreview();
      }
      if ((current.imageUrl ?? null) !== lastImageUrl) {
        lastImageUrl = current.imageUrl ?? null;
        loadTexture(lastImageUrl);
      }

      const viewRotation = current.view === "Frente" ? 0 : current.view === "Lateral" ? -Math.PI / 2 : Math.PI;
      if (avatarRoot) {
        avatarRoot.visible = current.showBody && !current.garmentOnly;
        avatarRoot.rotation.y = viewRotation;
        applyPose(avatarRoot, current.pose);
      }
      if (previewRoot) {
        const a = current.adjustments;
        const fitScale = current.fit === "Slim" ? 0.92 : current.fit === "Oversize" ? 1.12 : 1;
        previewRoot.rotation.y = viewRotation + (a.rotation * Math.PI) / 180;
        previewRoot.position.set(a.x / 100, (a.y + a.height) / 100, a.distance / 250);
        previewRoot.scale.set((a.width / 100) * (a.scale / 100) * fitScale, (a.length / 100) * (a.scale / 100), (1 + a.distance / 100) * (a.scale / 100) * fitScale);
      }

      controls.update();
      renderer.render(scene, camera);
      animationFrame = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      disposed = true;
      cancelAnimationFrame(animationFrame);
      observer.disconnect();
      controls.dispose();
      texture?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [avatar.modelUrl, avatar.fallbackUrl, avatar.frontRotationY]);

  return <div ref={mountRef} style={{ width: "100%", height: "100%", minHeight: 500 }} aria-label="Vista previa 3D sobre el avatar CLOUVA" />;
}
