import type { ImageAspectRatio, ImageQuality } from "@/lib/media-generation-config";

export type ImageGenerationIntent = {
  prompt: string;
  aspectRatio: ImageAspectRatio;
  quality: ImageQuality;
};

const IMAGE_NOUNS = /(imagen|foto|portada|render|ilustraci[oó]n|poster|afiche|arte|visual)/i;
const CREATE_VERBS = /(generame|generá|genera|generar|creame|creá|crea|crear|haceme|hacé|hace|hacer|diseñame|diseñá|diseña|armame|armá|arma|quiero)/i;
const STRONG_PHRASES = /(us[aá] este prompt para (crear|generar)|quiero una (imagen|foto|portada|ilustraci[oó]n|render)|haceme un render)/i;
const TECHNICAL_CONTEXT = /(generador de im[aá]genes|api|endpoint|c[oó]digo|componente|pantalla|bug|error|typescript|github)/i;

export function detectImageGenerationIntent(message: string) {
  const text = message.trim();
  if (!text) return false;
  if (STRONG_PHRASES.test(text)) return true;
  if (TECHNICAL_CONTEXT.test(text) && !/(generame|creame|haceme|diseñame|armame)/i.test(text)) return false;
  return CREATE_VERBS.test(text) && IMAGE_NOUNS.test(text);
}

function inferAspectRatio(message: string): ImageAspectRatio {
  const text = message.toLowerCase();
  if (/\b(9:16|vertical|story|historia)\b/.test(text)) return "9:16";
  if (/\b(1:1|cuadrad[ao])\b/.test(text)) return "1:1";
  if (/\b(4:5|retrato)\b/.test(text)) return "4:5";
  if (/\b(5:4)\b/.test(text)) return "5:4";
  if (/\b(16:9|horizontal|banner|paisaje)\b/.test(text)) return "16:9";
  return "16:9";
}

function inferQuality(message: string): ImageQuality {
  const text = message.toLowerCase();
  if (/\b(4k|m[aá]xima|maximum|ultra)\b/.test(text)) return "maximum";
  if (/\b(r[aá]pida|rapida|quick|borrador)\b/.test(text)) return "quick";
  return "high";
}

function extractPrompt(message: string) {
  const stripped = message
    .trim()
    .replace(/^\s*(por favor\s+)?(generame|generá|genera|creame|creá|crea|haceme|hacé|hace|diseñame|diseñá|diseña|armame|armá|arma)\s+(una?\s+)?(imagen|foto|portada|render|ilustraci[oó]n|poster|afiche|arte|visual)?\s*(de|con|que|:)?\s*/i, "")
    .replace(/^\s*quiero\s+una?\s+(imagen|foto|portada|render|ilustraci[oó]n|poster|afiche|arte|visual)\s*(de|con|que|:)?\s*/i, "")
    .replace(/^\s*us[aá]\s+este\s+prompt\s+para\s+(crear|generar)\s+(una?\s+)?(imagen|foto)?\s*:?\s*/i, "")
    .trim();
  return stripped || message.trim();
}

export function parseImageGenerationIntent(message: string): ImageGenerationIntent | null {
  if (!detectImageGenerationIntent(message)) return null;
  return {
    prompt: extractPrompt(message),
    aspectRatio: inferAspectRatio(message),
    quality: inferQuality(message),
  };
}
