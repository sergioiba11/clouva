export type MediaCreatorMode = "image" | "video";

export function buildMediaCreatorHref(mode: MediaCreatorMode, prompt?: string | null) {
  const params = new URLSearchParams();
  params.set("mode", mode);
  const cleanPrompt = prompt?.trim();
  if (cleanPrompt) params.set("prompt", cleanPrompt.slice(0, 4_000));
  return `/crear?${params.toString()}`;
}
