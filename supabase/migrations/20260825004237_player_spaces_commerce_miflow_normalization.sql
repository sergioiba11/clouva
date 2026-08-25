begin;

create schema if not exists private;
revoke all on schema private from public;

create or replace function private.user_is_global_admin(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null and exists (
    select 1 from public.profiles p
    where p.id = p_user_id and p.role::text = 'admin'
  );
$$;

create or replace function private.user_has_active_vip(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null and exists (
    select 1
    from public.user_entitlements e
    where e.user_id = p_user_id
      and e.status = 'active'
      and e.tier = 'vip'
      and coalesce(e.valid_from, e.starts_at, now()) <= now()
      and (coalesce(e.valid_until, e.expires_at) is null or coalesce(e.valid_until, e.expires_at) > now())
  );
$$;

create or replace function public.has_active_vip_entitlement()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.user_has_active_vip((select auth.uid()));
$$;

create or replace function public.can_administer_spaces()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.user_is_global_admin((select auth.uid()))
      or private.user_has_active_vip((select auth.uid()));
$$;

create or replace function public.can_administer_spaces(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.user_is_global_admin(p_user_id)
      or private.user_has_active_vip(p_user_id);
$$;

revoke all on function private.user_is_global_admin(uuid) from public;
revoke all on function private.user_has_active_vip(uuid) from public;
revoke all on function public.has_active_vip_entitlement() from public, anon;
revoke all on function public.can_administer_spaces() from public, anon;
revoke all on function public.can_administer_spaces(uuid) from public, anon, authenticated;
grant execute on function public.has_active_vip_entitlement() to authenticated, service_role;
grant execute on function public.can_administer_spaces() to authenticated, service_role;
grant execute on function public.can_administer_spaces(uuid) to service_role;

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

  select p.id into v_existing
  from public.players p
  where p.owner_user_id = p_user_id
  order by p.created_at asc
  limit 1;

  if v_existing is not null then
    if not exists (
      select 1 from public.player_members pm
      where pm.player_id = v_existing and pm.user_id = p_user_id and pm.status = 'active'
    ) then
      insert into public.player_members(player_id,user_id,role,status,joined_at)
      values (v_existing,p_user_id,'owner','active',now())
      on conflict (player_id,user_id) do update
      set role='owner',status='active',joined_at=coalesce(public.player_members.joined_at,now()),updated_at=now();
    end if;
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

  insert into public.user_entitlements(user_id,product_code,tier,status,source,starts_at,metadata)
  select p_user_id,'core','free','active','signup',now(),jsonb_build_object('auto_player',true)
  where not exists (
    select 1 from public.user_entitlements e
    where e.user_id=p_user_id
      and e.product_code='core'
      and e.status='active'
      and (coalesce(e.valid_until,e.expires_at) is null or coalesce(e.valid_until,e.expires_at)>now())
  );

  return v_existing;
end;
$$;

revoke all on function private.ensure_player_for_user(uuid) from public, anon, authenticated;

do $$
declare
  v_user record;
begin
  for v_user in select id from auth.users loop
    perform private.ensure_player_for_user(v_user.id);
  end loop;
end
$$;

create unique index if not exists players_owner_user_unique
  on public.players(owner_user_id)
  where owner_user_id is not null;

create or replace function private.handle_new_auth_user_player()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.ensure_player_for_user(new.id);
  return new;
end;
$$;

drop trigger if exists clouva_ensure_player_on_auth_user on auth.users;
create trigger clouva_ensure_player_on_auth_user
after insert on auth.users
for each row execute function private.handle_new_auth_user_player();

create table if not exists public.spaces (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('studio','business','spot','club','brand','other')),
  slug text not null unique,
  name text not null,
  owner_player_id uuid not null references public.players(id) on delete restrict,
  created_by_user_id uuid references auth.users(id) on delete set null,
  description text,
  logo_url text,
  cover_url text,
  accent_color text,
  palette text[] not null default '{}'::text[],
  public_enabled boolean not null default false,
  status text not null default 'active' check (status in ('draft','active','paused','suspended','archived')),
  settings jsonb not null default '{}'::jsonb,
  legacy_studio_id uuid unique references public.studios(id) on delete set null,
  legacy_commerce_spot_id uuid unique references public.commerce_spots(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists spaces_owner_player_idx on public.spaces(owner_player_id);
create index if not exists spaces_type_status_idx on public.spaces(type,status);
create index if not exists spaces_created_by_idx on public.spaces(created_by_user_id) where created_by_user_id is not null;

create table if not exists public.space_members (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  role text not null check (role in ('owner','admin','manager','catalog','inventory','sales','finance','content','support','viewer')),
  status text not null default 'active' check (status in ('active','invited','disabled')),
  invited_by_player_id uuid references public.players(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(space_id,player_id)
);

create index if not exists space_members_player_status_idx on public.space_members(player_id,status);
create index if not exists space_members_space_role_idx on public.space_members(space_id,role,status);

create or replace function private.user_controls_player(p_user_id uuid,p_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null and p_player_id is not null and (
    exists(select 1 from public.players p where p.id=p_player_id and p.owner_user_id=p_user_id)
    or exists(
      select 1 from public.player_members pm
      where pm.player_id=p_player_id and pm.user_id=p_user_id and pm.status='active'
        and pm.role in ('owner','manager','editor','viewer')
    )
  );
$$;

create or replace function private.space_role_for_user(p_space_id uuid,p_user_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  if p_space_id is null or p_user_id is null then return null; end if;
  if private.user_is_global_admin(p_user_id) then return 'admin'; end if;

  select sm.role into v_role
  from public.space_members sm
  where sm.space_id=p_space_id and sm.status='active'
    and private.user_controls_player(p_user_id,sm.player_id)
  order by case sm.role
    when 'owner' then 1 when 'admin' then 2 when 'manager' then 3
    when 'finance' then 4 when 'sales' then 5 when 'catalog' then 6
    when 'inventory' then 7 when 'content' then 8 when 'support' then 9 else 10 end
  limit 1;

  return v_role;
end;
$$;

create or replace function public.space_role_for_current_user(p_space_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select private.space_role_for_user(p_space_id,(select auth.uid()));
$$;

create or replace function public.space_can(p_space_id uuid,p_capability text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_role text;
begin
  if v_user_id is null then return false; end if;
  if private.user_is_global_admin(v_user_id) then return true; end if;
  v_role := private.space_role_for_user(p_space_id,v_user_id);
  if v_role is null then return false; end if;
  if p_capability = 'view' then return true; end if;
  if not private.user_has_active_vip(v_user_id) then return false; end if;
  if v_role='owner' then return true; end if;
  if v_role='admin' then return p_capability <> 'transfer_owner'; end if;
  if v_role='manager' then return p_capability in ('operations','catalog','inventory','sales','finance','content','support','settings'); end if;
  if v_role='catalog' then return p_capability in ('catalog','content'); end if;
  if v_role='inventory' then return p_capability='inventory'; end if;
  if v_role='sales' then return p_capability in ('sales','support'); end if;
  if v_role='finance' then return p_capability='finance'; end if;
  if v_role='content' then return p_capability='content'; end if;
  if v_role='support' then return p_capability='support'; end if;
  return false;
end;
$$;

revoke all on function private.user_controls_player(uuid,uuid) from public,anon,authenticated;
revoke all on function private.space_role_for_user(uuid,uuid) from public,anon,authenticated;
revoke all on function public.space_role_for_current_user(uuid) from public,anon;
revoke all on function public.space_can(uuid,text) from public,anon;
grant execute on function public.space_role_for_current_user(uuid) to authenticated,service_role;
grant execute on function public.space_can(uuid,text) to authenticated,service_role;

alter table public.spaces enable row level security;
alter table public.space_members enable row level security;
revoke insert,update,delete on public.spaces from anon,authenticated;
revoke insert,update,delete on public.space_members from anon,authenticated;
grant select on public.spaces to anon,authenticated;
grant select on public.space_members to authenticated;

drop policy if exists spaces_public_or_member_select on public.spaces;
create policy spaces_public_or_member_select on public.spaces
for select to anon,authenticated
using ((public_enabled=true and status='active') or public.space_role_for_current_user(id) is not null);

drop policy if exists space_members_accessible_select on public.space_members;
create policy space_members_accessible_select on public.space_members
for select to authenticated
using (private.user_controls_player((select auth.uid()),player_id) or public.space_can(space_id,'settings'));

insert into public.spaces(
  type,slug,name,owner_player_id,created_by_user_id,description,logo_url,cover_url,
  accent_color,palette,public_enabled,status,settings,legacy_studio_id
)
select
  'studio',s.slug,s.name,p.id,s.owner_id,s.description,s.logo_url,s.cover_url,
  s.accent_color,coalesce(s.palette,'{}'::text[]),s.is_published,
  case when s.publication_status='published' then 'active' else 'draft' end,
  jsonb_build_object('source','studio','studio_os_status',s.studio_os_status),s.id
from public.studios s
join public.players p on p.owner_user_id=s.owner_id
on conflict (legacy_studio_id) do update set
  name=excluded.name,slug=excluded.slug,owner_player_id=excluded.owner_player_id,
  description=excluded.description,logo_url=excluded.logo_url,cover_url=excluded.cover_url,
  accent_color=excluded.accent_color,palette=excluded.palette,public_enabled=excluded.public_enabled,
  status=excluded.status,settings=public.spaces.settings || excluded.settings,updated_at=now();

update public.spaces sp
set legacy_commerce_spot_id=cs.id,
    public_enabled=sp.public_enabled or cs.public_enabled,
    settings=sp.settings || jsonb_build_object('commerce_spot_id',cs.id,'commerce_enabled',true),
    updated_at=now()
from public.commerce_spots cs
where sp.legacy_studio_id=cs.studio_id
  and cs.owner_type='studio'
  and sp.legacy_commerce_spot_id is null
  and not exists(select 1 from public.spaces other where other.legacy_commerce_spot_id=cs.id);

insert into public.spaces(
  type,slug,name,owner_player_id,created_by_user_id,description,logo_url,cover_url,
  accent_color,palette,public_enabled,status,settings,legacy_commerce_spot_id
)
select
  case when cs.settings->>'space_type' in ('studio','business','spot','club','brand','other') then cs.settings->>'space_type'
       when cs.business_type is not null then 'business' else 'spot' end,
  case when exists(select 1 from public.spaces sx where sx.slug=cs.slug)
       then cs.slug || '-' || left(replace(cs.id::text,'-',''),8) else cs.slug end,
  cs.name,coalesce(p_user.id,p_studio.id),coalesce(cs.created_by,cs.owner_user_id,s.owner_id),
  cs.description,cs.logo_url,cs.cover_url,cs.accent_color,coalesce(cs.palette,'{}'::text[]),
  cs.public_enabled,
  case cs.status when 'active' then 'active' when 'paused' then 'paused' when 'archived' then 'archived' else 'draft' end,
  coalesce(cs.settings,'{}'::jsonb) || jsonb_build_object('source','commerce_spot','business_type',cs.business_type),cs.id
from public.commerce_spots cs
left join public.studios s on s.id=cs.studio_id
left join public.players p_user on p_user.owner_user_id=cs.owner_user_id
left join public.players p_studio on p_studio.owner_user_id=s.owner_id
where not exists(select 1 from public.spaces sp where sp.legacy_commerce_spot_id=cs.id)
  and coalesce(p_user.id,p_studio.id) is not null
on conflict (legacy_commerce_spot_id) do nothing;

insert into public.space_members(space_id,player_id,role,status)
select sp.id,sp.owner_player_id,'owner','active'
from public.spaces sp
on conflict (space_id,player_id) do update set role='owner',status='active',updated_at=now();

insert into public.space_members(space_id,player_id,role,status)
select sp.id,p.id,
  case sm.role
    when 'owner' then 'owner' when 'admin' then 'admin' when 'manager' then 'manager'
    when 'editor' then 'catalog' when 'finance' then 'finance' when 'bookings' then 'sales'
    when 'support' then 'support' else 'viewer' end,
  case when sm.status='active' then 'active' else 'disabled' end
from public.studio_members sm
join public.spaces sp on sp.legacy_studio_id=sm.studio_id
join public.players p on p.owner_user_id=sm.profile_id
on conflict (space_id,player_id) do update set
  role=case when public.space_members.role='owner' then 'owner' else excluded.role end,
  status=excluded.status,updated_at=now();

insert into public.space_members(space_id,player_id,role,status)
select sp.id,p.id,csm.role,
  case when csm.status='active' then 'active' when csm.status='invited' then 'invited' else 'disabled' end
from public.commerce_spot_members csm
join public.spaces sp on sp.legacy_commerce_spot_id=csm.spot_id
join public.players p on p.owner_user_id=csm.user_id
on conflict (space_id,player_id) do update set
  role=case when public.space_members.role='owner' then 'owner' else excluded.role end,
  status=excluded.status,updated_at=now();

create or replace function private.sync_space_from_studio()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player_id uuid;
begin
  v_player_id := private.ensure_player_for_user(new.owner_id);
  if v_player_id is null then return new; end if;
  insert into public.spaces(
    type,slug,name,owner_player_id,created_by_user_id,description,logo_url,cover_url,
    accent_color,palette,public_enabled,status,settings,legacy_studio_id
  ) values (
    'studio',new.slug,new.name,v_player_id,new.owner_id,new.description,new.logo_url,new.cover_url,
    new.accent_color,coalesce(new.palette,'{}'::text[]),new.is_published,
    case when new.publication_status='published' then 'active' else 'draft' end,
    jsonb_build_object('source','studio','studio_os_status',new.studio_os_status),new.id
  )
  on conflict (legacy_studio_id) do update set
    name=excluded.name,owner_player_id=excluded.owner_player_id,description=excluded.description,
    logo_url=excluded.logo_url,cover_url=excluded.cover_url,accent_color=excluded.accent_color,
    palette=excluded.palette,public_enabled=excluded.public_enabled,status=excluded.status,
    settings=public.spaces.settings || excluded.settings,updated_at=now();

  insert into public.space_members(space_id,player_id,role,status)
  select sp.id,v_player_id,'owner','active' from public.spaces sp where sp.legacy_studio_id=new.id
  on conflict (space_id,player_id) do update set role='owner',status='active',updated_at=now();
  return new;
end;
$$;

create or replace function private.sync_space_from_commerce_spot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_space_id uuid;
  v_player_id uuid;
  v_owner_user_id uuid;
  v_type text;
  v_slug text;
begin
  if new.owner_type='studio' and new.studio_id is not null then
    select sp.id into v_space_id from public.spaces sp where sp.legacy_studio_id=new.studio_id limit 1;
    if v_space_id is not null and not exists(select 1 from public.spaces sx where sx.legacy_commerce_spot_id=new.id and sx.id<>v_space_id) then
      update public.spaces set
        legacy_commerce_spot_id=new.id,
        public_enabled=public_enabled or new.public_enabled,
        settings=settings || jsonb_build_object('commerce_spot_id',new.id,'commerce_enabled',true),
        updated_at=now()
      where id=v_space_id and (legacy_commerce_spot_id is null or legacy_commerce_spot_id=new.id);
      return new;
    end if;
  end if;

  if new.owner_type='user' then
    v_owner_user_id := new.owner_user_id;
  else
    select s.owner_id into v_owner_user_id from public.studios s where s.id=new.studio_id;
  end if;
  v_player_id := private.ensure_player_for_user(v_owner_user_id);
  if v_player_id is null then return new; end if;

  v_type := case when new.settings->>'space_type' in ('studio','business','spot','club','brand','other') then new.settings->>'space_type'
                 when new.business_type is not null then 'business' else 'spot' end;
  select sp.id into v_space_id from public.spaces sp where sp.legacy_commerce_spot_id=new.id limit 1;
  if v_space_id is null then
    v_slug := new.slug;
    if exists(select 1 from public.spaces sp where sp.slug=v_slug) then
      v_slug := v_slug || '-' || left(replace(new.id::text,'-',''),8);
    end if;
    insert into public.spaces(
      type,slug,name,owner_player_id,created_by_user_id,description,logo_url,cover_url,
      accent_color,palette,public_enabled,status,settings,legacy_commerce_spot_id
    ) values (
      v_type,v_slug,new.name,v_player_id,coalesce(new.created_by,v_owner_user_id),new.description,new.logo_url,new.cover_url,
      new.accent_color,coalesce(new.palette,'{}'::text[]),new.public_enabled,
      case new.status when 'active' then 'active' when 'paused' then 'paused' when 'archived' then 'archived' else 'draft' end,
      coalesce(new.settings,'{}'::jsonb) || jsonb_build_object('source','commerce_spot','business_type',new.business_type),new.id
    ) returning id into v_space_id;
  else
    update public.spaces set
      type=v_type,name=new.name,owner_player_id=v_player_id,description=new.description,logo_url=new.logo_url,
      cover_url=new.cover_url,accent_color=new.accent_color,palette=coalesce(new.palette,'{}'::text[]),
      public_enabled=new.public_enabled,
      status=case new.status when 'active' then 'active' when 'paused' then 'paused' when 'archived' then 'archived' else 'draft' end,
      settings=settings || coalesce(new.settings,'{}'::jsonb) || jsonb_build_object('business_type',new.business_type),updated_at=now()
    where id=v_space_id;
  end if;

  insert into public.space_members(space_id,player_id,role,status)
  values(v_space_id,v_player_id,'owner','active')
  on conflict(space_id,player_id) do update set role='owner',status='active',updated_at=now();
  return new;
end;
$$;

drop trigger if exists spaces_sync_studio on public.studios;
create trigger spaces_sync_studio
after insert or update of owner_id,name,slug,description,logo_url,cover_url,accent_color,palette,is_published,publication_status,studio_os_status
on public.studios for each row execute function private.sync_space_from_studio();

drop trigger if exists spaces_sync_commerce_spot on public.commerce_spots;
create trigger spaces_sync_commerce_spot
after insert or update of owner_type,owner_user_id,studio_id,name,description,logo_url,cover_url,accent_color,palette,public_enabled,status,business_type,settings
on public.commerce_spots for each row execute function private.sync_space_from_commerce_spot();

create table if not exists public.commerce_product_publications (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.commerce_products(id) on delete cascade,
  target_type text not null check (target_type in ('player','space','marketplace')),
  target_player_id uuid references public.players(id) on delete cascade,
  target_space_id uuid references public.spaces(id) on delete cascade,
  placement text not null default 'merch',
  is_visible boolean not null default true,
  display_order integer not null default 0,
  source text not null default 'manual' check (source in ('manual','auto_owner','auto_space')),
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commerce_product_publications_target_shape check (
    (target_type='player' and target_player_id is not null and target_space_id is null)
    or (target_type='space' and target_space_id is not null and target_player_id is null)
    or (target_type='marketplace' and target_player_id is null and target_space_id is null)
  )
);

create unique index if not exists commerce_product_publications_player_unique
  on public.commerce_product_publications(product_id,target_player_id,placement)
  where target_type='player';
create unique index if not exists commerce_product_publications_space_unique
  on public.commerce_product_publications(product_id,target_space_id,placement)
  where target_type='space';
create unique index if not exists commerce_product_publications_marketplace_unique
  on public.commerce_product_publications(product_id,placement)
  where target_type='marketplace';
create index if not exists commerce_product_publications_player_visible_idx
  on public.commerce_product_publications(target_player_id,is_visible,display_order)
  where target_type='player';
create index if not exists commerce_product_publications_space_visible_idx
  on public.commerce_product_publications(target_space_id,is_visible,display_order)
  where target_type='space';

alter table public.commerce_product_publications enable row level security;
revoke insert,update,delete on public.commerce_product_publications from anon,authenticated;
grant select on public.commerce_product_publications to anon,authenticated;

drop policy if exists commerce_product_publications_public_select on public.commerce_product_publications;
create policy commerce_product_publications_public_select on public.commerce_product_publications
for select to anon,authenticated
using (
  is_visible=true and exists(
    select 1 from public.commerce_products cp
    where cp.id=product_id and cp.status='published'
  )
);

create or replace function private.sync_product_publications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_space_id uuid;
  v_player_id uuid;
begin
  if new.status <> 'published' then
    update public.commerce_product_publications
    set is_visible=false,updated_at=now()
    where product_id=new.id and source in ('auto_owner','auto_space');
    return new;
  end if;

  update public.commerce_product_publications
  set is_visible=false,updated_at=now()
  where product_id=new.id and source in ('auto_owner','auto_space');

  if new.owner_type='player' and new.player_id is not null then
    insert into public.commerce_product_publications(product_id,target_type,target_player_id,placement,is_visible,source,created_by_user_id)
    values(new.id,'player',new.player_id,'merch',true,'auto_owner',new.created_by)
    on conflict (product_id,target_player_id,placement) where target_type='player'
    do update set is_visible=true,source='auto_owner',updated_at=now();
  elsif new.owner_type='user' and new.owner_user_id is not null then
    select p.id into v_player_id from public.players p where p.owner_user_id=new.owner_user_id limit 1;
    if v_player_id is not null then
      insert into public.commerce_product_publications(product_id,target_type,target_player_id,placement,is_visible,source,created_by_user_id)
      values(new.id,'player',v_player_id,'merch',true,'auto_owner',new.created_by)
      on conflict (product_id,target_player_id,placement) where target_type='player'
      do update set is_visible=true,source='auto_owner',updated_at=now();
    end if;
  elsif new.owner_type='studio' and new.studio_id is not null then
    select sp.id into v_space_id from public.spaces sp where sp.legacy_studio_id=new.studio_id limit 1;
    if v_space_id is not null then
      insert into public.commerce_product_publications(product_id,target_type,target_space_id,placement,is_visible,source,created_by_user_id)
      values(new.id,'space',v_space_id,'merch',true,'auto_owner',new.created_by)
      on conflict (product_id,target_space_id,placement) where target_type='space'
      do update set is_visible=true,source='auto_owner',updated_at=now();
    end if;
  end if;

  if new.spot_id is not null then
    select sp.id into v_space_id from public.spaces sp where sp.legacy_commerce_spot_id=new.spot_id limit 1;
    if v_space_id is not null then
      insert into public.commerce_product_publications(product_id,target_type,target_space_id,placement,is_visible,source,created_by_user_id)
      values(new.id,'space',v_space_id,'merch',true,'auto_space',new.created_by)
      on conflict (product_id,target_space_id,placement) where target_type='space'
      do update set is_visible=true,source='auto_space',updated_at=now();
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists commerce_products_sync_publications on public.commerce_products;
create trigger commerce_products_sync_publications
after insert or update of status,owner_type,player_id,studio_id,owner_user_id,spot_id
on public.commerce_products for each row execute function private.sync_product_publications();

insert into public.commerce_product_publications(product_id,target_type,target_player_id,placement,is_visible,source,created_by_user_id)
select cp.id,'player',cp.player_id,'merch',true,'auto_owner',cp.created_by
from public.commerce_products cp
where cp.status='published' and cp.owner_type='player' and cp.player_id is not null
on conflict (product_id,target_player_id,placement) where target_type='player'
do update set is_visible=true,updated_at=now();

insert into public.commerce_product_publications(product_id,target_type,target_player_id,placement,is_visible,source,created_by_user_id)
select cp.id,'player',p.id,'merch',true,'auto_owner',cp.created_by
from public.commerce_products cp
join public.players p on p.owner_user_id=cp.owner_user_id
where cp.status='published' and cp.owner_type='user' and cp.owner_user_id is not null
on conflict (product_id,target_player_id,placement) where target_type='player'
do update set is_visible=true,updated_at=now();

insert into public.commerce_product_publications(product_id,target_type,target_space_id,placement,is_visible,source,created_by_user_id)
select cp.id,'space',sp.id,'merch',true,'auto_owner',cp.created_by
from public.commerce_products cp
join public.spaces sp on sp.legacy_studio_id=cp.studio_id
where cp.status='published' and cp.owner_type='studio' and cp.studio_id is not null
on conflict (product_id,target_space_id,placement) where target_type='space'
do update set is_visible=true,updated_at=now();

insert into public.commerce_product_publications(product_id,target_type,target_space_id,placement,is_visible,source,created_by_user_id)
select cp.id,'space',sp.id,'merch',true,'auto_space',cp.created_by
from public.commerce_products cp
join public.spaces sp on sp.legacy_commerce_spot_id=cp.spot_id
where cp.status='published' and cp.spot_id is not null
on conflict (product_id,target_space_id,placement) where target_type='space'
do update set is_visible=true,updated_at=now();

create or replace function public.commerce_spot_can(p_spot_id uuid,p_user_id uuid,p_capability text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text := public.commerce_spot_role_for_user(p_spot_id,p_user_id);
begin
  if v_role is null then return false; end if;
  if p_capability='view' then return true; end if;
  if private.user_is_global_admin(p_user_id) then return true; end if;
  if not private.user_has_active_vip(p_user_id) then return false; end if;
  if v_role='owner' then return true; end if;
  if v_role='admin' then return p_capability <> 'transfer_owner'; end if;
  if v_role='manager' then return p_capability in ('operations','catalog','inventory','sales','finance','content','support','settings'); end if;
  if v_role='catalog' then return p_capability in ('catalog','content'); end if;
  if v_role='inventory' then return p_capability='inventory'; end if;
  if v_role='sales' then return p_capability in ('sales','support'); end if;
  if v_role='finance' then return p_capability='finance'; end if;
  if v_role='content' then return p_capability='content'; end if;
  if v_role='support' then return p_capability='support'; end if;
  return false;
end;
$$;

create or replace function public.can_manage_studio(p_studio_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and public.is_studio_os_active(p_studio_id)
    and (
      private.user_is_global_admin((select auth.uid()))
      or (
        private.user_has_active_vip((select auth.uid())) and (
          exists(select 1 from public.studios s where s.id=p_studio_id and s.owner_id=(select auth.uid()))
          or exists(select 1 from public.studio_members sm where sm.studio_id=p_studio_id and sm.profile_id=(select auth.uid()) and sm.status='active' and sm.role in ('owner','admin','manager','editor','finance','bookings','support'))
        )
      )
    );
$$;

create or replace function public.can_manage_studio(p_studio_id uuid,p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null
    and public.is_studio_os_active(p_studio_id)
    and (
      private.user_is_global_admin(p_user_id)
      or (
        private.user_has_active_vip(p_user_id) and (
          exists(select 1 from public.studios s where s.id=p_studio_id and s.owner_id=p_user_id)
          or exists(select 1 from public.studio_members sm where sm.studio_id=p_studio_id and sm.profile_id=p_user_id and sm.status='active' and sm.role in ('owner','admin','manager','editor','finance','bookings','support'))
        )
      )
    );
$$;

drop policy if exists commerce_spot_members_manage_team on public.commerce_spot_members;
create policy commerce_spot_members_manage_team on public.commerce_spot_members
for all to authenticated
using (public.commerce_spot_can(spot_id,(select auth.uid()),'team'))
with check (public.commerce_spot_can(spot_id,(select auth.uid()),'team'));

drop policy if exists commerce_spots_insert_owner_or_studio_manager on public.commerce_spots;
create policy commerce_spots_insert_owner_or_studio_manager on public.commerce_spots
for insert to authenticated
with check (
  public.can_administer_spaces()
  and (
    (owner_type='user' and owner_user_id=(select auth.uid()))
    or (owner_type='studio' and studio_id is not null and public.can_manage_studio(studio_id,(select auth.uid())))
  )
);

drop policy if exists commerce_spots_delete_owner on public.commerce_spots;
create policy commerce_spots_delete_owner on public.commerce_spots
for delete to authenticated
using (
  public.commerce_spot_role_for_user(id,(select auth.uid()))='owner'
  and public.commerce_spot_can(id,(select auth.uid()),'settings')
);

create or replace function public.normalize_commerce_listing_spot_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_spot public.commerce_spots%rowtype;
  v_player_id uuid;
begin
  if new.spot_id is null then return new; end if;
  select * into v_spot from public.commerce_spots where id=new.spot_id;
  if not found then return new; end if;

  if v_spot.owner_type='user' then
    select p.id into v_player_id from public.players p where p.owner_user_id=v_spot.owner_user_id limit 1;
    if v_player_id is not null then
      new.owner_type := 'player';
      new.player_id := v_player_id;
      new.owner_user_id := null;
      new.studio_id := null;
    else
      new.owner_type := 'user';
      new.owner_user_id := v_spot.owner_user_id;
      new.player_id := null;
      new.studio_id := null;
    end if;
  else
    new.owner_type := 'studio';
    new.owner_user_id := null;
    new.player_id := null;
    new.studio_id := v_spot.studio_id;
  end if;
  return new;
end;
$$;

create or replace function public.normalize_commerce_order_spot_seller()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_spot public.commerce_spots%rowtype;
  v_player_id uuid;
begin
  if new.spot_id is null then return new; end if;
  select * into v_spot from public.commerce_spots where id=new.spot_id;
  if not found then return new; end if;

  if v_spot.owner_type='user' then
    select p.id into v_player_id from public.players p where p.owner_user_id=v_spot.owner_user_id limit 1;
    if v_player_id is not null then
      new.seller_type := 'player';
      new.seller_player_id := v_player_id;
      new.seller_studio_id := null;
      new.seller_user_id := null;
    else
      new.seller_type := 'user';
      new.seller_user_id := coalesce(v_spot.beneficiary_user_id,v_spot.owner_user_id);
      new.seller_player_id := null;
      new.seller_studio_id := null;
    end if;
  else
    new.seller_type := 'studio';
    new.seller_user_id := null;
    new.seller_player_id := null;
    new.seller_studio_id := v_spot.studio_id;
  end if;
  return new;
end;
$$;

create or replace function public.create_user_commerce_spot(
  p_owner_user_id uuid,
  p_name text,
  p_country_code text default 'AR',
  p_currency text default 'ARS',
  p_business_type text default null,
  p_business_categories text[] default '{}'::text[],
  p_enabled_modules text[] default array['dashboard','catalog','inventory','scanner','sales','orders','codes','finance','settings']::text[],
  p_brand_tone text default null,
  p_description text default null,
  p_accent_color text default null,
  p_palette text[] default '{}'::text[],
  p_ai_profile jsonb default '{}'::jsonb
)
returns public.commerce_spots
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_spot public.commerce_spots%rowtype;
  v_slug text;
  v_player_id uuid;
  v_space_type text;
begin
  if p_owner_user_id is null then raise exception 'El propietario es obligatorio.'; end if;
  if nullif(btrim(p_name),'') is null then raise exception 'El nombre del espacio es obligatorio.'; end if;
  if not private.user_has_active_vip(p_owner_user_id) and not private.user_is_global_admin(p_owner_user_id) then
    raise exception 'VIP_REQUIRED: CLOUVA VIP es necesario para crear y administrar espacios.';
  end if;

  v_player_id := private.ensure_player_for_user(p_owner_user_id);
  if v_player_id is null then raise exception 'PLAYER_REQUIRED: No se pudo resolver el Player propietario.'; end if;

  v_space_type := lower(coalesce(nullif(p_ai_profile->>'spaceType',''),'business'));
  if v_space_type not in ('studio','business','spot','club','brand','other') then v_space_type := 'business'; end if;

  v_slug := trim(both '-' from regexp_replace(lower(btrim(p_name)),'[^a-z0-9]+','-','g'));
  if v_slug='' then v_slug:='space'; end if;
  v_slug := left(v_slug,48) || '-' || left(replace(gen_random_uuid()::text,'-',''),8);

  insert into public.commerce_spots(
    studio_id,owner_type,owner_user_id,beneficiary_user_id,
    slug,name,country_code,currency,public_enabled,status,created_by,
    business_type,business_categories,enabled_modules,brand_tone,
    description,accent_color,palette,ai_profile,settings
  ) values (
    null,'user',p_owner_user_id,p_owner_user_id,
    v_slug,btrim(p_name),upper(p_country_code),upper(p_currency),false,'active',p_owner_user_id,
    nullif(btrim(p_business_type),''),coalesce(p_business_categories,'{}'::text[]),
    coalesce(p_enabled_modules,array['dashboard','catalog','inventory','scanner','sales','orders','codes','finance','settings']::text[]),
    nullif(btrim(p_brand_tone),''),nullif(btrim(p_description),''),nullif(btrim(p_accent_color),''),
    coalesce(p_palette,'{}'::text[]),coalesce(p_ai_profile,'{}'::jsonb),jsonb_build_object('space_type',v_space_type,'owner_player_id',v_player_id)
  ) returning * into v_spot;

  insert into public.commerce_spot_members(spot_id,user_id,role,status)
  values(v_spot.id,p_owner_user_id,'owner','active')
  on conflict(spot_id,user_id) do update set role='owner',status='active',updated_at=now();

  insert into public.commerce_inventory_locations(spot_id,code,name,status,metadata)
  values(v_spot.id,'PRINCIPAL','Principal','active',jsonb_build_object('created_with_spot',true))
  on conflict(spot_id,code) do nothing;

  insert into public.commerce_flow_accounts(spot_id,local_currency)
  values(v_spot.id,v_spot.currency)
  on conflict(spot_id) do nothing;

  return v_spot;
end;
$$;

create or replace function public.create_studio_os_draft(
  p_user_id uuid,p_name text,p_slug text,p_city text default null,p_description text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slug text;
  v_base_slug text;
  v_suffix integer := 1;
  v_studio public.studios%rowtype;
  v_player_id uuid;
begin
  if p_user_id is null or not exists(select 1 from public.profiles where id=p_user_id) then
    raise exception 'La cuenta no tiene un perfil CLOUVA válido';
  end if;
  if not private.user_has_active_vip(p_user_id) and not private.user_is_global_admin(p_user_id) then
    raise exception 'VIP_REQUIRED: CLOUVA VIP es necesario para crear y administrar espacios.';
  end if;
  if nullif(btrim(p_name),'') is null then raise exception 'El nombre del Estudio es obligatorio'; end if;

  v_player_id := private.ensure_player_for_user(p_user_id);
  if v_player_id is null then raise exception 'PLAYER_REQUIRED: No se pudo resolver el Player propietario.'; end if;

  v_base_slug := lower(regexp_replace(coalesce(nullif(btrim(p_slug),''),btrim(p_name)),'[^a-zA-Z0-9]+','-','g'));
  v_base_slug := trim(both '-' from v_base_slug);
  if v_base_slug='' then v_base_slug:='estudio'; end if;
  v_slug:=v_base_slug;
  while exists(select 1 from public.studios where slug=v_slug) loop
    v_suffix:=v_suffix+1;
    v_slug:=v_base_slug || '-' || v_suffix::text;
  end loop;

  insert into public.studios(owner_id,name,slug,city,description,is_published,publication_status,studio_os_status)
  values(p_user_id,btrim(p_name),v_slug,nullif(btrim(p_city),''),nullif(btrim(p_description),''),false,'draft','pending')
  returning * into v_studio;

  insert into public.studio_members(studio_id,profile_id,role,status,joined_at)
  values(v_studio.id,p_user_id,'owner','active',now())
  on conflict(studio_id,profile_id) do update set role='owner',status='active',joined_at=coalesce(public.studio_members.joined_at,now());

  insert into public.player_studios(player_id,studio_id,role,area_key,area_label,is_primary,is_visible,status,joined_at)
  values(v_player_id,v_studio.id,'Fundador','direction','Dirección',false,false,'pending',now())
  on conflict(player_id,studio_id) do update set role='Fundador',area_key='direction',area_label='Dirección',status='pending',is_visible=false,left_at=null,updated_at=now();

  insert into public.studio_membership_plans(
    studio_id,name,slug,description,is_free,price,billing_interval,benefits,display_order,
    public_role_key,public_role_label,area_key,area_label,join_policy,requires_approval,display_badge,created_by
  ) values (
    v_studio.id,'Artista','artista','Sumate gratis como Artista del Estudio.',true,null,null,
    '["Aparecer como Artista del Estudio","Recibir novedades y oportunidades"]'::jsonb,0,
    'artist','Artista','artistic','Artística','automatic',false,'ARTISTA',p_user_id
  );

  insert into public.profile_modes(user_id,mode,status)
  values(p_user_id,'studio_owner','active')
  on conflict(user_id,mode) do update set status='active',activated_at=now(),updated_at=now();

  return jsonb_build_object('id',v_studio.id,'slug',v_studio.slug,'name',v_studio.name,'studioOsStatus',v_studio.studio_os_status);
end;
$$;

revoke all on function public.create_user_commerce_spot(uuid,text,text,text,text,text[],text[],text,text,text,text[],jsonb) from public,anon,authenticated;
grant execute on function public.create_user_commerce_spot(uuid,text,text,text,text,text[],text[],text,text,text,text[],jsonb) to service_role;
revoke all on function public.create_studio_os_draft(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.create_studio_os_draft(uuid,text,text,text,text) to service_role;

commit;
