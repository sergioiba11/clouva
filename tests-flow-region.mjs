import assert from "node:assert/strict";
import test from "node:test";
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

test("FLOW regions resolve to the exact official Admin Assets", () => {
  assert.equal(FLOW_REGION_ASSETS["south-america"], "brand/01_flows_sudamerica.png");
  assert.equal(FLOW_REGION_ASSETS["north-america"], "brand/02_flows_norteamerica.png");
  assert.equal(FLOW_REGION_ASSETS.europe, "brand/03_flows_europa.png");
  assert.equal(FLOW_REGION_ASSETS.africa, "brand/04_flows_africa.png");
  assert.equal(FLOW_REGION_ASSETS.asia, "brand/05_flows_asia.png");
  assert.equal(FLOW_REGION_ASSETS.oceania, "brand/06_flows_oceania.png");

  assert.equal(resolveFlowLogoAssetForCountry("AR"), "brand/01_flows_sudamerica.png");
  assert.equal(resolveFlowLogoAssetForCountry("US"), "brand/02_flows_norteamerica.png");
  assert.equal(resolveFlowLogoAssetForCountry("ES"), "brand/03_flows_europa.png");
  assert.equal(resolveFlowLogoAssetForCountry("NG"), "brand/04_flows_africa.png");
  assert.equal(resolveFlowLogoAssetForCountry("JP"), "brand/05_flows_asia.png");
  assert.equal(resolveFlowLogoAssetForCountry("AU"), "brand/06_flows_oceania.png");
});
