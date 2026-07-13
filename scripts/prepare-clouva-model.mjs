import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const root = process.cwd();
const partsDir = join(root, "assets", "clouva-base-rig-v1");
const output = join(root, "public", "models", "clouva", "clouva-base-rig-v1.glb");

if (!existsSync(partsDir)) {
  console.warn("[clouva] Rig parts not found; keeping existing public model if present.");
  process.exit(0);
}

const parts = readdirSync(partsDir)
  .filter((name) => name.endsWith(".b64"))
  .sort();

if (!parts.length) {
  console.warn("[clouva] No rig parts found; keeping existing public model if present.");
  process.exit(0);
}

const base64 = parts.map((name) => readFileSync(join(partsDir, name), "utf8").trim()).join("");
const binary = Buffer.from(base64, "base64");

if (binary.subarray(0, 4).toString("ascii") !== "glTF") {
  throw new Error("CLOUVA rig reconstruction produced an invalid GLB header");
}

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, binary);
console.log(`[clouva] Prepared ${output} (${binary.length} bytes)`);
