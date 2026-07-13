import type { AvatarItem } from "./types";

const trim = (value?: string | null) => value?.trim() || null;
const isHttps = (value: string) => /^https:\/\//i.test(value);
const isLocal = (value: string) => value.startsWith("/");
const join = (base: string, path: string) => `${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;

export function resolveAvatarAssetUrl(item: Pick<AvatarItem, "modelUrl" | "metadata"> | null | undefined): string | null {
  const modelUrl = trim(item?.modelUrl);
  const storageBase = trim(process.env.NEXT_PUBLIC_SUPABASE_STORAGE_URL);
  const assetBase = trim(process.env.NEXT_PUBLIC_AVATAR_ASSET_BASE_URL);

  if (modelUrl) {
    if (isHttps(modelUrl) || isLocal(modelUrl)) return modelUrl;
    if (modelUrl.startsWith("supabase://") && storageBase) return join(storageBase, modelUrl.replace("supabase://", ""));
    if (assetBase) return join(assetBase, modelUrl);
    return `/${modelUrl.replace(/^\//, "")}`;
  }

  const metadata = item?.metadata ?? {};
  const supabasePath = typeof metadata.supabasePath === "string" ? trim(metadata.supabasePath) : null;
  if (supabasePath && storageBase) return join(storageBase, supabasePath);
  const localPath = typeof metadata.localPath === "string" ? trim(metadata.localPath) : null;
  if (localPath) return isLocal(localPath) ? localPath : `/${localPath}`;
  return null;
}
