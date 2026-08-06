-- CLOUVA Logo Engine V2 -- hotfix de fidelidad (2026-08-06). Único cambio de
-- esquema indispensable para esta tanda: un candidato descartado desde /logo
-- (Fase 9, "Descartar candidato") necesita un estado propio -- 'draft' ya
-- significa "todavía sin decidir", reusarlo para "decidido que NO" perdería
-- esa distinción real. No se borra nada (ledger/auditoría intactos), solo
-- cambia de estado.
--
-- NO aplicada en esta tanda (igual que el resto del hotfix): se escribe acá
-- versionada, lista para cuando se decida aplicar.

alter table public.brand_asset_versions drop constraint if exists brand_asset_versions_status_check;
alter table public.brand_asset_versions
  add constraint brand_asset_versions_status_check
  check (status in ('draft', 'approved', 'published', 'rejected'));
