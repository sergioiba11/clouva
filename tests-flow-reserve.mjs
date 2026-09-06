import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const schemaPath = "supabase/migrations/20260905234547_flow_reserve_custody_schema.sql";
const functionsPath = "supabase/migrations/20260905234752_flow_reserve_custody_functions.sql";
const hardeningPath = "supabase/migrations/20260906000513_flow_real_money_checkout_hardening.sql";

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
  assert.match(sql, /where status='active'/i);
  assert.match(sql, /custody_status/i);
  assert.match(sql, /reserve_account_id/i);
  assert.match(sql, /reference_usd_amount/i);
});

test("backing belongs to the FLOW asset, not to its current owner", async () => {
  const sql = await source(schemaPath);
  const backing = section(
    sql,
    "create table if not exists public.flow_backing_allocations",
    "create unique index if not exists flow_backing_allocations_one_active_per_asset",
  );
  assert.match(backing, /flow_asset_id uuid not null references public\.flow_assets\(id\)/i);
  assert.doesNotMatch(backing, /owner_user_id/i);
  assert.doesNotMatch(backing, /owner_player_id/i);
});

test("cash received remains PENDING_BACKING and does not issue FLOW", async () => {
  const sql = await source(functionsPath);
  const cash = section(
    sql,
    "create or replace function public.register_flow_cash_payment",
    "create or replace function public.confirm_flow_external_payment",
  );
  assert.match(cash, /'confirmed','pending'/i);
  assert.match(cash, /'not_in_reserve'/i);
  assert.match(cash, /'issued',false/i);
  assert.doesNotMatch(cash, /issue_flows_for_operation/i);
  assert.doesNotMatch(cash, /adjust_flows_balance/i);
});

test("baseline reserve issuance requires capacity and creates allocation before wallet credit", async () => {
  const sql = await source(functionsPath);
  const issue = section(
    sql,
    "create or replace function public.issue_flows_for_operation",
    "create or replace function public.register_flow_cash_payment",
  );
  const allocationAt = issue.indexOf("insert into public.flow_backing_allocations");
  const walletAt = issue.lastIndexOf("perform public.adjust_flows_balance");
  assert.ok(allocationAt >= 0, "issuance must create backing allocation");
  assert.ok(walletAt > allocationAt, "wallet credit must happen after backing allocation");
  assert.match(issue, /flow_reserve_account_free_usd/i);
  assert.match(issue, /'backingShortfallUsd'/i);
  assert.match(issue, /'backingStatus','pending'/i);
  assert.match(issue, /reference_usd_value/i);
});

test("baseline positive FLOW wallet credit requires verified backed assets", async () => {
  const sql = await source(functionsPath);
  const adjust = section(
    sql,
    "create or replace function public.adjust_flows_balance",
    "create or replace function public.issue_flows_for_operation",
  );
  assert.match(adjust, /v_op\.backing_status<>'verified'/i);
  assert.match(adjust, /flow_backing_allocations/i);
  assert.match(adjust, /flow_reserve_accounts/i);
  assert.match(adjust, /v_backed_count<>p_amount/i);
});

test("baseline Mercado Pago reserve contribution uses net cash and collector metadata", async () => {
  const sql = await source(functionsPath);
  const external = section(
    sql,
    "create or replace function public.confirm_flow_external_payment",
    "create or replace function public.confirm_flow_reserve_deposit",
  );
  assert.match(external, /v_net:=greatest\(p_amount-v_fee,0\)/i);
  assert.match(external, /v_reference_usd:=v_net\/v_op\.fx_rate_original_per_usd/i);
  assert.match(external, /account_reference=v_collector/i);
  assert.match(external, /custody_status/i);
});

test("reserve deposits are idempotent and attempt issuance only after custody is confirmed", async () => {
  const sql = await source(functionsPath);
  const deposit = section(
    sql,
    "create or replace function public.confirm_flow_reserve_deposit",
    "create or replace function public.record_flow_reserve_release",
  );
  assert.match(deposit, /where idempotency_key=p_idempotency_key/i);
  assert.match(deposit, /'reserve_deposit'/i);
  assert.match(deposit, /'confirmed'/i);
  assert.match(deposit, /select public\.issue_flows_for_operation/i);
});

