\set ON_ERROR_STOP on

insert into auth.users(id) values
  ('51515151-1111-4111-8111-111111111111'),
  ('52525252-2222-4222-8222-222222222222')
on conflict(id) do nothing;
insert into public.profiles(id) values
  ('51515151-1111-4111-8111-111111111111'),
  ('52525252-2222-4222-8222-222222222222')
on conflict(id) do nothing;
insert into public.players(id,owner_user_id,slug,display_name,is_published,publication_status,privacy_status)
values
  ('51515151-aaaa-4111-8111-111111111111','51515151-1111-4111-8111-111111111111','flow-concurrency-sender','Concurrency Sender',true,'published','public'),
  ('52525252-aaaa-4222-8222-222222222222','52525252-2222-4222-8222-222222222222','flow-concurrency-recipient','Concurrency Recipient',true,'published','public')
on conflict(id) do nothing;

insert into public.flow_reserve_accounts(
  id,name,provider,account_type,currency,account_reference,status,is_active,
  authorized_for_flow,authorized_at,flow_account_role,authorized_for_collection
) values (
  '5aaaaaaa-0000-4000-8000-000000000001','Concurrency reserve','test','custody','USD','CONCURRENCY-RESERVE','active',true,
  true,now(),'reserve',false
);
insert into public.flow_purchase_operations(
  id,buyer_user_id,buyer_player_id,recipient_user_id,recipient_player_id,
  provider,provider_reference,payment_method,quantity,unit_usd,amount,currency,
  status,confirmed_at,issued_at,backing_status,fx_rate_original_per_usd,fx_source,
  fx_quoted_at,operation_type,provider_fee,net_amount,required_backing_usd,
  backing_amount,processing_fee_amount,processing_fee_policy
) values (
  '5bbbbbbb-0000-4000-8000-000000000001','51515151-1111-4111-8111-111111111111','51515151-aaaa-4111-8111-111111111111',
  '51515151-1111-4111-8111-111111111111','51515151-aaaa-4111-8111-111111111111',
  'test','flow-concurrency-operation','test',1,1,1,'USD','confirmed',now(),now(),'verified',1,'test',now(),
  'purchase_new',0,1,1,1,0,'clouva_absorbs'
);
insert into public.flow_funding_ledger(
  id,operation_id,entry_type,provider,payment_method,amount,currency,status,idempotency_key,
  net_amount,reserve_account_id,custody_status,custody_reference,custody_confirmed_at,
  reference_usd_amount,custody_stage
) values (
  '5ccccccc-0000-4000-8000-000000000001','5bbbbbbb-0000-4000-8000-000000000001','reserve_deposit','test','test',1,'USD','confirmed',
  'flow-concurrency-funding',1,'5aaaaaaa-0000-4000-8000-000000000001','confirmed','CONCURRENCY-CUSTODY',now(),1,'allocated'
);
insert into public.flow_assets(
  id,operation_id,operation_unit,owner_user_id,owner_player_id,original_buyer_user_id,
  original_buyer_player_id,status,backing_operation_id
) values (
  '5ddddddd-0000-4000-8000-000000000001','5bbbbbbb-0000-4000-8000-000000000001',1,
  '51515151-1111-4111-8111-111111111111','51515151-aaaa-4111-8111-111111111111',
  '51515151-1111-4111-8111-111111111111','51515151-aaaa-4111-8111-111111111111','pending_payment',
  '5bbbbbbb-0000-4000-8000-000000000001'
);
insert into public.flow_backing_allocations(flow_asset_id,reserve_account_id,funding_entry_id,reference_usd_value,status)
values ('5ddddddd-0000-4000-8000-000000000001','5aaaaaaa-0000-4000-8000-000000000001','5ccccccc-0000-4000-8000-000000000001',1,'active');
update public.flow_assets set status='available',backed_at=now(),activated_at=now() where id='5ddddddd-0000-4000-8000-000000000001';
insert into public.flows_wallets(user_id,balance) values
  ('51515151-1111-4111-8111-111111111111',1),
  ('52525252-2222-4222-8222-222222222222',0)
on conflict(user_id) do update set balance=excluded.balance,updated_at=now();
insert into public.clouva_qr_registry(id,public_token,entity_type,entity_id,status,is_canonical)
values ('5eeeeeee-0000-4000-8000-000000000001','flow-concurrency-recipient','USER','52525252-2222-4222-8222-222222222222','ACTIVE',true);
