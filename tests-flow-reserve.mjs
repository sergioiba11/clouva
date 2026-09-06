import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const schemaPath = "supabase/migrations/20260905234547_flow_reserve_custody_schema.sql";
const functionsPath = "supabase/migrations/20260905234752_flow_reserve_custody_functions.sql";
const hardeningPath = "supabase/migrations/20260906000513_flow_real_money_checkout_hardening.sql";
const transferPath = "supabase/migrations/20260906002500_flow_backed_transfer_qr.sql";
const separationPath = "supabase/migrations/20260906005627_flow_collection_rail_reserve_separation.sql";

async function source(path) {
  return readFile(new URL(path, `file://${process.cwd()}/`), "utf8");
}

function section(sql, start, end) {
  const from = sql.indexOf(start);
  assert.notEqual(from, -1, `missing ${start}`);
  const to = end ? sql.indexOf(end, from + start.length) : sql.length;
  assert.notEqual(to, -1, `missing ${end}`);
  return sql.slice(from, to);
}

test("FLOW reserve schema has explicit custody accounts and one active allocation per asset", async () => {
  const sql = await source(schemaPath);
  assert.match(sql, /create table if not exists public\.flow_reserve_accounts/i);
  assert.match(sql, /create table if not exists public\.flow_backing_allocations/i);
  assert.match(sql, /flow_backing_allocations_one_active_per_asset/i);
  assert.match(sql, /custody_status/i);
  assert.match(sql, /reserve_account_id/i);
  assert.match(sql, /reference_usd_amount/i);
});

test("backing belongs to the FLOW asset, not its current owner", async () => {
  const sql = await source(schemaPath);
  const backing = section(sql, "create table if not exists public.flow_backing_allocations", "create unique index if not exists flow_backing_allocations_one_active_per_asset");
  assert.match(backing, /flow_asset_id uuid not null references public\.flow_assets\(id\)/i);
  assert.doesNotMatch(backing, /owner_user_id/i);
});

test("cash received remains PENDING_BACKING and does not issue FLOW", async () => {
  const sql = await source(functionsPath);
  const cash = section(sql, "create or replace function public.register_flow_cash_payment", "create or replace function public.confirm_flow_external_payment");
  assert.match(cash, /'confirmed','pending'/i);
  assert.doesNotMatch(cash, /issue_flows_for_operation/i);
});

test("hardening separates required backing from processing fees", async () => {
  const sql = await source(hardeningPath);
  assert.match(sql, /processing_fee_policy text not null default 'clouva_absorbs'/i);
  assert.match(sql, /required_backing_usd numeric/i);
  assert.match(sql, /backing_amount numeric/i);
  assert.match(sql, /processing_fee_amount numeric not null default 0/i);
});

test("collection rail and custody reserve are explicit, mutually exclusive roles", async () => {
  const sql = await source(separationPath);
  assert.match(sql, /flow_account_role text not null default 'reserve'/i);
  assert.match(sql, /authorized_for_collection boolean not null default false/i);
  assert.match(sql, /flow_account_role in \('collection_rail','reserve'\)/i);
  assert.match(sql, /flow_account_role='collection_rail' and authorized_for_flow/i);
  assert.match(sql, /flow_account_role='reserve' and authorized_for_collection/i);
});

test("existing Mercado Pago account is demoted to collection rail, never kept as reserve", async () => {
  const sql = await source(separationPath);
  assert.match(sql, /where provider='mercadopago'/i);
  assert.match(sql, /flow_account_role='collection_rail'/i);
  assert.match(sql, /authorized_for_collection=\(account_reference is not null\)/i);
  assert.match(sql, /authorized_for_flow=false/i);
  assert.match(sql, /processor_only/i);
});

test("Mercado Pago payment confirmation records processor money but cannot issue FLOW", async () => {
  const sql = await source(separationPath);
  const external = section(sql, "create or replace function public.confirm_flow_external_payment", "revoke all on function public.confirm_flow_external_payment");
  assert.match(external, /flow_account_role='collection_rail'/i);
  assert.match(external, /authorized_for_collection/i);
  assert.match(external, /'received_by_processor'/i);
  assert.match(external, /provider_fee,net_amount,reserve_account_id,custody_status,custody_reference,custody_confirmed_at,reference_usd_amount,custody_stage,metadata/i);
  assert.match(external, /v_fee,v_net,null,'pending',null,null,0,'received_by_processor'/i);
  assert.match(external, /reserve_account_id=null/i);
  assert.match(external, /processorIsNotReserve/i);
  assert.doesNotMatch(external, /select public\.issue_flows_for_operation/i);
  assert.doesNotMatch(external, /perform public\.issue_flows_for_operation/i);
});

test("processor net is valued with the operation historical FX", async () => {
  const sql = await source(separationPath);
  const external = section(sql, "create or replace function public.confirm_flow_external_payment", "revoke all on function public.confirm_flow_external_payment");
  assert.match(external, /v_net_reference_usd:=v_net\/v_op\.fx_rate_original_per_usd/i);
  assert.match(external, /processorNetReferenceUsd/i);
});

