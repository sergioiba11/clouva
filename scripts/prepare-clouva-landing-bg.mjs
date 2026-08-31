import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.join(process.cwd(), "public", "assets", "clouva");
const output = path.join(root, "landing-bg-v6.webp");
const parts = await Promise.all(
  Array.from({ length: 5 }, (_, index) =>
    readFile(path.join(root, `landing-bg-v5-${index}.b64`), "utf8"),
  ),
);

const image = Buffer.from(parts.join(""), "base64");
const hasWebPContainer =
  image.length >= 12 &&
  image.subarray(0, 4).toString("ascii") === "RIFF" &&
  image.subarray(8, 12).toString("ascii") === "WEBP";
const declaredRiffSize = hasWebPContainer ? image.readUInt32LE(4) + 8 : 0;

if (!hasWebPContainer || declaredRiffSize !== image.length) {
  throw new Error("CLOUVA landing background is not a valid WebP payload");
}

await writeFile(output, image);
console.log(`[clouva] prepared ${path.relative(process.cwd(), output)} (${image.length} bytes)`);
