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
  attemptId?: string | null;
  forceFreshSource?: boolean;
};

export type BlenderJob = ReturnType<typeof buildBlenderJob>;

export function buildBlenderJob(payload: BlenderRequest) {
  const category = payload.category ?? "accessory";
  const deformable = ["hoodie", "shirt", "jacket", "pants", "shorts", "shoes"].includes(category);
  const templateMode = deformable
    ? false
    : Boolean(payload.templateMode || payload.preserveExistingSkinning);
  const transferSkinWeights = deformable ? true : (templateMode ? false : (payload.autoWeight ?? true));
  const upperGarment = category === "hoodie" || category === "shirt" || category === "jacket";
  const lowerGarment = category === "pants" || category === "shorts";
  const automaticFit = deformable && payload.previewSettings?.automaticFit !== false;
  const manualCorrectionEnabled = deformable && Boolean(payload.previewSettings?.manualCorrectionEnabled);
  const attemptId = payload.attemptId ?? null;
  const forceFreshSource = payload.forceFreshSource ?? deformable;

  return {
    type: "clouva_creator_pipeline",
    operation: "fit_and_rig_reference",
    pipelineVersion: "body-mesh-contract-v15",
    attemptId,
    sourcePolicy: forceFreshSource ? "fresh-upload-and-factory-startup" : "uploaded-source",
    riggingStrategy: deformable
      ? "fresh_transfer_from_active_avatar"
      : templateMode
        ? "preserve_existing_skinning"
        : "transfer_from_avatar",
    avatarRig: payload.rig ?? "clouva_base_v1",
    avatarMoldSource: deformable ? "official-unreal-fbx" : null,
    category,
    sourceUrl: payload.sourceUrl ?? null,
    sourceStoragePath: payload.sourceStoragePath ?? null,
    referenceAssetName: payload.referenceAssetName ?? null,
    templateId: payload.templateId ?? null,
    templateMode,
    previewSettings: {
      ...(payload.previewSettings ?? {}),
      rigProfileVersion: deformable ? 15 : payload.previewSettings?.rigProfileVersion,
      automaticFit,
      manualCorrectionEnabled,
      avatarMoldSource: deformable ? "official-unreal-fbx" : payload.previewSettings?.avatarMoldSource,
      attemptId,
      forceFreshSource,
      cleanScene: true,
      canonicalBindVersion: deformable ? 43 : null,
      restPoseBeforeMold: deformable,
    },
    options: {
      cleanGeometry: true,
      repairNormals: true,
      applyTransforms: true,
      centerModel: !templateMode,
      fitToAvatar: true,
      fitSource: deformable ? "official_unreal_fbx" : "active_avatar",
      automaticFit,
      manualCorrectionOptional: deformable,
      manualCorrectionEnabled,
      normalizeSourcePose: deformable,
      useOfficialAvatarMesh: deformable,
      useOfficialAvatarSkeleton: deformable,
      useOfficialAvatarWeights: deformable,
      normalizeBeforeSkinning: deformable,
      canonicalRestPose: deformable,
      rejectPostSkinScaleChanges: deformable,
      forceFreshSource,
      cleanSceneBeforeImport: true,
      fitIncludesLimbSpan: upperGarment,
      fitUsesCanonicalLowerBodyLandmarks: lowerGarment,
      fitUsesBodyMeshVolume: lowerGarment,
      shrinkwrap: deformable && !templateMode,
      surfaceDeform: deformable && !templateMode,
      transferSkinWeights,
      transferVertexGroups: deformable || !templateMode,
      attachArmature: deformable || !templateMode,
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
        sampleCount: 16,
        separateLeftRightLimbs: deformable,
        rayRadius: 0.02,
      },
      validation: {
        requireArmature: true,
        requireWeightedVertices: true,
        requireBilateralSleeveWeights: upperGarment,
        requireBilateralLegWeights: lowerGarment,
        requireWaistAtHips: lowerGarment,
        requireBodyMeshRoundtrip: lowerGarment,
        rejectTorsoAlignedPants: lowerGarment,
        rejectMissingBones: true,
        rejectUnnormalizedWeights: true,
        requireCanonicalRestBind: deformable,
        requireUnitLocalScale: deformable,
        maxUnweightedVertexRatio: 0.005,
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
