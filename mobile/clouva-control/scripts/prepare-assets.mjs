import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const assetsDir = path.resolve("assets");
const source = path.join(assetsDir, "icon-source.svg");
const icon = path.join(assetsDir, "icon.png");
const adaptive = path.join(assetsDir, "adaptive-icon.png");

await fs.mkdir(assetsDir, { recursive: true });

await sharp(source)
  .resize(1024, 1024, { fit: "cover" })
  .png({ compressionLevel: 9, palette: true })
  .toFile(icon);

await sharp(source)
  .resize(768, 768, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .extend({ top: 128, bottom: 128, left: 128, right: 128, background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png({ compressionLevel: 9, palette: true })
  .toFile(adaptive);

console.log("Prepared CLOUVA CONTROL Android icon assets");
