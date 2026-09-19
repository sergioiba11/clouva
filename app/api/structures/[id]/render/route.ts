import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { uploadGeneratedMediaObject } from "@/lib/gcs-media";
import { generateGoogleCloudImage, GoogleCloudGenAIError } from "@/lib/server/google-cloud-genai";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";
import {
  compactStructureIdentityPack,
  downloadStructureImage,
  getOwnedStructure,
  pickRenderReferences,
  renderPrompt,
} from "@/lib/structures/server";
import type {
  StructureImageRecord,
  StructureRuleRecord,
  StructureSurfaceRecord,
} from "@/lib/structures/spatial";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type RouteContext = { params: Promise<{ id: string }> };
type RenderView = "front" | "corner" | "environment" | "aerial_oblique";

const ALL_VIEWS: RenderView[] = ["front", "corner", "environment", "aerial_oblique"];
const VIEW_LABELS: Record<RenderView, string> = {
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
  return [...new Set(views)].slice(0, 4);
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

export async function POST(request: NextRequest, context: RouteContext) {
  let jobId: string | null = null;
  try {
    const { id } = await context.params;
    const { user } = await requireUser(request);
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
    const cameraNodes = (cameraNodesResult.data ?? []) as Array<{
      id: string;
      structure_id: string;
      image_id: string;
      latitude: number | null;
      longitude: number | null;
      altitude: number | null;
      local_x: number | null;
      local_y: number | null;
      local_z: number | null;
      heading: number | null;
      pitch: number | null;
      roll: number | null;
      fov: number | null;
      target_x: number | null;
      target_y: number | null;
      target_z: number | null;
      confidence: number | null;
      spatial_source: "unplaced" | "exif" | "filename" | "manual" | "inferred_cloud";
    }>;
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

    const requested = views.map((view) => ({
      key: view,
      label: VIEW_LABELS[view],
      referenceIds: pickRenderReferences(images, view, 8).map((image) => image.id),
    }));

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
    const allReferenceIds = [...new Set(requested.flatMap((view) => view.referenceIds))];
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
      requestedView: (typeof requested)[number],
      canonicalAnchor?: { mimeType: string; data: string } | null,
    ) => {
      const references = requestedView.referenceIds
        .map((imageId) => preparedById.get(imageId))
        .filter((entry): entry is Awaited<ReturnType<typeof prepareReference>> => Boolean(entry));

      if (!references.length) {
        throw new Error(`${requestedView.label}: no hay referencias utilizables para esta cámara.`);
      }

      const prompt = renderPrompt({
        identityPack: identityPack as Record<string, unknown>,
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

      const referenceImages = [
        ...(canonicalAnchor ? [canonicalAnchor] : []),
        ...references.map((entry) => entry.reference),
      ];

      const generated = await generateGoogleCloudImage({
        prompt,
        model,
        aspectRatio: "16:9",
        imageSize: "2K",
        referenceImages,
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
      if (outputError || !output) {
        throw new Error(`${requestedView.label}: la imagen se generó pero no pudo registrarse.`);
      }

      return {
        output,
        generatedReference: {
          mimeType: generated.mimeType,
          data: generated.bytes.toString("base64"),
        },
      };
    };

    const outcomes: Array<PromiseSettledResult<Record<string, unknown>>> = [];
    let canonicalAnchor: { mimeType: string; data: string } | null = null;

    const aerialRequest = requested.find((view) => view.key === "aerial_oblique");
    if (aerialRequest) {
      try {
        const aerial = await generateView(aerialRequest, null);
        canonicalAnchor = aerial.generatedReference;
        outcomes.push({ status: "fulfilled", value: aerial.output });
      } catch (reason) {
        outcomes.push({ status: "rejected", reason });
      }
    }

    const remainingViews = requested.filter((view) => view.key !== "aerial_oblique");
    const remainingOutcomes = await Promise.allSettled(
      remainingViews.map(async (requestedView) => {
        const result = await generateView(requestedView, canonicalAnchor);
        return result.output;
      }),
    );
    outcomes.push(...remainingOutcomes);

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
      } catch {
        // Preserve the original render error.
      }
    }
    return responseError(error);
  }
}
