-- Resolución administrativa auditada para casos donde un provider externo no
-- está disponible o una similitud intermedia requiere revisión humana.

alter table public.brand_clearance_checks
  add column if not exists manual_decision text,
  add column if not exists review_note text,
  add column if not exists reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists reviewed_at timestamptz;

alter table public.brand_clearance_checks drop constraint if exists brand_clearance_checks_manual_decision_check;
alter table public.brand_clearance_checks
  add constraint brand_clearance_checks_manual_decision_check
  check (manual_decision is null or manual_decision in (
    'clear',
    'review_required',
    'blocked_external_name_conflict',
    'blocked_external_visual_conflict',
    'blocked_combined_conflict'
  ));
