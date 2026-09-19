import "server-only";
import { Storage } from "@google-cloud/storage";

export type IgluAssetKey =
  | "logo"
  | "logoAlt"
  | "emblem"
  | "igloo"
  | "snowflake"
  | "cta"
  | "studioHero"
  | "studioHeroAlt"
  | "homeScene"
  | "publicHomeHero"
  | "publicLogo"
  | "publicBackground"
  | "publicPlayersCard"
  | "publicReservationsCard"
  | "publicMerchCard"
  | "publicBottomNav"
  | "publicRedButton"
  | "publicPlayButton"
  | "publicTopIcons"
  | "publicReserveButton"
  | "recordingsScene"
  | "productionsScene"
  | "producersScene"
  | "artistsScene"
  | "sessionsScene"
  | "membershipsScene"
  | "paymentsScene"
  | "aboutScene"
  | "contactScene"
  | "albumDelSur"
  | "playerDelSur";

export type IgluAssetMap = Partial<Record<IgluAssetKey, string>>;

const BUCKET_NAME = process.env.CLOUVA_ADMIN_ASSETS_BUCKET ?? process.env.CLOUVA_GENERATED_MEDIA_BUCKET ?? "clouva-generated-media";
const ROOT_PREFIX = "admin-assets/";

const CANDIDATES: Record<IgluAssetKey, string[]> = {
  logo: [
    "02_logo_iglu_records_neon_hielo.png",
    "assets iglu (26).png",
    "assets iglu (12)(1).png",
    "iglu records logo oficial",
    "iglu logo principal",
    "iglu records principal",
  ],
  logoAlt: [
    "iglu records logo alternativo",
    "iglu records blue logo",
    "iglu records logo glaciar",
    "logo alternativo iglu",
  ],
  emblem: [
    "assets iglu (27).png",
    "assets iglu (13)(1).png",
    "emblema montana iglu",
    "mountain emblem iglu",
    "iglu mountain symbol",
  ],
  igloo: [
    "3960c457-ea73-433f-9572-41822cdda621(6).png",
    "assets iglu (14)(2).png",
    "assets iglu (14)(1).png",
    "icono iglu oficial",
    "igloo icon official",
  ],
  snowflake: [
    "assets iglu (21)(1).png",
    "assets iglu (15)(1).png",
    "snowflake iglu",
    "copo iglu",
    "copo de nieve iglu",
  ],
  cta: [
    "assets iglu (22)(1).png",
    "assets iglu (16)(1).png",
    "conocer el estudio",
    "cta iglu congelado",
    "frozen cta iglu",
  ],
  studioHero: [
    "assets iglu (23).png",
    "assets iglu (17)(1).png",
    "iglu studio hero",
    "hero estudio iglu",
    "estudio iglu background",
  ],
  studioHeroAlt: [
    "assets iglu (17)(1).png",
    "assets iglu (23).png",
    "estudio iglu alternativo",
    "iglu studio alternate",
  ],
  homeScene: [
    "iglu home hero",
    "iglu home background",
    "iglu plaza",
    "iglu hall",
    "gran salon iglu",
    "home iglu records",
  ],
  publicHomeHero: [
    "06_background_base_musical_iglu.png",
    "iglu public home hero",
    "iglu home hero studio",
    "home public spot iglu",
    "entra al iglu",
    "entrada iglu records",
    "iglu exterior home",
    "home hero",
    "homehero",
  ],
  publicLogo: [
    "02_logo_iglu_records_neon_hielo.png",
  ],
  publicBackground: [
    "06_background_base_musical_iglu.png",
  ],
  publicBottomNav: [
    "07_barra_navegacion_neon.png",
  ],
  publicRedButton: [
    "08_boton_circular_iglu_rojo.png",
  ],
  publicPlayButton: [
    "09_boton_play_azul_neon.png",
  ],
  publicTopIcons: [
    "10_iconos_superiores_navegacion.png",
  ],
  publicReserveButton: [
    "11_boton_cta_reservar_sesion.png",
  ],
  publicPlayersCard: [
    "04_card_players_iglu_records.png",
    "iglu players card",
    "players studio console",
    "iglu home studio console",
    "players iglu home",
    "artistas card iglu",
    "players card",
    "player visual",
    "playervisual",
  ],
  publicReservationsCard: [
    "05_card_reservas_iglu_records.png",
    "iglu reservas card",
    "reservas tablet iglu",
    "booking card iglu",
    "agenda card iglu",
    "reservas iglu home",
    "reservas card",
    "reservas",
  ],
  publicMerchCard: [
    "03_banner_merch_iglu_records.png",
    "iglu merch card",
    "merch abrigo iglu",
    "iglu merch home",
    "hoodie gorra remera iglu",
    "merchandise iglu records",
    "merch card",
    "merch",
    "abrigo",
  ],
  recordingsScene: [
    "iglu grabaciones hero",
    "grabaciones iglu background",
    "recording studio iglu",
    "vocal booth iglu",
    "microfono iglu",
  ],
  productionsScene: [
    "iglu producciones hero",
    "producciones iglu background",
    "production console iglu",
    "beats mezcla master iglu",
  ],
  producersScene: [
    "iglu productores hero",
    "productores iglu background",
    "producer stations iglu",
    "cabinas productores iglu",
  ],
  artistsScene: [
    "iglu artistas hero",
    "artistas player iglu",
    "artists gallery iglu",
    "player gallery iglu",
  ],
  sessionsScene: [
    "iglu sesiones hero",
    "sesiones iglu background",
    "iglu sessions stage",
    "escenario sesiones iglu",
  ],
  membershipsScene: [
    "iglu membresias hero",
    "membresias iglu background",
    "membership crystals iglu",
    "galeria cristales iglu",
  ],
  paymentsScene: [
    "iglu pagos unicos hero",
    "pagos unicos iglu background",
    "services counter iglu",
    "caja servicios iglu",
  ],
  aboutScene: [
    "iglu nosotros hero",
    "nosotros iglu background",
    "iglu lounge",
    "refugio iglu",
    "fireplace iglu",
  ],
  contactScene: [
    "iglu contacto hero",
    "contacto iglu background",
    "iglu reception",
    "recepcion iglu",
  ],
  albumDelSur: [
    "assets iglu (24).png",
    "assets iglu (18).png",
    "del sur album",
    "del sur cover",
    "portada del sur iglu",
  ],
  playerDelSur: [
    "assets iglu (19)(1).png",
    "del sur player",
    "player del sur iglu",
  ],
};

