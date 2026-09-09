import { NextRequest, NextResponse } from "next/server";
import { generateImage, GeminiImageError, type GeminiImageModel, type GeminiReferenceImage } from "@/lib/gemini-image";
import { uploadGeneratedMediaObject } from "@/lib/gcs-media";
import { isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const IMAGE_MODELS = new Set<GeminiImageModel>(["gemini-3.1-flash-lite-image", "gemini-3.1-flash-image", "gemini-3-pro-image"]);
const GENERATED_BUCKET = process.env.CLOUVA_GENERATED_MEDIA_BUCKET ?? "clouva-generated-media";
const MAX_REFERENCE_BYTES = 8 * 1024 * 1024;
const MAX_REFERENCES = 6;
const TARGETS = {
  collection_cover: "1:1",
  campaign_group: "16:9",
  campaign_story: "9:16",
  campaign_social_square: "1:1",
} as const;

type CampaignKind = keyof typeof TARGETS;
type AssetLike = { url?: unknown; kind?: unknown; status?: unknown; storagePath?: unknown };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function campaignKinds(body: { target?: unknown; kinds?: unknown }): CampaignKind[] {
  const allowed = new Set(Object.keys(TARGETS) as CampaignKind[]);
  if (Array.isArray(body.kinds)) {
    const values = body.kinds.map((value) => String(value) as CampaignKind).filter((value) => allowed.has(value));
    if (values.length) return [...new Set(values)];
  }
  const target = String(body.target || "") as CampaignKind;
  if (allowed.has(target)) return [target];
  return Object.keys(TARGETS) as CampaignKind[];
}

function trustedUrl(value: unknown) {
  const raw = text(value, 2000);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.hostname !== "storage.googleapis.com") return null;
    if (!url.pathname.startsWith(`/${GENERATED_BUCKET}/creator-commerce/`)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

async function loadReference(url: string): Promise<GeminiReferenceImage | null> {
  try {
    const response = await fetch(url, { cache: "force-cache", signal: AbortSignal.timeout(20_000) });
    if (!response.ok) return null;
    const mimeType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() || "";
    if (!ALLOWED_MIME.has(mimeType)) return null;
    const declared = Number(response.headers.get("content-length") || "0");
    if (declared > MAX_REFERENCE_BYTES) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_REFERENCE_BYTES) return null;
    return { mimeType, data: bytes.toString("base64") };
  } catch {
    return null;
  }
}

function campaignPrompt(args: {
  projectName: string;
  collectionName: string;
  brief: string;
  designSystem: Record<string, unknown>;
  productNames: string[];
  kind: CampaignKind;
  campaignStyle: string;
}) {
  const formatInstruction = args.kind === "campaign_story"
    ? "Composición vertical 9:16 para story."
    : args.kind === "campaign_group"
      ? "Composición horizontal 16:9 con varios productos del drop juntos."
      : args.kind === "collection_cover"
        ? "Portada cuadrada 1:1 del drop: identidad potente y clara, sin texto añadido."
        : "Social square 1:1 de campaña con lenguaje editorial/comercial.";
  return [
    "Sos el director de campaña de CLOUVA Commerce Creator.",
    `DROP: ${args.projectName} · ${args.collectionName || "Drop"}.`,
    args.brief ? `Brief: ${args.brief}.` : "",
    `Design System: ${JSON.stringify(args.designSystem).slice(0, 2200)}.`,
    `Productos aprobados de la colección: ${args.productNames.join(", ")}.`,
    `Estilo: ${args.campaignStyle || "premium urbano futurista"}.`,
    formatInstruction,
    "Las imágenes de referencia muestran productos APROBADOS. Conservá sus diseños, colores, artwork y materiales visibles. No sustituyas logos ni inventes otro drop.",
    "Podés presentar los productos solos o con modelos ADULTOS completamente ficticios cuando la composición lo pida. No imites celebridades ni personas reales.",
    "No agregues precios, stock, claims, marcas externas ni texto promocional flotante.",
    "Estos son assets de CAMPAÑA DEL DROP; no deben fingir ser la ficha individual de un producto.",
  ].filter(Boolean).join("\n");
}

function publicError(error: unknown) {
  if (error instanceof GeminiImageError) {
    const message = error.message || "Gemini no pudo generar la campaña.";
    if (/quota|resource exhausted|rate limit/i.test(message)) return { status: 429, message: "La cuota de Gemini para imágenes está agotada." };
    if (/billing|paid tier|payment/i.test(message)) return { status: 402, message: "La generación de imágenes requiere facturación habilitada." };
    if (/abort|timeout|timed out/i.test(message)) return { status: 504, message: "Gemini superó el tiempo de espera." };
    return { status: error.status || 502, message };
  }
  const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
  return { status, message: error instanceof Error ? error.message : "No se pudo generar la campaña." };
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user, supabase } = await requireUser(request);
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { campaignStyle?: unknown; target?: unknown; kinds?: unknown };
    const requestedKinds = campaignKinds(body);

    const [projectResult, conceptsResult] = await Promise.all([
      supabase.from("commerce_creator_projects").select("id,name,collection_name,brief,design_system,reference_assets,generated_assets").eq("id", id).maybeSingle(),
      supabase.from("commerce_creator_product_concepts").select("id,name,status,approved_assets").eq("project_id", id).in("status", ["approved", "commerce_ready", "published"]).order("position", { ascending: true }),
    ]);
    if (projectResult.error) throw new Error(projectResult.error.message);
    if (conceptsResult.error) throw new Error(conceptsResult.error.message);
    if (!projectResult.data) return NextResponse.json({ error: "El proyecto no existe o no tenés permiso." }, { status: 404 });

    const concepts = conceptsResult.data ?? [];
    const approvedProductUrls = concepts.flatMap((concept) =>
      Array.isArray(concept.approved_assets)
        ? (concept.approved_assets as AssetLike[]).map((asset) => trustedUrl(asset?.url)).filter((url): url is string => Boolean(url)).slice(0, 1)
        : [],
    );
    const projectReferenceUrls = Array.isArray(projectResult.data.reference_assets)
      ? (projectResult.data.reference_assets as AssetLike[]).map((asset) => trustedUrl(asset?.url)).filter((url): url is string => Boolean(url))
      : [];
    const urls = [...approvedProductUrls, ...projectReferenceUrls].slice(0, MAX_REFERENCES);
    if (!approvedProductUrls.length) {
      return NextResponse.json({ error: "Aprobá al menos un producto antes de generar la campaña del drop." }, { status: 409 });
    }

    const refs = (await Promise.all(urls.map(loadReference))).filter((item): item is GeminiReferenceImage => Boolean(item));
    if (!refs.length) return NextResponse.json({ error: "No pudimos cargar referencias aprobadas para la campaña." }, { status: 422 });

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY no está configurada." }, { status: 500 });
    const configuredModel = process.env.GEMINI_COMMERCE_IMAGE_MODEL ?? process.env.GEMINI_IMAGE_MODEL ?? "gemini-3.1-flash-image";
    const model: GeminiImageModel = IMAGE_MODELS.has(configuredModel as GeminiImageModel) ? configuredModel as GeminiImageModel : "gemini-3.1-flash-image";
    const designSystem = record(projectResult.data.design_system);
    const campaignStyle = text(body.campaignStyle, 80) || text(designSystem.campaignStyle, 80);
    const productNames = concepts.map((concept) => concept.name).slice(0, 8);
    const common = {
      projectName: projectResult.data.name,
      collectionName: projectResult.data.collection_name || "",
      brief: projectResult.data.brief || "",
      designSystem,
      productNames,
      campaignStyle,
    };

    let currentAssets = Array.isArray(projectResult.data.generated_assets) ? projectResult.data.generated_assets as AssetLike[] : [];
    const generated: AssetLike[] = [];
    const failures: Array<{ kind: CampaignKind; error: string }> = [];

    for (const kind of requestedKinds) {
      try {
        const image = await generateImage({
          apiKey,
          model,
          prompt: campaignPrompt({ ...common, kind }),
          referenceImages: refs,
          aspectRatio: TARGETS[kind],
          imageSize: "1K",
          timeoutMs: 150_000,
        });
        const stored = await uploadGeneratedMediaObject({
          bytes: image.bytes,
          mimeType: image.mimeType,
          pathPrefix: `creator-commerce/${user.id}/${id}/campaign/${kind}`,
        });
        const asset: AssetLike = {
          kind,
          url: stored.url,
          storagePath: stored.objectPath,
          status: "generated",
        };
        currentAssets = [...currentAssets.filter((item) => String(record(item).kind) !== kind), asset];
        const saved = await supabase
          .from("commerce_creator_projects")
          .update({ generated_assets: currentAssets, updated_at: new Date().toISOString() })
          .eq("id", id)
          .select("id")
          .maybeSingle();
        if (saved.error) throw new Error(saved.error.message);
        if (!saved.data) throw new Error("No se pudo persistir el asset de campaña.");
        generated.push(asset);
      } catch (error) {
        const mapped = publicError(error);
        failures.push({ kind, error: mapped.message });
      }
    }

    if (!generated.length && failures.length) {
      return NextResponse.json({ error: "No se pudo generar ningún asset de campaña.", failures }, { status: 502 });
    }

    return NextResponse.json({ assets: generated, failures, provider: "gemini", model, persisted: true, partial: failures.length > 0 });
  } catch (error) {
    const mapped = publicError(error);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}
