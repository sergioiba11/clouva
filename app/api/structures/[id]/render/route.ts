import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { uploadGeneratedMediaObject } from "@/lib/gcs-media";
import { generateGoogleCloudImage, generateGoogleCloudJson, GoogleCloudGenAIError } from "@/lib/server/google-cloud-genai";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";
import {
  compactStructureIdentityPack,
  downloadStructureImage,
  getOwnedStructure,
  masterOverviewPrompt,
  pickRenderReferences,
  renderPrompt,
  structureAnalysisPrompt,
  structureEvidenceBatchPrompt,
} from "@/lib/structures/server";
import type {
  StructureCameraNodeRecord,
  StructureImageRecord,
  StructureRuleRecord,
  StructureSurfaceRecord,
} from "@/lib/structures/spatial";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

type RouteContext = { params: Promise<{ id: string }> };
type RenderView = "master_overview" | "front" | "corner" | "environment" | "aerial_oblique";
type StandardRenderView = Exclude<RenderView, "master_overview">;

const ALL_VIEWS: RenderView[] = ["master_overview", "front", "corner", "environment", "aerial_oblique"];
const STANDARD_VIEWS: StandardRenderView[] = ["front", "corner", "environment", "aerial_oblique"];
const VIEW_LABELS: Record<RenderView, string> = {
  master_overview: "00_MASTER_OVERVIEW",
  front: "01_FRONT",
  corner: "02_CORNER",
  environment: "03_ENVIRONMENT",
  aerial_oblique: "04_AERIAL_OBLIQUE",
};
function responseError(error: unknown) {
  const message = error instanceof Error ? error.message : "CLOUVA Cloud no pudo completar el render.";
  const status = error instanceof GoogleCloudGenAIError
    ? error.status
    : isAuthError(error) ? 401 : /no encontrada/i.test(message) ? 404 : 400;
  return NextResponse.json({ error: message }, { status });
}

function parseViews(value: unknown): RenderView[] {
  if (!Array.isArray(value) || !value.length) return ALL_VIEWS;
  const views = value.filter((item): item is RenderView =>
    typeof item === "string" && ALL_VIEWS.includes(item as RenderView),
  );
  return [...new Set(views)].slice(0, 5);
}

async function prepareReference(image: StructureImageRecord) {
  const bytes = await downloadStructureImage(image.public_url);
  const prepared = await sharp(bytes)
    .rotate()
    .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
  return {
    image,
    reference: { mimeType: "image/jpeg", data: prepared.toString("base64") },
  };
}

async function prepareAnalysisReference(image: StructureImageRecord) {
  const bytes = await downloadStructureImage(image.public_url);
  const prepared = await sharp(bytes)
    .rotate()
    .resize(640, 640, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 54, mozjpeg: true })
    .toBuffer();
  return {
    image,
    reference: { mimeType: "image/jpeg", data: prepared.toString("base64") },
  };
}

