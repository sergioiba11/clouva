import "server-only";
import { GoogleGenAI } from "@google/genai";
import { requireGoogleMediaConfig } from "@/lib/clouva-ai/media/config";

let cached: GoogleGenAI | null = null;
let cachedKey = "";

export function getGoogleMediaClient() {
  const config = requireGoogleMediaConfig();
  const key = `${config.project}:${config.location}`;
  if (!cached || cachedKey !== key) {
    cached = new GoogleGenAI({
      vertexai: true,
      project: config.project,
      location: config.location,
    });
    cachedKey = key;
  }
  return cached;
}