const SCENE_KEYS = new Set<IgluAssetKey>([
  "homeScene",
  "publicHomeHero",
  "publicLogo",
  "publicBackground",
  "publicPlayersCard",
  "publicReservationsCard",
  "publicMerchCard",
  "publicBottomNav",
  "publicRedButton",
  "publicPlayButton",
  "publicTopIcons",
  "publicReserveButton",
  "recordingsScene",
  "productionsScene",
  "producersScene",
  "artistsScene",
  "sessionsScene",
  "membershipsScene",
  "paymentsScene",
  "aboutScene",
  "contactScene",
]);

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

function metadataRecord(metadata: unknown) {
  if (!metadata || typeof metadata !== "object") return {} as Record<string, string>;
  return Object.fromEntries(
    Object.entries(metadata as Record<string, unknown>).map(([key, value]) => [key, String(value ?? "")]),
  );
}

function objectTimestamp(metadata: Record<string, unknown>) {
  const raw = metadata.updated ?? metadata.timeCreated ?? metadata.timeStorageClassUpdated;
  const parsed = typeof raw === "string" ? Date.parse(raw) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function isReferenceOnlyAsset(normalized: string) {
  return ["mockup", "reference", "referencia", "assetpack", "brandpack", "screen", "screenshot", "captura"].some((token) => normalized.includes(token));
}

let assetPromise: Promise<IgluAssetMap> | null = null;

async function resolveAssets(): Promise<IgluAssetMap> {
  try {
    const storage = new Storage();
    const [files] = await storage.bucket(BUCKET_NAME).getFiles({ prefix: ROOT_PREFIX, autoPaginate: true });
    const normalizedFiles = files
      .filter((file) => file.name && !file.name.endsWith("/"))
      .map((file) => {
        const basenameRaw = file.name.split("/").at(-1) ?? file.name;
        const custom = metadataRecord(file.metadata.metadata);
        const originalArchivePath = custom.originalArchivePath ?? "";
        const originalBasenameRaw = originalArchivePath.split("/").at(-1) ?? originalArchivePath;
        const importedFromPack = custom.importedFromAssetPack === "true";
        return {
          file,
          basename: normalizeAssetName(basenameRaw),
          originalBasename: normalizeAssetName(originalBasenameRaw),
          searchable: normalizeAssetName(
            `${file.name} ${originalArchivePath} ${custom.sourcePack ?? ""} ${JSON.stringify(custom)}`,
          ),
          importJobId: importedFromPack ? (custom.importJobId ?? "") : "",
          uploadedAt: objectTimestamp(file.metadata as unknown as Record<string, unknown>),
        };
      })
      .sort((a, b) => b.uploadedAt - a.uploadedAt);

    // A ZIP import stamps every extracted object with one importJobId.
    // Prefer the newest imported batch so IGLÚ always consumes the assets the admin just uploaded,
    // instead of an older object with the same basename elsewhere in admin-assets.
    const newestImported = normalizedFiles.find((entry) => entry.importJobId);
    const newestImportJobId = newestImported?.importJobId ?? "";

    const resolved: IgluAssetMap = {};

    for (const [key, candidates] of Object.entries(CANDIDATES) as Array<[IgluAssetKey, string[]]>) {
      const normalizedCandidates = candidates.map(normalizeAssetName).filter(Boolean);
      const allowed = normalizedFiles.filter(({ searchable }) => !(SCENE_KEYS.has(key) && isReferenceOnlyAsset(searchable)));
      const currentBatch = newestImportJobId
        ? allowed.filter((entry) => entry.importJobId === newestImportJobId)
        : [];

      const pools = currentBatch.length ? [currentBatch, allowed] : [allowed];
      let match: (typeof allowed)[number] | undefined;

      for (const pool of pools) {
        match = pool.find(({ basename, originalBasename }) =>
          normalizedCandidates.includes(basename) || normalizedCandidates.includes(originalBasename),
        );
        match ??= pool.find(({ searchable }) =>
          normalizedCandidates.some((candidate) => candidate.length >= 5 && searchable.includes(candidate)),
        );
        if (match) break;
      }

      if (match) resolved[key] = publicGcsUrl(match.file.name);
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
