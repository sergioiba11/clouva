import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const schemaPath = "supabase/migrations/20260905234547_flow_reserve_custody_schema.sql";
const functionsPath = "supabase/migrations/20260905234752_flow_reserve_custody_functions.sql";

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

test("FLOW issuance requires reserve capacity and creates an active 1:1 allocation before wallet credit", async () => {
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

test("positive FLOW wallet credit requires verified backed assets", async () => {
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

test("Mercado Pago reserve contribution is based on net cash and verified collector metadata", async () => {
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
  assert.match(external, /'confirmed'/i);
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

test("treasury reconciliation reports unbacked spendable FLOW and wallet/backing mismatch", async () => {
  const sql = await source(functionsPath);
  const report = section(sql, "create or replace function public.flow_reconciliation_report", "revoke all on function public.confirm_flow_reserve_deposit");
  assert.match(report, /spendable_without_backing_allocation/i);
  assert.match(report, /reserve_overallocated/i);
  assert.match(report, /wallet_backing_mismatch/i);
  assert.match(report, /custody_confirmed_without_account/i);
});

test("server routes keep reserve account identifiers private and calculate deposit USD server-side", async () => {
  const treasury = await source("app/api/admin/flows/treasury/route.ts");
  const deposit = await source("app/api/admin/flows/treasury/reserve-deposit/route.ts");
  const webhook = await source("app/api/webhooks/mercadopago/flows/route.ts");
  assert.match(treasury, /account_reference: account\.account_reference \? `••••\$\{account\.account_reference\.slice\(-6\)\}`/);
  assert.match(deposit, /getFlowCheckoutQuote/);
  assert.match(deposit, /referenceUsdAmount = amount \/ quote\.fxRateOriginalPerUsd/);
  assert.match(webhook, /collectorId: text\(payment\.collector_id \|\| config\.userId\)/);
});
