import fs from "node:fs";
import path from "node:path";

const gradlePath = path.resolve("android/app/build.gradle");
const required = ["CLOUVA_CONTROL_KEYSTORE_PATH", "CLOUVA_CONTROL_KEY_ALIAS", "CLOUVA_CONTROL_KEYSTORE_PASSWORD", "CLOUVA_CONTROL_KEY_PASSWORD"];
for (const name of required) {
  if (!process.env[name]) throw new Error(`Missing ${name}`);
}

let source = fs.readFileSync(gradlePath, "utf8");
if (source.includes("clouvaControlRelease")) {
  console.log("CLOUVA CONTROL signing already configured");
  process.exit(0);
}

const signingBlock = `
    signingConfigs {
        clouvaControlRelease {
            storeFile file(System.getenv("CLOUVA_CONTROL_KEYSTORE_PATH"))
            storePassword System.getenv("CLOUVA_CONTROL_KEYSTORE_PASSWORD")
            keyAlias System.getenv("CLOUVA_CONTROL_KEY_ALIAS")
            keyPassword System.getenv("CLOUVA_CONTROL_KEY_PASSWORD")
        }
    }
`;

source = source.replace(/android\s*\{/, (match) => `${match}${signingBlock}`);
source = source.replace(/buildTypes\s*\{([\s\S]*?)release\s*\{/, (match) => `${match}\n            signingConfig signingConfigs.clouvaControlRelease`);

if (!source.includes("signingConfig signingConfigs.clouvaControlRelease")) {
  throw new Error("Could not attach clouvaControlRelease signing config to buildTypes.release");
}

fs.writeFileSync(gradlePath, source);
console.log("Configured stable CLOUVA CONTROL Android signing");
