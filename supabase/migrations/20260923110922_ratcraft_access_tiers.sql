alter table public.ratcraft_access_passes
  add column plan_code text not null default 'rata'
    check (plan_code in ('rata','rata_plus','rata_premium')),
  add column price_usd numeric(12,2) not null default 10
    check (price_usd in (10,20,50)),
  add column fx_local_per_usd numeric(14,4),
  add column preference_id text,
  add column benefits jsonb not null default '[]'::jsonb,
  add column failure_reason text;

alter table public.ratcraft_access_passes
  alter column amount drop default;

create index ratcraft_access_passes_user_created_idx
  on public.ratcraft_access_passes (user_id, created_at desc);
