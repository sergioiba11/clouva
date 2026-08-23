-- Universal MI SPOT ownership and permissions.
-- Studio remains a supported Spot owner, but a normal CLOUVA user can own a
-- commercial Spot directly without creating a Player or Studio.

begin;

alter table public.commerce_spots
  alter column studio_id drop not null,
  add column if not exists owner_type text,
  add column if not exists owner_user_id uuid,
  add column if not exists beneficiary_user_id uuid,
  add column if not exists business_type text,
  add column if not exists business_categories text[] not null default '{}'::text[],
  add column if not exists enabled_modules text[] not null default array['dashboard','catalog','inventory','scanner','sales','orders','codes','finance','settings']::text[],
  add column if not exists brand_tone text,
  add column if not exists description text,
  add column if not exists logo_url text,
  add column if not exists cover_url text,
  add column if not exists accent_color text,
  add column if not exists palette text[] not null default '{}'::text[],
  add column if not exists ai_profile jsonb not null default '{}'::jsonb,
  add column if not exists settings jsonb not null default '{}'::jsonb;

update public.commerce_spots
set owner_type = 'studio'
where owner_type is null and studio_id is not null;

update public.commerce_spots spot
set beneficiary_user_id = studio.owner_id
from public.studios studio
where spot.owner_type = 'studio'
  and spot.studio_id = studio.id
  and spot.beneficiary_user_id is null;

alter table public.commerce_spots
  alter column owner_type set not null,
  alter column owner_type set default 'studio';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'commerce_spots_owner_user_id_fkey'
      and conrelid = 'public.commerce_spots'::regclass
  ) then
    alter table public.commerce_spots
      add constraint commerce_spots_owner_user_id_fkey
      foreign key (owner_user_id) references auth.users(id) on delete cascade;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'commerce_spots_beneficiary_user_id_fkey'
      and conrelid = 'public.commerce_spots'::regclass
  ) then
    alter table public.commerce_spots
      add constraint commerce_spots_beneficiary_user_id_fkey
      foreign key (beneficiary_user_id) references auth.users(id) on delete set null;
  end if;
end
$$;

alter table public.commerce_spots drop constraint if exists commerce_spots_owner_type_check;
alter table public.commerce_spots
  add constraint commerce_spots_owner_type_check
  check (owner_type in ('user', 'studio'));

alter table public.commerce_spots drop constraint if exists commerce_spots_owner_shape;
alter table public.commerce_spots
  add constraint commerce_spots_owner_shape check (
    (owner_type = 'user' and owner_user_id is not null and studio_id is null)
    or
    (owner_type = 'studio' and studio_id is not null and owner_user_id is null)
  );

create unique index if not exists commerce_spots_user_slug_unique
  on public.commerce_spots(owner_user_id, slug)
  where owner_type = 'user' and owner_user_id is not null;
create index if not exists commerce_spots_owner_user_idx
  on public.commerce_spots(owner_user_id)
  where owner_user_id is not null;
create index if not exists commerce_spots_beneficiary_idx
  on public.commerce_spots(beneficiary_user_id)
  where beneficiary_user_id is not null;