test("reserve deposit requires real reserve role, real reference and historical FX", async () => {
  const sql = await source(separationPath);
  const deposit = section(sql, "create or replace function public.confirm_flow_reserve_deposit", "revoke all on function public.confirm_flow_reserve_deposit");
  assert.match(deposit, /flow_account_role='reserve'/i);
  assert.match(deposit, /authorized_for_flow/i);
  assert.match(deposit, /account_reference is not null/i);
  assert.match(deposit, /coalesce\(trim\(p_custody_reference\),''\)=''/i);
  assert.match(deposit, /p_amount\/v_op\.fx_rate_original_per_usd/i);
  assert.match(deposit, /No existe un FX histórico/i);
  assert.match(deposit, /entry_type.*'reserve_deposit'/is);
  assert.match(deposit, /'reserve_confirmed'/i);
});

test("reserve deposit cannot confirm more backing than the operation requires", async () => {
  const sql = await source(separationPath);
  const deposit = section(sql, "create or replace function public.confirm_flow_reserve_deposit", "revoke all on function public.confirm_flow_reserve_deposit");
  assert.match(deposit, /v_total_reference_usd>v_op\.required_backing_usd\+0\.02/i);
  assert.match(deposit, /No se puede confirmar más backing/i);
});

test("issuance waits for processor funds to reach reserve and then checks total reserve capacity", async () => {
  const sql = await source(separationPath);
  const issue = section(sql, "create or replace function public.issue_flows_for_operation", "revoke all on function public.issue_flows_for_operation");
  assert.match(issue, /v_required_transfer_usd:=least\(v_required_usd,v_processor_net_usd\)/i);
  assert.match(issue, /entry_type='reserve_deposit'/i);
  assert.match(issue, /processor_funds_not_transferred/i);
  assert.match(issue, /flow_reserve_account_free_usd/i);
  assert.match(issue, /reserve_capacity_insufficient/i);
});

test("issuance sequence remains non-spendable asset -> allocation -> available -> wallet", async () => {
  const sql = await source(separationPath);
  const issue = section(sql, "create or replace function public.issue_flows_for_operation", "revoke all on function public.issue_flows_for_operation");
  const assetAt = issue.lastIndexOf("'pending_payment',v_op.id");
  const allocationAt = issue.lastIndexOf("insert into public.flow_backing_allocations");
  const availableAt = issue.lastIndexOf("update public.flow_assets set status='available'");
  const walletAt = issue.lastIndexOf("perform public.adjust_flows_balance");
  assert.ok(assetAt >= 0);
  assert.ok(allocationAt > assetAt);
  assert.ok(availableAt > allocationAt);
  assert.ok(walletAt > availableAt);
});

test("spendable FLOW requires reserve_deposit custody on a real reserve", async () => {
  const sql = await source(separationPath);
  const guard = section(sql, "create or replace function public.guard_flow_asset_backing", "revoke all on function public.guard_flow_asset_backing");
  assert.match(guard, /r\.flow_account_role='reserve'/i);
  assert.match(guard, /f\.entry_type='reserve_deposit'/i);
  assert.match(guard, /f\.custody_status='confirmed'/i);
  assert.match(guard, /f\.custody_stage in \('reserve_confirmed','allocated'\)/i);
  assert.match(guard, /abs\(b\.reference_usd_value-v_price\)<=0\.000001/i);
});

test("treasury reserve totals exclude processor funding", async () => {
  const sql = await source(separationPath);
  const snapshot = section(sql, "create or replace function public.flow_treasury_snapshot", "revoke all on function public.flow_treasury_snapshot");
  assert.match(snapshot, /flow_account_role='reserve'/i);
  assert.match(snapshot, /entry_type='reserve_deposit'/i);
  assert.match(snapshot, /paymentsAwaitingReserve/i);
  assert.match(snapshot, /fundingByCurrency/i);
});

test("reconciliation detects any processor funding falsely claiming custody", async () => {
  const sql = await source(separationPath);
  const report = section(sql, "create or replace function public.flow_reconciliation_report", "revoke all on function public.flow_reconciliation_report");
  assert.match(report, /processor_funding_claims_custody/i);
  assert.match(report, /collection_rail_marked_as_reserve/i);
  assert.match(report, /wallet_backing_mismatch/i);
  assert.match(report, /reserve_overallocated/i);
});

test("purchase checkout requires the verified Mercado Pago collection rail, not a reserve", async () => {
  const purchase = await source("app/api/flows/purchase/route.ts");
  assert.match(purchase, /\.eq\("account_reference", mpConfig\.userId\)/);
  assert.match(purchase, /\.eq\("flow_account_role", "collection_rail"\)/);
  assert.match(purchase, /\.eq\("authorized_for_collection", true\)/);
  assert.doesNotMatch(purchase, /\.eq\("authorized_for_flow", true\)/);
  assert.match(purchase, /collectionRailAccountId/);
  assert.match(purchase, /processorIsNotReserve: true/);
  assert.match(purchase, /backing_amount: backingAmount/);
  assert.match(purchase, /processing_fee_amount: processingFeeAmount/);
});

