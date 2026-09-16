import { GoogleGenAI, Modality, type FunctionDeclaration } from "@google/genai";
import type { ToolFunctionDeclaration } from "../tool-router";
import type { RealtimeProvider, RealtimeSessionRequest } from "./types";

function geminiFunctionDeclaration(declaration: ToolFunctionDeclaration): FunctionDeclaration {
  const properties = Object.fromEntries(
    Object.entries(declaration.parameters.properties).map(([name, schema]) => [name, {
      type: schema.type.toLowerCase(),
      description: schema.description,
    }]),
  );
  return {
    name: declaration.name,
    description: declaration.description,
    parametersJsonSchema: {
      type: "object",
      properties,
      required: declaration.parameters.required ?? [],
      additionalProperties: false,
    },
  };
}

export class GeminiRealtimeProvider implements RealtimeProvider {
  readonly id = "gemini" as const;

  async createSession(request: RealtimeSessionRequest) {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) throw Object.assign(new Error("Gemini Live no está configurado en este servicio."), { status: 503, code: "PROVIDER_AUTH_ERROR" });
    const model = process.env.GEMINI_LIVE_MODEL?.trim() || "gemini-3.1-flash-live-preview";
    const voice = process.env.TREBOL_LIVE_VOICE?.trim() || "Kore";
    if (!/^[A-Za-z0-9._-]{3,120}$/.test(model)) throw new Error("GEMINI_LIVE_MODEL no es válido.");
    if (!/^[A-Za-z][A-Za-z0-9_-]{1,60}$/.test(voice)) throw new Error("TREBOL_LIVE_VOICE no es válida.");

    const now = Date.now();
    const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "v1beta" } });
    const authToken = await ai.authTokens.create({
      config: {
        uses: 1,
        expireTime: new Date(now + 30 * 60_000).toISOString(),
        newSessionExpireTime: new Date(now + 60_000).toISOString(),
        liveConnectConstraints: {
          model,
          config: {
            responseModalities: [Modality.AUDIO],
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            sessionResumption: {},
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
            systemInstruction: request.systemInstruction,
            tools: request.tools.length ? [{ functionDeclarations: request.tools.map(geminiFunctionDeclaration) }] : undefined,
          },
        },
      },
    });
    if (!authToken.name) throw new Error("Gemini Live no devolvió un token efímero.");
    return {
      provider: this.id,
      token: authToken.name,
      model,
      expiresAt: new Date(now + 60_000).toISOString(),
      transport: "gemini-live" as const,
    };
  }
}
