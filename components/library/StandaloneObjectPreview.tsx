"use client";

import { useEffect, useRef, useState } from "react";
import {
  ACESFilmicToneMapping,
  AmbientLight,
  Box3,
  DirectionalLight,
  HemisphereLight,
  Object3D,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

type Props = {
  modelUrl: string;
  className?: string;
};

function frameObject(camera: PerspectiveCamera, object: Object3D, aspect: number) {
  object.updateMatrixWorld(true);
  const box = new Box3().setFromObject(object);
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  const maxDimension = Math.max(size.x, size.y, size.z, 0.001);
  const verticalFov = (camera.fov * Math.PI) / 180;
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * Math.max(aspect, 0.1));
  const distanceForHeight = size.y / (2 * Math.tan(verticalFov / 2));
  const distanceForWidth = size.x / (2 * Math.tan(horizontalFov / 2));
  const distance = Math.max(distanceForHeight, distanceForWidth, maxDimension) * 1.35;

  camera.aspect = aspect;
  camera.near = Math.max(distance / 100, 0.001);
  camera.far = Math.max(distance * 20, 100);
  camera.position.set(center.x + distance * 0.28, center.y + distance * 0.08, center.z + distance);
  camera.lookAt(center);
  camera.updateProjectionMatrix();
  return center;
}

export function StandaloneObjectPreview({ modelUrl, className = "" }: Props) {
  const mount = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const host = mount.current;
    if (!host || !modelUrl) return;

    let disposed = false;
    let frame = 0;
    let model: Object3D | null = null;

    const scene = new Scene();
    const camera = new PerspectiveCamera(32, 1, 0.01, 1000);
    const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    Object.assign(renderer.domElement.style, { width: "100%", height: "100%", display: "block", touchAction: "none" });
    host.appendChild(renderer.domElement);

    scene.add(new HemisphereLight(0xffffff, 0x160b25, 2.4));
    scene.add(new AmbientLight(0xffffff, 1.15));
    const key = new DirectionalLight(0xffffff, 3.4);
    key.position.set(3, 5, 4);
    scene.add(key);
    const fill = new DirectionalLight(0x9d8cff, 1.8);
    fill.position.set(-4, 2, 3);
    scene.add(fill);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;

    const resize = () => {
      const rect = host.getBoundingClientRect();
      const width = Math.max(rect.width, 1);
      const height = Math.max(rect.height, 1);
      renderer.setSize(width, height, false);
      if (model) {
        const center = frameObject(camera, model, width / height);
        controls.target.copy(center);
        controls.update();
      }
    };

    const observer = new ResizeObserver(resize);
    observer.observe(host);

    const loader = new GLTFLoader();
    setStatus("loading");
    void loader.loadAsync(modelUrl)
      .then((gltf) => {
        if (disposed) return;
        model = gltf.scene;
        model.position.set(0, 0, 0);
        model.rotation.set(0, 0, 0);
        model.scale.set(1, 1, 1);
        scene.add(model);
        resize();
        setStatus("ready");
      })
      .catch(() => {
        if (!disposed) setStatus("error");
      });

    const animate = () => {
      if (disposed) return;
      controls.update();
      renderer.render(scene, camera);
      frame = window.requestAnimationFrame(animate);
    };
    animate();

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      scene.clear();
    };
  }, [modelUrl]);

  return (
    <div ref={mount} className={className} style={{ position: "relative", width: "100%", height: "100%" }}>
      {status === "loading" ? (
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "rgba(255,255,255,.55)", fontSize: 12 }}>
          Cargando objeto 3D…
        </div>
      ) : null}
      {status === "error" ? (
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", padding: 24, color: "rgba(255,255,255,.55)", fontSize: 12, textAlign: "center" }}>
          No se pudo abrir el GLB del objeto.
        </div>
      ) : null}
    </div>
  );
}
