-- Public profiles may show a VIP badge without exposing billing rows, dates,
-- provider IDs or any private entitlement information.
create or replace function public.is_player_vip(p_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.players p
    join public.user_entitlements ue
      on ue.user_id = p.owner_user_id
    where p.id = p_player_id
      and p.is_published = true
      and p.publication_status = 'published'
      and ue.tier = 'vip'
      and ue.status = 'active'
      and coalesce(ue.valid_from, ue.starts_at) <= now()
      and (
        coalesce(ue.valid_until, ue.expires_at) is null
        or coalesce(ue.valid_until, ue.expires_at) > now()
      )
  );
$$;

revoke all on function public.is_player_vip(uuid) from public;
grant execute on function public.is_player_vip(uuid) to anon, authenticated;
