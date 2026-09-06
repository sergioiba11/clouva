-- FLOW QR payment hardening layered on top of the canonical transfer engine.
-- A transfer must still have reserve custody at the exact moment the asset moves.

create or replace function public.guard_flow_transfer_current_backing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.action <> 'transferred' then
    return new;
  end if;

  if new.flow_asset_id is null or new.from_user_id is null or new.to_user_id is null then
    raise exception 'La transferencia FLOW no tiene provenance completa.';
  end if;

  if not exists (
    select 1
    from public.flow_backing_allocations b
    join public.flow_reserve_accounts r on r.id = b.reserve_account_id
    join public.flow_funding_ledger f on f.id = b.funding_entry_id
    join public.flow_issuance_settings s on s.id = 'canonical'
    where b.flow_asset_id = new.flow_asset_id
      and b.status = 'active'
      and abs(b.reference_usd_value - s.flow_usd_value) <= 0.000001
      and r.flow_account_role = 'reserve'
      and r.authorized_for_flow
      and r.is_active
      and r.status = 'active'
      and r.account_reference is not null
      and f.reserve_account_id = r.id
      and f.status = 'confirmed'
      and f.custody_status = 'confirmed'
      and f.custody_stage in ('reserve_confirmed', 'allocated')
      and f.entry_type = 'reserve_deposit'
      and coalesce(f.reference_usd_amount, 0) > 0
  ) then
    raise exception 'El FLOW perdió respaldo o custodia de Reserva CLOUVA antes de transferirse.';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_flow_transfer_current_backing() from public, anon, authenticated;
grant execute on function public.guard_flow_transfer_current_backing() to service_role;

drop trigger if exists flow_asset_movements_current_backing_guard on public.flow_asset_movements;
create trigger flow_asset_movements_current_backing_guard
before insert on public.flow_asset_movements
for each row
when (new.action = 'transferred')
execute function public.guard_flow_transfer_current_backing();

-- The orchestration functions are SECURITY DEFINER and service-role only.
-- Keep their lookup path immutable; all application objects inside are schema-qualified.
alter function public.execute_flow_qr_transfer(uuid,text,integer,uuid,uuid) set search_path = '';
alter function public.complete_commerce_flow_qr_sale(uuid,text,uuid,uuid,integer,uuid,uuid,uuid,text,text) set search_path = '';
