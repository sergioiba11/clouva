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
  SkeletonHelper,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

export type RigValidation = {
  loading: boolean;
  valid: boolean;
  bones: number;
  skinnedMeshes: number;
  animations: number;
  missing: string[];
  error?: string;
};

type Props = {
  url: string | null;
  onValidation: (validation: RigValidation) => void;
};

function clean(value: string) {
  return value.toLowerCase().replace(/^mixamorig:/, "").replace(/[^a-z0-9]/g, "");
}

function hasAny(names: string[], aliases: string[]) {
  return names.some((name) => aliases.some((alias) => name === alias || name.includes(alias)));
}

export function OfficialAvatarRigPreview({ url, onValidation }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [showSkeleton, setShowSkeleton] = useState(true);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !url) {
      onValidation({ loading: false, valid: false, bones: 0, skinnedMeshes: 0, animations: 0, missing: ["modelo"] });
      return;
    }

    let disposed = false;
    let raf = 0;
    let model: Object3D | null = null;
    let helper: SkeletonHelper | null = null;

    onValidation({ loading: true, valid: false, bones: 0, skinnedMeshes: 0, animations: 0, missing: [] });

    const scene = new Scene();
    const camera = new PerspectiveCamera(34, 1, 0.01, 100);
    const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    renderer.domElement.style.touchAction = "none";
    mount.replaceChildren(renderer.domElement);

    scene.add(new HemisphereLight(0xffffff, 0x171025, 2));
    scene.add(new AmbientLight(0xffffff, 0.8));
    const key = new DirectionalLight(0xffffff, 2.6);
    key.position.set(3, 5, 4);
    scene.add(key);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;

    const resize = () => {
      const rect = mount.getBoundingClientRect();
      const width = Math.max(rect.width, 1);
      const height = Math.max(rect.height, 1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      if (model) {
        const box = new Box3().setFromObject(model);
        const size = box.getSize(new Vector3());
        const center = box.getCenter(new Vector3());
        const distance = Math.max(size.y, size.x, size.z) * 1.7;
        camera.position.set(center.x, center.y + size.y * 0.05, center.z + distance);
        controls.target.copy(center);
        controls.update();
      }
    };
    const observer = new ResizeObserver(resize);
    observer.observe(mount);

    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);

    void loader.loadAsync(url).then((gltf) => {
      if (disposed) return;
      model = gltf.scene;
      scene.add(model);

      const boneNames = new Set<string>();
      let skinnedMeshes = 0;
      model.traverse((object: any) => {
        if (object.isBone) boneNames.add(clean(object.name));
        if (object.isSkinnedMesh) {
          skinnedMeshes += 1;
          for (const bone of object.skeleton?.bones ?? []) boneNames.add(clean(bone.name));
        }
      });

      helper = new SkeletonHelper(model);
      helper.visible = showSkeleton && boneNames.size > 0;
      scene.add(helper);

      const names = [...boneNames];
      const checks: Array<[string, string[]]> = [
        ["cadera", ["hips", "pelvis", "jbiphips"]],
        ["brazo izquierdo", ["leftupperarm", "upperarml", "jbiplupperarm"]],
        ["brazo derecho", ["rightupperarm", "upperarmr", "jbiprupperarm"]],
        ["antebrazo izquierdo", ["leftlowerarm", "leftforearm", "jbipllowerarm"]],
        ["antebrazo derecho", ["rightlowerarm", "rightforearm", "jbiprlowerarm"]],
        ["pierna izquierda", ["leftupperleg", "leftupleg", "jbiplupperleg"]],
        ["pierna derecha", ["rightupperleg", "rightupleg", "jbiprupperleg"]],
      ];
      const missing = checks.filter(([, aliases]) => !hasAny(names, aliases)).map(([label]) => label);
      const valid = boneNames.size >= 15 && skinnedMeshes > 0 && missing.length === 0;
      onValidation({ loading: false, valid, bones: boneNames.size, skinnedMeshes, animations: gltf.animations.length, missing });
      resize();
    }).catch((error) => {
      if (disposed) return;
      onValidation({ loading: false, valid: false, bones: 0, skinnedMeshes: 0, animations: 0, missing: [], error: error instanceof Error ? error.message : "No se pudo abrir el GLB" });
    });

    const animate = () => {
      if (helper) helper.visible = showSkeleton;
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      controls.dispose();
      renderer.dispose();
      helper?.geometry.dispose();
      mount.replaceChildren();
    };
  }, [url, onValidation, showSkeleton]);

  return (
    <div className="mt-4 overflow-hidden rounded-2xl border border-white/10 bg-[#0d0817]">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-violet-300">Previsualización de rig</p>
          <p className="text-xs text-white/45">Modelo activo + esqueleto detectado</p>
        </div>
        <button type="button" onClick={() => setShowSkeleton((value) => !value)} className="rounded-xl border border-white/10 px-3 py-2 text-xs">
          {showSkeleton ? "Ocultar huesos" : "Mostrar huesos"}
        </button>
      </div>
      <div ref={mountRef} className="h-[360px] w-full sm:h-[440px]" />
    </div>
  );
}
