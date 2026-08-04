-- El check constraint original de status nunca se actualizó cuando se
-- agregaron los estados nuevos del flujo de layout (classifying_reference,
-- generating_variants, generating_variant_assets, awaiting_variant_selection)
-- -- el código ya los usaba, pero la base los rechazaba con
-- "violates check constraint vip_profile_generation_jobs_status_check".

alter table public.vip_profile_generation_jobs
  drop constraint if exists vip_profile_generation_jobs_status_check;

alter table public.vip_profile_generation_jobs
  add constraint vip_profile_generation_jobs_status_check check (status in (
    'queued', 'preparing_identity', 'analyzing_identity', 'generating_copy',
    'classifying_reference', 'generating_assets', 'generating_variants', 'generating_variant_assets',
    'assembling_profile', 'awaiting_variant_selection', 'review_ready', 'published',
    'failed', 'blocked_budget', 'needs_user_input', 'cancelled'
  ));
