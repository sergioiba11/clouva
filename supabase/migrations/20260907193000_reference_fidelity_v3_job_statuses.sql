alter table public.vip_profile_generation_jobs
  drop constraint if exists vip_profile_generation_jobs_status_check;

alter table public.vip_profile_generation_jobs
  add constraint vip_profile_generation_jobs_status_check
  check (status = any (array[
    'queued',
    'preparing_identity',
    'analyzing_identity',
    'generating_copy',
    'classifying_reference',
    'generating_assets',
    'generating_variants',
    'generating_variant_assets',
    'assembling_profile',
    'rendering_reference_preview',
    'capturing_reference_render',
    'comparing_reference',
    'applying_visual_corrections',
    'validating_visual_fidelity',
    'awaiting_variant_selection',
    'review_ready',
    'published',
    'failed',
    'blocked_budget',
    'needs_user_input',
    'cancelled'
  ]::text[]));
