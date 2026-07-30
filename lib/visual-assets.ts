// Real, already-generated Fase 1 assets (see lib/ai-budget/manifest.ts for
// the prompts/model/cost that produced each one). Centralized here so pages
// don't hardcode GCS URLs -- when an asset is regenerated, only this file
// needs to change.
export const VISUAL_ASSETS = {
  "home-avatar-atmosphere-01":
    "https://storage.googleapis.com/clouva-generated-media/visual-system/backgrounds/home/home-avatar-atmosphere-01/7a62767a-1899-417e-85d9-605a0dacc3b6.jpg",
  "matrix-network-master-01":
    "https://storage.googleapis.com/clouva-generated-media/visual-system/backgrounds/matrix/matrix-network-master-01/ef0eecea-42cd-4330-a260-b1fbbd7b7cd4.jpg",
  "players-directory-hero-01":
    "https://storage.googleapis.com/clouva-generated-media/visual-system/backgrounds/players/players-directory-hero-01/d9033c38-4f23-4493-98e6-601c8512531a.jpg",
  "player-public-profile-cover-01":
    "https://storage.googleapis.com/clouva-generated-media/visual-system/backgrounds/player-profile/player-public-profile-cover-01/dd1a2ccb-121e-43e7-8cd4-43ef23182158.jpg",
} as const;