create table if not exists public.commerce_spot_members (
  id uuid primary key default gen_random_uuid(),
  spot_id uuid not null references public.commerce_spots(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in (
    'owner', 'admin', 'manager', 'catalog', 'inventory', 'sales',
    'finance', 'content', 'support', 'viewer'
  )),
  status text not null default 'active' check (status in ('active', 'invited', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commerce_spot_members_spot_user_unique unique (spot_id, user_id)
);

create index if not exists commerce_spot_members_user_idx
  on public.commerce_spot_members(user_id, status);
create index if not exists commerce_spot_members_spot_role_idx
  on public.commerce_spot_members(spot_id, role, status);

insert into public.commerce_spot_members(spot_id, user_id, role, status)
select spot.id, studio.owner_id, 'owner', 'active'
from public.commerce_spots spot
join public.studios studio on studio.id = spot.studio_id
where spot.owner_type = 'studio' and studio.owner_id is not null
on conflict (spot_id, user_id) do update set role = 'owner', status = 'active', updated_at = now();

create or replace function public.commerce_spot_role_for_user(p_spot_id uuid, p_user_id uuid)
returns text
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_spot public.commerce_spots%rowtype;
  v_role text;
begin
  if p_spot_id is null or p_user_id is null then return null; end if;

  if exists (
    select 1 from public.profiles profile
    where profile.id = p_user_id and profile.role::text = 'admin'
  ) then
    return 'admin';
  end if;

  select * into v_spot from public.commerce_spots where id = p_spot_id;
  if not found then return null; end if;

  if v_spot.owner_type = 'user' and v_spot.owner_user_id = p_user_id then
    return 'owner';
  end if;

  select member.role into v_role
  from public.commerce_spot_members member
  where member.spot_id = p_spot_id
    and member.user_id = p_user_id
    and member.status = 'active'
  limit 1;
  if v_role is not null then return v_role; end if;

  if v_spot.owner_type = 'studio' and v_spot.studio_id is not null then
    if exists (
      select 1 from public.studios studio
      where studio.id = v_spot.studio_id and studio.owner_id = p_user_id
    ) then
      return 'owner';
    end if;

    select case member.role
      when 'owner' then 'owner'
      when 'admin' then 'admin'
      when 'manager' then 'manager'
      when 'editor' then 'catalog'
      when 'finance' then 'finance'
      when 'bookings' then 'sales'
      when 'support' then 'support'
      else 'viewer'
    end
    into v_role
    from public.studio_members member
    where member.studio_id = v_spot.studio_id
      and member.profile_id = p_user_id
      and member.status = 'active'
    limit 1;
  end if;

  return v_role;
end;
$$;

create or replace function public.commerce_spot_can(p_spot_id uuid, p_user_id uuid, p_capability text)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_role text := public.commerce_spot_role_for_user(p_spot_id, p_user_id);
begin
  if v_role is null then return false; end if;
  if v_role = 'owner' then return true; end if;
  if v_role = 'admin' then return p_capability <> 'transfer_owner'; end if;
  if v_role = 'manager' then return p_capability in ('view','operations','catalog','inventory','sales','finance','content','support','settings'); end if;
  if v_role = 'catalog' then return p_capability in ('view','catalog','content'); end if;
  if v_role = 'inventory' then return p_capability in ('view','inventory'); end if;
  if v_role = 'sales' then return p_capability in ('view','sales','support'); end if;
  if v_role = 'finance' then return p_capability in ('view','finance'); end if;
  if v_role = 'content' then return p_capability in ('view','content'); end if;
  if v_role = 'support' then return p_capability in ('view','support'); end if;
  if v_role = 'viewer' then return p_capability = 'view'; end if;
  return false;
end;
$$;

revoke all on function public.commerce_spot_role_for_user(uuid, uuid) from public;
revoke all on function public.commerce_spot_can(uuid, uuid, text) from public;
grant execute on function public.commerce_spot_role_for_user(uuid, uuid) to authenticated, service_role;
grant execute on function public.commerce_spot_can(uuid, uuid, text) to authenticated, service_role;

alter table public.commerce_spot_members enable row level security;

drop policy if exists commerce_spot_members_select_accessible on public.commerce_spot_members;
create policy commerce_spot_members_select_accessible on public.commerce_spot_members
  for select using (
    user_id = auth.uid()
    or public.commerce_spot_can(spot_id, auth.uid(), 'settings')
  );

drop policy if exists commerce_spot_members_manage_team on public.commerce_spot_members;
create policy commerce_spot_members_manage_team on public.commerce_spot_members
  for all using (
    public.commerce_spot_role_for_user(spot_id, auth.uid()) in ('owner', 'admin')
  ) with check (
    public.commerce_spot_role_for_user(spot_id, auth.uid()) in ('owner', 'admin')
  );

alter table public.commerce_spots enable row level security;
drop policy if exists commerce_spots_select_public_or_manager on public.commerce_spots;
create policy commerce_spots_select_public_or_member on public.commerce_spots
  for select using (
    (status = 'active' and public_enabled = true)
    or public.commerce_spot_role_for_user(id, auth.uid()) is not null
  );

drop policy if exists commerce_spots_insert_manager on public.commerce_spots;
create policy commerce_spots_insert_owner_or_studio_manager on public.commerce_spots
  for insert with check (
    (owner_type = 'user' and owner_user_id = auth.uid())
    or (owner_type = 'studio' and studio_id is not null and public.can_manage_studio(studio_id, auth.uid()))
  );

drop policy if exists commerce_spots_update_manager on public.commerce_spots;
create policy commerce_spots_update_member on public.commerce_spots
  for update using (
    public.commerce_spot_can(id, auth.uid(), 'settings')
  ) with check (
    public.commerce_spot_can(id, auth.uid(), 'settings')
  );

drop policy if exists commerce_spots_delete_manager on public.commerce_spots;
create policy commerce_spots_delete_owner on public.commerce_spots
  for delete using (
    public.commerce_spot_role_for_user(id, auth.uid()) = 'owner'
  );

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
set search_path = public
as $$
declare
  v_spot public.commerce_spots%rowtype;
  v_slug text;
begin
  if p_owner_user_id is null then raise exception 'El propietario es obligatorio.'; end if;
  if nullif(btrim(p_name), '') is null then raise exception 'El nombre del Spot es obligatorio.'; end if;

  v_slug := trim(both '-' from regexp_replace(lower(btrim(p_name)), '[^a-z0-9]+', '-', 'g'));
  if v_slug = '' then v_slug := 'spot'; end if;
  v_slug := left(v_slug, 48) || '-' || left(replace(gen_random_uuid()::text, '-', ''), 8);

  insert into public.commerce_spots(
    studio_id, owner_type, owner_user_id, beneficiary_user_id,
    slug, name, country_code, currency, public_enabled, status, created_by,
    business_type, business_categories, enabled_modules, brand_tone,
    description, accent_color, palette, ai_profile
  ) values (
    null, 'user', p_owner_user_id, p_owner_user_id,
    v_slug, btrim(p_name), upper(p_country_code), upper(p_currency), false, 'active', p_owner_user_id,
    nullif(btrim(p_business_type), ''), coalesce(p_business_categories, '{}'::text[]),
    coalesce(p_enabled_modules, array['dashboard','catalog','inventory','scanner','sales','orders','codes','finance','settings']::text[]),
    nullif(btrim(p_brand_tone), ''), nullif(btrim(p_description), ''), nullif(btrim(p_accent_color), ''),
    coalesce(p_palette, '{}'::text[]), coalesce(p_ai_profile, '{}'::jsonb)
  ) returning * into v_spot;

  insert into public.commerce_spot_members(spot_id, user_id, role, status)
  values (v_spot.id, p_owner_user_id, 'owner', 'active')
  on conflict (spot_id, user_id) do update set role = 'owner', status = 'active', updated_at = now();

  insert into public.commerce_inventory_locations(spot_id, code, name, status, metadata)
  values (v_spot.id, 'PRINCIPAL', 'Principal', 'active', jsonb_build_object('created_with_spot', true))
  on conflict (spot_id, code) do nothing;

  insert into public.commerce_flow_accounts(spot_id, local_currency)
  values (v_spot.id, v_spot.currency)
  on conflict (spot_id) do nothing;

  return v_spot;
end;
$$;

revoke all on function public.create_user_commerce_spot(uuid, text, text, text, text, text[], text[], text, text, text, text[], jsonb)
  from public, anon, authenticated;
grant execute on function public.create_user_commerce_spot(uuid, text, text, text, text, text[], text[], text, text, text, text[], jsonb)
  to service_role;

-- Allow Spot-owned listings without pretending the owner is a Studio.
alter table public.commerce_products add column if not exists owner_user_id uuid;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'commerce_products_owner_user_id_fkey'
      and conrelid = 'public.commerce_products'::regclass
  ) then
    alter table public.commerce_products
      add constraint commerce_products_owner_user_id_fkey
      foreign key (owner_user_id) references auth.users(id) on delete set null;
  end if;
end
$$;

alter table public.commerce_products drop constraint if exists commerce_products_owner_type_check;
alter table public.commerce_products
  add constraint commerce_products_owner_type_check
  check (owner_type in ('player', 'studio', 'user', 'clouva'));
alter table public.commerce_products drop constraint if exists commerce_products_owner_shape;
alter table public.commerce_products
  add constraint commerce_products_owner_shape check (
    (owner_type = 'player' and player_id is not null and studio_id is null and owner_user_id is null)
    or (owner_type = 'studio' and studio_id is not null and player_id is null and owner_user_id is null)
    or (owner_type = 'user' and owner_user_id is not null and player_id is null and studio_id is null)
    or (owner_type = 'clouva' and player_id is null and studio_id is null and owner_user_id is null)
  );

create or replace function public.normalize_commerce_listing_spot_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_spot public.commerce_spots%rowtype;
begin
  if new.spot_id is null then return new; end if;
  select * into v_spot from public.commerce_spots where id = new.spot_id;
  if not found then return new; end if;

  if v_spot.owner_type = 'user' then
    new.owner_type := 'user';
    new.owner_user_id := v_spot.owner_user_id;
    new.player_id := null;
    new.studio_id := null;
  else
    new.owner_type := 'studio';
    new.owner_user_id := null;
    new.player_id := null;
    new.studio_id := v_spot.studio_id;
  end if;
  return new;
end;
$$;

drop trigger if exists commerce_products_normalize_spot_owner on public.commerce_products;
create trigger commerce_products_normalize_spot_owner
  before insert or update of spot_id, owner_type, studio_id, player_id, owner_user_id
  on public.commerce_products
  for each row execute function public.normalize_commerce_listing_spot_owner();

-- Existing scanner RPCs still insert Studio-shaped listings; the trigger above
-- normalizes them atomically for user-owned Spots before constraints run.

drop policy if exists commerce_products_select_published_or_owner on public.commerce_products;
create policy commerce_products_select_published_or_owner on public.commerce_products
  for select using (
    status = 'published'
    or created_by = auth.uid()
    or (owner_type = 'user' and owner_user_id = auth.uid())
    or (spot_id is not null and public.commerce_spot_role_for_user(spot_id, auth.uid()) is not null)
    or (owner_type = 'player' and exists (select 1 from public.players p where p.id = player_id and p.owner_user_id = auth.uid()))
    or (owner_type = 'player' and exists (select 1 from public.player_members m where m.player_id = player_id and m.user_id = auth.uid() and m.status = 'active' and m.role in ('owner','manager','editor')))
    or (owner_type = 'studio' and exists (select 1 from public.studios s where s.id = studio_id and s.owner_id = auth.uid()))
    or (owner_type = 'studio' and exists (select 1 from public.studio_members m where m.studio_id = studio_id and m.profile_id = auth.uid() and m.status = 'active' and m.role in ('owner','admin','manager','editor')))
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text = 'admin')
  );

