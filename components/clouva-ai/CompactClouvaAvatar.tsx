"use client";

import { useEffect, useRef, useState } from "react";
import {
  ACESFilmicToneMapping,
  AmbientLight,
  Clock,
  DirectionalLight,
  HemisphereLight,
  Object3D,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { frameAvatar, normalizeAvatarObject } from "@/lib/avatar-engine/frame-avatar";

export function CompactClouvaAvatar({ modelUrl }: { modelUrl: string }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let disposed = false;
    let frame = 0;
    let avatar: Object3D | null = null;

    const scene = new Scene();
    const camera = new PerspectiveCamera(28, 1, 0.02, 100);
    const renderer = new WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "low-power",
    });

    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.pointerEvents = "none";
    mount.replaceChildren(renderer.domElement);

    scene.add(new HemisphereLight(0xffffff, 0x170b27, 2.3));
    scene.add(new AmbientLight(0xffffff, 0.9));
    const key = new DirectionalLight(0xffffff, 2.8);
    key.position.set(3, 5, 4);
    scene.add(key);
    const rim = new DirectionalLight(0x8b5cf6, 2);
    rim.position.set(-3, 3, -2);
    scene.add(rim);

    const resize = () => {
      const rect = mount.getBoundingClientRect();
      const width = Math.max(rect.width, 1);
      const height = Math.max(rect.height, 1);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);

      if (avatar) {
        const framed = frameAvatar(camera, avatar, width / height, 1.48);
        camera.lookAt(framed.center);
      }
    };

    const observer = new ResizeObserver(resize);
    observer.observe(mount);

    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);

    void loader
      .loadAsync(modelUrl)
      .then((gltf) => {
        if (disposed) return;
        avatar = gltf.scene;
        normalizeAvatarObject(avatar, { targetHeight: 2.05, frontRotationY: 0 });
        avatar.rotation.y = -0.18;
        avatar.traverse((child: any) => {
          if (child.isMesh || child.isSkinnedMesh) {
            child.visible = true;
            child.frustumCulled = false;
            child.normalizeSkinWeights?.();
          }
        });
        scene.add(avatar);
        resize();
      })
      .catch((error) => {
        console.warn("Compact CLOUVA avatar failed", error);
        if (!disposed) setFailed(true);
      });

    const clock = new Clock();
    const animate = () => {
      const elapsed = clock.getElapsedTime();
      if (avatar) avatar.rotation.y = -0.18 + Math.sin(elapsed * 0.55) * 0.08;
      renderer.render(scene, camera);
      frame = window.requestAnimationFrame(animate);
    };
    frame = window.requestAnimationFrame(animate);

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      avatar?.traverse((child: any) => {
        child.geometry?.dispose?.();
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.filter(Boolean).forEach((material: any) => material.dispose?.());
      });
      renderer.dispose();
      mount.replaceChildren();
    };
  }, [modelUrl]);

  return (
    <div
      ref={mountRef}
      className="relative h-full w-full overflow-hidden"
      aria-label="CLOUVA, artista y guía de la plataforma"
    >
      {failed ? (
        <div className="grid h-full w-full place-items-center text-lg font-black text-violet-200">C</div>
      ) : null}
    </div>
  );
}
