# NFSU2 RESOURCE INVENTORY

Game root (read-only, do not modify originals): `D:\gamesss\Need for Speed Underground 2\Need for Speed Underground 2`
Verified: 2026-10-06 by COMMANDER-QA (cycle 1). Tools that work here: PryHUB `ug2.exe` (`C:\Users\CLV\Downloads\PryHUB\target\release\ug2.exe`; info/parts/fields/dump/textures/import/replace/poke/tune/profile/globalb/probe/diff/export), Python 3.13.

Legend for **Status**: `EXTRACTED` = already usable in CLOUVA · `READY` = convertible now, not yet used · `DATA-ONLY` = numbers/behavior usable, raw assets not practical · `BLOCKED` = needs more work.

## 1. Shop / showroom environments

| Resource | Contains | Convertible? | CLOUVA use | Perf cost | Status |
|---|---|---|---|---|---|
| `FRONTEND\PLATFORMS\Showroom.BIN` | Showroom platform geometry/materials | Partial via PryHUB | Garage backdrop + camera framing reference | Medium if converted; prefer reference-only | READY (reference) |
| `FRONTEND\PLATFORMS\CarLot01.BIN` | Car lot platform | Partial | Category-specific floor/platform treatment | Medium | READY (reference) |
| `FRONTEND\PLATFORMS\PaintShop01.BIN` | Paint shop environment | Partial | Paint-category lighting context | Medium | READY (reference) |
| `FRONTEND\PLATFORMS\PartsShop01.BIN`, `PerfShop01/02.BIN`, `AudioShop01.BIN`, `MegaloShop01.BIN`, `Crib01.BIN` | Shop interiors | Partial | Per-category garage "shop context" (plan goal) | High if all converted; extract selectively | READY (reference) |
| `FRONTEND\ENVMAPS\Showroom.bin`, `ElaborareGT.bin` | Environment maps | Yes (env map for Three.js) | Real reflections on EL UNITO paint/glass (pairs with HDReflections.ini VehicleScale 0.5) | Low (PMREM once, reuse) | READY |

## 2. HUD / frontend language

| Resource | Contains | Convertible? | CLOUVA use | Perf cost | Status |
|---|---|---|---|---|---|
| `GLOBAL\HUD_CustomTextures_00..16.bin` + `ALL` (4.26 MB) | HUD textures: bars, icons, overlays, selection states | Yes (TexWizard/PryHUB) | Derive CLOUVA UI tokens: lime selected state, condensed hierarchy, meter patterns, angles/borders | Low (texture atlas) | READY |
| `GLOBAL\GlobalTexturesNA.bin`, `GlobalTexturesROW.bin`, `DYNTEX.BIN` | Shared frontend textures | Yes | Icon/overlay source | Low | READY |
| `FRONTEND\FrontB.lzc`, `FRONTA.BUN`, `MAGAZINES_*.BIN` | Frontend archives | Partial (LZ compressed) | Font/menu language reference | Low | READY |

## 3. Real wheels — `CARS\WHEELS\`

