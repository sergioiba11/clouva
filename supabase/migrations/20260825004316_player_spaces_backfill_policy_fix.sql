begin;

create or replace function private.ensure_player_for_user(p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing uuid;
  v_profile public.profiles%rowtype;
  v_user auth.users%rowtype;
  v_display_name text;
  v_slug_base text;
  v_slug text;
  v_username text;
begin
  if p_user_id is null then return null; end if;

  insert into public.user_entitlements(user_id,product_code,tier,status,source,starts_at,metadata)
  select p_user_id,'core','free','active','signup',now(),jsonb_build_object('auto_player',true,'reason','universal_player')
  where not exists (
    select 1 from public.user_entitlements e
    where e.user_id=p_user_id
      and e.product_code='core'
      and e.status='active'
      and (coalesce(e.valid_until,e.expires_at) is null or coalesce(e.valid_until,e.expires_at)>now())
  );

  select p.id into v_existing
  from public.players p
  where p.owner_user_id = p_user_id
  order by p.created_at asc
  limit 1;

  if v_existing is not null then
    insert into public.player_members(player_id,user_id,role,status,joined_at)
    values (v_existing,p_user_id,'owner','active',now())
    on conflict (player_id,user_id) do update
    set role='owner',status='active',joined_at=coalesce(public.player_members.joined_at,now()),updated_at=now();
    return v_existing;
  end if;

  select * into v_user from auth.users u where u.id = p_user_id;
  if not found then return null; end if;
  select * into v_profile from public.profiles p where p.id = p_user_id;

  v_display_name := coalesce(
    nullif(btrim(v_profile.display_name),''),
    nullif(btrim(v_profile.full_name),''),
    nullif(btrim(v_profile.username),''),
    nullif(btrim(v_user.raw_user_meta_data->>'display_name'),''),
    nullif(btrim(v_user.raw_user_meta_data->>'full_name'),''),
    nullif(split_part(coalesce(v_user.email,''),'@',1),''),
    'Player'
  );

  v_slug_base := trim(both '-' from regexp_replace(lower(v_display_name),'[^a-z0-9]+','-','g'));
  if v_slug_base = '' then v_slug_base := 'player'; end if;
  v_slug := left(v_slug_base,48) || '-' || left(replace(p_user_id::text,'-',''),8);

  if v_profile.username is not null
    and nullif(btrim(v_profile.username),'') is not null
    and not exists (select 1 from public.players p where p.username = btrim(v_profile.username)) then
    v_username := btrim(v_profile.username);
  else
    v_username := null;
  end if;

  insert into public.players(
    owner_user_id,slug,display_name,username,profile_image_url,
    claim_status,claimed_at,publication_status,is_published,privacy_status
  ) values (
    p_user_id,v_slug,left(v_display_name,160),v_username,v_profile.avatar_url,
    'claimed',now(),'draft',false,'public'
  ) returning id into v_existing;

  insert into public.player_members(player_id,user_id,role,status,joined_at)
  values (v_existing,p_user_id,'owner','active',now())
  on conflict (player_id,user_id) do update
  set role='owner',status='active',joined_at=coalesce(public.player_members.joined_at,now()),updated_at=now();

  return v_existing;
end;
$$;

do $$
declare
  v_user record;
begin
  for v_user in select id from auth.users loop
    perform private.ensure_player_for_user(v_user.id);
  end loop;
end
$$;

create or replace function public.current_user_controls_player(p_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.user_controls_player((select auth.uid()),p_player_id);
$$;

revoke all on function public.current_user_controls_player(uuid) from public,anon;
grant execute on function public.current_user_controls_player(uuid) to authenticated,service_role;

drop policy if exists space_members_accessible_select on public.space_members;
create policy space_members_accessible_select on public.space_members
for select to authenticated
using (
  public.current_user_controls_player(player_id)
  or public.space_can(space_id,'settings')
);

commit;
