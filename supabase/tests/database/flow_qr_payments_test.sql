begin;

create extension if not exists pgtap with schema extensions;
select plan(54);

create or replace function pg_temp.did_throw(p_sql text, p_contains text)
returns boolean
language plpgsql
as $$
begin
  execute p_sql;
  return false;
exception when others then
  return position(lower(p_contains) in lower(sqlerrm)) > 0;
end;
$$;

-- Isolated users and Players.
insert into auth.users(id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222'),
  ('33333333-3333-4333-8333-333333333333'),
  ('44444444-4444-4444-8444-444444444444')
on conflict (id) do nothing;

insert into public.profiles(id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222'),
  ('33333333-3333-4333-8333-333333333333'),
  ('44444444-4444-4444-8444-444444444444')
on conflict (id) do nothing;

insert into public.players(id, owner_user_id, slug, display_name, username, is_published, publication_status, privacy_status)
values
  ('11111111-aaaa-4111-8111-111111111111','11111111-1111-4111-8111-111111111111','flow-test-sender','FLOW Sender','flow.test.sender',true,'published','public'),
  ('22222222-aaaa-4222-8222-222222222222','22222222-2222-4222-8222-222222222222','flow-test-recipient','FLOW Recipient','flow.test.recipient',true,'published','public'),
  ('33333333-aaaa-4333-8333-333333333333','33333333-3333-4333-8333-333333333333','flow-test-third','FLOW Third','flow.test.third',true,'published','public'),
  ('44444444-aaaa-4444-8444-444444444444','44444444-4444-4444-8444-444444444444','flow-test-invalid','FLOW Invalid','flow.test.invalid',true,'published','public')
on conflict (id) do nothing;

insert into public.flow_reserve_accounts(
  id,name,provider,account_type,currency,account_reference,status,is_active,
  authorized_for_flow,authorized_at,flow_account_role,authorized_for_collection
) values (
  'aaaaaaaa-0000-4000-8000-000000000001','QR test reserve','test','custody','USD','TEST-RESERVE-1','active',true,
  true,now(),'reserve',false
);

create or replace function pg_temp.add_backed_flow(
  p_operation uuid,
  p_funding uuid,
  p_asset uuid,
  p_owner uuid,
  p_unit integer
) returns void
language plpgsql
as $$
declare
  v_player uuid;
begin
  select id into v_player from public.players where owner_user_id=p_owner order by created_at limit 1;

  insert into public.flow_purchase_operations(
    id,buyer_user_id,buyer_player_id,recipient_user_id,recipient_player_id,
    provider,provider_reference,payment_method,quantity,unit_usd,amount,currency,
    status,confirmed_at,issued_at,backing_status,fx_rate_original_per_usd,fx_source,
    fx_quoted_at,operation_type,provider_fee,net_amount,required_backing_usd,
    backing_amount,processing_fee_amount,processing_fee_policy
  ) values (
    p_operation,p_owner,v_player,p_owner,v_player,
    'test','qr-db:'||p_operation::text,'test',1,1,1,'USD',
    'confirmed',now(),now(),'verified',1,'test',now(),'purchase_new',0,1,1,1,0,'clouva_absorbs'
  );

  insert into public.flow_funding_ledger(
    id,operation_id,entry_type,provider,payment_method,amount,currency,status,
    idempotency_key,net_amount,reserve_account_id,custody_status,custody_reference,
    custody_confirmed_at,reference_usd_amount,custody_stage
  ) values (
    p_funding,p_operation,'reserve_deposit','test','test',1,'USD','confirmed',
    'qr-db-funding:'||p_funding::text,1,'aaaaaaaa-0000-4000-8000-000000000001',
    'confirmed','QR-DB-'||p_funding::text,now(),1,'allocated'
  );

  insert into public.flow_assets(
    id,operation_id,operation_unit,owner_user_id,owner_player_id,
    original_buyer_user_id,original_buyer_player_id,status,backing_operation_id
  ) values (
    p_asset,p_operation,p_unit,p_owner,v_player,p_owner,v_player,'pending_payment',p_operation
  );

  insert into public.flow_backing_allocations(
    flow_asset_id,reserve_account_id,funding_entry_id,reference_usd_value,status
  ) values (
    p_asset,'aaaaaaaa-0000-4000-8000-000000000001',p_funding,1,'active'
  );

  update public.flow_assets set status='available',backed_at=now(),activated_at=now() where id=p_asset;
  insert into public.flows_wallets(user_id,balance) values(p_owner,1)
  on conflict(user_id) do update set balance=public.flows_wallets.balance+1,updated_at=now();
end;
$$;

select pg_temp.add_backed_flow(
  'bbbbbbbb-0000-4000-8000-000000000001',
  'cccccccc-0000-4000-8000-000000000001',
  'dddddddd-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',1
);
insert into public.flows_wallets(user_id,balance) values
  ('22222222-2222-4222-8222-222222222222',0),
  ('33333333-3333-4333-8333-333333333333',0)
on conflict(user_id) do nothing;

insert into public.clouva_qr_registry(id,public_token,entity_type,entity_id,status,is_canonical)
values
  ('eeeeeeee-0000-4000-8000-000000000001','flow-user-recipient','USER','22222222-2222-4222-8222-222222222222','ACTIVE',true),
  ('eeeeeeee-0000-4000-8000-000000000002','flow-user-third','USER','33333333-3333-4333-8333-333333333333','ACTIVE',true),
  ('eeeeeeee-0000-4000-8000-000000000003','flow-user-revoked','USER','22222222-2222-4222-8222-222222222222','REVOKED',false);
update public.clouva_qr_registry set revoked_at=now() where id='eeeeeeee-0000-4000-8000-000000000003';

select has_table('public','flow_transfer_operations','FLOW operation recovery table exists');
select ok(not has_function_privilege('authenticated','public.execute_flow_qr_transfer(uuid,text,integer,uuid,uuid)','EXECUTE'),'authenticated cannot execute user FLOW transfer RPC directly');
select ok(not has_function_privilege('authenticated','public.complete_commerce_flow_qr_sale(uuid,text,uuid,uuid,integer,uuid,uuid,uuid,text,text)','EXECUTE'),'authenticated cannot execute commerce FLOW RPC directly');

select lives_ok($$
  select public.execute_flow_qr_transfer(
    '11111111-1111-4111-8111-111111111111','flow-user-recipient',1,
    'ffffffff-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111'
  )
$$,'backed USER QR transfer succeeds');
select is((select owner_user_id from public.flow_assets where id='dddddddd-0000-4000-8000-000000000001'),'22222222-2222-4222-8222-222222222222'::uuid,'asset ownership moves to recipient');
select is((select balance from public.flows_wallets where user_id='11111111-1111-4111-8111-111111111111'),0,'sender wallet is debited');
select is((select balance from public.flows_wallets where user_id='22222222-2222-4222-8222-222222222222'),1,'recipient wallet is credited');
select is((select count(*)::integer from public.flow_backing_allocations where flow_asset_id='dddddddd-0000-4000-8000-000000000001' and status='active'),1,'backing allocation remains attached to transferred asset');
select is((select count(*)::integer from public.flow_asset_movements where action='transferred' and metadata->>'transferId'='ffffffff-0000-4000-8000-000000000001'),1,'one authoritative asset movement is written');
select is((select count(*)::integer from public.flows_wallet_ledger where reference_id='ffffffff-0000-4000-8000-000000000001' and transaction_type in ('transfer_out','transfer_in')),2,'wallet ledger writes exactly one debit and one credit');
select is((select status from public.flow_transfer_operations where id='ffffffff-0000-4000-8000-000000000001'),'COMPLETED','operation is persisted as completed');

select lives_ok($$
  select public.execute_flow_qr_transfer(
    '11111111-1111-4111-8111-111111111111','flow-user-recipient',1,
    'ffffffff-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111'
  )
$$,'lost-response retry with same operation id is recoverable');
select is((select count(*)::integer from public.flow_asset_movements where action='transferred' and metadata->>'transferId'='ffffffff-0000-4000-8000-000000000001'),1,'retry does not move another asset');
select is((select count(*)::integer from public.flows_wallet_ledger where reference_id='ffffffff-0000-4000-8000-000000000001'),2,'retry does not duplicate wallet ledger');
select ok(((public.execute_flow_qr_transfer('11111111-1111-4111-8111-111111111111','flow-user-recipient',1,'ffffffff-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111')->>'duplicate')::boolean),'recovered result identifies duplicate operation');
select ok(pg_temp.did_throw($$select public.execute_flow_qr_transfer('11111111-1111-4111-8111-111111111111','flow-user-recipient',2,'ffffffff-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111')$$,'otra operación'),'same operation id with a different amount is rejected');
select ok(pg_temp.did_throw($$select public.execute_flow_qr_transfer('11111111-1111-4111-8111-111111111111','flow-user-third',1,'ffffffff-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111')$$,'otra operación'),'same operation id with a different recipient/QR is rejected');
select ok(pg_temp.did_throw($$select public.execute_flow_qr_transfer('11111111-1111-4111-8111-111111111111','flow-user-revoked',1,'ffffffff-0000-4000-8000-000000000004','11111111-1111-4111-8111-111111111111')$$,'player activo'),'revoked QR cannot receive FLOW');
select ok(pg_temp.did_throw($$select public.execute_flow_qr_transfer('11111111-1111-4111-8111-111111111111','flow-user-recipient',1,'ffffffff-0000-4000-8000-000000000005','11111111-1111-4111-8111-111111111111')$$,'saldo'),'insufficient wallet/asset state is rejected');

update public.flow_funding_ledger set custody_stage='reserve_received' where id='cccccccc-0000-4000-8000-000000000001';
select ok(pg_temp.did_throw($$select public.transfer_backed_flows('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111',1,'ffffffff-0000-4000-8000-000000000006','22222222-2222-4222-8222-222222222222')$$,'perdió respaldo'),'current-custody movement guard blocks a stale custody stage');
select is((select owner_user_id from public.flow_assets where id='dddddddd-0000-4000-8000-000000000001'),'22222222-2222-4222-8222-222222222222'::uuid,'failed custody transfer rolls asset ownership back');
select is((select balance from public.flows_wallets where user_id='22222222-2222-4222-8222-222222222222'),1,'failed custody transfer leaves recipient balance unchanged');
update public.flow_funding_ledger set custody_stage='allocated' where id='cccccccc-0000-4000-8000-000000000001';

-- Invalid backing cannot become spendable in the first place.
insert into public.flow_reserve_accounts(id,name,provider,account_type,currency,account_reference,status,is_active,authorized_for_flow,flow_account_role)
values ('aaaaaaaa-0000-4000-8000-000000000002','Unauthorized reserve','test','custody','USD','TEST-RESERVE-2','active',true,false,'reserve');
insert into public.flow_purchase_operations(id,recipient_user_id,provider,provider_reference,payment_method,quantity,amount,currency,status,issued_at,backing_status,required_backing_usd,backing_amount,processing_fee_policy)
values ('bbbbbbbb-0000-4000-8000-000000000010','44444444-4444-4444-8444-444444444444','test','qr-invalid-reserve','test',1,1,'USD','confirmed',now(),'verified',1,1,'clouva_absorbs');
insert into public.flow_funding_ledger(id,operation_id,entry_type,provider,payment_method,amount,currency,status,idempotency_key,reserve_account_id,custody_status,custody_reference,custody_confirmed_at,reference_usd_amount,custody_stage)
values ('cccccccc-0000-4000-8000-000000000010','bbbbbbbb-0000-4000-8000-000000000010','reserve_deposit','test','test',1,'USD','confirmed','qr-invalid-reserve-funding','aaaaaaaa-0000-4000-8000-000000000002','confirmed','invalid-reserve',now(),1,'allocated');
insert into public.flow_assets(id,operation_id,operation_unit,owner_user_id,status,backing_operation_id)
values ('dddddddd-0000-4000-8000-000000000010','bbbbbbbb-0000-4000-8000-000000000010',1,'44444444-4444-4444-8444-444444444444','pending_payment','bbbbbbbb-0000-4000-8000-000000000010');
insert into public.flow_backing_allocations(flow_asset_id,reserve_account_id,funding_entry_id,reference_usd_value,status)
values ('dddddddd-0000-4000-8000-000000000010','aaaaaaaa-0000-4000-8000-000000000002','cccccccc-0000-4000-8000-000000000010',1,'active');
select ok(pg_temp.did_throw($$update public.flow_assets set status='available' where id='dddddddd-0000-4000-8000-000000000010'$$,'respaldo'),'unauthorized reserve cannot make a FLOW spendable');

insert into public.flow_purchase_operations(id,recipient_user_id,provider,provider_reference,payment_method,quantity,amount,currency,status,issued_at,backing_status,required_backing_usd,backing_amount,processing_fee_policy)
values ('bbbbbbbb-0000-4000-8000-000000000011','44444444-4444-4444-8444-444444444444','test','qr-invalid-funding','test',1,1,'USD','confirmed',now(),'verified',1,1,'clouva_absorbs');
insert into public.flow_funding_ledger(id,operation_id,entry_type,provider,payment_method,amount,currency,status,idempotency_key,reserve_account_id,custody_status,reference_usd_amount,custody_stage)
values ('cccccccc-0000-4000-8000-000000000011','bbbbbbbb-0000-4000-8000-000000000011','reserve_deposit','test','test',1,'USD','pending','qr-invalid-funding-entry','aaaaaaaa-0000-4000-8000-000000000001','pending',1,'pending');
insert into public.flow_assets(id,operation_id,operation_unit,owner_user_id,status,backing_operation_id)
values ('dddddddd-0000-4000-8000-000000000011','bbbbbbbb-0000-4000-8000-000000000011',1,'44444444-4444-4444-8444-444444444444','pending_payment','bbbbbbbb-0000-4000-8000-000000000011');
insert into public.flow_backing_allocations(flow_asset_id,reserve_account_id,funding_entry_id,reference_usd_value,status)
values ('dddddddd-0000-4000-8000-000000000011','aaaaaaaa-0000-4000-8000-000000000001','cccccccc-0000-4000-8000-000000000011',1,'active');
select ok(pg_temp.did_throw($$update public.flow_assets set status='available' where id='dddddddd-0000-4000-8000-000000000011'$$,'respaldo'),'unconfirmed funding/custody cannot make a FLOW spendable');
select is((select status from public.flow_assets where id='dddddddd-0000-4000-8000-000000000010'),'pending_payment','unauthorized reserve asset stays non-spendable');
select is((select status from public.flow_assets where id='dddddddd-0000-4000-8000-000000000011'),'pending_payment','unconfirmed funding asset stays non-spendable');

-- Commerce fixture: one product costs exactly 1 FLOW at the persisted Spot FX.
insert into public.studios(id,slug,name,owner_id) values ('99999999-0000-4000-8000-000000000001','flow-qr-db-studio','FLOW QR DB Studio','22222222-2222-4222-8222-222222222222');
insert into public.commerce_spots(id,studio_id,slug,name,currency,public_enabled,status,owner_type,beneficiary_user_id)
values ('99999999-1000-4000-8000-000000000001','99999999-0000-4000-8000-000000000001','flow-qr-db-spot','FLOW QR DB Spot','ARS',true,'active','studio','22222222-2222-4222-8222-222222222222');
insert into public.commerce_inventory_locations(id,spot_id,code,name,status)
values ('99999999-2000-4000-8000-000000000001','99999999-1000-4000-8000-000000000001','PRINCIPAL','Principal','active');
insert into public.commerce_flow_accounts(id,spot_id,local_currency)
values ('99999999-3000-4000-8000-000000000001','99999999-1000-4000-8000-000000000001','ARS');
insert into public.commerce_catalog_products(id,product_kind,name,status)
values ('99999999-4000-4000-8000-000000000001','physical','FLOW QR test product','active');
insert into public.commerce_products(
  id,owner_type,studio_id,product_type,name,slug,price,currency,stock,status,
  spot_id,catalog_product_id,cost_amount,listing_kind
) values (
  '99999999-5000-4000-8000-000000000001','studio','99999999-0000-4000-8000-000000000001','physical',
  'FLOW QR test product','flow-qr-test-product',1000,'ARS',2,'published',
  '99999999-1000-4000-8000-000000000001','99999999-4000-4000-8000-000000000001',500,'standard'
);
insert into public.commerce_product_identifiers(
  id,catalog_product_id,spot_id,identifier_type,value,normalized_value,is_primary,origin,status,scope,public_token,destination_type
) values (
  '99999999-6000-4000-8000-000000000001','99999999-4000-4000-8000-000000000001','99999999-1000-4000-8000-000000000001',
  'clouva_qr','flow-product-token','FLOW-PRODUCT-TOKEN',true,'clouva_generated','active','spot','flow-product-token','product'
);
insert into public.clouva_qr_registry(id,public_token,entity_type,entity_id,studio_id,source_identifier_id,status,is_canonical)
values (
  '99999999-7000-4000-8000-000000000001','flow-product-token','PRODUCT','99999999-4000-4000-8000-000000000001',
  '99999999-0000-4000-8000-000000000001','99999999-6000-4000-8000-000000000001','ACTIVE',true
);
insert into public.commerce_fx_rates(id,spot_id,local_currency,quote_currency,local_per_quote,source,quoted_at,idempotency_key)
values ('99999999-8000-4000-8000-000000000001','99999999-1000-4000-8000-000000000001','ARS','USD',1000,'test',now(),'flow-qr-db-fx');

select pg_temp.add_backed_flow(
  'bbbbbbbb-0000-4000-8000-000000000002',
  'cccccccc-0000-4000-8000-000000000002',
  'dddddddd-0000-4000-8000-000000000002',
  '11111111-1111-4111-8111-111111111111',1
);

select lives_ok($$
  select public.complete_commerce_flow_qr_sale(
    '11111111-1111-4111-8111-111111111111','flow-product-token',
    '99999999-5000-4000-8000-000000000001',null,1,
    '99999999-8000-4000-8000-000000000001','ffffffff-1000-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111',null,null
  )
$$,'atomic product QR sale succeeds');
select is((select stock from public.commerce_products where id='99999999-5000-4000-8000-000000000001'),1,'successful sale decrements stock exactly once');
select is((select count(*)::integer from public.commerce_orders where external_reference='pos:flowqr:ffffffff-1000-4000-8000-000000000001' and payment_status='paid' and status='confirmed'),1,'order is confirmed and paid');
select is((select count(*)::integer from public.commerce_payments where idempotency_key='flowqr:ffffffff-1000-4000-8000-000000000001' and provider='flow' and status='confirmed'),1,'commerce payment is reconciled to FLOW provider');
select is((select count(*)::integer from public.commerce_flow_ledger l join public.commerce_payments p on p.id=l.payment_id where p.idempotency_key='flowqr:ffffffff-1000-4000-8000-000000000001' and l.metadata->>'rail'='FLOW'),1,'commerce ledger carries FLOW provenance');
select is((select owner_user_id from public.flow_assets where id='dddddddd-0000-4000-8000-000000000002'),'22222222-2222-4222-8222-222222222222'::uuid,'commerce FLOW asset moves to Spot beneficiary');
select is((select balance from public.flows_wallets where user_id='11111111-1111-4111-8111-111111111111'),0,'commerce sale debits buyer Mi Flow');
select is((select count(*)::integer from public.flow_transfer_operations where id='ffffffff-1000-4000-8000-000000000001' and status='COMPLETED' and order_id is not null and payment_id is not null),1,'commerce operation links order and payment');
select ok(((public.complete_commerce_flow_qr_sale('11111111-1111-4111-8111-111111111111','flow-product-token','99999999-5000-4000-8000-000000000001',null,1,'99999999-8000-4000-8000-000000000001','ffffffff-1000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111',null,null)->>'duplicate')::boolean),'same commerce operation recovers as duplicate');
select is((select count(*)::integer from public.commerce_orders where external_reference='pos:flowqr:ffffffff-1000-4000-8000-000000000001'),1,'commerce retry does not create a second order');
select is((select stock from public.commerce_products where id='99999999-5000-4000-8000-000000000001'),1,'commerce retry does not decrement stock twice');
select is((select count(*)::integer from public.flows_wallet_ledger where reference_id='ffffffff-1000-4000-8000-000000000001'),2,'commerce retry does not duplicate Mi Flow ledger entries');
select is((select count(*)::integer from public.flow_backing_allocations where flow_asset_id='dddddddd-0000-4000-8000-000000000002' and status='active'),1,'commerce transfer keeps backing attached to the asset');

-- Stock failure occurs before FLOW can move.
select pg_temp.add_backed_flow(
  'bbbbbbbb-0000-4000-8000-000000000003',
  'cccccccc-0000-4000-8000-000000000003',
  'dddddddd-0000-4000-8000-000000000003',
  '11111111-1111-4111-8111-111111111111',1
);
update public.commerce_products set stock=0 where id='99999999-5000-4000-8000-000000000001';
select ok(pg_temp.did_throw($$select public.complete_commerce_flow_qr_sale('11111111-1111-4111-8111-111111111111','flow-product-token','99999999-5000-4000-8000-000000000001',null,1,'99999999-8000-4000-8000-000000000001','ffffffff-1000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111',null,null)$$,'stock'),'stock-insufficient sale is rejected');
select is((select owner_user_id from public.flow_assets where id='dddddddd-0000-4000-8000-000000000003'),'11111111-1111-4111-8111-111111111111'::uuid,'stock failure does not move FLOW asset');
select is((select balance from public.flows_wallets where user_id='11111111-1111-4111-8111-111111111111'),1,'stock failure does not debit buyer wallet');
select is((select count(*)::integer from public.flow_transfer_operations where id='ffffffff-1000-4000-8000-000000000002'),0,'stock failure rolls operation record back');

-- Force a failure after complete_commerce_pos_sale has done its work: the
-- movement guard must roll back order, payment, stock and transfer together.
update public.commerce_products set stock=1 where id='99999999-5000-4000-8000-000000000001';
update public.flow_funding_ledger set custody_stage='reserve_received' where id='cccccccc-0000-4000-8000-000000000003';
select ok(pg_temp.did_throw($$select public.complete_commerce_flow_qr_sale('11111111-1111-4111-8111-111111111111','flow-product-token','99999999-5000-4000-8000-000000000001',null,1,'99999999-8000-4000-8000-000000000001','ffffffff-1000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111',null,null)$$,'perdió respaldo'),'post-order FLOW failure aborts entire commerce transaction');
select is((select stock from public.commerce_products where id='99999999-5000-4000-8000-000000000001'),1,'post-order FLOW failure restores stock');
select is((select count(*)::integer from public.commerce_orders where external_reference='pos:flowqr:ffffffff-1000-4000-8000-000000000003'),0,'post-order FLOW failure rolls order back');
select is((select count(*)::integer from public.commerce_payments where idempotency_key='flowqr:ffffffff-1000-4000-8000-000000000003'),0,'post-order FLOW failure rolls payment back');
select is((select count(*)::integer from public.flow_transfer_operations where id='ffffffff-1000-4000-8000-000000000003'),0,'post-order FLOW failure rolls operation provenance back');
select is((select owner_user_id from public.flow_assets where id='dddddddd-0000-4000-8000-000000000003'),'11111111-1111-4111-8111-111111111111'::uuid,'post-order failure rolls asset ownership back');
select is((select balance from public.flows_wallets where user_id='11111111-1111-4111-8111-111111111111'),1,'post-order failure leaves Mi Flow balance unchanged');

update public.clouva_qr_registry set status='REVOKED',is_canonical=false,revoked_at=now() where id='99999999-7000-4000-8000-000000000001';
select ok(pg_temp.did_throw($$select public.complete_commerce_flow_qr_sale('11111111-1111-4111-8111-111111111111','flow-product-token','99999999-5000-4000-8000-000000000001',null,1,'99999999-8000-4000-8000-000000000001','ffffffff-1000-4000-8000-000000000004','11111111-1111-4111-8111-111111111111',null,null)$$,'qr de producto'),'revoked product QR cannot execute a commerce payment');
select is((select count(*)::integer from public.flows_wallet_ledger where reference_id='ffffffff-1000-4000-8000-000000000001' and metadata->>'qrRegistryId'='99999999-7000-4000-8000-000000000001'),2,'commerce Mi Flow ledger keeps QR provenance');
select is((select external_payment_id from public.commerce_payments where idempotency_key='flowqr:ffffffff-1000-4000-8000-000000000001'),'ffffffff-1000-4000-8000-000000000001','commerce payment keeps canonical transfer id');

select * from finish();
rollback;
