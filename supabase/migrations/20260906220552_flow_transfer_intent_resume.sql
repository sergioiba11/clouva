create unique index if not exists flow_transfer_intents_purchase_unique
  on public.flow_transfer_intents(purchase_operation_id)
  where purchase_operation_id is not null;

create or replace function public.resume_flow_transfer_intent(p_intent_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_intent public.flow_transfer_intents%rowtype;
  v_balance integer := 0;
  v_transfer jsonb;
begin
  if p_intent_id is null then raise exception 'Intent de transferencia inválido.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('flow-transfer-intent:' || p_intent_id::text, 0));
  select * into v_intent from public.flow_transfer_intents where id=p_intent_id for update;
  if not found then raise exception 'Intent de transferencia inexistente.'; end if;

  if v_intent.status='completed' then
    return jsonb_build_object('intentId',v_intent.id,'status','completed','transferId',v_intent.transfer_id,'duplicate',true);
  end if;
  if v_intent.status in ('cancelled','expired','failed') then
    return jsonb_build_object('intentId',v_intent.id,'status',v_intent.status,'transferId',v_intent.transfer_id);
  end if;
  if v_intent.expires_at<=now() then
    update public.flow_transfer_intents set status='expired',updated_at=now(),last_error_code='expired',last_safe_message='La intención de pago venció.' where id=v_intent.id;
    return jsonb_build_object('intentId',v_intent.id,'status','expired','transferId',v_intent.transfer_id);
  end if;

  select balance into v_balance from public.flows_wallets where user_id=v_intent.sender_user_id for update;
  v_balance:=coalesce(v_balance,0);
  if v_balance<v_intent.required_quantity then
    update public.flow_transfer_intents
      set status=case when purchase_operation_id is null then 'awaiting_funding' else 'awaiting_backing' end,
          updated_at=now(),last_error_code=null,last_safe_message=null
      where id=v_intent.id;
    return jsonb_build_object('intentId',v_intent.id,'status',case when v_intent.purchase_operation_id is null then 'awaiting_funding' else 'awaiting_backing' end,'requiredQuantity',v_intent.required_quantity,'available',v_balance,'missingQuantity',greatest(v_intent.required_quantity-v_balance,0));
  end if;

  update public.flow_transfer_intents set status='executing',updated_at=now(),last_error_code=null,last_safe_message=null where id=v_intent.id;
  begin
    select public.transfer_backed_flows(
      v_intent.sender_user_id,
      v_intent.recipient_user_id,
      v_intent.required_quantity,
      v_intent.transfer_id,
      v_intent.sender_user_id
    ) into v_transfer;
  exception when others then
    update public.flow_transfer_intents
      set status='failed',updated_at=now(),last_error_code='transfer_failed',last_safe_message='Los FLOW quedaron en tu billetera porque la transferencia automática no pudo completarse.'
      where id=v_intent.id;
    return jsonb_build_object('intentId',v_intent.id,'status','failed','transferId',v_intent.transfer_id,'safeMessage','Los FLOW quedaron en tu billetera porque la transferencia automática no pudo completarse.');
  end;

  update public.flow_transfer_intents
    set status='completed',completed_at=coalesce(completed_at,now()),updated_at=now(),last_error_code=null,last_safe_message=null,
        metadata=metadata||jsonb_build_object('completedBy','canonical_transfer','completedTransfer',v_transfer)
    where id=v_intent.id;
  return jsonb_build_object('intentId',v_intent.id,'status','completed','transferId',v_intent.transfer_id,'transfer',v_transfer);
end $$;

revoke all on function public.resume_flow_transfer_intent(uuid) from public, anon, authenticated;
grant execute on function public.resume_flow_transfer_intent(uuid) to service_role;

create or replace function public.resume_flow_transfer_intent_after_purchase_ledger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_operation_id uuid;
  v_intent_id uuid;
begin
  if new.transaction_type<>'purchase' or new.reference_id is null then return new; end if;
  begin
    v_operation_id:=new.reference_id::uuid;
  exception when invalid_text_representation then
    return new;
  end;

  select id into v_intent_id
  from public.flow_transfer_intents
  where purchase_operation_id=v_operation_id and sender_user_id=new.user_id
    and status in ('awaiting_funding','awaiting_backing','ready','executing')
  limit 1;
  if v_intent_id is not null then
    perform public.resume_flow_transfer_intent(v_intent_id);
  end if;
  return new;
end $$;

revoke all on function public.resume_flow_transfer_intent_after_purchase_ledger() from public, anon, authenticated;
grant execute on function public.resume_flow_transfer_intent_after_purchase_ledger() to service_role;

drop trigger if exists flow_transfer_intent_purchase_resume on public.flows_wallet_ledger;
create trigger flow_transfer_intent_purchase_resume
after insert on public.flows_wallet_ledger
for each row when (new.transaction_type='purchase')
execute function public.resume_flow_transfer_intent_after_purchase_ledger();
