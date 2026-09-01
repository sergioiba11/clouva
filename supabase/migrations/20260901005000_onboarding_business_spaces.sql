-- CLOUVA onboarding + Business/Space canonicalization.
-- Additive only: existing Studios, Commerce Spots and Space Core remain the sources
-- that already own their data. This migration adds the missing business-kind and
-- management-request semantics on top of Space Core.

begin;

-- ---------------------------------------------------------------------------
-- Player @ normalization / uniqueness
-- ---------------------------------------------------------------------------

create or replace function private.normalize_player_username()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.username is not null then
    new.username := lower(regexp_replace(btrim(new.username), '^@+', ''));
    if new.username = '' then new.username := null; end if;
  end if;
  return new;
end;
$$;

drop trigger if exists players_normalize_username on public.players;
create trigger players_normalize_username
before insert or update of username on public.players
for each row execute function private.normalize_player_username();

-- Existing exact uniqueness remains in place. The normalized expression makes
-- future lookups and DB writes case-insensitively unique as well. If historical
-- data ever contains a case-only collision, the migration must stop instead of
-- silently renaming a user's public identity.
create unique index if not exists players_username_normalized_unique
  on public.players ((lower(username)))
  where username is not null;

alter table public.players drop constraint if exists players_username_format_check;
alter table public.players
  add constraint players_username_format_check
  check (
    username is null
    or (
      username = lower(username)
      and username ~ '^[a-z0-9][a-z0-9._-]{1,28}[a-z0-9]$'
    )
  ) not valid;

-- Name + @ are one identity operation. The API performs the friendly reserved-
-- alias check; this RPC owns the atomic DB write and repeats format/uniqueness
-- checks so two concurrent requests cannot create divergent Player/Profile data.
create or replace function public.set_player_basics(
  p_user_id uuid,
  p_display_name text,
  p_username text
)
returns public.players
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player public.players%rowtype;
  v_display_name text := left(regexp_replace(btrim(coalesce(p_display_name,'')), '\s+', ' ', 'g'),160);
  v_username text := lower(regexp_replace(btrim(coalesce(p_username,'')), '^@+', ''));
begin
  if p_user_id is null then raise exception 'Usuario inválido.'; end if;
  if v_display_name = '' then raise exception 'Tu nombre público es obligatorio.'; end if;
  if v_username !~ '^[a-z0-9][a-z0-9._-]{1,28}[a-z0-9]$' then
    raise exception 'El @ tiene un formato inválido.';
  end if;

  select * into v_player
  from public.players p
  where p.owner_user_id = p_user_id
  for update;
  if not found then raise exception 'No pudimos resolver tu Player base.'; end if;

  if exists (
    select 1 from public.players p
    where lower(p.username) = v_username and p.id <> v_player.id
  ) then
    raise exception 'Ese @ ya está en uso.' using errcode = '23505';
  end if;

  if exists (
    select 1 from public.public_slug_aliases a
    where a.normalized_alias = v_username and a.entity_id <> v_player.id
  ) then
    raise exception 'Ese @ ya está en uso.' using errcode = '23505';
  end if;

  update public.players
  set display_name = v_display_name,
      username = v_username,
      updated_at = now()
  where id = v_player.id
  returning * into v_player;

  update public.profiles
  set display_name = v_display_name,
      full_name = v_display_name,
      username = v_username,
      updated_at = now()
  where id = p_user_id;

  return v_player;
end;
$$;

revoke all on function public.set_player_basics(uuid,text,text) from public,anon,authenticated;
grant execute on function public.set_player_basics(uuid,text,text) to service_role;

-- ---------------------------------------------------------------------------
-- Space business identity + activatable modules
-- ---------------------------------------------------------------------------

alter table public.spaces
  add column if not exists business_kind text,
  add column if not exists category text,
  add column if not exists subcategory text,
  add column if not exists location_label text,
  add column if not exists enabled_modules text[] not null default '{}'::text[];

alter table public.spaces drop constraint if exists spaces_business_kind_check;
alter table public.spaces
  add constraint spaces_business_kind_check
  check (business_kind is null or business_kind in ('digital_business','physical_business','studio'));