function parseStructuredJson(text: string): Record<string, unknown> {
  const trimmed = text.trim().replace(/^\uFEFF/, "");
  const unfenced = trimmed
    .replace(/^\`\`\`(?:json)?\s*/i, "")
    .replace(/\s*\`\`\`$/, "")
    .trim();
  const candidates = [trimmed, unfenced];
  const firstBrace = unfenced.indexOf("{");
  const lastBrace = unfenced.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(unfenced.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Try the next normalized representation.
    }
  }
  throw new Error("CLOUVA Cloud no pudo estructurar el análisis canónico del spot.");
}

async function prepareAnalysisReferences(images: StructureImageRecord[]) {
  const unique = images.filter((image, index, all) =>
    all.findIndex((candidate) => candidate.sha256 === image.sha256) === index,
  ).slice(0, 96);
  const prepared: Awaited<ReturnType<typeof prepareAnalysisReference>>[] = [];
  for (let start = 0; start < unique.length; start += 12) {
    const chunk = await Promise.all(unique.slice(start, start + 12).map(async (image) => {
      try {
        return await prepareAnalysisReference(image);
      } catch {
        return null;
      }
    }));
    prepared.push(...chunk.filter((item): item is Awaited<ReturnType<typeof prepareAnalysisReference>> => Boolean(item)));
  }
  return prepared;
}

export async function POST(request: NextRequest, context: RouteContext) {
  let jobId: string | null = null;
  let structureId: string | null = null;
  let ownerId: string | null = null;
  try {
    const { id } = await context.params;
    structureId = id;
    const { user } = await requireUser(request);
    ownerId = user.id;
    const admin = createAdminSupabase();
    const structure = await getOwnedStructure(admin, user.id, id);
    const body = await request.json().catch(() => ({})) as { views?: unknown };
    const views = parseViews(body.views);
    if (!views.length) throw new Error("Elegí al menos una vista.");

    const [
      imagesResult,
      surfacesResult,
      rulesResult,
      cameraNodesResult,
      activeJobsResult,
    ] = await Promise.all([
      admin.from("structure_images").select("*").eq("structure_id", id),
      admin.from("structure_surfaces").select("*").eq("structure_id", id),
      admin.from("structure_rules").select("*").eq("structure_id", id).eq("active", true).order("priority", { ascending: false }),
      admin.from("structure_camera_nodes").select("*").eq("structure_id", id),
      admin.from("structure_render_jobs").select("id", { count: "exact", head: true }).eq("structure_id", id).eq("status", "rendering"),
    ]);

    if (imagesResult.error || surfacesResult.error || rulesResult.error || cameraNodesResult.error || activeJobsResult.error) {
      throw new Error("No se pudo preparar el contexto espacial del render.");
    }
    if ((activeJobsResult.count ?? 0) > 0) {
      throw new Error("Ya hay una reconstrucción de esta estructura en curso.");
    }

    const images = (imagesResult.data ?? []) as unknown as StructureImageRecord[];
    const surfaces = (surfacesResult.data ?? []) as unknown as StructureSurfaceRecord[];
    const dbRules = (rulesResult.data ?? []) as unknown as StructureRuleRecord[];
    const cameraNodes = (cameraNodesResult.data ?? []) as unknown as StructureCameraNodeRecord[];
    if (!images.length) throw new Error("Subí evidencia visual antes de generar las vistas.");

    const activeRules = [
      ...((Array.isArray(structure.reconstruction_rules) ? structure.reconstruction_rules : []) as string[]),
      ...dbRules.map((rule) => rule.rule),
    ].filter((rule, index, all) => Boolean(rule) && all.indexOf(rule) === index);

    const identityPack = compactStructureIdentityPack({
      structure,
      rules: activeRules,
      surfaces: surfaces.map((surface) => ({
        name: surface.name,
        type: surface.type,
        orientation: surface.orientation,
      })),
      images,
      cameraNodes,
    });

    const requestedStandard = views
      .filter((view): view is StandardRenderView => STANDARD_VIEWS.includes(view as StandardRenderView))
      .map((view) => ({
        key: view,
        label: VIEW_LABELS[view],
        referenceIds: pickRenderReferences(images, view, 8).map((image) => image.id),
      }));
    const wantsMasterOverview = views.includes("master_overview");
    const requested = [
      ...(wantsMasterOverview ? [{ key: "master_overview" as const, label: VIEW_LABELS.master_overview, referenceIds: [] as string[] }] : []),
      ...requestedStandard,
    ];

    const { data: job, error: jobError } = await admin
      .from("structure_render_jobs")
      .insert({
        structure_id: id,
        user_id: user.id,
        status: "rendering",
        views_requested: requested,
        input_manifest: {
          identityPack,
          evidenceCount: images.length,
          surfaceCount: surfaces.length,
          cameraNodeCount: cameraNodes.length,
          analysisPass: "canonical-structure-v2-batched",
          generatedBy: "google-cloud-vertex-ai",
        },
        started_at: new Date().toISOString(),
      })
      .select("*")
      .single();
    if (jobError || !job) throw new Error("No se pudo registrar el trabajo de reconstrucción.");
    jobId = job.id;

    await admin.from("structures").update({
      status: "rendering",
      updated_at: new Date().toISOString(),
    }).eq("id", id).eq("owner_id", user.id);

    const imageById = new Map(images.map((image) => [image.id, image]));
    const cameraByImageId = new Map(cameraNodes.map((node) => [node.image_id, node]));

    const analysisPrepared = await prepareAnalysisReferences(images);
    if (!analysisPrepared.length) throw new Error("No se pudo preparar evidencia visual para el análisis canónico.");

    const analysisModel = process.env.GOOGLE_CLOUD_STRUCTURES_VISION_MODEL
      ?? process.env.CLOUVA_STRUCTURES_VISION_MODEL
      ?? "gemini-2.5-flash";

    // Keep each multimodal request safely below Vertex input-token limits while preserving all evidence.
    const BATCH_SIZE = 12;
    const analysisBatches: typeof analysisPrepared[] = [];
    for (let start = 0; start < analysisPrepared.length; start += BATCH_SIZE) {
      analysisBatches.push(analysisPrepared.slice(start, start + BATCH_SIZE));
    }

    const batchSchema = {
      type: "object",
      properties: {
        batchIndex: { type: "number" },
        observations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              imageId: { type: "string" },
              sector: { type: "string" },
              observedElements: { type: "array", items: { type: "string" } },
              geometryClues: { type: "array", items: { type: "string" } },
              continuityClues: { type: "array", items: { type: "string" } },
              conflicts: { type: "array", items: { type: "string" } },
              confidence: { type: "string", enum: ["high", "medium", "low"] },
            },
            required: ["imageId","sector","observedElements","geometryClues","continuityClues","conflicts","confidence"],
          },
        },
        sectorSummary: {
          type: "array",
          items: {
            type: "object",
            properties: {
              sector: { type: "string" },
              imageIds: { type: "array", items: { type: "string" } },
              confirmed: { type: "array", items: { type: "string" } },
              inferred: { type: "array", items: { type: "string" } },
              uncertain: { type: "array", items: { type: "string" } },
            },
            required: ["sector","imageIds","confirmed","inferred","uncertain"],
          },
        },
        aerialFacts: { type: "array", items: { type: "string" } },
        streetFacts: { type: "array", items: { type: "string" } },
      },
      required: ["batchIndex","observations","sectorSummary","aerialFacts","streetFacts"],
    };

    const batchAnalyses = await Promise.all(
      analysisBatches.map(async (batch, batchIndex) => {
        const prompt = structureEvidenceBatchPrompt({
          batchIndex: batchIndex + 1,
          totalBatches: analysisBatches.length,
          evidence: batch.map((entry, index) => {
            const camera = cameraByImageId.get(entry.image.id);
            return {
              index: index + 1,
              imageId: entry.image.id,
              description: entry.image.description,
              sector: entry.image.sector,
              sourceType: entry.image.source_type,
              sceneType: entry.image.scene_type,
              direction: entry.image.cardinal_direction,
              localX: camera?.local_x ?? entry.image.local_x,
              localY: camera?.local_y ?? entry.image.local_y,
              heading: camera?.heading ?? entry.image.heading,
              verified: entry.image.manual_verified,
            };
          }),
        });
        const generated = await generateGoogleCloudJson({
          model: analysisModel,
          prompt,
          referenceImages: batch.map((entry) => entry.reference),
          responseJsonSchema: batchSchema,
          temperature: 0.05,
          maxOutputTokens: 3200,
        });
        return parseStructuredJson(generated.text);
      }),
    );

    const synthesisIdentityPack = {
      project: identityPack.project,
      reconstructionRules: identityPack.reconstructionRules,
      surfaces: identityPack.surfaces,
      spatial: identityPack.spatial,
      evidenceCount: images.length,
    };

    const analysisPrompt = structureAnalysisPrompt({
      identityPack: synthesisIdentityPack as Record<string, unknown>,
      batchAnalyses,
    });

    const analysisGenerated = await generateGoogleCloudJson({
      model: analysisModel,
      prompt: analysisPrompt,
      responseJsonSchema: {
        type: "object",
        properties: {
          summary: { type: "string" },
          canonicalSpatialModel: {
            type: "object",
            properties: {
              footprint: { type: "string" },
              orientation: { type: "string" },
              massing: { type: "array", items: { type: "string" } },
              facades: { type: "array", items: { type: "string" } },
              corners: { type: "array", items: { type: "string" } },
              roof: { type: "array", items: { type: "string" } },
              accesses: { type: "array", items: { type: "string" } },
              patiosOpenAreas: { type: "array", items: { type: "string" } },
              perimeter: { type: "array", items: { type: "string" } },
              sidewalksStreets: { type: "array", items: { type: "string" } },
              immediateEnvironment: { type: "array", items: { type: "string" } },
            },
            required: ["footprint","orientation","massing","facades","corners","roof","accesses","patiosOpenAreas","perimeter","sidewalksStreets","immediateEnvironment"],
          },
          evidenceMapping: {
            type: "array",
            items: {
              type: "object",
              properties: {
                sector: { type: "string" },
                imageIds: { type: "array", items: { type: "string" } },
                confirms: { type: "array", items: { type: "string" } },
                suggests: { type: "array", items: { type: "string" } },
                conflicts: { type: "array", items: { type: "string" } },
              },
              required: ["sector","imageIds","confirms","suggests","conflicts"],
            },
          },
          confidenceMap: {
            type: "array",
            items: {
              type: "object",
              properties: {
                sector: { type: "string" },
                confidence: { type: "string", enum: ["high","medium","low"] },
                basis: { type: "string" },
                imageIds: { type: "array", items: { type: "string" } },
              },
              required: ["sector","confidence","basis","imageIds"],
            },
          },
          renderConstraints: {
            type: "object",
            properties: {
              immutableFacts: { type: "array", items: { type: "string" } },
              uncertainAreas: { type: "array", items: { type: "string" } },
              forbiddenInventions: { type: "array", items: { type: "string" } },
            },
            required: ["immutableFacts","uncertainAreas","forbiddenInventions"],
          },
        },
        required: ["summary","canonicalSpatialModel","evidenceMapping","confidenceMap","renderConstraints"],
      },
      temperature: 0.05,
      maxOutputTokens: 9000,
    });

    const canonicalAnalysis = parseStructuredJson(analysisGenerated.text);

    await admin.from("structure_render_jobs").update({
      input_manifest: {
        identityPack,
        canonicalAnalysis,
        evidenceCount: images.length,
        visualEvidenceAnalyzed: analysisPrepared.length,
        analysisBatchCount: analysisBatches.length,
        surfaceCount: surfaces.length,
        cameraNodeCount: cameraNodes.length,
        analysisModel,
        analysisPass: "canonical-structure-v2-batched",
        generatedBy: "google-cloud-vertex-ai",
      },
    }).eq("id", job.id).eq("user_id", user.id);

    const allReferenceIds = [...new Set(requestedStandard.flatMap((view) => view.referenceIds))];
    const preparedEntries = await Promise.all(allReferenceIds.map(async (imageId) => {
      const image = imageById.get(imageId);
      if (!image) return null;
      try {
        return await prepareReference(image);
      } catch {
        return null;
      }
    }));
    const preparedById = new Map(
      preparedEntries
        .filter((entry): entry is Awaited<ReturnType<typeof prepareReference>> => Boolean(entry))
        .map((entry) => [entry.image.id, entry]),
    );

    const model = process.env.GOOGLE_CLOUD_STRUCTURES_IMAGE_MODEL
      ?? process.env.CLOUVA_STRUCTURES_IMAGE_MODEL
      ?? "gemini-2.5-flash-image";

    const generateView = async (
      requestedView: (typeof requestedStandard)[number],
      canonicalAnchor?: { mimeType: string; data: string } | null,
    ) => {
      const references = requestedView.referenceIds
        .map((imageId) => preparedById.get(imageId))
        .filter((entry): entry is Awaited<ReturnType<typeof prepareReference>> => Boolean(entry));

      if (!references.length) {
        throw new Error(`${requestedView.label}: no hay referencias utilizables para esta camara.`);
      }

      const prompt = renderPrompt({
        identityPack: identityPack as Record<string, unknown>,
        canonicalAnalysis,
        view: requestedView.key,
        hasCanonicalAnchor: Boolean(canonicalAnchor),
        referenceDescriptions: references.map(({ image }) => {
          const camera = cameraByImageId.get(image.id);
          return {
            id: image.id,
            description: image.description,
            sector: image.sector,
            direction: image.cardinal_direction,
            localX: camera?.local_x ?? image.local_x,
            localY: camera?.local_y ?? image.local_y,
            heading: camera?.heading ?? image.heading,
          };
        }),
      });

      const generated = await generateGoogleCloudImage({
        prompt,
        model,
        aspectRatio: "16:9",
        imageSize: "2K",
        referenceImages: [
          ...(canonicalAnchor ? [canonicalAnchor] : []),
          ...references.map((entry) => entry.reference),
        ],
        timeoutMs: 120_000,
      });

      const stored = await uploadGeneratedMediaObject({
        bytes: generated.bytes,
        mimeType: generated.mimeType,
        pathPrefix: `structures/${user.id}/${id}/renders/${job.id}/${requestedView.key}`,
      });

      const { data: output, error: outputError } = await admin
        .from("structure_render_outputs")
        .insert({
          job_id: job.id,
          structure_id: id,
          view_key: requestedView.key,
          prompt,
          reference_image_ids: references.map((entry) => entry.image.id),
          storage_path: stored.objectPath,
          public_url: stored.url,
          mime_type: generated.mimeType,
          provider_operation_id: generated.responseId,
        })
        .select("*")
        .single();
      if (outputError || !output) throw new Error(`${requestedView.label}: la imagen se genero pero no pudo registrarse.`);

      return {
        output: output as Record<string, unknown>,
        reference: { mimeType: generated.mimeType, data: generated.bytes.toString("base64") },
      };
    };

    const outcomes: Array<PromiseSettledResult<Record<string, unknown>>> = [];
    const generatedViewReferences = new Map<StandardRenderView, { mimeType: string; data: string }>();
    let canonicalAnchor: { mimeType: string; data: string } | null = null;

    const aerialRequest = requestedStandard.find((view) => view.key === "aerial_oblique");
    if (aerialRequest) {
      try {
        const aerial = await generateView(aerialRequest, null);
        canonicalAnchor = aerial.reference;
        generatedViewReferences.set("aerial_oblique", aerial.reference);
        outcomes.push({ status: "fulfilled", value: aerial.output });
      } catch (reason) {
        outcomes.push({ status: "rejected", reason });
      }
    }

    const remainingViews = requestedStandard.filter((view) => view.key !== "aerial_oblique");
    const remainingResults = await Promise.allSettled(
      remainingViews.map(async (requestedView) => {
        const result = await generateView(requestedView, canonicalAnchor);
        generatedViewReferences.set(requestedView.key, result.reference);
        return result.output;
      }),
    );
    outcomes.push(...remainingResults);

    if (wantsMasterOverview) {
      try {
        const boardReferences = (["aerial_oblique","front","corner","environment"] as StandardRenderView[])
          .map((view) => generatedViewReferences.get(view))
          .filter((reference): reference is { mimeType: string; data: string } => Boolean(reference));

        if (boardReferences.length < 4) {
          const { data: previousOutputs } = await admin
            .from("structure_render_outputs")
            .select("view_key,public_url,created_at")
            .eq("structure_id", id)
            .in("view_key", STANDARD_VIEWS)
            .order("created_at", { ascending: false })
            .limit(24);
          const seen = new Set<string>();
          for (const output of previousOutputs ?? []) {
            if (boardReferences.length >= 4) break;
            const key = output.view_key as StandardRenderView;
            if (generatedViewReferences.has(key) || seen.has(key) || !output.public_url) continue;
            seen.add(key);
            try {
              const bytes = await downloadStructureImage(output.public_url);
              const prepared = await sharp(bytes)
                .rotate()
                .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
                .jpeg({ quality: 82, mozjpeg: true })
                .toBuffer();
              boardReferences.push({ mimeType: "image/jpeg", data: prepared.toString("base64") });
            } catch {
              // Continue with the remaining available canonical views.
            }
          }
        }

        if (!boardReferences.length) throw new Error("00_MASTER_OVERVIEW: faltan vistas canónicas para construir el panel maestro.");

        const prompt = masterOverviewPrompt({
          identityPack: identityPack as Record<string, unknown>,
          canonicalAnalysis,
        });
        const generated = await generateGoogleCloudImage({
          prompt,
          model,
          aspectRatio: "16:9",
          imageSize: "2K",
          referenceImages: boardReferences,
          timeoutMs: 120_000,
        });
        const stored = await uploadGeneratedMediaObject({
          bytes: generated.bytes,
          mimeType: generated.mimeType,
          pathPrefix: `structures/${user.id}/${id}/renders/${job.id}/master_overview`,
        });
        const { data: output, error: outputError } = await admin
          .from("structure_render_outputs")
          .insert({
            job_id: job.id,
            structure_id: id,
            view_key: "master_overview",
            prompt,
            reference_image_ids: [],
            storage_path: stored.objectPath,
            public_url: stored.url,
            mime_type: generated.mimeType,
            provider_operation_id: generated.responseId,
          })
          .select("*")
          .single();
        if (outputError || !output) throw new Error("00_MASTER_OVERVIEW: la imagen se genero pero no pudo registrarse.");
        outcomes.unshift({ status: "fulfilled", value: output as Record<string, unknown> });
      } catch (reason) {
        outcomes.unshift({ status: "rejected", reason });
      }
    }

    const outputs = outcomes
      .filter((outcome): outcome is PromiseFulfilledResult<Record<string, unknown>> => outcome.status === "fulfilled")
      .map((outcome) => outcome.value);
    const errors = outcomes
      .filter((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected")
      .map((outcome) => outcome.reason instanceof Error ? outcome.reason.message : "Una vista no pudo generarse.");

    const status = outputs.length === requested.length
      ? "completed"
      : outputs.length > 0 ? "partial" : "failed";

    await admin.from("structure_render_jobs").update({
      status,
      error: errors.length ? errors.join("\n").slice(0, 3000) : null,
      completed_at: new Date().toISOString(),
    }).eq("id", job.id).eq("user_id", user.id);

    await admin.from("structures").update({
      status: status === "failed" ? "ready" : "completed",
      updated_at: new Date().toISOString(),
    }).eq("id", id).eq("owner_id", user.id);

    if (!outputs.length) {
      const firstError = errors[0] || "CLOUVA Cloud no pudo generar ninguna vista.";
      const quotaLimited = /RESOURCE_EXHAUSTED|quota|rate.?limit/i.test(firstError);
      const permissionDenied = /PERMISSION_DENIED|forbidden|permission/i.test(firstError);
      return NextResponse.json({
        error: firstError,
        code: quotaLimited ? "vertex_quota_limited" : permissionDenied ? "vertex_permission_denied" : "render_failed",
        provider: "google_vertex_ai",
        job: { ...job, status },
        outputs,
        errors,
        model,
      }, { status: quotaLimited ? 429 : permissionDenied ? 403 : 502 });
    }

    return NextResponse.json({
      job: { ...job, status },
      outputs,
      errors,
      model,
      provider: "google_vertex_ai",
    });
  } catch (error) {
    if (jobId) {
      try {
        const admin = createAdminSupabase();
        await admin.from("structure_render_jobs").update({
          status: "failed",
          error: error instanceof Error ? error.message.slice(0, 3000) : "Falló la reconstrucción.",
          completed_at: new Date().toISOString(),
        }).eq("id", jobId);
        if (structureId && ownerId) {
          await admin.from("structures").update({
            status: "ready",
            updated_at: new Date().toISOString(),
          }).eq("id", structureId).eq("owner_id", ownerId);
        }
      } catch {
        // Preserve the original render error.
      }
    }
    return responseError(error);
  }
}
