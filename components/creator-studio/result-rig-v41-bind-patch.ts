import { Matrix4, Object3D, Skeleton, SkinnedMesh } from "three";

const PATCH_KEY = Symbol.for("clouva.creatorStudio.detachedSharedSkeleton.v41");

type PatchedPrototype = typeof SkinnedMesh.prototype & {
  [PATCH_KEY]?: boolean;
};

function previewRigRoot(mesh: Object3D): Object3D | null {
  let current: Object3D | null = mesh;
  while (current?.parent) {
    if (current.parent.name === "CLOUVA_FINAL_DRESSED_PREVIEW") return current;
    current = current.parent;
  }
  return null;
}

/**
 * The exported garment mesh can still be parented below its source armature hierarchy.
 * After replacing its Skeleton with the active avatar Skeleton, keeping that old parent
 * makes Three.js combine two transform spaces during animation. The rest frame looks
 * correct, but the first moving frame can stretch the garment across the viewport.
 *
 * This patch is deliberately scoped to the Creator Studio dressed-preview hierarchy.
 * It moves each SkinnedMesh directly below the aligned rig root while preserving its
 * world transform and uses detached bind mode so its bind matrix remains fixed while
 * the avatar bones animate.
 */
const prototype = SkinnedMesh.prototype as PatchedPrototype;
if (!prototype[PATCH_KEY]) {
  const originalBind = SkinnedMesh.prototype.bind;

  SkinnedMesh.prototype.bind = function bindClouvaSharedSkeletonV41(
    skeleton: Skeleton,
    bindMatrix?: Matrix4,
  ) {
    const rigRoot = previewRigRoot(this);
    const belongsToCreatorStudioPreview = Boolean(rigRoot);

    if (rigRoot && this.parent !== rigRoot) {
      this.updateMatrixWorld(true);
      rigRoot.attach(this);
      rigRoot.updateMatrixWorld(true);
    }

    if (belongsToCreatorStudioPreview) this.bindMode = "detached";
    const result = originalBind.call(this, skeleton, bindMatrix);
    if (belongsToCreatorStudioPreview) {
      this.bindMode = "detached";
      this.frustumCulled = false;
      this.updateMatrixWorld(true);
    }
    return result;
  };

  prototype[PATCH_KEY] = true;
}