| Resource | Contains | Convertible? | CLOUVA use | Perf cost | Status |
|---|---|---|---|---|---|
| `GEOMETRY_*.BIN` × 34 brands (5ZIGEN, ADVAN, ARTI, AVUS, AXIS, BBS, BLITZ, DAVIN, DONZ, ENKEI, FOXX, GIANELLE, GIOVANNA, HART, KAIZER, KONIG, LEXANI, LOWENHART, MOMO, NFSU, OASIS, OEM, OZ, RACINGHART, RAYS, ROJA, ROTA, SPARCO, SPINNER, STREETSPIN, VEILSIDE, VOLK, WELDWHEEL, WORK) | Real NFS rim geometry, per-style variants (e.g. BBS_STYLE04_15/17_23_A/B/C) | Yes (PryHUB; proven by existing BBS 228-node GLB, 4.6 MB, at `C:\Users\CLV\Downloads\NFSU2_WHEEL_BBS_OUT\`) | Real rims on EL UNITO; expand beyond the current 6 brands | Per-brand GLB 12–40 KB (current 6) — good; full 228-node BBS = 4.6 MB, lazy-load only selected brand/style | 6 brands EXTRACTED (BBS, ENKEI, MOMO, OZ, RAYS, VOLK — each currently a single representative variant, e.g. `BBS_STYLE04_17_23_A`); 28 brands READY |
| `CARS\WHEELS\TEXTURES.BIN` | Rim textures | Yes | Rim faces/finishes | Low | READY |

**Mounting note (P0 bug):** rim GLBs are local-space (centered at origin); the Uno body GLB is world-space. Mount constants must be normalized — see `COMMANDER_TO_OPENCODE.md` P0-1 for exact numbers.

## 4. Fiat Uno addon — `C:\Users\CLV\Downloads\Fiat_Uno_Sx_By_MiniMods_Addon\Files\CARS\UNO`

| Resource | Contains | Convertible? | CLOUVA use | Perf cost | Status |
|---|---|---|---|---|---|
| `geometry.bin` (3900.9 KB) | 121 meshes: stock body, body kit 01, widebody 01/02/03, hoods STYLE00–10 + CF, spoilers 01–40 + CF, headlight STYLE05, brakes, mirrors, exhaust, driver | Yes → deployed `public/models/vehicles/fiat-uno-sx-minimods.glb` (121 nodes/121 meshes/29 materials, all mesh names verified) | Whole EL UNITO model + part visibility groups | One GLB, lazy-load per vehicle | EXTRACTED |
| `textures.bin` (201 KB) | Body textures | Yes | Paint/livery base | Low | EXTRACTED |
| `VINYLS.BIN` (18.6 MB, ~1786 textures) | Vinyl/sticker library | Yes, selectively | Vinyl layer browsing (NFS-style categories); custom upload/transform | High if wholesale — extract curated set only | READY (selective) |

Part taxonomy (from `scripts\_General.ini`): BodyShop = FrontBumper, RearBumper, Skirt, Fender, Quarter, Spoiler, Hood, Engine, Trunk, RoofScoops, Interior, Roof, Brakes, Headlights, Taillights, Mirrors, Exhaust, Rims, CarbonFiber, WideBodyKits; plus Performance, Paint (VinylLayers=4), Specialties.

## 5. Engine / audio behavior — `SOUND\ENGINE\` + `scripts\CarSoundData\`

| Resource | Contains | Convertible? | CLOUVA use | Perf cost | Status |
|---|---|---|---|---|---|
| `SOUND\ENGINE\CAR_00..40_ENG_*.abk`, `~90 GIN files` | Engine sound banks (Honda S2000 etc.) | Proprietary format; raw playback not practical | Do NOT ship raw; use behavior data below | — | BLOCKED (raw audio) |
| `scripts\CarSoundData\EngineData\00.ini` | MaxRPM 9229, MinRPM 1350, AccelDeltaRPMThreshold 150, AEMSMixLRPM 0.15, GinsuMixLRPM 0.85, MainRAMBankName=CAR_00_ENG_MB_EE.abk | Read directly | Reactive Show/audio visualization curves | None (numbers) | DATA-ONLY (usable now) |
| `scripts\CarSoundData\ShiftPatterns\00.ini` | BankName=GEAR_SML_Base.abk, Unk13=8000 | Read directly | Shift-point feel for visualization | None | DATA-ONLY |
| `scripts\CarSoundData\TurboDataSet\00.ini` | TurboBank=TURBO_SML1_0_MB.abk, ChargeTime=0.5 | Read directly | Turbo spool timing in Show mode | None | DATA-ONLY |
| `scripts\NFSU2CarSoundTunerSettings.ini` | Tuner defaults | Read directly | Reference values | None | DATA-ONLY |

## 6. Stance / camera / rendering mods — `scripts\` (lowercase folder)

| Resource | Contains | Convertible? | CLOUVA use | Perf cost | Status |
|---|---|---|---|---|---|
| `NFSU2_StanceMod.ini` | CamberAngle 0–15 (default 7), TrackWidthOffset 0–2, TireWidthMultiplier 1.0–1.5 | Read directly | Real stance slider ranges (current CLOUVA sliders: ride -0.3..0.2, wheel scale 0.82–1.24 — within plausible bounds but not mapped to NFS ranges) | None | DATA-ONLY (usable now) |
| `NFSU2HDReflections.ini` | VehicleScale 0.5, RoadScale 0.5, MirrorScale 1.0, ImproveReflectionLOD, RestoreSkybox=1, RestoreHeadlights=1 | Read directly | Reflection/env-map budget for the viewer | None | DATA-ONLY |
| `NFSUnderground2.WidescreenFix.ini` | FixHUD=1, FixFOV=1, Scaling=1, FPSLimit=-1 | Read directly | Camera FOV/framing intent | None | DATA-ONLY |
| `ReShade.ini` + `1-Bayview`, `2-Olympic`, `3-Bayview-Soft`, `4-Olympic-Soft` presets | Post-processing: Bayview = MultiLUT ug2net-luts.png (LutAmount 2), Bloom 0.301/0.756, SMAA CornerRounding 25, Vignette -0.638 | Read directly | Site/viewer post-processing feel (exposure, bloom, vignette) | Low (LUT shader) | DATA-ONLY |
| `NFSU2ExtraOptionsSettings.ini`, `NFSU2UnlimiterSettings.ini` | Extra options, limiter removal | Read directly | Behavior reference | None | DATA-ONLY |

## 7. Extraction tooling

| Tool | Path | Status |
|---|---|---|
| PryHUB CLI (`ug2.exe`) | `C:\Users\CLV\Downloads\PryHUB\target\release\ug2.exe` | WORKING — primary extractor |
| Full BBS wheel catalog GLB (228 nodes) | `C:\Users\CLV\Downloads\NFSU2_WHEEL_BBS_OUT\NFSU2_WHEEL_BBS.glb` | Ready to slim into lazy-loaded per-style GLBs |
| Python GLB analysis scripts | `%LOCALAPPDATA%\Temp\opencode\measure_glb.py`, `dump_nodes.py` | Working (bbox + node transform dumps) |

## Rules
- Work on copies; never modify the installed game.
- `public/assets/auto/nfsu2-derived/` only for assets CLOUVA actually needs, optimized (per plan).
- Keep CLOUVA originals: BAJOCERO-Z, EL UNITO, LOCODANISONIDO.
