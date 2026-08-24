import type { VideoAspectRatio, VideoDuration, VideoQuality } from "@/lib/media-generation-config";

export type VideoGenerationIntent = {
  prompt: string;
  aspectRatio: VideoAspectRatio;
  quality: VideoQuality;
  durationSeconds: VideoDuration;
};

const VIDEO_NOUNS = /(video|clip|animaci[oó]n|secuencia|escena|cinem[aá]tica|reel|trailer|teaser)/i;
const CREATE_VERBS = /(generame|generá|genera|generar|creame|creá|crea|crear|haceme|hacé|hace|hacer|animate|animá|anima|animar|convertime|convertí|converti|quiero)/i;
const STRONG_PHRASES = /(haceme un video|generame un video|generá un video|creame un video|creá un video|quiero un video|animá esta imagen|anima esta imagen|convertí esta imagen en video|converti esta imagen en video)/i;
const TECHNICAL_CONTEXT = /(generador de video|api|endpoint|c[oó]digo|componente|pantalla|bug|error|typescript|github|veo)/i;

export function detectVideoGenerationIntent(message: string) {
  const text = message.trim();
  if (!text) return false;
  if (STRONG_PHRASES.test(text)) return true;
  if (TECHNICAL_CONTEXT.test(text) && !CREATE_VERBS.test(text)) return false;
  return CREATE_VERBS.test(text) && VIDEO_NOUNS.test(text);
}

function inferAspectRatio(message: string): VideoAspectRatio {
  const text = message.toLowerCase();
  if (/\b(9:16|vertical|story|historia|reel|tiktok|short)\b/.test(text)) return "9:16";
  return "16:9";
}

function inferQuality(message: string): VideoQuality {
  const text = message.toLowerCase();
  if (/\b(cinem[aá]tic[ao]|m[aá]xima calidad|premium|calidad alta)\b/.test(text)) return "cinematic";
  if (/\b(econ[oó]mic[ao]|barat[ao]|ahorro)\b/.test(text)) return "economy";
  return "fast";
}

function inferDuration(message: string): VideoDuration {
  const match = message.match(/\b(4|6|8)\s*(?:s|seg|segs|segundo|segundos)\b/i);
  if (match) return Number(match[1]) as VideoDuration;
  return 8;
}

function extractPrompt(message: string) {
  const stripped = message
    .trim()
    .replace(/^\s*(ahora|listo|bueno|ok(?:ay)?|dale)\b[\s,;:\-]*/i, "")
    .replace(/^\s*(por favor\s+)?(generame|generá|genera|creame|creá|crea|haceme|hacé|hace|animate|animá|anima|convertime|convertí|converti)\s+(un|una|el|la|esta|este)?\s*/i, "")
    .replace(/^\s*(video|clip|animaci[oó]n|secuencia|escena|reel|trailer|teaser)\s*(de|con|que|:)?\s*/i, "")
    .replace(/^\s*quiero\s+(un|una|el|la)?\s*(video|clip|animaci[oó]n|secuencia|escena|reel|trailer|teaser)?\s*(de|con|que|:)?\s*/i, "")
    .trim();
  return stripped || message.trim();
}

export function buildVideoGenerationRequest(message: string): VideoGenerationIntent {
  return {
    prompt: extractPrompt(message),
    aspectRatio: inferAspectRatio(message),
    quality: inferQuality(message),
    durationSeconds: inferDuration(message),
  };
}

export function parseVideoGenerationIntent(message: string): VideoGenerationIntent | null {
  if (!detectVideoGenerationIntent(message)) return null;
  return buildVideoGenerationRequest(message);
}
