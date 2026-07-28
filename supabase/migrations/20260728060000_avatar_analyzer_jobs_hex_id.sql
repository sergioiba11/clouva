-- Switch avatar_analyzer_jobs.id from uuid to the 32-char lowercase hex
-- format already used everywhere else for job/run ids in this codebase
-- (Python's uuid.uuid4().hex, matched by RUN_ID_PATTERN = ^[a-f0-9]{32}$
-- in worker/garment-rig/app_v17.py and JOB_ID_PATTERN in the Next.js
-- analyze API routes). A uuid column round-trips through Postgres in
-- dashed form, which would fail that shared regex on every request.
-- Table has zero rows (just created), so this is a plain type change.

begin;

alter table public.avatar_analyzer_jobs
  alter column id drop default;

alter table public.avatar_analyzer_jobs
  alter column id type text using replace(id::text, '-', '');

alter table public.avatar_analyzer_jobs
  alter column id set default lower(replace(gen_random_uuid()::text, '-', ''));

alter table public.avatar_analyzer_jobs
  add constraint avatar_analyzer_jobs_id_format check (id ~ '^[a-f0-9]{32}$');

commit;
