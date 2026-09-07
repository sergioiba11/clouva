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

  assert.match(globalBalance, /<FlowCoinIcon/);
  assert.match(globalBalance, /imageUrl=\{region\.assetUrl\}/);
  assert.match(globalBalance, /fallbackImageUrl=\{region\.assetFallbackUrl\}/);
  assert.doesNotMatch(globalBalance, /TOP_BAR_REGION_LABEL/);

  assert.match(globalBalance, /HEADER_VALUE_ROTATION_MS/);
  assert.match(globalBalance, /headerValue === "flow"/);
  assert.match(globalBalance, /headerValue === "usd"/);
  assert.match(globalBalance, /US\$ \{data\.usdValue\}/);
  assert.doesNotMatch(globalBalance, /\bARS\b/);

  assert.match(globalBalance, /Precios del mismo valor/);
  assert.match(globalBalance, /Ver mi Flow/);
  assert.match(globalBalance, /href="\/mi-flow\/billetera\?asset=flows"/);
});

test("FLOW visual identity uses one circular renderer and never falls back to the CLOUVA logo", async () => {
  const flowLogo = await readFile(new URL("./components/flows/flow-logo.tsx", import.meta.url), "utf8");
  const flowCoinIcon = await readFile(new URL("./components/flow-coin-icon.tsx", import.meta.url), "utf8");
  const playerWallet = await readFile(new URL("./components/wallet/PlayerFlowWallet.tsx", import.meta.url), "utf8");
  const walletChip = await readFile(new URL("./components/wallet/WalletBalanceChip.tsx", import.meta.url), "utf8");
  const flowUi = await readFile(new URL("./components/flows/flow-ui.tsx", import.meta.url), "utf8");

  // The canonical renderer owns crop, fallback and regional recovery. It must
  // not use the CLOUVA brand mark as a currency fallback.
  assert.doesNotMatch(flowLogo, /ClouvaLogoMark/);
  assert.match(flowLogo, /borderRadius: "9999px"/);
  assert.match(flowLogo, /overflow: "hidden"/);
  assert.match(flowLogo, /objectFit: "cover"/);
  assert.match(flowLogo, />\s*FLOW\s*<\/span>/);
  assert.match(flowLogo, /authenticatedFetch\("\/api\/flows\/balance"/);

  // FlowCoinIcon is now only an adapter over the same FlowLogo renderer, so
  // the header cannot render a raw square PNG independently anymore.
  assert.match(flowCoinIcon, /return \(\s*<FlowLogo/);
  assert.doesNotMatch(flowCoinIcon, /<img/);
  assert.match(flowCoinIcon, /imageUrl=\{imageUrl\}/);
  assert.match(flowCoinIcon, /fallbackImageUrl=\{fallbackImageUrl\}/);

  // The main wallet already points its currency identity at FlowLogo. With the
  // canonical renderer fixed, this surface no longer falls back to CLOUVA.
  assert.match(playerWallet, /<FlowLogo size=\{64\} priority \/>/);

  // Other FLOW surfaces keep consuming that same canonical renderer rather
  // than maintaining their own regional asset tables.
  assert.match(walletChip, /<FlowLogo size=\{16\}/);
  assert.match(flowUi, /<FlowLogo/);
  assert.doesNotMatch(walletChip, /flows-region-/);
  assert.doesNotMatch(flowUi, /flows-region-/);
});
