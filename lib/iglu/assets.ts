import "server-only";
import { Storage } from "@google-cloud/storage";

export type IgluAssetKey =
  | "logo"
  | "emblem"
  | "igloo"
  | "snowflake"
  | "cta"
  | "studioHero"
  | "studioHeroAlt"
  | "albumDelSur"
  | "playerDelSur";

export type IgluAssetMap = Partial<Record<IgluAssetKey, string>>;

const BUCKET_NAME = process.env.CLOUVA_ADMIN_ASSETS_BUCKET ?? process.env.CLOUVA_GENERATED_MEDIA_BUCKET ?? "clouva-generated-media";
const ROOT_PREFIX = "admin-assets/";

const CANDIDATES: Record<IgluAssetKey, string[]> = {
  logo: ["assets iglu (26).png", "assets iglu (12)(1).png", "iglu records logo", "iglu logo oficial"],
  emblem: ["assets iglu (27).png", "assets iglu (13)(1).png", "emblema montana iglu", "mountain emblem iglu"],
  igloo: [
    "3960c457-ea73-433f-9572-41822cdda621(6).png",
    "assets iglu (14)(2).png",
    "assets iglu (14)(1).png",
    "icono iglu oficial",
  ],
  snowflake: ["assets iglu (21)(1).png", "assets iglu (15)(1).png", "snowflake iglu", "copo iglu"],
  cta: ["assets iglu (22)(1).png", "assets iglu (16)(1).png", "conocer el estudio"],
  studioHero: ["assets iglu (23).png", "assets iglu (17)(1).png", "iglu studio hero"],
  studioHeroAlt: ["assets iglu (17)(1).png", "assets iglu (23).png", "estudio iglu"],
  albumDelSur: ["assets iglu (24).png", "assets iglu (18).png", "del sur album"],
  playerDelSur: ["assets iglu (19)(1).png", "del sur player"],
};

function normalizeAssetName(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function publicGcsUrl(objectPath: string) {
  return `https://storage.googleapis.com/${BUCKET_NAME}/${objectPath.split("/").map(encodeURIComponent).join("/")}`;
}

let assetPromise: Promise<IgluAssetMap> | null = null;

async function resolveAssets(): Promise<IgluAssetMap> {
  try {
    const storage = new Storage();
    const [files] = await storage.bucket(BUCKET_NAME).getFiles({ prefix: ROOT_PREFIX, autoPaginate: true });
    const normalizedFiles = files
      .filter((file) => file.name && !file.name.endsWith("/"))
      .map((file) => ({ file, normalized: normalizeAssetName(file.name.split("/").at(-1) ?? file.name) }));

    const resolved: IgluAssetMap = {};
    for (const [key, candidates] of Object.entries(CANDIDATES) as Array<[IgluAssetKey, string[]]>) {
      const normalizedCandidates = candidates.map(normalizeAssetName);
      const exact = normalizedFiles.find(({ normalized }) => normalizedCandidates.includes(normalized));
      const fuzzy = exact ?? normalizedFiles.find(({ normalized }) => normalizedCandidates.some((candidate) => candidate.length >= 8 && normalized.includes(candidate)));
      if (fuzzy) resolved[key] = publicGcsUrl(fuzzy.file.name);
    }
    return resolved;
  } catch (error) {
    console.error("[iglu-assets] could not resolve canonical GCS assets", error);
    return {};
  }
}

export function resolveIgluAssets() {
  assetPromise ??= resolveAssets();
  return assetPromise;
}
