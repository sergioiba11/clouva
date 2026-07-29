-- Follow-up constraints for Identity & Revenue V2.

-- PostgREST upsert can infer a regular unique index by its column list. NULL
-- values remain non-conflicting, so manual media rows are still unrestricted.
drop index if exists public.player_media_external_unique;
create unique index player_media_external_unique
  on public.player_media(origin, external_id, player_id);

-- Link an entitlement to its internal subscription only after both tables exist.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'user_entitlements_source_subscription_fkey'
  ) then
    alter table public.user_entitlements
      add constraint user_entitlements_source_subscription_fkey
      foreign key (source_subscription_id)
      references public.billing_subscriptions(id)
      on delete set null;
  end if;
end
$$;

create index if not exists user_entitlements_source_subscription_idx
  on public.user_entitlements(source_subscription_id)
  where source_subscription_id is not null;
