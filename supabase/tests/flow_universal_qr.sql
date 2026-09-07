-- Transactional integration test for Universal QR fractional FLOW accounting.
-- Exercises exact base units, hold/idempotency, double-spend prevention,
-- proportional backing release, partial asset reuse and failure rollback.

begin;

do $test$
declare
  v_user uuid := '91111111-1111-4111-8111-111111111111';
  v_player uuid := '91111111-aaaa-4111-8111-111111111111';
  v_reserve uuid := '9aaaaaaa-0000-4000-8000-000000000001';
  v_operation uuid;
  v_funding uuid;
  v_asset uuid;
  v_qr uuid := '9fffffff-0000-4000-8000-000000000001';
  v_qr_fail uuid := '9fffffff-0000-4000-8000-000000000002';
  v_qr_blocked uuid := '9fffffff-0000-4000-8000-000000000003';
  v_result jsonb;
  v_units bigint;
  v_balance integer;
  v_count integer;
  v_partial bigint;
  v_release numeric;
  v_free numeric;
  i integer;
begin
  if public.flow_units_per_flow() <> 1000000 then raise exception 'unexpected FLOW unit scale'; end if;

  insert into auth.users(id) values(v_user) on conflict(id) do nothing;
  insert into public.profiles(id) values(v_user) on conflict(id) do nothing;
  insert into public.players(id,owner_user_id,slug,display_name,username,is_published,publication_status,privacy_status)
  values(v_player,v_user,'universal-qr-test-player','Universal QR Test','universal.qr.test',true,'published','public')
  on conflict(id) do nothing;

  insert into public.flow_reserve_accounts(
    id,name,provider,account_type,currency,account_reference,status,is_active,
    authorized_for_flow,authorized_at,flow_account_role,authorized_for_collection
  ) values(
    v_reserve,'Universal QR rollback reserve','test','custody','USD','UNIVERSAL-QR-ROLLBACK','active',true,
    true,now(),'reserve',false
  );

  for i in 1..8 loop
    v_operation:=gen_random_uuid();
    v_funding:=gen_random_uuid();
    v_asset:=gen_random_uuid();
    insert into public.flow_purchase_operations(
      id,buyer_user_id,buyer_player_id,recipient_user_id,recipient_player_id,
      provider,provider_reference,payment_method,quantity,unit_usd,amount,currency,
      status,confirmed_at,issued_at,backing_status,fx_rate_original_per_usd,fx_source,fx_quoted_at,
      operation_type,provider_fee,net_amount,required_backing_usd,backing_amount,processing_fee_amount,processing_fee_policy
    ) values(
      v_operation,v_user,v_player,v_user,v_player,
      'test','universal-qr-op:'||v_operation::text,'test',1,1,1,'USD',
      'confirmed',now(),now(),'verified',1,'test',now(),
      'purchase_new',0,1,1,1,0,'clouva_absorbs'
    );
    insert into public.flow_funding_ledger(
      id,operation_id,entry_type,provider,payment_method,amount,currency,status,idempotency_key,
      net_amount,reserve_account_id,custody_status,custody_reference,custody_confirmed_at,reference_usd_amount,custody_stage
    ) values(
      v_funding,v_operation,'reserve_deposit','test','test',1,'USD','confirmed','universal-qr-funding:'||v_funding::text,
      1,v_reserve,'confirmed','UNIVERSAL-QR-'||i::text,now(),1,'allocated'
    );
    insert into public.flow_assets(
      id,operation_id,operation_unit,owner_user_id,owner_player_id,original_buyer_user_id,original_buyer_player_id,
      status,backing_operation_id,total_units,available_units,held_units
    ) values(
      v_asset,v_operation,1,v_user,v_player,v_user,v_player,'pending_payment',v_operation,1000000,1000000,0
    );
    insert into public.flow_backing_allocations(
      flow_asset_id,reserve_account_id,funding_entry_id,reference_usd_value,consumed_reference_usd_value,status
    ) values(v_asset,v_reserve,v_funding,1,0,'active');
    update public.flow_assets set status='available',backed_at=now(),activated_at=now() where id=v_asset;
  end loop;

  insert into public.flows_wallets(user_id,balance,balance_units) values(v_user,8,8000000)
  on conflict(user_id) do update set balance=8,balance_units=8000000,updated_at=now();

  if abs(public.flow_reserve_account_free_usd(v_reserve)) > 0.000001 then raise exception 'fixture reserve is not fully allocated'; end if;

  insert into public.flow_qr_payment_operations(
    id,user_id,player_id,raw_qr,qr_payload_hash,qr_type,provider,merchant_name,merchant_id,
    merchant_amount,merchant_currency,capability,resolution,status,fx_pair,fx_rate,fx_source,fx_quoted_at,
    quote_expires_at,reference_usd,flow_units,provider_fee_units,clouva_fee_units,total_flow_units,
    rail_provider,rail_method,sandbox
  ) values(
    v_qr,v_user,v_player,'CLOUVA-SANDBOX:KIOSK:KIOSCO_PEPE:ARS:8500.00',repeat('a',64),'sandbox_merchant','sandbox','Kiosco Pepe','sandbox-kiosk',
    8500,'ARS','PAYABLE','{}','quoted','USD/ARS',1480.84,'test',now(),now()+interval '10 minutes',5.739986,5739986,0,0,5739986,
    'sandbox','merchant_qr',true
  );

  v_result:=public.hold_flow_qr_payment(v_qr,v_user,5739986,v_user);
  if v_result->>'status'<>'flow_held' then raise exception 'hold did not reach flow_held'; end if;
  select balance,balance_units into v_balance,v_units from public.flows_wallets where user_id=v_user;
  if v_units<>2260014 or v_balance<>2 then raise exception 'fractional wallet hold mismatch: % %',v_balance,v_units; end if;
  select count(*) into v_count from public.flow_qr_payment_items where operation_id=v_qr and status='held';
  if v_count<>6 then raise exception 'expected six assets in 5.739986 FLOW hold, got %',v_count; end if;
  if exists(select 1 from public.flow_assets a join public.flow_qr_payment_items i on i.flow_asset_id=a.id where i.operation_id=v_qr and a.status<>'qr_payment_pending') then
    raise exception 'held assets remained spendable';
  end if;

  v_result:=public.hold_flow_qr_payment(v_qr,v_user,5739986,v_user);
  if coalesce((v_result->>'duplicate')::boolean,false) is not true then raise exception 'hold idempotency failed'; end if;
  select count(*) into v_count from public.flows_wallet_ledger where user_id=v_user and transaction_type='qr_payment_hold' and reference_id=v_qr::text;
  if v_count<>1 then raise exception 'hold ledger duplicated'; end if;

  insert into public.flow_qr_payment_operations(
    id,user_id,player_id,raw_qr,qr_payload_hash,qr_type,provider,merchant_name,merchant_amount,merchant_currency,capability,resolution,status,
    fx_pair,fx_rate,fx_source,fx_quoted_at,quote_expires_at,reference_usd,flow_units,total_flow_units,rail_provider,rail_method,sandbox
  ) values(
    v_qr_blocked,v_user,v_player,'CLOUVA-SANDBOX:KIOSK:OTHER:ARS:4500',repeat('b',64),'sandbox_merchant','sandbox','Other kiosk',4500,'ARS','PAYABLE','{}','quoted',
    'USD/ARS',1500,'test',now(),now()+interval '10 minutes',3,3000000,3000000,'sandbox','merchant_qr',true
  );
  begin
    perform public.hold_flow_qr_payment(v_qr_blocked,v_user,3000000,v_user);
    raise exception 'double spend was allowed';
  exception when others then
    if position('Saldo FLOW respaldado insuficiente' in sqlerrm)=0 then raise; end if;
  end;

  perform public.mark_flow_qr_payment_submitted(v_qr,v_user,v_user,'sbx-kiosco-pepe','PENDING');
  v_result:=public.confirm_flow_qr_payment(v_qr,v_user,v_user,'sbx-kiosco-pepe','sandbox:sbx-kiosco-pepe');
  if v_result->>'status'<>'payment_confirmed' then raise exception 'confirm failed'; end if;
  select balance,balance_units into v_balance,v_units from public.flows_wallets where user_id=v_user;
  if v_units<>2260014 or v_balance<>2 then raise exception 'confirm changed held wallet a second time'; end if;
  select count(*) into v_count from public.flow_assets where owner_user_id=v_user and status='redeemed';
  if v_count<>5 then raise exception 'expected five fully redeemed FLOW, got %',v_count; end if;
  select available_units into v_partial from public.flow_assets where owner_user_id=v_user and status='qr_partial';
  if v_partial<>260014 then raise exception 'partial FLOW remainder mismatch: %',v_partial; end if;
  select coalesce(sum(reference_usd_amount),0) into v_release from public.flow_funding_ledger
  where entry_type='reserve_release' and metadata->>'qrPaymentOperationId'=v_qr::text;
  if abs(v_release-5.739986)>0.000001 then raise exception 'reserve release mismatch: %',v_release; end if;
  v_free:=public.flow_reserve_account_free_usd(v_reserve);
  if abs(v_free)>0.00001 then raise exception 'reserve free balance drifted after proportional release: %',v_free; end if;
  if exists(
    select 1 from public.flow_backing_allocations b join public.flow_assets a on a.id=b.flow_asset_id
    where a.status='qr_partial' and abs((b.reference_usd_value-b.consumed_reference_usd_value)-0.260014)>0.00001
  ) then raise exception 'partial asset backing is not proportional'; end if;

  v_result:=public.confirm_flow_qr_payment(v_qr,v_user,v_user,'sbx-kiosco-pepe','sandbox:sbx-kiosco-pepe');
  if coalesce((v_result->>'duplicate')::boolean,false) is not true then raise exception 'confirmation idempotency failed'; end if;

  insert into public.flow_qr_payment_operations(
    id,user_id,player_id,raw_qr,qr_payload_hash,qr_type,provider,merchant_name,merchant_amount,merchant_currency,capability,resolution,status,
    fx_pair,fx_rate,fx_source,fx_quoted_at,quote_expires_at,reference_usd,flow_units,total_flow_units,rail_provider,rail_method,sandbox
  ) values(
    v_qr_fail,v_user,v_player,'CLOUVA-SANDBOX:KIOSK:FAIL:ARS:370',repeat('c',64),'sandbox_merchant','sandbox','Fail kiosk',370,'ARS','PAYABLE','{}','quoted',
    'USD/ARS',1480,'test',now(),now()+interval '10 minutes',0.25,250000,250000,'sandbox','merchant_qr',true
  );
  perform public.hold_flow_qr_payment(v_qr_fail,v_user,250000,v_user);
  select balance_units into v_units from public.flows_wallets where user_id=v_user;
  if v_units<>2010014 then raise exception 'failure fixture hold mismatch'; end if;
  v_result:=public.release_flow_qr_payment(v_qr_fail,v_user,v_user,'failed','sandbox_rejected','Sandbox rejected');
  if v_result->>'status'<>'failed' then raise exception 'release did not fail operation'; end if;
  select balance_units into v_units from public.flows_wallets where user_id=v_user;
  if v_units<>2260014 then raise exception 'failed QR did not restore exact FLOW units'; end if;
  select available_units into v_partial from public.flow_assets where owner_user_id=v_user and status='qr_partial';
  if v_partial<>260014 then raise exception 'failed QR changed partial asset remainder'; end if;
  select count(*) into v_count from public.flows_wallet_ledger where reference_id=v_qr_fail::text and transaction_type in('qr_payment_hold','qr_payment_release');
  if v_count<>2 then raise exception 'failure ledger must have one hold and one release'; end if;
end
$test$;

rollback;
