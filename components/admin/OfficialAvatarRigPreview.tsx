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

type BoneSegment = {
  parent: Bone;
  child: Bone;
  start: Vector3;
  end: Vector3;
  midpoint: Vector3;
  direction: Vector3;
  length: number;
};

function clean(value: string) {
  return value.toLowerCase().replace(/^mixamorig:/, "").replace(/[^a-z0-9]/g, "");
}

function hasAny(names: string[], aliases: string[]) {
  return names.some((name) => aliases.some((alias) => name === alias || name.includes(alias)));
}

function isBone(object: Object3D): object is Bone {
  return (object as Bone).isBone === true;
}

function getBoneChildren(bone: Bone) {
  return bone.children.filter(isBone);
}

function collectSegments(bones: Bone[]) {
  const segments: BoneSegment[] = [];
  for (const parent of bones) {
    for (const child of getBoneChildren(parent)) {
      const start = parent.getWorldPosition(new Vector3());
      const end = child.getWorldPosition(new Vector3());
      const direction = end.clone().sub(start);
      const length = direction.length();
      if (length < 0.0001) continue;
      segments.push({
        parent,
        child,
        start,
        end,
        midpoint: start.clone().add(end).multiplyScalar(0.5),
        direction: direction.normalize(),
        length,
      });
    }
  }
  return segments;
}

