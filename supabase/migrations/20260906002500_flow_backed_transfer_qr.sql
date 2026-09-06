alter table public.flows_wallet_ledger drop constraint if exists flows_wallet_ledger_transaction_type_check;
alter table public.flows_wallet_ledger add constraint flows_wallet_ledger_transaction_type_check
  check (transaction_type in (
    'purchase','reward','refund','ai_usage','avatar_purchase','marketplace_purchase',
    'admin_adjustment','promotional_credit','transfer_out','transfer_in'
  ));

create unique index if not exists flows_wallet_ledger_transfer_reference_unique
  on public.flows_wallet_ledger(transaction_type, reference_id)
  where transaction_type in ('transfer_out','transfer_in') and reference_id is not null;

create or replace function public.adjust_flows_balance(
  p_user_id uuid,
  p_amount integer,
  p_transaction_type text,
  p_source text default null,
  p_reference_id text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_created_by uuid default null
)
returns public.flows_wallet_ledger
language plpgsql
security definer
set search_path='public'
as $$
declare
  v_balance integer;
  v_new integer;
  v_row public.flows_wallet_ledger%rowtype;
  v_op public.flow_purchase_operations%rowtype;
  v_backed_count integer;
  v_transfer_id uuid;
begin
  if p_amount>0 then
    if p_transaction_type='purchase' then
      if p_reference_id is null then
        raise exception 'Los créditos positivos de FLOWS requieren una operación económica confirmada.';
      end if;

      begin
        select * into v_op from public.flow_purchase_operations where id=p_reference_id::uuid;
      exception when invalid_text_representation then
        raise exception 'Referencia económica de FLOW inválida.';
      end;

      if not found
         or v_op.recipient_user_id<>p_user_id
         or v_op.status<>'confirmed'
         or v_op.backing_status<>'verified'
         or v_op.issued_at is null
         or v_op.quantity<>p_amount then
        raise exception 'La emisión no tiene respaldo económico y de custodia confirmado.';
      end if;

      select count(distinct a.id)::integer into v_backed_count
      from public.flow_assets a
      join public.flow_backing_allocations b on b.flow_asset_id=a.id and b.status='active'
      join public.flow_reserve_accounts r on r.id=b.reserve_account_id
        and r.is_active and r.status='active' and r.authorized_for_flow and r.account_reference is not null
      join public.flow_funding_ledger f on f.id=b.funding_entry_id
        and f.reserve_account_id=r.id and f.status='confirmed' and f.custody_status='confirmed'
        and f.entry_type in ('funding','reserve_deposit') and coalesce(f.reference_usd_amount,0)>0
      where a.backing_operation_id=v_op.id
        and a.owner_user_id=p_user_id
        and a.status in ('available','activated','transferred');

      if v_backed_count<>p_amount then
        raise exception 'La wallet no puede acreditarse sin un respaldo 1:1 por FLOW en una cuenta autorizada.';
      end if;
    elsif p_transaction_type='transfer_in' then
      if p_source is distinct from 'flow_transfer' or p_reference_id is null then
        raise exception 'Un crédito por transferencia requiere la transferencia canónica de FLOW.';
      end if;
      begin
        v_transfer_id:=p_reference_id::uuid;
      exception when invalid_text_representation then
        raise exception 'Referencia de transferencia FLOW inválida.';
      end;

      select count(distinct a.id)::integer into v_backed_count
      from public.flow_asset_movements m
      join public.flow_assets a on a.id=m.flow_asset_id
      join public.flow_backing_allocations b on b.flow_asset_id=a.id and b.status='active'
      join public.flow_reserve_accounts r on r.id=b.reserve_account_id
        and r.is_active and r.status='active' and r.authorized_for_flow and r.account_reference is not null
      join public.flow_funding_ledger f on f.id=b.funding_entry_id
        and f.reserve_account_id=r.id and f.status='confirmed' and f.custody_status='confirmed'
        and f.entry_type in ('funding','reserve_deposit') and coalesce(f.reference_usd_amount,0)>0
      where m.action='transferred'
        and m.to_user_id=p_user_id
        and m.metadata->>'transferId'=v_transfer_id::text
        and a.owner_user_id=p_user_id
        and a.status='transferred';

      if v_backed_count<>p_amount then
        raise exception 'El crédito de transferencia no coincide con FLOWS respaldados transferidos.';
      end if;
    else
      raise exception 'Los créditos positivos de FLOWS requieren emisión o transferencia respaldada.';
    end if;

    if exists (
      select 1 from public.flow_reserve_accounts r
      where r.authorized_for_flow and r.is_active and r.status='active'
        and public.flow_reserve_account_free_usd(r.id)<-0.000001
    ) then
      raise exception 'La reserva quedaría sobreasignada.';
    end if;
  elsif p_amount<0 and p_transaction_type='transfer_out' then
    if p_source is distinct from 'flow_transfer' or p_reference_id is null then
      raise exception 'Un débito por transferencia requiere la transferencia canónica de FLOW.';
    end if;
    begin
      v_transfer_id:=p_reference_id::uuid;
    exception when invalid_text_representation then
      raise exception 'Referencia de transferencia FLOW inválida.';
    end;

    select count(distinct a.id)::integer into v_backed_count
    from public.flow_asset_movements m
    join public.flow_assets a on a.id=m.flow_asset_id
    join public.flow_backing_allocations b on b.flow_asset_id=a.id and b.status='active'
    join public.flow_reserve_accounts r on r.id=b.reserve_account_id
      and r.is_active and r.status='active' and r.authorized_for_flow and r.account_reference is not null
    join public.flow_funding_ledger f on f.id=b.funding_entry_id
      and f.reserve_account_id=r.id and f.status='confirmed' and f.custody_status='confirmed'
      and f.entry_type in ('funding','reserve_deposit') and coalesce(f.reference_usd_amount,0)>0
    where m.action='transferred'
      and m.from_user_id=p_user_id
      and m.metadata->>'transferId'=v_transfer_id::text;

    if v_backed_count<>abs(p_amount) then
      raise exception 'El débito de transferencia no coincide con FLOWS respaldados transferidos.';
    end if;
  end if;

  insert into public.flows_wallets(user_id,balance) values(p_user_id,0) on conflict(user_id) do nothing;
  select balance into v_balance from public.flows_wallets where user_id=p_user_id for update;
  v_new:=v_balance+p_amount;
  if v_new<0 then raise exception 'Saldo de Flows insuficiente.'; end if;
  update public.flows_wallets set balance=v_new,updated_at=now() where user_id=p_user_id;
  insert into public.flows_wallet_ledger(user_id,transaction_type,amount,balance_after,source,reference_id,metadata,created_by)
  values(p_user_id,p_transaction_type,p_amount,v_new,p_source,p_reference_id,coalesce(p_metadata,'{}'::jsonb),p_created_by)
  returning * into v_row;
  return v_row;