drop policy if exists commerce_products_write_owner_or_admin on public.commerce_products;
create policy commerce_products_write_owner_or_admin on public.commerce_products
  for all using (
    (owner_type = 'user' and owner_user_id = auth.uid())
    or (spot_id is not null and public.commerce_spot_can(spot_id, auth.uid(), 'catalog'))
    or (owner_type = 'player' and exists (select 1 from public.players p where p.id = player_id and p.owner_user_id = auth.uid()))
    or (owner_type = 'player' and exists (select 1 from public.player_members m where m.player_id = player_id and m.user_id = auth.uid() and m.status = 'active' and m.role in ('owner','manager','editor')))
    or (owner_type = 'studio' and exists (select 1 from public.studios s where s.id = studio_id and s.owner_id = auth.uid()))
    or (owner_type = 'studio' and exists (select 1 from public.studio_members m where m.studio_id = studio_id and m.profile_id = auth.uid() and m.status = 'active' and m.role in ('owner','admin','manager','editor')))
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text = 'admin')
  ) with check (
    (owner_type = 'user' and owner_user_id = auth.uid())
    or (spot_id is not null and public.commerce_spot_can(spot_id, auth.uid(), 'catalog'))
    or (owner_type = 'player' and exists (select 1 from public.players p where p.id = player_id and p.owner_user_id = auth.uid()))
    or (owner_type = 'player' and exists (select 1 from public.player_members m where m.player_id = player_id and m.user_id = auth.uid() and m.status = 'active' and m.role in ('owner','manager','editor')))
    or (owner_type = 'studio' and exists (select 1 from public.studios s where s.id = studio_id and s.owner_id = auth.uid()))
    or (owner_type = 'studio' and exists (select 1 from public.studio_members m where m.studio_id = studio_id and m.profile_id = auth.uid() and m.status = 'active' and m.role in ('owner','admin','manager','editor')))
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text = 'admin')
  );

