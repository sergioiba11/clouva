import { buildTrebolRuntimeContext } from "./agent/context-builder";

export type NormalizedAttachment = {
  name: string;
  mimeType: string;
  size: number;
  dataBase64: string;
  kind: "image" | "audio" | "file" | "preview";
};

const MAX_ATTACHMENTS = 4;
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 12 * 1024 * 1024;
const ALLOWED_ATTACHMENT_MIME = /^(?:image\/(?:png|jpe?g|webp|gif)|audio\/(?:wav|x-wav|mpeg|mp4|ogg|webm)|application\/pdf|application\/json|text\/[a-z0-9.+-]+)$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normalizeScreenContext(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  let serialized = "";
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Error("El contexto de Workspace no es serializable.");
  }
  if (Buffer.byteLength(serialized, "utf8") > 24_000) {
    throw new Error("El contexto de Workspace es demasiado grande.");
  }
  const context = buildTrebolRuntimeContext(value);
  const legacyProject = isRecord(value.project) ? value.project : {};
  const legacyPreview = isRecord(value.preview) ? value.preview : {};
  const legacyViewport = isRecord(legacyPreview.viewport) ? legacyPreview.viewport : {};
  const cleanText = (item: unknown, limit: number) => typeof item === "string"
    ? item.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, limit)
    : "";
  const cleanUrl = (item: unknown) => {
    const raw = cleanText(item, 1_000);
    try {
      const parsed = new URL(raw);
      if (!['http:', 'https:'].includes(parsed.protocol)) return "";
      parsed.search = "";
      parsed.hash = "";
      return parsed.toString();
    } catch {
      return "";
    }
  };

  return {
    ...context,
    page: cleanText(value.page, 300) || context.navigation.pathname,
    url: context.navigation.url,
    capturedAt: cleanText(value.capturedAt, 80),
    surface: value.surface === "desktop" ? "desktop" : "web",
    project: {
      ...context.project,
      id: cleanText(legacyProject.id, 160),
      path: cleanText(legacyProject.path, 1_000),
    },
    preview: {
      url: cleanUrl(legacyPreview.url),
      state: cleanText(legacyPreview.state, 80),
      route: cleanText(legacyPreview.route, 300),
      viewport: {
        width: typeof legacyViewport.width === "number" && Number.isFinite(legacyViewport.width)
          ? Math.max(0, Math.round(legacyViewport.width))
          : undefined,
        height: typeof legacyViewport.height === "number" && Number.isFinite(legacyViewport.height)
          ? Math.max(0, Math.round(legacyViewport.height))
          : undefined,
      },
    },
  };
}

export function normalizeAttachments(value: unknown): NormalizedAttachment[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_ATTACHMENTS) {
    throw new Error(`Se permiten hasta ${MAX_ATTACHMENTS} adjuntos por mensaje.`);
  }

  let totalBytes = 0;
  return value.map((raw, index) => {
    if (!isRecord(raw)) throw new Error(`El adjunto ${index + 1} es inválido.`);
    const name = typeof raw.name === "string" ? raw.name.trim().slice(0, 180) : "";
    const mimeType = typeof raw.mimeType === "string" ? raw.mimeType.trim().toLowerCase() : "";
    const dataBase64 = typeof raw.dataBase64 === "string" ? raw.dataBase64.replace(/\s+/g, "") : "";
    const kind = ["image", "audio", "file", "preview"].includes(String(raw.kind))
      ? raw.kind as NormalizedAttachment["kind"]
      : "file";
    if (!name || !ALLOWED_ATTACHMENT_MIME.test(mimeType) || dataBase64.length % 4 !== 0 || !/^[a-z0-9+/]*={0,2}$/i.test(dataBase64)) {
      throw new Error(`El adjunto ${index + 1} tiene un nombre, MIME o contenido inválido.`);
    }
    const bytes = Buffer.from(dataBase64, "base64");
    if (!bytes.length || bytes.length > MAX_ATTACHMENT_BYTES) {
      throw new Error(`El adjunto “${name}” supera el máximo de 5 MB o está vacío.`);
    }
    totalBytes += bytes.length;
    if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) throw new Error("Los adjuntos superan el máximo total de 12 MB.");
    return { name, mimeType, size: bytes.length, dataBase64, kind };
  });
}

export function attachmentPart(attachment: NormalizedAttachment): Record<string, unknown> {
  if (attachment.mimeType.startsWith("text/") || attachment.mimeType === "application/json") {
    const text = Buffer.from(attachment.dataBase64, "base64").toString("utf8");
    return { text: `ARCHIVO ADJUNTO: ${attachment.name}\n\n${text.slice(0, 120_000)}` };
  }
  return { inlineData: { mimeType: attachment.mimeType, data: attachment.dataBase64 } };
}
