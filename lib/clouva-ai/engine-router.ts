import { parseImageGenerationIntent, type ImageGenerationIntent } from "@/lib/clouva-ai/image-generation-intent";
import { parseVideoGenerationIntent, type VideoGenerationIntent } from "@/lib/clouva-ai/video-generation-intent";

export type ClouvaEngine = "text" | "image" | "video" | "voice" | "tool";

export type ClouvaIntent =
  | { engine: "image"; confidence: number; action: "generate_image"; payload: ImageGenerationIntent }
  | { engine: "video"; confidence: number; action: "generate_video"; payload: VideoGenerationIntent }
  | { engine: "voice"; confidence: number; action: "start_voice"; payload: null }
  | { engine: "text"; confidence: number; action: "chat"; payload: null };

const VOICE_REQUEST = /(?:quiero|podemos|vamos a|activ[aá]|abr[ií]|inici[aá]|empez[aá]).{0,28}(?:hablar|conversar).{0,18}(?:por voz|con voz|micr[oó]fono)|(?:hablame|habl[aá] conmigo)\s+por\s+voz/i;

export function routeClouvaIntent(message: string): ClouvaIntent {
  const video = parseVideoGenerationIntent(message);
  if (video) return { engine: "video", confidence: 0.96, action: "generate_video", payload: video };

  const image = parseImageGenerationIntent(message);
  if (image) return { engine: "image", confidence: 0.96, action: "generate_image", payload: image };

  if (VOICE_REQUEST.test(message.trim())) {
    return { engine: "voice", confidence: 0.9, action: "start_voice", payload: null };
  }

  return { engine: "text", confidence: 0.75, action: "chat", payload: null };
}
