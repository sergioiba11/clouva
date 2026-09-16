-- Public identity fields used by Player SEO/AEO/Knowledge Graph output.
-- Idempotent because production may already contain these columns.
alter table public.players
  add column if not exists alternate_names text[] not null default '{}'::text[],
  add column if not exists country text,
  add column if not exists birth_place text,
  add column if not exists schema_job_title text,
  add column if not exists public_identity_label text;
