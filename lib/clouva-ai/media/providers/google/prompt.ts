import "server-only";
import { getGoogleMediaClient } from "@/lib/clouva-ai/media/providers/google/client";
import { requireGoogleMediaConfig } from "@/lib/clouva-ai/media/config";

export async function enrichMediaPrompt(args: {
  mode: "image" | "video";
  prompt: string;
  contextText: string;
  activeReferenceNames: string[];
}) {
  if (!args.contextText.trim()) return args.prompt.trim();
  const config = requireGoogleMediaConfig();
  const client = getGoogleMediaClient();
  const response = await client.models.generateContent({
    model: config.models.multimodal,
    contents: [{
      role: "user",
      parts: [{
        text: [
          "You are the prompt compiler inside CLOUVA AI.",
          `Compile the user's ${args.mode} request into one precise generation prompt.`,
          "The user's request is the goal. Persistent context constrains identity/style/objects; it must not replace the goal.",
          "Manual context instructions are authoritative. Never invent brand geometry, names, colors or objects that contradict the context.",
          "Do not mention that you analyzed context, files, JSON, or reference indices in the final prompt.",
          `ACTIVE VISUAL REFERENCES SENT TO PROVIDER: ${args.activeReferenceNames.join(", ") || "none"}`,
          "PERSISTENT CONTEXT:",
          args.contextText,
          "USER REQUEST:",
          args.prompt.trim(),
          "Return only the final generation prompt, with no preface or commentary.",
        ].join("\n\n"),
      }],
    }],
    config: { temperature: 0.2 },
  });
  const enriched = response.text?.trim();
  return enriched || args.prompt.trim();
}
