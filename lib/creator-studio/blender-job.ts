export type BlenderPreviewSettings = Record<string, unknown>;

export type BlenderRequest = {
  sourceUrl?: string;
  category?: string;
  rig?: string;
  autoFix?: boolean;
  autoWeight?: boolean;
  autoExport?: boolean;
  targetPolycount?: number;
  maxFileSizeMb?: number;
  textureResolution?: number;
  formats?: string[];
  previewSettings?: BlenderPreviewSettings;
  referenceAssetName?: string | null;
  templateMode?: boolean;
  templateId?: string | null;
  sourceStoragePath?: string | null;
  preserveExistingSkinning?: boolean;
};

export type BlenderJob = ReturnType<typeof buildBlenderJob>;

export function buildBlenderJob(payload: BlenderRequest) {
  const templateMode = Boolean(payload.templateMode || payload.preserveExistingSkinning);
  const transferSkinWeights = templateMode ? false : (payload.autoWeight ?? true);

  return {
    type: "clouva_creator_pipeline",
    operation: "fit_and_rig_reference",
    pipelineVersion: "base-mesh-v1",
    riggingStrategy: templateMode ? "preserve_existing_skinning" : "transfer_from_avatar",
    avatarRig: payload.rig ?? "clouva_base_v1",
    category: payload.category ?? "accessory",
    sourceUrl: payload.sourceUrl ?? null,
    sourceStoragePath: payload.sourceStoragePath ?? null,
    referenceAssetName: payload.referenceAssetName ?? null,
    templateId: payload.templateId ?? null,
    templateMode,
    previewSettings: payload.previewSettings ?? {},
    runner: {
      script: "scripts/blender/rig_clothing.py",
      blenderArguments: ["--background", "--python"],
    },
    options: {
      cleanGeometry: true,
      repairNormals: true,
      applyTransforms: true,
      centerModel: !templateMode,
      fitToAvatar: true,
      shrinkwrap: !templateMode,
      surfaceDeform: !templateMode,
      transferSkinWeights,
      transferVertexGroups: !templateMode,
      attachArmature: !templateMode,
      preserveExistingSkinning: templateMode,
      preserveTopology: templateMode,
      applyTemplateDeformations: templateMode,
      preserveMaterials: true,
      removeClipping: payload.autoFix ?? true,
      normalizeWeights: true,
      removeEmptyVertexGroups: true,
      maxBoneInfluences: 4,
      weightTransfer: {
        method: "nearest_surface_point",
        dataType: "VGROUP_WEIGHTS",
        mixMode: "REPLACE",
        rayRadius: 0.02,
      },
      validation: {
        requireArmature: true,
        requireWeightedVertices: true,
        rejectMissingBones: true,
        rejectUnnormalizedWeights: true,
        maxUnweightedVertexRatio: 0.01,
        animationTests: ["tpose", "idle", "walk", "run"],
      },
      animationTests: ["tpose", "idle", "walk", "run"],
      generateLod: true,
      targetPolycount: payload.targetPolycount ?? 25000,
      maxFileSizeMb: payload.maxFileSizeMb ?? 18,
      textureResolution: payload.textureResolution ?? 2048,
      compressMaterials: true,
      generateThumbnails: true,
      generateTurntable: true,
      formats: payload.formats ?? ["glb"],
      autoExport: payload.autoExport ?? true,
    },
  };
}
