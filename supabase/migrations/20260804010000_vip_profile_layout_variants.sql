-- Flujo de 3 variantes para adaptive_layout (sin mockup detectado): cada
-- variante lleva su propio layout_config + portada + logo, guardadas todas
-- acá hasta que el usuario elige una (select-variant crea player_profile_versions
-- recién ahí -- las otras dos nunca se persisten como versión aparte).

alter table public.vip_profile_generation_jobs
  add column if not exists layout_variants jsonb;
