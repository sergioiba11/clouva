import { getAIProviderConfig, selectedModelFromRequest, type ProviderConfig } from "./config";
import { GeminiProvider } from "./gemini-provider";
import { OpenAICompatibleProvider } from "./openai-compatible-provider";
import { normalizeProviderError, ProviderError } from "./errors";
import type {
  ClouvaAIProvider,
  ClouvaAIProviderId,
  ProviderGenerateArgs,
  ProviderModel,
  ProviderToolTurnArgs,
  RoutedProviderResult,
} from "./types";

function createProvider(config: ProviderConfig): ClouvaAIProvider {
  return config.id === "clouva"
    ? new OpenAICompatibleProvider(config)
    : new GeminiProvider(config);
}

type Candidate = { provider: ClouvaAIProvider; model: string; fallbackUsed: boolean };

export class ClouvaAIProviderRouter {
  readonly primaryProvider: ClouvaAIProvider;
  readonly fallbackProvider: ClouvaAIProvider | null;
  readonly selectedModel: string;

  constructor(args: { request?: Request; selectedModel?: string } = {}) {
    const config = getAIProviderConfig();
    this.primaryProvider = createProvider(config.primary);
    this.fallbackProvider = config.fallback ? createProvider(config.fallback) : null;
    this.selectedModel = args.selectedModel
      ?? (args.request ? selectedModelFromRequest(args.request, this.primaryProvider.defaultModel) : this.primaryProvider.defaultModel);
  }

  private candidates(preferred?: { provider?: ClouvaAIProviderId; model?: string }): Candidate[] {
    const providers = [this.primaryProvider, this.fallbackProvider].filter((value): value is ClouvaAIProvider => Boolean(value));
    if (preferred?.provider) providers.sort((left) => left.id === preferred.provider ? -1 : rightScore(left, preferred.provider));
    const result: Candidate[] = [];
    for (const provider of providers) {
      const selected = provider.id === (preferred?.provider ?? this.primaryProvider.id)
        ? (preferred?.model ?? (provider.id === this.primaryProvider.id ? this.selectedModel : provider.defaultModel))
        : provider.defaultModel;
      for (const model of Array.from(new Set([selected, provider.fallbackModel].filter(Boolean) as string[]))) {
        result.push({
          provider,
          model,
          fallbackUsed: provider.id !== this.primaryProvider.id || model !== this.selectedModel,
        });
      }
    }
    return result;
  }

  async generate(
    args: Omit<ProviderGenerateArgs, "model"> & { preferredProvider?: ClouvaAIProviderId; preferredModel?: string },
  ) {
    let lastError: ProviderError | null = null;
    for (const candidate of this.candidates({ provider: args.preferredProvider, model: args.preferredModel })) {
      try {
        const result = await candidate.provider.generate({ ...args, model: candidate.model });
        return {
          ...result,
          provider: candidate.provider.id,
          model: candidate.model,
          primaryProvider: this.primaryProvider.id,
          fallbackUsed: candidate.fallbackUsed,
        } satisfies RoutedProviderResult<typeof result>;
      } catch (error) {
        lastError = normalizeProviderError(candidate.provider.id, error);
        if (!lastError.retryable) throw lastError;
      }
    }
    throw lastError ?? new ProviderError({ code: "PROVIDER_UNAVAILABLE", provider: this.primaryProvider.id, message: "ClouAI no encontró un provider disponible." });
  }

  async *stream(
    args: Omit<ProviderGenerateArgs, "model"> & { preferredProvider?: ClouvaAIProviderId; preferredModel?: string },
  ): AsyncGenerator<string, RoutedProviderResult<{ usage: Record<string, unknown> | null; finishReason?: string | null }>, void> {
    let lastError: ProviderError | null = null;
    for (const candidate of this.candidates({ provider: args.preferredProvider, model: args.preferredModel })) {
      const generator = candidate.provider.stream({ ...args, model: candidate.model });
      let emitted = false;
      try {
        while (true) {
          const { value, done } = await generator.next();
          if (done) {
            return {
              ...value,
              provider: candidate.provider.id,
              model: candidate.model,
              primaryProvider: this.primaryProvider.id,
              fallbackUsed: candidate.fallbackUsed,
            };
          }
          emitted = true;
          yield value;
        }
      } catch (error) {
        lastError = normalizeProviderError(candidate.provider.id, error);
        // Never start a second provider/model after visible output. Doing so
        // would duplicate or splice the response the user already received.
        if (emitted || !lastError.retryable) throw lastError;
      }
    }
    throw lastError ?? new ProviderError({ code: "PROVIDER_UNAVAILABLE", provider: this.primaryProvider.id, message: "ClouAI no encontró un provider disponible." });
  }

  async toolTurn(
    args: Omit<ProviderToolTurnArgs, "model"> & { preferredProvider?: ClouvaAIProviderId; preferredModel?: string },
  ) {
    let lastError: ProviderError | null = null;
    for (const candidate of this.candidates({ provider: args.preferredProvider, model: args.preferredModel })) {
      try {
        const result = await candidate.provider.toolTurn({ ...args, model: candidate.model });
        return {
          ...result,
          provider: candidate.provider.id,
          model: candidate.model,
          primaryProvider: this.primaryProvider.id,
          fallbackUsed: candidate.fallbackUsed,
        };
      } catch (error) {
        lastError = normalizeProviderError(candidate.provider.id, error);
        if (!lastError.retryable) throw lastError;
      }
    }
    throw lastError ?? new ProviderError({ code: "PROVIDER_UNAVAILABLE", provider: this.primaryProvider.id, message: "ClouAI no encontró un provider disponible." });
  }

  async listModels(): Promise<ProviderModel[]> {
    return this.primaryProvider.listModels();
  }

  diagnostics() {
    return {
      provider: this.primaryProvider.id,
      model: this.selectedModel,
      fallbackModel: this.primaryProvider.fallbackModel,
      fallbackProvider: this.fallbackProvider?.id ?? null,
      capabilities: this.primaryProvider.capabilities,
    };
  }
}

function rightScore(provider: ClouvaAIProvider, preferred: ClouvaAIProviderId) {
  return provider.id === preferred ? -1 : 1;
}

export function createAIProviderRouter(args: { request?: Request; selectedModel?: string } = {}) {
  return new ClouvaAIProviderRouter(args);
}
