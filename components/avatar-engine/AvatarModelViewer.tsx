"use client";

import { useEffect, useRef, useState } from "react";
import {
  ACESFilmicToneMapping,
  AmbientLight,
  Box3,
  DirectionalLight,
  HemisphereLight,
  MathUtils,
  Object3D,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { buildProceduralClouvaAvatar } from "@/lib/avatar-engine/procedural-clouva";
import type { AvatarConfig } from "@/lib/avatar-engine/types";

type ModelState = "loading" | "ready" | "fallback" | "error";
type Props = { modelUrl: string | null; config?: AvatarConfig; alt?: string; className?: string };

function normalizeModel(object: Object3D, targetHeight = 2.15) {
  object.updateMatrixWorld(true);
  const initialBox = new Box3().setFromObject(object);
  const initialSize = initialBox.getSize(new Vector3());
  const scale = initialSize.y > 0 ? targetHeight / initialSize.y : 1;
  object.scale.multiplyScalar(scale);
  object.updateMatrixWorld(true);
  const box = new Box3().setFromObject(object);
  const center = box.getCenter(new Vector3());
  object.position.x -= center.x;
  object.position.z -= center.z;
  object.position.y -= box.min.y;
  object.updateMatrixWorld(true);
}

function frameModel(camera: PerspectiveCamera, object: Object3D, aspect: number) {
  object.updateMatrixWorld(true);
  const box = new Box3().setFromObject(object);
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  const vFov = MathUtils.degToRad(camera.fov);
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * Math.max(aspect, 0.1));
  const distance = Math.max(
    size.y / (2 * Math.tan(vFov / 2)),
    size.x / (2 * Math.tan(hFov / 2)),
    size.z * 2,
    2.5,
  ) * 1.25;

  camera.aspect = aspect;
  camera.near = Math.max(distance / 100, 0.02);
  camera.far = Math.max(distance * 20, 100);
  camera.position.set(center.x, center.y + size.y * 0.03, center.z + distance);
  camera.lookAt(center.x, center.y, center.z);
  camera.updateProjectionMatrix();
  return { center, distance };
}

export function AvatarModelViewer({ modelUrl, config, className = "" }: Props) {
  const mount = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<ModelState>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!config || !mount.current) return;

    let disposed = false;
    let raf = 0;
    let currentModel: Object3D | null = null;
    let resumeTimer: ReturnType<typeof setTimeout> | null = null;

    const scene = new Scene();
    const camera = new PerspectiveCamera(32, 1, 0.02, 100);
    const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });

    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, window.innerWidth < 768 ? 1 : 1.5));
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    renderer.domElement.style.touchAction = "none";
    mount.current.appendChild(renderer.domElement);

    scene.add(new HemisphereLight(0xffffff, 0x1b1029, 2.4));
    scene.add(new AmbientLight(0xffffff, 1.15));
    const key = new DirectionalLight(0xffffff, 3.3);
    key.position.set(3, 5, 4);
    scene.add(key);
    const rim = new DirectionalLight(0x8b5cf6, 1.8);
    rim.position.set(-3, 2, -2);
    scene.add(rim);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.enableRotate = true;
    controls.enableZoom = true;
    controls.rotateSpeed = 0.72;
    controls.zoomSpeed = 0.85;
    controls.minPolarAngle = Math.PI * 0.2;
    controls.maxPolarAngle = Math.PI * 0.78;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.45;

    controls.addEventListener("start", () => {
      controls.autoRotate = false;
      if (resumeTimer) clearTimeout(resumeTimer);
    });
    controls.addEventListener("end", () => {
      resumeTimer = setTimeout(() => {
        controls.autoRotate = true;
      }, 2200);
    });

    const resize = () => {
      const rect = mount.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.max(rect.width, 1);
      const height = Math.max(rect.height, 1);
      renderer.setSize(width, height, false);
      if (currentModel) {
        const framed = frameModel(camera, currentModel, width / height);
        controls.target.copy(framed.center);
        controls.minDistance = Math.max(framed.distance * 0.62, 1.2);
        controls.maxDistance = framed.distance * 1.8;
        controls.update();
      } else {
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      }
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount.current);
    window.addEventListener("resize", resize);

    const useFallback = () => {
      const fallback = buildProceduralClouvaAvatar(config);
      normalizeModel(fallback);
      currentModel = fallback;
      scene.add(fallback);
      setState("fallback");
      resize();
    };

    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);

    setState("loading");
    setErrorMessage(null);

    if (modelUrl) {
      loader.load(
        modelUrl,
        (gltf) => {
          if (disposed) return;
          const object = gltf.scene;
          normalizeModel(object);
          object.rotation.y = Math.PI;
          currentModel = object;
          scene.add(object);
          setState("ready");
          resize();
        },
        undefined,
        (error) => {
          console.error("GLB load failed", error);
          if (!disposed) useFallback();
        },
      );
    } else {
      useFallback();
    }

    const animate = () => {
      if (!document.hidden) {
        controls.update();
        renderer.render(scene, camera);
      }
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      if (resumeTimer) clearTimeout(resumeTimer);
      resizeObserver.disconnect();
      window.removeEventListener("resize", resize);
      controls.dispose();
      renderer.dispose();
      mount.current?.replaceChildren();
    };
  }, [modelUrl, config]);

  if (!config) return null;

  return (
    <div
      className={`avatar-render-shell ${className}`}
      data-state={state}
      data-avatar-source={state === "ready" ? "glb" : "procedural"}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", minHeight: "100dvh" }}
    >
      {state === "loading" ? <div className="avatar-loader">Cargando CLOUVA 3D…</div> : null}
      {state === "error" ? <div className="avatar-loader">No se pudo cargar el avatar: {errorMessage}</div> : null}
      <div ref={mount} className="avatar-model-viewer" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", minHeight: "100dvh", touchAction: "none" }} />
    </div>
  );
}
