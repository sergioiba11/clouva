import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getFlowRegionByCountryCode } from "./lib/flows.ts";
import {
  FLOW_REGION_ASSETS,
  normalizeCountryCode,
  resolveFlowLogoAssetForCountry,
  resolveFlowRegion,
} from "./lib/flows/flow-region.ts";

test("FLOW resolves representative countries to the six official regions", () => {
  const cases = {
    AR: "south-america",
    CL: "south-america",
    BR: "south-america",
    US: "north-america",
    CA: "north-america",
    MX: "north-america",
    ES: "europe",
    FR: "europe",
    DE: "europe",
    NG: "africa",
    ZA: "africa",
    EG: "africa",
    JP: "asia",
    CN: "asia",
    KR: "asia",
    AU: "oceania",
    NZ: "oceania",
    FJ: "oceania",
  };

  for (const [countryCode, expectedRegion] of Object.entries(cases)) {
    assert.equal(resolveFlowRegion(countryCode), expectedRegion, countryCode);
  }
});

test("FLOW country normalization is deterministic and unknown countries stay neutral", () => {
  assert.equal(normalizeCountryCode(" ar "), "AR");
  assert.equal(resolveFlowRegion(" ar "), "south-america");
  assert.equal(resolveFlowRegion("us"), "north-america");
  assert.equal(normalizeCountryCode(null), null);
  assert.equal(normalizeCountryCode(undefined), null);
  assert.equal(normalizeCountryCode("ARG"), null);
  assert.equal(normalizeCountryCode("1A"), null);
  assert.equal(resolveFlowRegion("ZZ"), null);
  assert.equal(resolveFlowLogoAssetForCountry("ZZ"), null);
});

test("FLOW regions resolve to the exact new official Admin Assets", () => {
  assert.equal(
    FLOW_REGION_ASSETS["south-america"],
    "brand/clouva-logo/shared/other/flows-region-south-america-es.png",
  );
  assert.equal(
    FLOW_REGION_ASSETS["north-america"],
    "brand/clouva-logo/shared/other/flows-region-north-america-en.png",
  );
  assert.equal(FLOW_REGION_ASSETS.europe, "brand/clouva-logo/shared/other/flows-region-europe-fr.png");
  assert.equal(FLOW_REGION_ASSETS.africa, "brand/clouva-logo/shared/other/flows-region-africa-sw.png");
  assert.equal(FLOW_REGION_ASSETS.asia, "brand/clouva-logo/shared/other/flows-region-asia-ja.png");
  assert.equal(FLOW_REGION_ASSETS.oceania, "brand/clouva-logo/shared/other/flows-region-oceania-en.png");

  assert.equal(
    resolveFlowLogoAssetForCountry("AR"),
    "brand/clouva-logo/shared/other/flows-region-south-america-es.png",
  );
  assert.equal(
    resolveFlowLogoAssetForCountry("US"),
    "brand/clouva-logo/shared/other/flows-region-north-america-en.png",
  );
  assert.equal(resolveFlowLogoAssetForCountry("ES"), "brand/clouva-logo/shared/other/flows-region-europe-fr.png");
  assert.equal(resolveFlowLogoAssetForCountry("NG"), "brand/clouva-logo/shared/other/flows-region-africa-sw.png");
  assert.equal(resolveFlowLogoAssetForCountry("JP"), "brand/clouva-logo/shared/other/flows-region-asia-ja.png");
  assert.equal(resolveFlowLogoAssetForCountry("AU"), "brand/clouva-logo/shared/other/flows-region-oceania-en.png");
});

test("global FLOW balance bridge uses the same canonical regional assets", () => {
  const cases = {
    AR: ["latam", "flows-region-south-america-es.png"],
    US: ["north-america", "flows-region-north-america-en.png"],
    ES: ["europe", "flows-region-europe-fr.png"],
    NG: ["africa", "flows-region-africa-sw.png"],
    JP: ["asia-pacific", "flows-region-asia-ja.png"],
    AU: ["oceania", "flows-region-oceania-en.png"],
  };

  for (const [countryCode, [expectedKey, expectedFile]] of Object.entries(cases)) {
    const region = getFlowRegionByCountryCode(countryCode);
    assert.ok(region, countryCode);
    assert.equal(region.key, expectedKey, countryCode);
    assert.match(region.assetUrl ?? "", new RegExp(`${expectedFile.replaceAll(".", "\\.")}$`), countryCode);
  }
});

test("official FLOW topbar keeps canonical Player region, cycles FLOW/USD and does not invent local currency", async () => {
  const balanceRoute = await readFile(new URL("./app/api/flows/balance/route.ts", import.meta.url), "utf8");
  const globalBalance = await readFile(new URL("./components/GlobalFlowBalance.tsx", import.meta.url), "utf8");

  assert.match(balanceRoute, /select\("country_code,city"\)/);
  assert.match(balanceRoute, /getFlowRegionByCountryCode\(profileResult\.data\?\.country_code/);

  // The header must keep using the same canonical regional coin returned by
  // the FLOW balance bridge instead of hardcoding a separate topbar asset.
  assert.match(globalBalance, /imageUrl=\{region\.assetUrl\}/);
  assert.match(globalBalance, /fallbackImageUrl=\{region\.assetFallbackUrl\}/);

  // Current official topbar rotates only between the real FLOW balance and its
  // US$ reference. Local-currency presentation stays absent until its actual
  // conversion and official asset exist.
  assert.match(globalBalance, /HEADER_VALUE_ROTATION_MS/);
  assert.match(globalBalance, /headerValue === "flow"/);
  assert.match(globalBalance, /headerValue === "usd"/);
  assert.match(globalBalance, /US\$ \{data\.usdValue\}/);
  assert.doesNotMatch(globalBalance, /\bARS\b/);

  // Clicking the chip opens the official value popover and the CTA keeps the
  // existing Mi Flow wallet route rather than creating a second wallet flow.
  assert.match(globalBalance, /Precios del mismo valor/);
  assert.match(globalBalance, /Ver mi Flow/);
  assert.match(globalBalance, /href="\/mi-flow\/billetera\?asset=flows"/);
});