import { NextResponse } from "next/server";
import { Storage } from "@google-cloud/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET_NAME = process.env.CLOUVA_ADMIN_ASSETS_BUCKET
  ?? process.env.CLOUVA_GENERATED_MEDIA_BUCKET
  ?? "clouva-generated-media";
const BRAND_PREFIX = "admin-assets/brand/";

type HomeAssetMatcher = {
  exactNames?: readonly string[];
  prefixes?: readonly string[];
};

const HOME_ASSET_MATCHERS = {
  vipComplete: { prefixes: ["file_000000003ea4820e8a3ac72"] },
  vipPedestal: { prefixes: ["file_000000005080820e8091af9"] },
  playerRing: { prefixes: ["file_00000000ec8c820ea8bc2d5"] },
  vipCrown: { prefixes: ["file_00000000df4c820eac789d1"] },
  vipCompleteAlt: { prefixes: ["file_000000004600820ea0884ce"] },
  playerOrbits: { prefixes: ["file_000000003684820eae37692"] },
  heroStudio: { exactNames: ["home_hero_studio_clean.webp", "home_hero_studio_clean.png"] },
  cardPlayer: { exactNames: ["home_card_player.webp", "home_card_player.png"] },
  cardFlow: { exactNames: ["home_card_flow_official.webp", "home_card_flow_official.png"] },
  cardCreator: { exactNames: ["home_card_creator.webp", "home_card_creator.png"] },
  cardSpot: { exactNames: ["home_card_spot.webp", "home_card_spot.png"] },
  cardMarket: { exactNames: ["home_card_market.webp", "home_card_market.png"] },
  matrixBackground: { exactNames: ["matrix_background.webp", "matrix_background.png"] },
  flowCoin: { exactNames: ["flow_coin_official.webp", "flow_coin_official.png"] },
} as const satisfies Record<string, HomeAssetMatcher>;

type HomeAssetKey = keyof typeof HOME_ASSET_MATCHERS;
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
  return Object.fromEntries(
    Object.keys(HOME_ASSET_MATCHERS).map((key) => [key, null]),
  ) as HomeVisualAssets;
}

function matchRank(name: string, matcher: HomeAssetMatcher) {
  const exactRank = matcher.exactNames?.indexOf(name) ?? -1;
  if (exactRank >= 0) return exactRank;

  const prefixRank = matcher.prefixes?.findIndex((prefix) => name.startsWith(prefix)) ?? -1;
  if (prefixRank >= 0) return 100 + prefixRank;

  return Number.POSITIVE_INFINITY;
}

async function resolveHomeAssets() {
  if (cached && cached.expiresAt > Date.now()) return cached.assets;

  const assets = emptyAssets();
  const ranks = Object.fromEntries(
    Object.keys(HOME_ASSET_MATCHERS).map((key) => [key, Number.POSITIVE_INFINITY]),
  ) as Record<HomeAssetKey, number>;

  const [files] = await getStorage().bucket(BUCKET_NAME).getFiles({
    prefix: BRAND_PREFIX,
    autoPaginate: true,
  });

  for (const file of files) {
    const name = file.name.split("/").at(-1) ?? "";
    for (const [key, matcher] of Object.entries(HOME_ASSET_MATCHERS) as Array<[HomeAssetKey, HomeAssetMatcher]>) {
      const rank = matchRank(name, matcher);
      if (rank < ranks[key]) {
        ranks[key] = rank;
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
