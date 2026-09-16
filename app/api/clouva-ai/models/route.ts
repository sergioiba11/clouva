import { NextResponse } from "next/server";
import { createAIProviderRouter } from "@/lib/clouva-ai/providers/provider-router";
import { publicProviderError } from "@/lib/clouva-ai/providers/errors";

export const runtime = "nodejs";
export const revalidate = 300;

export async function GET(request: Request) {
  try {
    const router = createAIProviderRouter({ request });
    const diagnostics = router.diagnostics();
    try {
      const models = await router.listModels();
      const defaultModel = models.some((model) => model.id === diagnostics.model)
        ? diagnostics.model
        : models[0]?.id ?? diagnostics.model;
      return NextResponse.json({
        ok: true,
        available: true,
        provider: diagnostics.provider,
        models,
        defaultModel,
        fallbackModel: diagnostics.fallbackModel,
        fallbackProvider: diagnostics.fallbackProvider,
        capabilities: diagnostics.capabilities,
      });
    } catch (error) {
      const normalized = publicProviderError(error);
      return NextResponse.json({
        ok: true,
        available: false,
        provider: diagnostics.provider,
        models: [{
          id: diagnostics.model,
          name: diagnostics.model,
          description: "Modelo configurado en ClouAI; el catálogo del provider no respondió.",
          inputTokenLimit: null,
          outputTokenLimit: null,
        }],
        defaultModel: diagnostics.model,
        fallbackModel: diagnostics.fallbackModel,
        fallbackProvider: diagnostics.fallbackProvider,
        capabilities: diagnostics.capabilities,
        providerError: { code: normalized.code, message: normalized.message },
      });
    }
  } catch (error) {
    const normalized = publicProviderError(error);
    return NextResponse.json(
      { error: normalized.message, code: normalized.code },
      { status: normalized.status },
    );
  }
}
