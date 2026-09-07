import { NextResponse } from "next/server";
import { Storage } from "@google-cloud/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET_NAME = process.env.CLOUVA_ADMIN_ASSETS_BUCKET
  ?? process.env.CLOUVA_GENERATED_MEDIA_BUCKET
  ?? "clouva-generated-media";
const BRAND_PREFIX = "admin-assets/brand/";

const HOME_ASSET_PREFIXES = {
  vipComplete: "file_000000003ea4820e8a3ac72",
  vipPedestal: "file_000000005080820e8091af9",
  playerRing: "file_00000000ec8c820ea8bc2d5",
  vipCrown: "file_00000000df4c820eac789d1",
  vipCompleteAlt: "file_000000004600820ea0884ce",
  playerOrbits: "file_000000003684820eae37692",
} as const;

type HomeAssetKey = keyof typeof HOME_ASSET_PREFIXES;

type HomeVisualAssets = Record<HomeAssetKey, string | null>;

let storage: Storage | null = null;
let cached: { expiresAt: number; assets: HomeVisualAssets } | null = null;

function getStorage() {
  if (!storage) storage = new Storage();
  return storage;
}

function publicGcsUrl(bucket: string, objectPath: string) {
  return `https://storage.googleapis.com/${bucket}/${objectPath.split("/").map(encodeURIComponent).join("/")}`;
}

function emptyAssets(): HomeVisualAssets {
  return {
    vipComplete: null,
    vipPedestal: null,
    playerRing: null,
    vipCrown: null,
    vipCompleteAlt: null,
    playerOrbits: null,
  };
}

async function resolveHomeAssets() {
  if (cached && cached.expiresAt > Date.now()) return cached.assets;

  const assets = emptyAssets();
  const [files] = await getStorage().bucket(BUCKET_NAME).getFiles({
    prefix: BRAND_PREFIX,
    autoPaginate: true,
  });

  for (const file of files) {
    const name = file.name.split("/").at(-1) ?? "";
    for (const [key, prefix] of Object.entries(HOME_ASSET_PREFIXES) as Array<[HomeAssetKey, string]>) {
      if (!assets[key] && name.startsWith(prefix)) {
        assets[key] = publicGcsUrl(BUCKET_NAME, file.name);
      }
    }
  }

  cached = {
    assets,
    expiresAt: Date.now() + 60 * 60 * 1000,
  };

  return assets;
}

export async function GET() {
  try {
    const assets = await resolveHomeAssets();
    return NextResponse.json(
      { assets },
      {
        headers: {
          "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
        },
      },
    );
  } catch (error) {
    console.error("[home-visual-assets] could not resolve generated Home assets", error);
    return NextResponse.json(
      { assets: emptyAssets() },
      {
        headers: {
          "Cache-Control": "public, max-age=60, s-maxage=300",
        },
      },
    );
  }
}
