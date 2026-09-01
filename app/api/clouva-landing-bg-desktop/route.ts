import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

const CACHE_CONTROL = "public, max-age=31536000, immutable";

export async function GET() {
  const root = path.join(process.cwd(), "public", "assets", "clouva");
  const parts = await Promise.all(
    Array.from({ length: 3 }, (_, index) =>
      readFile(path.join(root, `landing-bg-desktop-fix-${index}.b64`), "utf8"),
    ),
  );
  const body = Buffer.from(parts.join(""), "base64");

  return new Response(body, {
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(body.length),
      "Cache-Control": CACHE_CONTROL,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
