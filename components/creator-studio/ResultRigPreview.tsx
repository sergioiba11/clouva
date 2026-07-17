"use client";

import { useEffect, useRef, useState } from "react";
import {
  ACESFilmicToneMapping,
  AmbientLight,
  Bone,
  Box3,
  DirectionalLight,
  HemisphereLight,
  Object3D,
  PerspectiveCamera,
  Scene,
  SkeletonHelper,
  SkinnedMesh,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

export type ResultRigInfo = {
  loading: boolean;
  bones: number;
  objectMeshName: string | null;
  anchorBoneName: string | null;
  weightedVertexRatio: number | null;
  error?: string;
};

type Props = {
  url: string | null;
  onInfo?: (info: ResultRigInfo) => void;
};

function findObjectMesh(root: Object3D): SkinnedMesh | null {
  let match: SkinnedMesh | null = null;
  root.traverse((object: any) => {
    if (match || !object.isSkinnedMesh) return;
    if (String(object.name || "").toLowerCase().includes("garment")) match = object as SkinnedMesh;
  });
  return match;
}

// Para categorías rígidas (gorra, etc.) Blender pesa el 100% de los vértices del objeto a
// un único hueso del avatar. Leemos el atributo skinIndex del vértice 0 para identificar
// exactamente a qué hueso quedó soldado, y qué proporción del resto de la malla concuerda.
function inspectAnchorBone(mesh: SkinnedMesh) {
  const skinIndexAttr = mesh.geometry.getAttribute("skinIndex");
  const skinWeightAttr = mesh.geometry.getAttribute("skinWeight");
  const bones = mesh.skeleton?.bones ?? [];
  if (!skinIndexAttr || !skinWeightAttr || bones.length === 0) {
    return { anchorBoneName: null, weightedVertexRatio: null };
  }

  const primaryBoneIndex = skinIndexAttr.getX(0);
  const anchorBone = bones[primaryBoneIndex] ?? null;
  let matching = 0;
  const total = skinIndexAttr.count;
  for (let i = 0; i < total; i += 1) {
    const dominant = skinWeightAttr.getX(i) >= skinWeightAttr.getY(i) ? skinIndexAttr.getX(i) : skinIndexAttr.getY(i);
    if (dominant === primaryBoneIndex) matching += 1;
  }

  return {
    anchorBoneName: anchorBone?.name ?? null,
    weightedVertexRatio: total > 0 ? matching / total : null,
  };
}

export function ResultRigPreview({ url, onInfo }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [showSkeleton, setShowSkeleton] = useState(true);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !url) {
      onInfo?.({ loading: false, bones: 0, objectMeshName: null, anchorBoneName: null, weightedVertexRatio: null });
      return;
    }

    let disposed = false;
    let raf = 0;
    let model: Object3D | null = null;
    let helper: SkeletonHelper | null = null;

    onInfo?.({ loading: true, bones: 0, objectMeshName: null, anchorBoneName: null, weightedVertexRatio: null });

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
      model.updateMatrixWorld(true);

      const boneMap = new Map<string, Bone>();
      model.traverse((object: any) => {
        if (object.isBone) boneMap.set(object.uuid, object as Bone);
        if (object.isSkinnedMesh) {
          for (const bone of object.skeleton?.bones ?? []) boneMap.set(bone.uuid, bone as Bone);
        }
      });

      helper = new SkeletonHelper(model);
      helper.visible = showSkeleton && boneMap.size > 0;
      scene.add(helper);

      const objectMesh = findObjectMesh(model);
      const { anchorBoneName, weightedVertexRatio } = objectMesh
        ? inspectAnchorBone(objectMesh)
        : { anchorBoneName: null, weightedVertexRatio: null };

      onInfo?.({
        loading: false,
        bones: boneMap.size,
        objectMeshName: objectMesh?.name ?? null,
        anchorBoneName,
        weightedVertexRatio,
      });
      resize();
    }).catch((error) => {
      if (disposed) return;
      onInfo?.({
        loading: false,
        bones: 0,
        objectMeshName: null,
        anchorBoneName: null,
        weightedVertexRatio: null,
        error: error instanceof Error ? error.message : "No se pudo abrir el GLB",
      });
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
  }, [url, onInfo, showSkeleton]);

  return (
    <div className="mt-4 overflow-hidden rounded-2xl border border-white/10 bg-[#0d0817]">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-violet-300">Rig del objeto riggeado</p>
          <p className="text-xs text-white/45">Resultado real de Blender + esqueleto del avatar</p>
        </div>
        <button type="button" onClick={() => setShowSkeleton((value) => !value)} className="rounded-xl border border-white/10 px-3 py-2 text-xs">
          {showSkeleton ? "Ocultar huesos" : "Mostrar huesos"}
        </button>
      </div>
      <div ref={mountRef} className="h-[360px] w-full sm:h-[440px]" />
    </div>
  );
}