end $$;

revoke all on function public.adjust_flows_balance(uuid,integer,text,text,text,jsonb,uuid) from public, anon, authenticated;
grant execute on function public.adjust_flows_balance(uuid,integer,text,text,text,jsonb,uuid) to service_role;

create or replace function public.transfer_backed_flows(
  p_sender_user_id uuid,
  p_recipient_user_id uuid,
  p_quantity integer,
  p_transfer_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $$
declare
  v_sender_player_id uuid;
  v_recipient_player_id uuid;
  v_sender_balance integer;
  v_recipient_balance integer;
  v_sender_backed integer;
  v_recipient_backed integer;
  v_existing_out public.flows_wallet_ledger%rowtype;
  v_existing_in public.flows_wallet_ledger%rowtype;
  v_out_exists boolean:=false;
  v_in_exists boolean:=false;
  v_moved integer:=0;
  v_flow_numbers jsonb:='[]'::jsonb;
  r_asset record;
begin
  if p_sender_user_id is null or p_recipient_user_id is null or p_actor_id is null or p_transfer_id is null then
    raise exception 'La transferencia FLOW está incompleta.';
  end if;
  if p_actor_id<>p_sender_user_id then raise exception 'El actor no puede transferir FLOWS de otro Player.'; end if;
  if p_sender_user_id=p_recipient_user_id then raise exception 'No podés pagarte FLOWS a vos mismo.'; end if;
  if p_quantity is null or p_quantity<1 or p_quantity>50 then raise exception 'La cantidad de FLOW debe estar entre 1 y 50.'; end if;

  perform pg_advisory_xact_lock(hashtextextended('flow-transfer:'||p_transfer_id::text,0));

  select id into v_sender_player_id
  from public.players
  where owner_user_id=p_sender_user_id
  order by created_at,id
  limit 1;
  if v_sender_player_id is null then raise exception 'El pagador no tiene un Player asociado.'; end if;

  select id into v_recipient_player_id
  from public.players
  where owner_user_id=p_recipient_user_id
  order by created_at,id
  limit 1;
  if v_recipient_player_id is null then raise exception 'El receptor no tiene un Player asociado.'; end if;

  insert into public.flows_wallets(user_id,balance) values(p_sender_user_id,0) on conflict(user_id) do nothing;
  insert into public.flows_wallets(user_id,balance) values(p_recipient_user_id,0) on conflict(user_id) do nothing;
  perform 1 from public.flows_wallets where user_id in(p_sender_user_id,p_recipient_user_id) order by user_id for update;

  select * into v_existing_out
  from public.flows_wallet_ledger
  where transaction_type='transfer_out' and reference_id=p_transfer_id::text
  limit 1;
  v_out_exists:=found;

  select * into v_existing_in
  from public.flows_wallet_ledger
  where transaction_type='transfer_in' and reference_id=p_transfer_id::text
  limit 1;
  v_in_exists:=found;

  if v_out_exists or v_in_exists then
    if not (v_out_exists and v_in_exists) then raise exception 'Transferencia FLOW parcialmente registrada; requiere reconciliación.'; end if;
    if v_existing_out.user_id<>p_sender_user_id
       or v_existing_in.user_id<>p_recipient_user_id
       or v_existing_out.amount<>-p_quantity
       or v_existing_in.amount<>p_quantity then
      raise exception 'El id de transferencia ya pertenece a otra operación.';
    end if;
    select coalesce(jsonb_agg(a.flow_number order by a.flow_number),'[]'::jsonb) into v_flow_numbers
    from public.flow_asset_movements m
    join public.flow_assets a on a.id=m.flow_asset_id
    where m.action='transferred' and m.metadata->>'transferId'=p_transfer_id::text;
    return jsonb_build_object(
      'transferId',p_transfer_id,'quantity',p_quantity,'duplicate',true,
      'senderUserId',p_sender_user_id,'recipientUserId',p_recipient_user_id,
      'flowNumbers',v_flow_numbers
    );
  end if;

  select balance into v_sender_balance from public.flows_wallets where user_id=p_sender_user_id;
  select balance into v_recipient_balance from public.flows_wallets where user_id=p_recipient_user_id;

  select count(distinct a.id)::integer into v_sender_backed
  from public.flow_assets a
  join public.flow_backing_allocations b on b.flow_asset_id=a.id and b.status='active'
  join public.flow_reserve_accounts r on r.id=b.reserve_account_id
    and r.authorized_for_flow and r.is_active and r.status='active' and r.account_reference is not null
  join public.flow_funding_ledger f on f.id=b.funding_entry_id
    and f.reserve_account_id=r.id and f.status='confirmed' and f.custody_status='confirmed'
    and f.entry_type in('funding','reserve_deposit') and coalesce(f.reference_usd_amount,0)>0
  where a.owner_user_id=p_sender_user_id and a.status in('available','activated','transferred');

  select count(distinct a.id)::integer into v_recipient_backed
  from public.flow_assets a
  join public.flow_backing_allocations b on b.flow_asset_id=a.id and b.status='active'
  join public.flow_reserve_accounts r on r.id=b.reserve_account_id
    and r.authorized_for_flow and r.is_active and r.status='active' and r.account_reference is not null
  join public.flow_funding_ledger f on f.id=b.funding_entry_id
    and f.reserve_account_id=r.id and f.status='confirmed' and f.custody_status='confirmed'
    and f.entry_type in('funding','reserve_deposit') and coalesce(f.reference_usd_amount,0)>0
  where a.owner_user_id=p_recipient_user_id and a.status in('available','activated','transferred');

  if v_sender_balance<>v_sender_backed then raise exception 'La wallet del pagador no está reconciliada con sus FLOWS respaldados.'; end if;
  if v_recipient_balance<>v_recipient_backed then raise exception 'La wallet del receptor no está reconciliada con sus FLOWS respaldados.'; end if;
  if v_sender_balance<p_quantity then raise exception 'Saldo de Flows insuficiente.'; end if;

  for r_asset in
    select a.id,a.flow_number,a.owner_user_id,a.owner_player_id
    from public.flow_assets a
    join public.flow_backing_allocations b on b.flow_asset_id=a.id and b.status='active'
    join public.flow_reserve_accounts r on r.id=b.reserve_account_id
      and r.authorized_for_flow and r.is_active and r.status='active' and r.account_reference is not null
    join public.flow_funding_ledger f on f.id=b.funding_entry_id
      and f.reserve_account_id=r.id and f.status='confirmed' and f.custody_status='confirmed'
      and f.entry_type in('funding','reserve_deposit') and coalesce(f.reference_usd_amount,0)>0
    where a.owner_user_id=p_sender_user_id and a.status in('available','activated','transferred')
    order by a.flow_number
    limit p_quantity
    for update of a,b,r,f
  loop
    update public.flow_assets
    set owner_user_id=p_recipient_user_id,
        owner_player_id=v_recipient_player_id,
        status='transferred',
        metadata=metadata||jsonb_build_object('lastTransferId',p_transfer_id,'lastTransferredAt',now())
    where id=r_asset.id;

    insert into public.flow_asset_movements(
      flow_asset_id,action,from_user_id,to_user_id,from_player_id,to_player_id,created_by,metadata
    ) values(
      r_asset.id,'transferred',p_sender_user_id,p_recipient_user_id,v_sender_player_id,v_recipient_player_id,p_actor_id,
      jsonb_build_object('transferId',p_transfer_id,'quantity',p_quantity,'backingMoved',false)
    );
    v_moved:=v_moved+1;
  end loop;

  if v_moved<>p_quantity then raise exception 'No hay suficientes FLOWS respaldados y disponibles para transferir.'; end if;

  select coalesce(jsonb_agg(a.flow_number order by a.flow_number),'[]'::jsonb) into v_flow_numbers
  from public.flow_asset_movements m
  join public.flow_assets a on a.id=m.flow_asset_id
  where m.action='transferred' and m.metadata->>'transferId'=p_transfer_id::text;

  perform public.adjust_flows_balance(
    p_sender_user_id,-p_quantity,'transfer_out','flow_transfer',p_transfer_id::text,
    jsonb_build_object('transferId',p_transfer_id,'recipientUserId',p_recipient_user_id,'recipientPlayerId',v_recipient_player_id,'flowNumbers',v_flow_numbers),p_actor_id
  );
  perform public.adjust_flows_balance(
    p_recipient_user_id,p_quantity,'transfer_in','flow_transfer',p_transfer_id::text,
    jsonb_build_object('transferId',p_transfer_id,'senderUserId',p_sender_user_id,'senderPlayerId',v_sender_player_id,'flowNumbers',v_flow_numbers),p_actor_id
  );

  select balance into v_sender_balance from public.flows_wallets where user_id=p_sender_user_id;
  select balance into v_recipient_balance from public.flows_wallets where user_id=p_recipient_user_id;

  select count(distinct a.id)::integer into v_sender_backed
  from public.flow_assets a
  join public.flow_backing_allocations b on b.flow_asset_id=a.id and b.status='active'
  join public.flow_reserve_accounts r on r.id=b.reserve_account_id and r.authorized_for_flow and r.is_active and r.status='active' and r.account_reference is not null
  join public.flow_funding_ledger f on f.id=b.funding_entry_id and f.reserve_account_id=r.id and f.status='confirmed' and f.custody_status='confirmed' and f.entry_type in('funding','reserve_deposit') and coalesce(f.reference_usd_amount,0)>0
  where a.owner_user_id=p_sender_user_id and a.status in('available','activated','transferred');

  select count(distinct a.id)::integer into v_recipient_backed
  from public.flow_assets a
  join public.flow_backing_allocations b on b.flow_asset_id=a.id and b.status='active'
  join public.flow_reserve_accounts r on r.id=b.reserve_account_id and r.authorized_for_flow and r.is_active and r.status='active' and r.account_reference is not null
  join public.flow_funding_ledger f on f.id=b.funding_entry_id and f.reserve_account_id=r.id and f.status='confirmed' and f.custody_status='confirmed' and f.entry_type in('funding','reserve_deposit') and coalesce(f.reference_usd_amount,0)>0
  where a.owner_user_id=p_recipient_user_id and a.status in('available','activated','transferred');

  if v_sender_balance<>v_sender_backed or v_recipient_balance<>v_recipient_backed then
    raise exception 'La transferencia no dejó las wallets reconciliadas con los FLOWS respaldados.';
  end if;

  return jsonb_build_object(
    'transferId',p_transfer_id,'quantity',p_quantity,'duplicate',false,
    'senderUserId',p_sender_user_id,'recipientUserId',p_recipient_user_id,
    'flowNumbers',v_flow_numbers,'backingMoved',false
  );
end $$;

revoke all on function public.transfer_backed_flows(uuid,uuid,integer,uuid,uuid) from public, anon, authenticated;
grant execute on function public.transfer_backed_flows(uuid,uuid,integer,uuid,uuid) to service_role;
