-- Canonical Player/account country identity used by regional FLOW branding.
-- This is profile identity only: it does not alter FLOW assets, ledger, backing or financial country rules.

alter table public.profiles
  add column if not exists country_code text;

comment on column public.profiles.country_code is
  'Canonical ISO 3166-1 alpha-2 country code for the Player/account identity. Nullable until explicitly selected by the user.';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_country_code_iso2_check'
  ) then
    alter table public.profiles
      add constraint profiles_country_code_iso2_check
      check (country_code is null or country_code ~ '^[A-Z]{2}$');
  end if;
end
$$;