update public.spaces
set business_kind = 'studio',
    enabled_modules = case
      when cardinality(enabled_modules) = 0
        then array['studio_os','services','bookings','memberships','commerce']::text[]
      else enabled_modules
    end,
    updated_at = now()
where type = 'studio' and business_kind is null;

update public.spaces sp
set business_kind = coalesce(
      nullif(cs.settings->>'business_kind',''),
      case
        when cs.business_type in ('digital_business','physical_business') then cs.business_type
        else sp.business_kind
      end
    ),
    category = coalesce(sp.category, nullif(cs.business_categories[1],'')),
    enabled_modules = case
      when cardinality(cs.enabled_modules) > 0 then cs.enabled_modules
      else sp.enabled_modules
    end,
    updated_at = now()
from public.commerce_spots cs
where sp.legacy_commerce_spot_id = cs.id;

create index if not exists spaces_business_kind_status_idx
  on public.spaces(business_kind,status)
  where business_kind is not null;

-- ---------------------------------------------------------------------------
-- Requests to receive operational access to a Space.
-- Deliberately separate from studio_applications (artist/presentation flow) and
-- from public/paid studio_memberships.
-- ---------------------------------------------------------------------------

create table if not exists public.space_management_requests (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  requested_role text not null check (requested_role in ('partner','manager','admin','team')),
  message text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  decision_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists space_management_requests_pending_unique
  on public.space_management_requests(space_id,user_id)
  where status = 'pending';
create index if not exists space_management_requests_space_status_idx
  on public.space_management_requests(space_id,status,created_at desc);
create index if not exists space_management_requests_user_status_idx
  on public.space_management_requests(user_id,status,created_at desc);

create or replace function private.validate_space_management_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_identity_changed boolean := tg_op = 'INSERT';
begin
  if tg_op = 'UPDATE' then
    v_identity_changed := new.space_id is distinct from old.space_id
      or new.user_id is distinct from old.user_id
      or new.player_id is distinct from old.player_id;
  end if;

  if not exists (
    select 1 from public.players p
    where p.id = new.player_id and p.owner_user_id = new.user_id
  ) then
    raise exception 'La solicitud debe usar el Player base del usuario.';
  end if;

  -- These checks protect creation / identity reassignment. A review is allowed
  -- to activate membership first and then mark the same locked request approved
  -- in the same transaction without the validation trigger rejecting itself.
  if v_identity_changed then
    if exists (
      select 1 from public.spaces sp
      where sp.id = new.space_id and sp.owner_player_id = new.player_id
    ) then
      raise exception 'El propietario ya administra este espacio.';
    end if;

    if exists (
      select 1 from public.space_members sm
      where sm.space_id = new.space_id
        and sm.player_id = new.player_id
        and sm.status = 'active'
    ) then
      raise exception 'Este Player ya forma parte del equipo del espacio.';
    end if;
  end if;

  new.message := nullif(btrim(coalesce(new.message,'')), '');
  if new.message is not null then new.message := left(new.message, 2000); end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists space_management_requests_validate on public.space_management_requests;
create trigger space_management_requests_validate
before insert or update of space_id,user_id,player_id,requested_role,message,status
on public.space_management_requests
for each row execute function private.validate_space_management_request();

alter table public.space_management_requests enable row level security;
revoke insert,update,delete on public.space_management_requests from anon,authenticated;
grant select on public.space_management_requests to authenticated;

drop policy if exists space_management_requests_select_accessible on public.space_management_requests;
create policy space_management_requests_select_accessible
on public.space_management_requests
for select to authenticated
using (
  user_id = (select auth.uid())
  or private.user_is_global_admin((select auth.uid()))
  or private.space_role_for_user(space_id,(select auth.uid())) in ('owner','admin')
);

-- Review is one transaction. The request is the audit record; internal access is
-- projected to the existing legacy system when one exists, then Space Core stays
-- in sync through the already-installed membership triggers.
create or replace function public.review_space_management_request(
  p_request_id uuid,
  p_reviewer_user_id uuid,
  p_decision text,
  p_decision_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.space_management_requests%rowtype;
  v_space public.spaces%rowtype;
  v_space_role text;
  v_studio_role text;
  v_spot_role text;
  v_redirect text;
begin
  if p_reviewer_user_id is null then raise exception 'Revisor inválido.'; end if;
  if p_decision not in ('approved','rejected') then raise exception 'Decisión inválida.'; end if;

  select * into v_request
  from public.space_management_requests
  where id = p_request_id
  for update;
  if not found then raise exception 'Solicitud inexistente.'; end if;

  if not (
    private.user_is_global_admin(p_reviewer_user_id)
    or private.space_role_for_user(v_request.space_id,p_reviewer_user_id) in ('owner','admin')
  ) then
    raise exception 'No tenés permiso para revisar esta solicitud.';
  end if;

  if v_request.status <> 'pending' then
    if v_request.status = p_decision then
      select * into v_space from public.spaces where id=v_request.space_id;
      return jsonb_build_object(
        'requestId',v_request.id,
        'status',v_request.status,
        'spaceId',v_request.space_id,
        'redirectTo',case
          when v_space.legacy_studio_id is not null then '/studio-dashboard/' || v_space.legacy_studio_id::text
          when v_space.legacy_commerce_spot_id is not null then '/mi-spot/' || v_space.legacy_commerce_spot_id::text || '/team'
          else '/profile/memberships'
        end
      );
    end if;
    raise exception 'La solicitud ya fue resuelta.';
  end if;

  select * into v_space from public.spaces where id=v_request.space_id;
  if not found then raise exception 'Espacio inexistente.'; end if;

  if p_decision = 'approved' then
    v_space_role := case v_request.requested_role
      when 'partner' then 'admin'
      when 'admin' then 'admin'
      when 'manager' then 'manager'
      else 'viewer'
    end;

    insert into public.space_members(space_id,player_id,role,status,updated_at)
    values(v_request.space_id,v_request.player_id,v_space_role,'active',now())
    on conflict(space_id,player_id) do update set
      role=case when public.space_members.role='owner' then 'owner' else excluded.role end,
      status='active',updated_at=now();

    if v_space.legacy_studio_id is not null then
      v_studio_role := case v_request.requested_role
        when 'partner' then 'admin'
        when 'admin' then 'admin'
        when 'manager' then 'manager'
        else 'member'
      end;
      insert into public.studio_members(studio_id,profile_id,role,status,joined_at)
      values(v_space.legacy_studio_id,v_request.user_id,v_studio_role,'active',now())
      on conflict(studio_id,profile_id) do update set
        role=case when public.studio_members.role='owner' then 'owner' else excluded.role end,
        status='active';
    end if;

    if v_space.legacy_commerce_spot_id is not null then
      v_spot_role := case v_request.requested_role
        when 'partner' then 'admin'
        when 'admin' then 'admin'
        when 'manager' then 'manager'
        else 'viewer'
      end;
      insert into public.commerce_spot_members(spot_id,user_id,role,status,updated_at)
      values(v_space.legacy_commerce_spot_id,v_request.user_id,v_spot_role,'active',now())
      on conflict(spot_id,user_id) do update set
        role=case when public.commerce_spot_members.role='owner' then 'owner' else excluded.role end,
        status='active',updated_at=now();
    end if;
  end if;

  update public.space_management_requests
  set status=p_decision,
      reviewed_at=now(),
      reviewed_by=p_reviewer_user_id,
      decision_message=nullif(left(btrim(coalesce(p_decision_message,'')),2000),''),
      updated_at=now()
  where id=v_request.id
  returning * into v_request;

  v_redirect := case
    when v_space.legacy_studio_id is not null then '/studio-dashboard/' || v_space.legacy_studio_id::text
    when v_space.legacy_commerce_spot_id is not null then '/mi-spot/' || v_space.legacy_commerce_spot_id::text || '/team'
    else '/profile/memberships'
  end;

  return jsonb_build_object(
    'requestId',v_request.id,
    'status',v_request.status,
    'spaceId',v_request.space_id,
    'redirectTo',v_redirect
  );
end;
$$;

revoke all on function public.review_space_management_request(uuid,uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.review_space_management_request(uuid,uuid,text,text)
  to service_role;

commit;