test("reserve release can only use free reserve", async () => {
  const sql = await source(functionsPath);
  const release = section(
    sql,
    "create or replace function public.record_flow_reserve_release",
    "create or replace function public.record_flow_refund",
  );
  assert.match(release, /v_free:=public\.flow_reserve_account_free_usd/i);
  assert.match(release, /p_reference_usd_amount>v_free/i);
  assert.match(release, /No se puede tocar el respaldo asignado a FLOWS/i);
});

test("refund reverses backing allocations and FLOW assets", async () => {
  const sql = await source(functionsPath);
  const refund = section(
    sql,
    "create or replace function public.record_flow_refund",
    "create or replace function public.flow_treasury_snapshot",
  );
  assert.match(refund, /update public\.flow_backing_allocations/i);
  assert.match(refund, /set status='reversed'/i);
  assert.match(refund, /update public\.flow_assets/i);
  assert.match(refund, /'reversal'/i);
});

test("hardening separates required backing from processing fees", async () => {
  const sql = await source(hardeningPath);
  assert.match(sql, /processing_fee_policy text not null default 'clouva_absorbs'/i);
  assert.match(sql, /required_backing_usd numeric/i);
  assert.match(sql, /backing_amount numeric/i);
  assert.match(sql, /processing_fee_amount numeric not null default 0/i);
  const issue = section(sql, "create or replace function public.issue_flows_for_operation", "revoke all on function public.issue_flows_for_operation");
  assert.match(issue, /v_required_usd:=v_op\.quantity\*v_price/i);
  assert.match(issue, /v_op\.amount\+0\.01<v_op\.backing_amount/i);
  assert.match(issue, /processing_fee_amount-greatest\(v_op\.amount-v_op\.backing_amount,0\)/i);
});

test("hardening never auto-creates or auto-binds a reserve from webhook collector metadata", async () => {
  const sql = await source(hardeningPath);
  const external = section(sql, "create or replace function public.confirm_flow_external_payment", "revoke all on function public.confirm_flow_external_payment");
  assert.match(external, /account_reference=v_collector/i);
  assert.match(external, /authorized_for_flow and is_active and status='active'/i);
  assert.match(external, /collector_not_authorized/i);
  assert.match(external, /'not_in_reserve'/i);
  assert.doesNotMatch(external, /insert into public\.flow_reserve_accounts/i);
  assert.doesNotMatch(external, /update public\.flow_reserve_accounts/i);
});

test("spendable FLOW requires an active 1:1 allocation funded by authorized custody", async () => {
  const sql = await source(hardeningPath);
  const guard = section(sql, "create or replace function public.guard_flow_asset_backing", "revoke all on function public.guard_flow_asset_backing");
  assert.match(guard, /flow_backing_allocations/i);
  assert.match(guard, /abs\(b\.reference_usd_value-v_price\)<=0\.000001/i);
  assert.match(guard, /r\.authorized_for_flow/i);
  assert.match(guard, /f\.custody_status='confirmed'/i);
  assert.match(guard, /f\.reserve_account_id=r\.id/i);
});

test("issuance creates the asset non-spendable, allocates backing, then makes it available", async () => {
  const sql = await source(hardeningPath);
  const issue = section(sql, "create or replace function public.issue_flows_for_operation", "revoke all on function public.issue_flows_for_operation");
  const assetAt = issue.lastIndexOf("'pending_payment',v_op.id");
  const allocationAt = issue.lastIndexOf("insert into public.flow_backing_allocations");
  const availableAt = issue.lastIndexOf("update public.flow_assets set status='available'");
  const walletAt = issue.lastIndexOf("perform public.adjust_flows_balance");
  assert.ok(assetAt >= 0, "new asset must start non-spendable");
  assert.ok(allocationAt > assetAt, "allocation must follow asset creation");
  assert.ok(availableAt > allocationAt, "asset can become available only after allocation");
  assert.ok(walletAt > availableAt, "wallet credit must happen after spendability is backed");
  assert.match(issue, /where authorized_for_flow and is_active and status='active' and account_reference is not null/i);
});

test("wallet credit and treasury reconciliation only count authorized reserve backing", async () => {
  const sql = await source(hardeningPath);
  const adjust = section(sql, "create or replace function public.adjust_flows_balance", "revoke all on function public.adjust_flows_balance");
  const report = section(sql, "create or replace function public.flow_reconciliation_report", "revoke all on function public.flow_reconciliation_report");
  assert.match(adjust, /r\.authorized_for_flow/i);
  assert.match(adjust, /flow_reserve_account_free_usd\(r\.id\)<-0\.000001/i);
  assert.match(report, /spendable_without_backing_allocation/i);
  assert.match(report, /spendable_with_invalid_reserve/i);
  assert.match(report, /custody_confirmed_without_authorized_account/i);
  assert.match(report, /reserve_overallocated/i);
  assert.match(report, /wallet_backing_mismatch/i);
});