test("Mercado Pago authorization verifies identity and authorizes collection only", async () => {
  const route = await source("app/api/admin/flows/treasury/authorize-mercadopago/route.ts");
  assert.match(route, /getCurrentUser\(\)/);
  assert.match(route, /reportedCollectorId !== config\.userId/);
  assert.match(route, /flow_account_role: "collection_rail"/);
  assert.match(route, /authorized_for_collection: true/);
  assert.match(route, /authorized_for_flow: false/);
  assert.match(route, /processorIsNotReserve: true/);
  assert.doesNotMatch(route, /\.from\("flow_reserve_accounts"\)\s*\.insert/s);
});

test("manual reserve confirmation route uses operation historical FX, not a fresh quote", async () => {
  const deposit = await source("app/api/admin/flows/treasury/reserve-deposit/route.ts");
  assert.doesNotMatch(deposit, /getFlowCheckoutQuote/);
  assert.match(deposit, /flow_account_role/);
  assert.match(deposit, /authorized_for_flow/);
  assert.match(deposit, /operation\.fx_rate_original_per_usd/);
  assert.match(deposit, /operation_historical_fx/);
  assert.match(deposit, /custodyReference/);
});

test("real reserve registration refuses to reuse the collection rail", async () => {
  const route = await source("app/api/admin/flows/treasury/reserve-account/route.ts");
  assert.match(route, /flow_account_role === "collection_rail"/);
  assert.match(route, /flow_account_role: "reserve"/);
  assert.match(route, /authorized_for_flow: true/);
  assert.match(route, /authorized_for_collection: false/);
  assert.match(route, /externalAccountCreatedByClouva: false/);
});

test("Mercado Pago webhook records actual net and provider fees from provider data", async () => {
  const webhook = await source("app/api/webhooks/mercadopago/flows/route.ts");
  assert.match(webhook, /transactionDetails\?\.net_received_amount/);
  assert.match(webhook, /fee_details/);
  assert.match(webhook, /providerFee/);
  assert.match(webhook, /netAmount/);
  assert.match(webhook, /collectorId: text\(payment\.collector_id \|\| config\.userId\)/);
});

test("Player wallet exposes payment -> reserve -> available stages", async () => {
  const wallet = await source("app/mi-flow/billetera/flows/page.tsx");
  const assets = await source("app/api/flows/assets/route.ts");
  assert.match(wallet, /PAGO PENDIENTE/);
  assert.match(wallet, /PAGO RECIBIDO · esperando Reserva CLOUVA/);
  assert.match(wallet, /MOVIENDO A RESERVA/);
  assert.match(wallet, /RESPALDO CONFIRMADO/);
  assert.match(wallet, /FLOW DISPONIBLE/);
  assert.match(wallet, /Mercado Pago procesa el cobro; Reserva CLOUVA confirma el respaldo/);
  assert.match(assets, /custody_stage/);
  assert.match(assets, /accountRole/);
});

test("Treasury separates collection rail, Reserve and funds-to-move", async () => {
  const page = await source("app/admin/flows/tesoreria/page.tsx");
  const route = await source("app/api/admin/flows/treasury/route.ts");
  assert.match(page, /Mercado Pago · rail de cobro/);
  assert.match(page, /Reserva CLOUVA · custodia/);
  assert.match(page, /Fondos por mover a Reserva/);
  assert.match(page, /Confirmar ingreso en Reserva/);
  assert.match(route, /collectionAuthorized/);
  assert.match(route, /fundsToMove/);
  assert.match(route, /processorNetReferenceUsd/);
  assert.match(route, /flow_account_role/);
});

test("backed FLOW transfer changes ownership without moving backing", async () => {
  const sql = await source(transferPath);
  const transfer = section(sql, "create or replace function public.transfer_backed_flows", "revoke all on function public.transfer_backed_flows");
  assert.match(sql, /'transfer_out','transfer_in'/i);
  assert.match(transfer, /pg_advisory_xact_lock/i);
  assert.match(transfer, /flow_backing_allocations/i);
  assert.match(transfer, /f\.custody_status='confirmed'/i);
  assert.match(transfer, /set owner_user_id=p_recipient_user_id/i);
  assert.match(transfer, /'backingMoved',false/i);
  assert.doesNotMatch(transfer, /update public\.flow_backing_allocations/i);
});

test("QR payment resolves the recipient from the canonical registry server-side", async () => {
  const route = await source("app/api/flows/transfer/route.ts");
  const resolver = await source("app/q/[identifierId]/page.tsx");
  const card = await source("components/flows/FlowQrPaymentCard.tsx");
  assert.match(route, /from\("clouva_qr_registry"\)/);
  assert.match(route, /\.eq\("is_canonical", true\)/);
  assert.match(route, /registry\.entity_type !== "USER"/);
  assert.match(route, /p_recipient_user_id: recipientUserId/);
  assert.match(route, /idempotency-key/);
  assert.doesNotMatch(route, /body\?\.recipientUserId/);
  assert.match(resolver, /FlowQrPaymentCard/);
  assert.match(card, /\/api\/flows\/transfer/);
  assert.match(card, /crypto\.randomUUID\(\)/);
});