function detectHumanoidByHierarchy(model: Object3D, bones: Bone[]) {
  model.updateMatrixWorld(true);
  const box = new Box3().setFromObject(model);
  const size = box.getSize(new Vector3());
  const height = Math.max(size.y, 0.001);
  const centerX = (box.min.x + box.max.x) * 0.5;
  const segments = collectSegments(bones);

  const relativeY = (point: Vector3) => (point.y - box.min.y) / height;
  const relativeX = (point: Vector3) => (point.x - centerX) / height;

  const centralSegments = segments.filter((segment) => {
    const y = relativeY(segment.midpoint);
    return Math.abs(relativeX(segment.midpoint)) < 0.12 && y > 0.28 && y < 0.86;
  });

  const hasHips = centralSegments.some((segment) => {
    const y = relativeY(segment.midpoint);
    const children = getBoneChildren(segment.parent).length;
    return y > 0.3 && y < 0.58 && children >= 2;
  }) || centralSegments.some((segment) => {
    const y = relativeY(segment.midpoint);
    return y > 0.35 && y < 0.55;
  });

  function detectArm(side: -1 | 1) {
    const sideSegments = segments.filter((segment) => {
      const y = relativeY(segment.midpoint);
      const x = relativeX(segment.midpoint) * side;
      const mostlyHorizontal = Math.abs(segment.direction.x) > Math.abs(segment.direction.y) * 0.35;
      return y > 0.43 && y < 0.82 && x > 0.035 && mostlyHorizontal;
    });

    for (const upper of sideSegments) {
      const lower = segments.find((segment) => segment.parent === upper.child);
      if (!lower) continue;
      const lowerY = relativeY(lower.midpoint);
      const lowerX = relativeX(lower.midpoint) * side;
      const extendsOutward = lowerX >= relativeX(upper.midpoint) * side - 0.035;
      if (lowerY > 0.34 && lowerY < 0.82 && lowerX > 0.045 && extendsOutward) {
        return { upper, lower };
      }
    }

    // Some rigs place shoulder as a tiny vertical segment. In that case,
    // accept a two-bone chain on the correct side of the upper torso.
    for (const first of segments) {
      const y = relativeY(first.midpoint);
      const x = relativeX(first.midpoint) * side;
      if (y < 0.48 || y > 0.82 || x < 0.04) continue;
      const second = segments.find((segment) => segment.parent === first.child);
      if (!second) continue;
      const secondX = relativeX(second.midpoint) * side;
      const secondY = relativeY(second.midpoint);
      if (secondX > 0.05 && secondY > 0.35 && secondY < 0.82) return { upper: first, lower: second };
    }
    return null;
  }

  function detectLeg(side: -1 | 1) {
    const candidates = segments.filter((segment) => {
      const y = relativeY(segment.midpoint);
      const x = relativeX(segment.midpoint) * side;
      const mostlyVertical = Math.abs(segment.direction.y) > Math.abs(segment.direction.x) * 0.55;
      return y > 0.08 && y < 0.58 && x > 0.008 && mostlyVertical;
    });
    for (const upper of candidates) {
      const lower = segments.find((segment) => segment.parent === upper.child);
      if (!lower) continue;
      const lowerY = relativeY(lower.midpoint);
      const lowerX = relativeX(lower.midpoint) * side;
      if (lowerY > 0.02 && lowerY < 0.48 && lowerX > -0.025) return { upper, lower };
    }
    return null;
  }

  return {
    hips: hasHips,
    leftArm: Boolean(detectArm(-1)),
    rightArm: Boolean(detectArm(1)),
    leftLeg: Boolean(detectLeg(-1)),
    rightLeg: Boolean(detectLeg(1)),
  };
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
      model.updateMatrixWorld(true);

      const boneMap = new Map<string, Bone>();
      let skinnedMeshes = 0;
      model.traverse((object: any) => {
        if (object.isBone) boneMap.set(object.uuid, object as Bone);
        if (object.isSkinnedMesh) {
          skinnedMeshes += 1;
          for (const bone of object.skeleton?.bones ?? []) boneMap.set(bone.uuid, bone as Bone);
        }
      });

      const bones = [...boneMap.values()];
      const names = bones.map((bone) => clean(bone.name));
      const hierarchy = detectHumanoidByHierarchy(model, bones);

      helper = new SkeletonHelper(model);
      helper.visible = showSkeleton && bones.length > 0;
      scene.add(helper);

      const namedHips = hasAny(names, ["hips", "pelvis", "jbiphips"]);
      const namedLeftArm = hasAny(names, ["leftupperarm", "upperarml", "jbiplupperarm", "leftarm", "arml", "upperarmleft"]);
      const namedRightArm = hasAny(names, ["rightupperarm", "upperarmr", "jbiprupperarm", "rightarm", "armr", "upperarmright"]);
      const namedLeftForearm = hasAny(names, ["leftlowerarm", "leftforearm", "jbipllowerarm", "forearml", "lowerarml"]);
      const namedRightForearm = hasAny(names, ["rightlowerarm", "rightforearm", "jbiprlowerarm", "forearmr", "lowerarmr"]);
      const namedLeftLeg = hasAny(names, ["leftupperleg", "leftupleg", "jbiplupperleg", "thighl", "upperlegl"]);
      const namedRightLeg = hasAny(names, ["rightupperleg", "rightupleg", "jbiprupperleg", "thighr", "upperlegr"]);

      const detected = {
        hips: namedHips || hierarchy.hips,
        leftArm: (namedLeftArm && namedLeftForearm) || hierarchy.leftArm,
        rightArm: (namedRightArm && namedRightForearm) || hierarchy.rightArm,
        leftLeg: namedLeftLeg || hierarchy.leftLeg,
        rightLeg: namedRightLeg || hierarchy.rightLeg,
      };

      const missing: string[] = [];
      if (!detected.hips) missing.push("cadera");
      if (!detected.leftArm) missing.push("brazo izquierdo");
      if (!detected.rightArm) missing.push("brazo derecho");
      if (!detected.leftLeg) missing.push("pierna izquierda");
      if (!detected.rightLeg) missing.push("pierna derecha");

      const valid = bones.length >= 15 && skinnedMeshes > 0 && missing.length === 0;
      console.info("[Official avatar rig validation]", {
        bones: bones.length,
        skinnedMeshes,
        animations: gltf.animations.length,
        detected,
        missing,
        boneNames: names,
      });
      onValidation({ loading: false, valid, bones: bones.length, skinnedMeshes, animations: gltf.animations.length, missing });
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
