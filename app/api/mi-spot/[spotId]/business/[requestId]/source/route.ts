import { NextRequest, NextResponse } from "next/server";
import {
  extractJsonValue,
  sanitizeBusinessCandidates,
} from "@/lib/commerce/business-copilot";
import { generateGroundedWithFallback } from "@/lib/clouva-ai/gemini-grounded";
import { generateWithFallback, selectedModelFromRequest } from "@/lib/clouva-ai/gemini-text";
import { requireSpotAccess } from "@/lib/server/commerce-spot";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type RequestRow = {
  id: string;
  spot_id: string;
  request_type: string;
  status: string;
  title: string;
  input_text: string | null;
  intent: Record<string, unknown>;
  plan: Array<Record<string, unknown>>;
  sourcing_result: Record<string, unknown>;
  decision_context: Record<string, unknown>;
};

function apiStatus(error: unknown) {
  return (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
}

function short(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

async function loadRequest(admin: ReturnType<typeof createAdminSupabase>, spotId: string, requestId: string) {
  const { data, error } = await admin
    .from("business_requests")
    .select("id,spot_id,request_type,status,title,input_text,intent,plan,sourcing_result,decision_context")
    .eq("id", requestId)
    .eq("spot_id", spotId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    const notFound = new Error("La operación no existe.") as Error & { status?: number };
    notFound.status = 404;
    throw notFound;
  }
  return data as RequestRow;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ spotId: string; requestId: string }> }) {
  let previousStatus = "analyzed";
  try {
    const { user } = await requireUser(request);
    const { spotId, requestId } = await params;
    const admin = createAdminSupabase();
    const access = await requireSpotAccess({ admin, userId: user.id, spotId, capability: "operations" });
    const operation = await loadRequest(admin, spotId, requestId);
    previousStatus = operation.status;

    if (operation.status === "candidate_selected" || operation.status === "completed") {
      return NextResponse.json({ error: "Esta operación ya tiene una decisión tomada." }, { status: 409 });
    }
    if (!["sourcing", "procurement", "vehicle", "operations"].includes(operation.request_type)) {
      return NextResponse.json({ error: "Esta operación no usa el ejecutor de búsqueda de proveedores." }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY no está configurada." }, { status: 503 });

    await admin.from("business_requests").update({ status: "searching", updated_at: new Date().toISOString() }).eq("id", requestId);

    const knowledge = await admin.rpc("clouva_resolve_knowledge_context", {
      p_user_id: user.id,
      p_query: `${operation.title} ${operation.input_text || ""}`,
      p_studio_id: access.spot.studio_id ?? null,
      p_limit: 6,
    });

    const selectedModel = selectedModelFromRequest(request);
    const searchPrompt = [
      `OPERACIÓN: ${operation.title}`,
      `PEDIDO ORIGINAL: ${operation.input_text || "sin texto adicional"}`,
      `INTENCIÓN ESTRUCTURADA: ${JSON.stringify(operation.intent)}`,
      `NEGOCIO: ${JSON.stringify({
        name: access.spot.name,
        businessType: access.spot.business_type,
        categories: access.spot.business_categories,
        countryCode: access.spot.country_code,
        currency: access.spot.currency,
        timezone: access.spot.timezone,
        brandTone: access.spot.brand_tone,
      })}`,
      `CONTEXTO CONOCIDO: ${JSON.stringify(knowledge.error ? null : knowledge.data)}`,
      "Investigá opciones reales y actuales en la web que sirvan para concretar este pedido.",
      "Priorizá proveedor/mayorista/fabricante o producto comprable según el objetivo. Si el destino se conoce, consideralo.",
      "Por cada opción, describí qué encontraste, proveedor, precio y moneda sólo si la fuente los muestra, MOQ sólo si está publicado, condiciones/envío si aparecen y por qué encaja.",
      "No inventes precios, stock, MOQ, autenticidad, logística ni capacidad de envío. Señalá lo que haya que confirmar.",
      "Terminá con una comparación operativa corta y qué dato falta antes de comprar.",
    ].join("\n\n");

    const grounded = await generateGroundedWithFallback({
      apiKey,
      selectedModel,
      instruction: [
        "Sos el ejecutor de sourcing de Business Player en CLOUVA.",
        "Usá Google Search grounding para investigar fuentes actuales.",
        "Tratás la web como Live Data: no la convertís en memoria permanente salvo una decisión posterior del Player.",
        "No afirmes que una marca es auténtica sólo por una foto o publicación.",
        "No inventes datos ausentes.",
      ].join("\n"),
      prompt: searchPrompt,
      maxOutputTokens: 3200,
    });

    const sourceList = grounded.sources.map((source, index) => ({ index, title: source.title, url: source.url }));
    const structured = await generateWithFallback({
      apiKey,
      selectedModel: grounded.model,
      instruction: [
        "Convertí una investigación grounded en candidatos estructurados para Business Player.",
        "Sólo podés enlazar una opción mediante sourceIndex si esa fuente realmente respalda la opción.",
        "No inventes precio, MOQ, moneda, envío ni proveedor. Usá null cuando no esté respaldado.",
        "Respondé sólo JSON válido sin markdown.",
      ].join("\n"),
      contents: [{
        role: "user",
        parts: [{ text: [
          `INVESTIGACIÓN:\n${grounded.text}`,
          `FUENTES GROUNDING INDEXADAS:\n${JSON.stringify(sourceList)}`,
          "Devolvé este contrato:",
          JSON.stringify({
            candidates: [{
              supplierName: null,
              offerTitle: "",
              sourceIndex: 0,
              priceAmount: null,
              currency: null,
              moq: null,
              shippingSummary: null,
              matchReason: "",
              risks: [],
            }],
          }),
        ].join("\n\n") }],
      }],
      maxOutputTokens: 2600,
      temperature: 0.1,
    });

    const candidates = sanitizeBusinessCandidates(extractJsonValue(structured.text), sourceList.length);
    await admin.from("business_sourcing_candidates").delete().eq("request_id", requestId);
    if (candidates.length) {
      const rows = candidates.map((candidate, index) => {
        const source = candidate.sourceIndex === null ? null : sourceList[candidate.sourceIndex] ?? null;
        return {
          request_id: requestId,
          rank: index + 1,
          status: "candidate",
          supplier_name: candidate.supplierName,
          offer_title: candidate.offerTitle,
          source_title: source?.title ?? null,
          source_url: source?.url ?? null,
          price_amount: candidate.priceAmount,
          currency: candidate.currency,
          moq: candidate.moq,
          shipping_summary: candidate.shippingSummary,
          match_reason: candidate.matchReason,
          risks: candidate.risks,
          metadata: { sourceIndex: candidate.sourceIndex },
        };
      });
      const insert = await admin.from("business_sourcing_candidates").insert(rows);
      if (insert.error) throw new Error(insert.error.message);
    }

    const sourcingResult = {
      research: grounded.text,
      sources: sourceList,
      searches: grounded.searches,
      groundedModel: grounded.model,
      structuredModel: structured.model,
      searchedAt: new Date().toISOString(),
    };
    const { error: updateError } = await admin.from("business_requests").update({
      status: "candidates_ready",
      sourcing_result: sourcingResult,
      updated_at: new Date().toISOString(),
    }).eq("id", requestId);
    if (updateError) throw new Error(updateError.message);

    await admin.from("business_request_events").insert({
      request_id: requestId,
      actor_user_id: user.id,
      event_type: "sourcing_completed",
      data: { sources: sourceList.length, candidates: candidates.length, model: grounded.model },
    });

    const refreshed = await admin.from("business_sourcing_candidates").select("*").eq("request_id", requestId).order("rank");
    if (refreshed.error) throw new Error(refreshed.error.message);
    return NextResponse.json({ sourcingResult, candidates: refreshed.data ?? [] });
  } catch (error) {
    try {
      const { spotId, requestId } = await params;
      const admin = createAdminSupabase();
      await admin.from("business_requests").update({ status: previousStatus, updated_at: new Date().toISOString() }).eq("id", requestId).eq("spot_id", spotId);
    } catch { /* preserve original error */ }
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo completar la búsqueda." }, { status: apiStatus(error) });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ spotId: string; requestId: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { spotId, requestId } = await params;
    const admin = createAdminSupabase();
    await requireSpotAccess({ admin, userId: user.id, spotId, capability: "operations" });
    const operation = await loadRequest(admin, spotId, requestId);
    const body = await request.json().catch(() => ({})) as { candidateId?: string; decision?: string; reason?: string };
    const candidateId = short(body.candidateId, 80);
    const decision = body.decision === "selected" ? "selected" : body.decision === "rejected" ? "rejected" : "";
    const reason = short(body.reason, 600);
    if (!candidateId || !decision) return NextResponse.json({ error: "Decisión inválida." }, { status: 400 });

    const { data: candidate, error: candidateError } = await admin
      .from("business_sourcing_candidates")
      .select("*")
      .eq("id", candidateId)
      .eq("request_id", requestId)
      .maybeSingle();
    if (candidateError) throw new Error(candidateError.message);
    if (!candidate) return NextResponse.json({ error: "El candidato no pertenece a esta operación." }, { status: 404 });

    if (decision === "selected") {
      await admin.from("business_sourcing_candidates").update({ status: "candidate", updated_at: new Date().toISOString() }).eq("request_id", requestId).neq("status", "rejected");
      const chosen = await admin.from("business_sourcing_candidates").update({ status: "selected", updated_at: new Date().toISOString() }).eq("id", candidateId);
      if (chosen.error) throw new Error(chosen.error.message);
      const update = await admin.from("business_requests").update({
        status: "candidate_selected",
        decision_context: {
          decision: "selected",
          candidateId,
          supplierName: candidate.supplier_name,
          offerTitle: candidate.offer_title,
          sourceTitle: candidate.source_title,
          sourceUrl: candidate.source_url,
          priceAmount: candidate.price_amount,
          currency: candidate.currency,
          moq: candidate.moq,
          reason: reason || null,
          decidedAt: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      }).eq("id", requestId);
      if (update.error) throw new Error(update.error.message);
    } else {
      const rejected = await admin.from("business_sourcing_candidates").update({ status: "rejected", updated_at: new Date().toISOString() }).eq("id", candidateId);
      if (rejected.error) throw new Error(rejected.error.message);
      const previous = operation.decision_context && typeof operation.decision_context === "object" ? operation.decision_context : {};
      const rejections = Array.isArray((previous as Record<string, unknown>).rejections)
        ? (previous as Record<string, unknown>).rejections as unknown[]
        : [];
      const update = await admin.from("business_requests").update({
        decision_context: {
          ...previous,
          rejections: [...rejections, {
            candidateId,
            supplierName: candidate.supplier_name,
            offerTitle: candidate.offer_title,
            reason: reason || null,
            rejectedAt: new Date().toISOString(),
          }].slice(-12),
        },
        updated_at: new Date().toISOString(),
      }).eq("id", requestId);
      if (update.error) throw new Error(update.error.message);
    }

    await admin.from("business_request_events").insert({
      request_id: requestId,
      actor_user_id: user.id,
      event_type: decision === "selected" ? "candidate_selected" : "candidate_rejected",
      data: { candidateId, reason: reason || null },
    });

    const refreshed = await admin.from("business_sourcing_candidates").select("*").eq("request_id", requestId).order("rank");
    if (refreshed.error) throw new Error(refreshed.error.message);
    const requestResult = await admin.from("business_requests").select("*").eq("id", requestId).single();
    if (requestResult.error) throw new Error(requestResult.error.message);
    return NextResponse.json({ request: requestResult.data, candidates: refreshed.data ?? [] });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo guardar la decisión." }, { status: apiStatus(error) });
  }
}
