-- User-uploaded inspiration/reference images for the VIP AI identity
-- pipeline (in addition to Instagram import). Purely additive: the Gemini
-- image calls already support multimodal input (lib/gemini-image.ts
-- generateImage()'s referenceImages param), it was just never fed anything.

alter table public.vip_profile_generation_jobs
  add column if not exists reference_image_urls text[] not null default '{}';
