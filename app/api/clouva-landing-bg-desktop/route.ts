import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

const CACHE_CONTROL = "public, max-age=31536000, immutable";

export async function GET() {
  const file = path.join(
    process.cwd(),
    "public",
    "assets",
    "clouva",
    "landing-bg-desktop-v1.b64",
  );
  const encoded = await readFile(file, "utf8");
  const body = Buffer.from(encoded, "base64");

  return new Response(body, {
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(body.length),
      "Cache-Control": CACHE_CONTROL,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