-- Orders gain a first-class user seller. A BEFORE trigger makes the existing
-- Spot POS/order RPCs ownership-agnostic without cloning their commerce logic.
alter table public.commerce_orders add column if not exists seller_user_id uuid;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'commerce_orders_seller_user_id_fkey'
      and conrelid = 'public.commerce_orders'::regclass
  ) then
    alter table public.commerce_orders
      add constraint commerce_orders_seller_user_id_fkey
      foreign key (seller_user_id) references auth.users(id) on delete set null;
  end if;
end
$$;

alter table public.commerce_orders drop constraint if exists commerce_orders_seller_type_check;
alter table public.commerce_orders
  add constraint commerce_orders_seller_type_check
  check (seller_type in ('player', 'studio', 'user', 'clouva'));

alter table public.commerce_orders drop constraint if exists commerce_orders_seller_shape;
alter table public.commerce_orders
  add constraint commerce_orders_seller_shape check (
    (seller_type = 'player' and seller_player_id is not null and seller_studio_id is null and seller_user_id is null)
    or (seller_type = 'studio' and seller_studio_id is not null and seller_player_id is null and seller_user_id is null)
    or (seller_type = 'user' and seller_user_id is not null and seller_player_id is null and seller_studio_id is null)
    or (seller_type = 'clouva' and seller_player_id is null and seller_studio_id is null and seller_user_id is null)
  );

