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
  avatarId?: string | null;
  avatarUrl?: string | null;
  avatarSource?: string | null;
  userId?: string | null;
};

export type BlenderJob = ReturnType<typeof buildBlenderJob>;

export function buildBlenderJob(payload: BlenderRequest) {
  const templateMode = Boolean(payload.templateMode || payload.preserveExistingSkinning);
  const transferSkinWeights = templateMode ? false : (payload.autoWeight ?? true);
  const avatarUrl = payload.avatarUrl?.trim() || null;

  return {
    type: "clouva_creator_pipeline",
    operation: "fit_and_rig_reference",
    pipelineVersion: "base-mesh-v2-user-avatar",
    riggingStrategy: templateMode ? "preserve_existing_skinning" : "transfer_from_avatar",
    avatarRig: payload.rig ?? "clouva_user_avatar",
    avatarId: payload.avatarId ?? null,
    avatarUrl,
    avatar_url: avatarUrl,
    avatarSource: payload.avatarSource ?? null,
    userId: payload.userId ?? null,
    category: payload.category ?? "accessory",
    sourceUrl: payload.sourceUrl ?? null,
    sourceStoragePath: payload.sourceStoragePath ?? null,
    referenceAssetName: payload.referenceAssetName ?? null,
    templateId: payload.templateId ?? null,
    templateMode,
    previewSettings: payload.previewSettings ?? {},
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
