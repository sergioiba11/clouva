-- Columnas para el análisis+generación de layout_config a partir de las
-- imágenes de referencia (clasificación mockup-vs-adaptativo + el layout
-- generado), llevadas entre pasos del worker igual que generated_assets.

alter table public.vip_profile_generation_jobs
  add column if not exists layout_analysis jsonb,
  add column if not exists generated_layout jsonb;
