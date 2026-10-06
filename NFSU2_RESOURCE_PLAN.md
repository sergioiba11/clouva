# NFSU2 RESOURCE-DRIVEN BUILD PLAN

## Principle
Do NOT merely imitate NFS Underground 2 from memory. Treat the user's installed game as a design/behavior/resource library. CLOUVA must remain its own product, but the tuning experience should be informed by actual NFSU2 resources and data.

## Installed game root
D:\gamesss\Need for Speed Underground 2\Need for Speed Underground 2

## High-value resource groups

### 1. Shop / showroom environments
Use these to understand or extract geometry/material/environment cues for each tuning category:
- FRONTEND\PLATFORMS\AudioShop01.BIN
- FRONTEND\PLATFORMS\CarLot01.BIN
- FRONTEND\PLATFORMS\Crib01.BIN
- FRONTEND\PLATFORMS\MegaloShop01.BIN
- FRONTEND\PLATFORMS\PaintShop01.BIN
- FRONTEND\PLATFORMS\PartsShop01.BIN
- FRONTEND\PLATFORMS\PerfShop01.BIN
- FRONTEND\PLATFORMS\PerfShop02.BIN
- FRONTEND\PLATFORMS\Showroom.BIN
- FRONTEND\ENVMAPS\Showroom.bin
- FRONTEND\ENVMAPS\ElaborareGT.bin

Goal:
- derive category-specific lighting/background/garage treatment
- understand camera framing and platform proportions
- reuse/convert compatible environment data where technically practical
- at minimum, reproduce behavior/composition from measured resources/screenshots rather than inventing generic SaaS cards

### 2. HUD / frontend language
- GLOBAL\HUD_CustomTextures_00.bin ... HUD_CustomTextures_14.bin
- GLOBAL\GlobalTexturesNA.bin
- GLOBAL\GlobalTexturesROW.bin
- FRONTEND\FrontB.lzc / FRONTA.BUN / related frontend archives

Goal:
- inspect actual HUD texture shapes, icon framing, bars, selection states, overlays
- derive CLOUVA-native UI tokens from them: angles, borders, opacity, selected lime, condensed hierarchy, meter patterns
- do not settle for generic rounded dashboard cards

### 3. Real wheels
- CARS\WHEELS\GEOMETRY_*.BIN
- CARS\WHEELS\TEXTURES.BIN

Already extracted initial families:
- BBS
- ENKEI
- MOMO
- OZ
- RAYS
- VOLK

Goal:
- add more useful brands/variants where web/mobile budget allows
- retain recognizable real NFS rim geometry
- mount correctly on EL UNITO with circular tire geometry and believable offset
- lazy-load per chosen brand/style

### 4. Fiat Uno addon
Source:
C:\Users\CLV\Downloads\Fiat_Uno_Sx_By_MiniMods_Addon\Files\CARS\UNO

Known:
- 121 meshes
- stock body
- body kit 01
- widebody 01/02/03
- hoods 01..10 + CF
- spoilers 01..40 + CF
- headlight style 05
- brakes, mirrors, exhaust
- VINYLS.BIN has ~1786 textures

Goal:
- expose as much real part selection as is practical
- build correct visibility groups
- do not fake part names if actual mesh names exist
- preserve mobile performance by selective/lazy asset loading

### 5. Vinyls / stickers
- Fiat addon VINYLS.BIN
- related texture archives

Goal:
- rescue actual usable vinyl texture layers
- category browsing inspired by NFS
- maintain CLOUVA originals: BAJOCERO-Z, EL UNITO, LOCODANISONIDO
- custom PNG/JPG/WebP upload, transform, scale, offset, rotate if possible

### 6. Engine / audio behavior
- SOUND\ENGINE\*.gin
- SCRIPTS\NFSU2CarSoundTunerSettings.ini
- SCRIPTS\CarSoundData\AccelFromIdle\*.ini
- SCRIPTS\CarSoundData\CarDataMapping\*.ini
- SCRIPTS\CarSoundData\CarTypeMapping\*.ini
- SCRIPTS\CarSoundData\EngineData\*.ini
- SCRIPTS\CarSoundData\ShiftPatterns
- SCRIPTS\CarSoundData\TurboDataSet
- SCRIPTS\CarSoundData\SweetnerDataSet

Goal:
- understand NFS response curves, engine state / acceleration / shift / turbo timing
- use those data patterns to make CLOUVA Show/audio visualization feel reactive and game-like
- do NOT block the core UI on proprietary audio conversion; behavior/data can be used even if raw .gin playback is not immediately practical
- integrate LOCODANISONIDO as the visual audio identity

### 7. Stance / camera / rendering mods
- SCRIPTS\NFSU2_StanceMod.ini
- SCRIPTS\NFSU2HDReflections.ini
- SCRIPTS\NFSU2ExtraOptionsSettings.ini
- SCRIPTS\NFSUnderground2.WidescreenFix.ini
- SCRIPTS\ReShade.ini
- SCRIPTS\1-ReShade-Bayview.ini
- SCRIPTS\2-ReShade-Olympic.ini
- SCRIPTS\3-ReShade-Bayview-Soft.ini
- SCRIPTS\4-ReShade-Olympic-Soft.ini
- SCRIPTS\NFSU2UnlimiterSettings.ini

Goal:
- read these configs and derive actual stance ranges, reflection/shadow intent, widescreen framing and post-processing feel
- translate useful numeric/style concepts into Three.js/web equivalents
- improve paint, clearcoat, glass, reflections, exposure, camera FOV, low-angle framing and platform contact

## Mandatory extraction/inventory phase
Before doing another major UI redesign:
1. Probe/dump the above resources with available tools (PryHUB/gizmo-nfs, TexWizard if safe/read-only, custom parsers).
2. Create NFSU2_RESOURCE_INVENTORY.md containing:
   - resource path
   - what it contains
   - whether it can be converted/read
   - how CLOUVA can use it
   - performance cost
   - implementation status
3. Create public/assets/auto/nfsu2-derived/ only for assets actually needed by CLOUVA and keep them optimized.
4. Prefer direct measured behavior/resources over visual guesswork.

## UI outcome
CLOUVA should be inspired by the user's actual NFSU2 installation:
- game-first full-screen garage
- shop context changes by tuning category
- selected state/menus/HUD derived from actual NFS frontend
- camera and car presentation derived from real NFS framing
- real rims/parts/vinyls from installed data where feasible
- audio/show response informed by installed sound mappings
- CLOUVA identity layered on top: BAJOCERO-Z, EL UNITO, LOCODANISONIDO, FLOW, CLOUVA navigation

## Current Priority 0
Still fix production bugs first:
- mobile horizontal overflow
- hero car size/framing
- broken-looking wheel/tire mounting
Then continue resource-driven refinement.