test("reserve authorization cannot be silently removed while it backs active FLOW", async () => {
  const sql = await source(hardeningPath);
  const guard = section(sql, "create or replace function public.guard_flow_reserve_account_authorization", "revoke all on function public.guard_flow_reserve_account_authorization");
  assert.match(guard, /flow_backing_allocations/i);
  assert.match(guard, /not new\.authorized_for_flow/i);
  assert.match(guard, /new\.account_reference is distinct from old\.account_reference/i);
});

test("purchase checkout requires an explicitly authorized Mercado Pago reserve and stores the breakdown", async () => {
  const purchase = await source("app/api/flows/purchase/route.ts");
  assert.match(purchase, /getMercadoPagoConfig/);
  assert.match(purchase, /\.eq\("account_reference", mpConfig\.userId\)/);
  assert.match(purchase, /\.eq\("authorized_for_flow", true\)/);
  assert.match(purchase, /requiredBackingUsd/);
  assert.match(purchase, /backing_amount: backingAmount/);
  assert.match(purchase, /processing_fee_amount: processingFeeAmount/);
  assert.match(purchase, /processingFeePolicy === "customer_buffer"/);
  assert.doesNotMatch(purchase, /insert\([^)]*flow_reserve_accounts/i);
});

test("reserve authorization verifies Mercado Pago identity and updates an existing account only", async () => {
  const route = await source("app/api/admin/flows/treasury/authorize-mercadopago/route.ts");
  assert.match(route, /getCurrentUser\(\)/);
  assert.match(route, /reportedCollectorId !== config\.userId/);
  assert.match(route, /authorizationMode: "explicit_admin_verified_provider"/);
  assert.match(route, /authorized_for_flow: true/);
  assert.match(route, /account_reference: config\.userId/);
  assert.doesNotMatch(route, /\.from\("flow_reserve_accounts"\)\s*\.insert/s);
});

test("Mercado Pago webhook records actual net and provider fees from provider data", async () => {
  const webhook = await source("app/api/webhooks/mercadopago/flows/route.ts");
  assert.match(webhook, /transaction_details\?\.net_received_amount/);
  assert.match(webhook, /fee_details/);
  assert.match(webhook, /providerFee/);
  assert.match(webhook, /netAmount/);
  assert.match(webhook, /collectorId: text\(payment\.collector_id \|\| config\.userId\)/);
});

test("server routes keep reserve identifiers masked and calculate manual deposit USD server-side", async () => {
  const treasury = await source("app/api/admin/flows/treasury/route.ts");
  const deposit = await source("app/api/admin/flows/treasury/reserve-deposit/route.ts");
  assert.match(treasury, /function maskReference/);
  assert.match(treasury, /account_reference: maskReference\(account\.account_reference\)/);
  assert.match(deposit, /getFlowCheckoutQuote/);
  assert.match(deposit, /referenceUsdAmount = amount \/ quote\.fxRateOriginalPerUsd/);
});

test("Player wallet displays backing, processing and authorized reserve state", async () => {
  const wallet = await source("app/mi-flow/billetera/flows/page.tsx");
  const assets = await source("app/api/flows/assets/route.ts");
  assert.match(wallet, /Valor de respaldo/);
  assert.match(wallet, /Costo procesamiento/);
  assert.match(wallet, /Cada FLOW queda respaldado 1:1 por dinero real dentro de la Reserva CLOUVA/);
  assert.match(wallet, /authorizedForFlow/);
  assert.match(assets, /authorized_for_flow/);
  assert.match(assets, /processingFeePolicy/);
});

test("treasury exposes reserve deficit, authorization and actual fee/net state", async () => {
  const page = await source("app/admin/flows/tesoreria/page.tsx");
  const route = await source("app/api/admin/flows/treasury/route.ts");
  assert.match(page, /reserveDeficit/);
  assert.match(page, /Verificar y autorizar como Reserva FLOW/);
  assert.match(page, /Fees proveedor reales/);
  assert.match(route, /reserveAuthorized/);
  assert.match(route, /required_backing_usd/);
  assert.match(route, /processing_fee_amount/);
});