create or replace function public.normalize_commerce_order_spot_seller()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_spot public.commerce_spots%rowtype;
begin
  if new.spot_id is null then return new; end if;
  select * into v_spot from public.commerce_spots where id = new.spot_id;
  if not found then return new; end if;

  if v_spot.owner_type = 'user' then
    new.seller_type := 'user';
    new.seller_user_id := coalesce(v_spot.beneficiary_user_id, v_spot.owner_user_id);
    new.seller_player_id := null;
    new.seller_studio_id := null;
  else
    new.seller_type := 'studio';
    new.seller_user_id := null;
    new.seller_player_id := null;
    new.seller_studio_id := v_spot.studio_id;
  end if;
  return new;
end;
$$;

drop trigger if exists commerce_orders_normalize_spot_seller on public.commerce_orders;
create trigger commerce_orders_normalize_spot_seller
  before insert or update of spot_id, seller_type, seller_player_id, seller_studio_id, seller_user_id
  on public.commerce_orders
  for each row execute function public.normalize_commerce_order_spot_seller();

drop policy if exists commerce_orders_select_buyer_seller_or_admin on public.commerce_orders;
create policy commerce_orders_select_buyer_seller_or_admin on public.commerce_orders
  for select using (
    buyer_id = auth.uid()
    or (seller_type = 'user' and seller_user_id = auth.uid())
    or (spot_id is not null and public.commerce_spot_role_for_user(spot_id, auth.uid()) is not null)
    or (seller_type = 'player' and exists (select 1 from public.players p where p.id = seller_player_id and p.owner_user_id = auth.uid()))
    or (seller_type = 'player' and exists (select 1 from public.player_members m where m.player_id = seller_player_id and m.user_id = auth.uid() and m.status = 'active' and m.role in ('owner','manager')))
    or (seller_type = 'studio' and exists (select 1 from public.studios s where s.id = seller_studio_id and s.owner_id = auth.uid()))
    or (seller_type = 'studio' and exists (select 1 from public.studio_members m where m.studio_id = seller_studio_id and m.profile_id = auth.uid() and m.status = 'active' and m.role in ('owner','admin','manager')))
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text = 'admin')
  );

-- MI FLOW accepts direct user-owned Spot beneficiaries as a third canonical
-- beneficiary type while preserving Player and Studio events.
alter table public.mi_flow_money_ledger drop constraint if exists mi_flow_money_ledger_beneficiary_type_check;
alter table public.mi_flow_money_ledger
  add constraint mi_flow_money_ledger_beneficiary_type_check
  check (beneficiary_type in ('user', 'player', 'studio'));

create or replace function public.sync_commerce_order_to_mi_flow()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_entity_type text;
  v_entity_id uuid;
  v_event_status text;
  v_subtotal numeric;
  v_commission numeric;
begin
  if new.payment_status not in ('paid', 'refunded') then return new; end if;
  if new.seller_type = 'clouva' then return new; end if;

  if new.seller_type = 'user' and new.seller_user_id is not null then
    select coalesce(spot.beneficiary_user_id, new.seller_user_id)
      into v_user_id
    from public.commerce_spots spot
    where spot.id = new.spot_id;
    v_user_id := coalesce(v_user_id, new.seller_user_id);
    v_entity_type := 'user';
    v_entity_id := v_user_id;
  elsif new.seller_type = 'player' and new.seller_player_id is not null then
    select player.owner_user_id into v_user_id
    from public.players player where player.id = new.seller_player_id;
    v_entity_type := 'player';
    v_entity_id := new.seller_player_id;
  elsif new.seller_type = 'studio' and new.seller_studio_id is not null then
    select coalesce(spot.beneficiary_user_id, studio.owner_id)
      into v_user_id
    from public.studios studio
    left join public.commerce_spots spot on spot.id = new.spot_id
    where studio.id = new.seller_studio_id;
    v_entity_type := 'studio';
    v_entity_id := new.seller_studio_id;
  end if;

  if v_user_id is null or v_entity_id is null then return new; end if;

  v_event_status := case when new.payment_status = 'refunded' then 'refunded' else 'paid' end;
  v_subtotal := coalesce(new.subtotal, 0);
  v_commission := greatest(coalesce(new.commission, 0), 0);

  perform public.upsert_mi_flow_money_event(
    v_user_id, v_entity_type, v_entity_id, coalesce(new.currency, 'ARS'),
    'commerce_order', new.id,
    round(v_subtotal * 100)::bigint,
    round(greatest(coalesce(new.fees, 0), 0) * 100)::bigint,
    round(v_commission * 100)::bigint,
    round(greatest(v_subtotal - v_commission, 0) * 100)::bigint,
    v_event_status, coalesce(new.paid_at, now()),
    jsonb_build_object('seller_type', new.seller_type, 'spot_id', new.spot_id, 'order_total', new.total)
  );
  return new;
end;
$$;

-- Keep timestamps deterministic for member/settings edits.
create or replace function public.touch_commerce_spot_member_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end
$$;
drop trigger if exists commerce_spot_members_touch_updated_at on public.commerce_spot_members;
create trigger commerce_spot_members_touch_updated_at
  before update on public.commerce_spot_members
  for each row execute function public.touch_commerce_spot_member_updated_at();

commit;
