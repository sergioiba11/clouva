from pathlib import Path
import re

ROOT = Path.cwd()


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding='utf-8')


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding='utf-8')


def replace_once(path: str, old: str, new: str, label: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected exactly one match in {path}, found {count}')
    write(path, text.replace(old, new, 1))


def regex_once(path: str, pattern: str, replacement: str, label: str) -> None:
    text = read(path)
    new_text, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f'{label}: expected exactly one regex match in {path}, found {count}')
    write(path, new_text)


write('lib/agenda/participation-policy.ts', r'''export type AgendaConnectionStatus = "pending" | "active" | "declined" | "revoked" | null;

export function isSelectableAgendaMember(status: AgendaConnectionStatus | string | undefined) {
  return status === "active" || status === "pending";
}

export function shouldDeliverAgendaInvitation(status: AgendaConnectionStatus | string | undefined) {
  return status == null || status === "declined" || status === "revoked";
}

export function eventProjectionForConnection(status: AgendaConnectionStatus | string | undefined) {
  if (status === "active") return { rsvpStatus: "accepted" as const, projectToAgenda: true };
  if (status === "declined" || status === "revoked") return { rsvpStatus: "declined" as const, projectToAgenda: false };
  return { rsvpStatus: "pending" as const, projectToAgenda: false };
}

export function signedDirection(amount: number) {
  return amount < 0 ? "debit" as const : "credit" as const;
}
''')

write('lib/server/agenda/timeline.ts', r'''import "server-only";

import { signedDirection } from "@/lib/agenda/participation-policy";
import { createAdminSupabase } from "@/lib/server/supabase";

type AdminClient = ReturnType<typeof createAdminSupabase>;

export type AgendaTimelineItem = {
  id: string;
  type: "financial" | "flow" | "diamond";
  occurredAt: string;
  source: string;
  title: string;
  amount: number;
  currency: string;
  direction: "credit" | "debit";
  referenceId: string | null;
  metadata: Record<string, unknown>;
};

type MoneyRow = {
  id: string;
  currency: string;
  source_type: string;
  source_id: string;
  net_amount_minor: number;
  status: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type WalletRow = {
  id: string;
  transaction_type: string;
  amount: number;
  source: string | null;
  reference_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

function asRangeIso(value: string, field: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`${field} inválido.`);
  return date.toISOString();
}

function metadataSource(metadata: Record<string, unknown>, fallback: string) {
  const values = [metadata.payment_provider, metadata.provider, metadata.wallet, metadata.source];
  const value = values.find((entry) => typeof entry === "string" && entry.trim());
  return typeof value === "string" ? value.trim() : fallback;
}

function moneyTitle(row: MoneyRow) {
  const metadata = row.metadata || {};
  const explicit = [metadata.title, metadata.description, metadata.merchant_name, metadata.store_name]
    .find((entry) => typeof entry === "string" && entry.trim());
  if (typeof explicit === "string") return explicit.trim();
  const labels: Record<string, string> = {
    commerce_order: "Venta / compra registrada",
    service_order: "Servicio",
    booking: "Reserva",
  };
  return labels[row.source_type] || "Movimiento económico";
}

function flowTitle(transactionType: string) {
  const labels: Record<string, string> = {
    purchase: "Compra de FLOWS",
    reward: "Recompensa de FLOWS",
    refund: "Reintegro de FLOWS",
    ai_usage: "Uso de CLOUVA AI",
    avatar_purchase: "Compra para avatar",
    marketplace_purchase: "Compra en Market",
    admin_adjustment: "Ajuste de FLOWS",
    promotional_credit: "Crédito promocional",
    issuance: "Emisión de FLOWS",
    transfer: "Transferencia de FLOWS",
  };
  return labels[transactionType] || transactionType.replaceAll("_", " ");
}

function walletAdapter(rows: WalletRow[], type: "flow" | "diamond", currency: "FLOW" | "DIAMOND") {
  return rows.map<AgendaTimelineItem>((row) => ({
    id: `${type}:${row.id}`,
    type,
    occurredAt: row.created_at,
    source: row.source || (type === "flow" ? "Mi Flow" : "CLOUVA"),
    title: type === "flow" ? flowTitle(row.transaction_type) : "Movimiento de Diamonds",
    amount: Number(row.amount || 0),
    currency,
    direction: signedDirection(Number(row.amount || 0)),
    referenceId: row.reference_id || null,
    metadata: row.metadata || {},
  }));
}

export async function getAgendaFinancialTimeline(args: {
  admin: AdminClient;
  userId: string;
  from: string;
  to: string;
}): Promise<AgendaTimelineItem[]> {
  const from = asRangeIso(args.from, "Desde");
  const to = asRangeIso(args.to, "Hasta");
  const fromMs = new Date(from).getTime();
  const toMs = new Date(to).getTime();
  if (toMs <= fromMs) throw new Error("El rango de la línea temporal es inválido.");
  if (toMs - fromMs > 400 * 86_400_000) throw new Error("El rango máximo de la línea temporal es 400 días.");

  const [moneyResult, flowsResult, diamondsResult] = await Promise.all([
    args.admin
      .from("mi_flow_money_ledger")
      .select("id,currency,source_type,source_id,net_amount_minor,status,metadata,created_at")
      .eq("beneficiary_user_id", args.userId)
      .gte("created_at", from)
      .lt("created_at", to)
      .order("created_at", { ascending: true })
      .limit(1000),
    args.admin
      .from("flows_wallet_ledger")
      .select("id,transaction_type,amount,source,reference_id,metadata,created_at")
      .eq("user_id", args.userId)
      .gte("created_at", from)
      .lt("created_at", to)
      .order("created_at", { ascending: true })
      .limit(1000),
    args.admin
      .from("diamond_wallet_ledger")
      .select("id,transaction_type,amount,source,reference_id,metadata,created_at")
      .eq("user_id", args.userId)
      .gte("created_at", from)
      .lt("created_at", to)
      .order("created_at", { ascending: true })
      .limit(1000),
  ]);

  for (const result of [moneyResult, flowsResult, diamondsResult]) {
    if (result.error) throw new Error(result.error.message);
  }

  const money = ((moneyResult.data ?? []) as MoneyRow[]).map<AgendaTimelineItem>((row) => {
    const metadata = row.metadata || {};
    const refunded = row.status === "refunded" || row.status === "reversed";
    const baseAmount = Math.abs(Number(row.net_amount_minor || 0)) / 100;
    const amount = refunded ? -baseAmount : baseAmount;
    return {
      id: `money:${row.id}`,
      type: "financial",
      occurredAt: row.created_at,
      source: metadataSource(metadata, row.source_type === "commerce_order" ? "Mi Flow" : row.source_type),
      title: moneyTitle(row),
      amount,
      currency: row.currency,
      direction: signedDirection(amount),
      referenceId: row.source_id || null,
      metadata: { ...metadata, status: row.status, sourceType: row.source_type },
    };
  });

  const items = [
    ...money,
    ...walletAdapter((flowsResult.data ?? []) as WalletRow[], "flow", "FLOW"),
    ...walletAdapter((diamondsResult.data ?? []) as WalletRow[], "diamond", "DIAMOND"),
  ];

  return items.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
}
''')

write('app/api/agenda/timeline/route.ts', r'''import { NextRequest, NextResponse } from "next/server";
import { getAgendaFinancialTimeline } from "@/lib/server/agenda/timeline";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const from = request.nextUrl.searchParams.get("from") || "";
    const to = request.nextUrl.searchParams.get("to") || "";
    if (!from || !to) return NextResponse.json({ error: "from y to son obligatorios." }, { status: 400 });
    const items = await getAgendaFinancialTimeline({
      admin: createAdminSupabase(),
      userId: user.id,
      from,
      to,
    });
    return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo cargar la economía de Agenda." }, { status });
  }
}
''')

write('supabase/migrations/20260904050000_agenda_notification_actor_context.sql', r'''alter table public.notifications
  add column if not exists actor_player_id uuid references public.players(id) on delete set null,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists notifications_actor_player_idx
  on public.notifications(actor_player_id, created_at desc);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end
$$;
''')

write('tests-agenda-life-timeline.mjs', r'''import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  eventProjectionForConnection,
  isSelectableAgendaMember,
  shouldDeliverAgendaInvitation,
  signedDirection,
} from "./lib/agenda/participation-policy.ts";

test("pending y active se pueden seleccionar para crear evento", () => {
  assert.equal(isSelectableAgendaMember("pending"), true);
  assert.equal(isSelectableAgendaMember("active"), true);
  assert.equal(isSelectableAgendaMember("declined"), false);
  assert.equal(isSelectableAgendaMember("revoked"), false);
  assert.equal(isSelectableAgendaMember(null), false);
});

test("una invitación pendiente o activa no vuelve a disparar canales", () => {
  assert.equal(shouldDeliverAgendaInvitation(null), true);
  assert.equal(shouldDeliverAgendaInvitation("declined"), true);
  assert.equal(shouldDeliverAgendaInvitation("revoked"), true);
  assert.equal(shouldDeliverAgendaInvitation("pending"), false);
  assert.equal(shouldDeliverAgendaInvitation("active"), false);
});

test("la proyección del evento espera aceptación de conexión", () => {
  assert.deepEqual(eventProjectionForConnection("pending"), { rsvpStatus: "pending", projectToAgenda: false });
  assert.deepEqual(eventProjectionForConnection("active"), { rsvpStatus: "accepted", projectToAgenda: true });
  assert.deepEqual(eventProjectionForConnection("declined"), { rsvpStatus: "declined", projectToAgenda: false });
});

test("dirección económica conserva signo", () => {
  assert.equal(signedDirection(10), "credit");
  assert.equal(signedDirection(-10), "debit");
  assert.equal(signedDirection(0), "credit");
});

test("Agenda valida conexión y no duplica economía en agenda_events", () => {
  const agenda = fs.readFileSync("lib/server/agenda/index.ts", "utf8");
  const timeline = fs.readFileSync("lib/server/agenda/timeline.ts", "utf8");
  assert.match(agenda, /AGENDA_CONNECTION_REQUIRED/);
  assert.match(agenda, /participantMembershipStatus/);
  assert.match(agenda, /projectToAgenda/);
  assert.match(agenda, /synchronizedEvents/);
  assert.doesNotMatch(timeline, /\.from\("agenda_events"\).*insert/s);
  assert.match(timeline, /flows_wallet_ledger/);
  assert.match(timeline, /mi_flow_money_ledger/);
});
''')

replace_once(
    'lib/server/agenda/index.ts',
    'import type { SupabaseClient } from "@supabase/supabase-js";\nimport { requirePlayerBasics } from "@/lib/server/player-basics";',
    'import type { SupabaseClient } from "@supabase/supabase-js";\nimport { eventProjectionForConnection, isSelectableAgendaMember, shouldDeliverAgendaInvitation } from "@/lib/agenda/participation-policy";\nimport { requirePlayerBasics } from "@/lib/server/player-basics";',
    'agenda policy import',
)

replace_once(
    'lib/server/agenda/index.ts',
    '  const recurrenceRule = cleanText(args.input.recurrenceRule, 1000) || null;\n\n  const { data: event, error } = await args.admin',
    '''  const recurrenceRule = cleanText(args.input.recurrenceRule, 1000) || null;

  const requestedParticipantIds = unique(
    ((Array.isArray(args.input.participantPlayerIds) ? args.input.participantPlayerIds : [])
      .filter(isUuid) as string[])
      .filter((playerId) => playerId !== access.playerId),
  );
  const participantMembershipStatus = new Map<string, string>();
  if (requestedParticipantIds.length) {
    const { data: memberRows, error: memberError } = await args.admin
      .from("agenda_members")
      .select("player_id,status")
      .eq("agenda_id", args.agendaId)
      .in("player_id", requestedParticipantIds);
    if (memberError) throw new Error(memberError.message);
    for (const member of memberRows ?? []) {
      participantMembershipStatus.set(String(member.player_id), String(member.status));
    }
    const invalidPlayerIds = requestedParticipantIds.filter(
      (playerId) => !isSelectableAgendaMember(participantMembershipStatus.get(playerId)),
    );
    if (invalidPlayerIds.length) {
      throw typedError(
        "Invitá al Player a conectar esta Agenda antes de compartir el evento.",
        409,
        "AGENDA_CONNECTION_REQUIRED",
      );
    }
  }

  const { data: event, error } = await args.admin''',
    'agenda participant validation',
)

regex_once(
    'lib/server/agenda/index.ts',
    r'''  const participantIds = unique\(\[\n    access\.playerId,\n    \.\.\.\(\(Array\.isArray\(args\.input\.participantPlayerIds\)[\s\S]*?\n  \}\n\n  const shareAgendaIds = unique''',
    '''  const participantIds = unique([access.playerId, ...requestedParticipantIds]);

  if (participantIds.length) {
    const participantRows = participantIds.map((playerId) => ({
      event_id: eventId,
      player_id: playerId,
      role: playerId === access.playerId ? "host" : "participant",
      rsvp_status: playerId === access.playerId ? "accepted" : "pending",
      invited_by_player_id: access.playerId,
    }));
    const { error: participantError } = await args.admin
      .from("agenda_event_participants")
      .upsert(participantRows, { onConflict: "event_id,player_id" });
    if (participantError) throw new Error(participantError.message);

    const projectedParticipantIds = unique([
      access.playerId,
      ...requestedParticipantIds.filter((playerId) => participantMembershipStatus.get(playerId) === "active"),
    ]);
    const { data: playerAgendas, error: playerAgendaError } = projectedParticipantIds.length
      ? await args.admin
          .from("agendas")
          .select("id,owner_player_id")
          .in("owner_player_id", projectedParticipantIds)
          .eq("is_default", true)
      : { data: [], error: null };
    if (playerAgendaError) throw new Error(playerAgendaError.message);
    const links = (playerAgendas ?? [])
      .filter((agenda) => String(agenda.id) !== args.agendaId)
      .map((agenda) => ({ event_id: eventId, agenda_id: agenda.id, relation: "invited" }));
    if (links.length) {
      const { error: linksError } = await args.admin
        .from("agenda_event_agendas")
        .upsert(links, { onConflict: "event_id,agenda_id" });
      if (linksError) throw new Error(linksError.message);
    }
  }

  const shareAgendaIds = unique''',
    'agenda participant projection block',
)

regex_once(
    'lib/server/agenda/index.ts',
    r'''export async function inviteAgendaMember\(args: \{[\s\S]*?\n\}\n\nexport async function respondAgendaInvite''',
    '''export async function inviteAgendaMember(args: {
  admin: AdminClient;
  userId: string;
  agendaId: string;
  playerId: string;
  role: "viewer" | "participant" | "editor";
}) {
  const access = await resolveAgendaAccess({ admin: args.admin, userId: args.userId, agendaId: args.agendaId });
  if (access.role !== "owner" && access.role !== "editor") {
    throw typedError("No podés compartir esta Agenda.", 403, "AGENDA_SHARE_FORBIDDEN");
  }
  if (!isUuid(args.playerId) || !["viewer", "participant", "editor"].includes(args.role)) {
    throw typedError("Invitación inválida.");
  }
  if (args.playerId === access.playerId) throw typedError("Tu Player ya tiene acceso a esta Agenda.");

  const { data: existing, error: existingError } = await args.admin
    .from("agenda_members")
    .select("status,role,invitation_token")
    .eq("agenda_id", args.agendaId)
    .eq("player_id", args.playerId)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);

  if (existing && !shouldDeliverAgendaInvitation(String(existing.status))) {
    return {
      agendaId: args.agendaId,
      playerId: args.playerId,
      status: String(existing.status),
      role: String(existing.role),
      invitationToken: existing.invitation_token ? String(existing.invitation_token) : null,
      invitedByPlayerId: access.playerId,
      shouldDeliver: false as const,
    };
  }

  const resetDelivery = {
    role: args.role,
    status: "pending",
    invited_by_player_id: access.playerId,
    accepted_at: null,
    declined_at: null,
    cancelled_at: null,
    email_delivery_status: "queued",
    email_provider_message_id: null,
    whatsapp_delivery_status: "queued",
    whatsapp_provider_message_id: null,
    notification_id: null,
  };

  const mutation = existing
    ? args.admin
        .from("agenda_members")
        .update({ ...resetDelivery, invitation_token: crypto.randomUUID() })
        .eq("agenda_id", args.agendaId)
        .eq("player_id", args.playerId)
    : args.admin
        .from("agenda_members")
        .insert({ agenda_id: args.agendaId, player_id: args.playerId, ...resetDelivery });

  const { data: invitation, error } = await mutation
    .select("status,role,invitation_token")
    .single();
  if (error) throw new Error(error.message);

  return {
    agendaId: args.agendaId,
    playerId: args.playerId,
    status: "pending" as const,
    role: String(invitation.role),
    invitationToken: invitation.invitation_token ? String(invitation.invitation_token) : null,
    invitedByPlayerId: access.playerId,
    shouldDeliver: true as const,
  };
}

export async function respondAgendaInvite''',
    'replace inviteAgendaMember',
)

regex_once(
    'lib/server/agenda/index.ts',
    r'''export async function respondAgendaInvite\(args: \{[\s\S]*?\n\}\n\nexport async function getAgendaAvailability''',
    '''export async function respondAgendaInvite(args: {
  admin: AdminClient;
  userId: string;
  agendaId: string;
  accept: boolean;
}) {
  const player = await loadActor(args.admin, args.userId);
  const nextStatus = args.accept ? "active" : "declined";
  const projection = eventProjectionForConnection(nextStatus);

  const { data: membership, error: membershipError } = await args.admin
    .from("agenda_members")
    .select("status")
    .eq("agenda_id", args.agendaId)
    .eq("player_id", player.id)
    .maybeSingle();
  if (membershipError) throw new Error(membershipError.message);
  if (!membership) throw typedError("No hay una invitación para esta Agenda.", 404, "AGENDA_INVITE_NOT_FOUND");

  if (String(membership.status) !== nextStatus) {
    if (String(membership.status) !== "pending") {
      throw typedError("La invitación ya fue resuelta.", 409, "AGENDA_INVITE_ALREADY_RESOLVED");
    }
    const now = new Date().toISOString();
    const { data: updated, error } = await args.admin
      .from("agenda_members")
      .update({
        status: nextStatus,
        accepted_at: args.accept ? now : null,
        declined_at: args.accept ? null : now,
      })
      .eq("agenda_id", args.agendaId)
      .eq("player_id", player.id)
      .eq("status", "pending")
      .select("status")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!updated) {
      const { data: current, error: currentError } = await args.admin
        .from("agenda_members")
        .select("status")
        .eq("agenda_id", args.agendaId)
        .eq("player_id", player.id)
        .maybeSingle();
      if (currentError) throw new Error(currentError.message);
      if (String(current?.status || "") !== nextStatus) {
        throw typedError("La invitación cambió mientras la estabas respondiendo.", 409, "AGENDA_INVITE_RACE");
      }
    }
  }

  const { data: ownedEvents, error: eventError } = await args.admin
    .from("agenda_events")
    .select("id")
    .eq("primary_agenda_id", args.agendaId);
  if (eventError) throw new Error(eventError.message);
  const eventIds = (ownedEvents ?? []).map((event) => String(event.id));

  let participantEventIds: string[] = [];
  if (eventIds.length) {
    const { data: participantRows, error: participantError } = await args.admin
      .from("agenda_event_participants")
      .select("event_id")
      .eq("player_id", player.id)
      .in("event_id", eventIds);
    if (participantError) throw new Error(participantError.message);
    participantEventIds = (participantRows ?? []).map((row) => String(row.event_id));

    if (participantEventIds.length) {
      const { error: rsvpError } = await args.admin
        .from("agenda_event_participants")
        .update({ rsvp_status: projection.rsvpStatus })
        .eq("player_id", player.id)
        .in("event_id", participantEventIds);
      if (rsvpError) throw new Error(rsvpError.message);
    }
  }

  const { data: playerAgenda, error: playerAgendaError } = await args.admin
    .from("agendas")
    .select("id")
    .eq("owner_player_id", player.id)
    .eq("is_default", true)
    .maybeSingle();
  if (playerAgendaError) throw new Error(playerAgendaError.message);

  if (playerAgenda && participantEventIds.length) {
    if (projection.projectToAgenda) {
      const { error: linkError } = await args.admin
        .from("agenda_event_agendas")
        .upsert(
          participantEventIds.map((eventId) => ({ event_id: eventId, agenda_id: playerAgenda.id, relation: "invited" })),
          { onConflict: "event_id,agenda_id" },
        );
      if (linkError) throw new Error(linkError.message);
    } else {
      const { error: unlinkError } = await args.admin
        .from("agenda_event_agendas")
        .delete()
        .eq("agenda_id", playerAgenda.id)
        .eq("relation", "invited")
        .in("event_id", participantEventIds);
      if (unlinkError) throw new Error(unlinkError.message);
    }
  }

  return { agendaId: args.agendaId, status: nextStatus, synchronizedEvents: participantEventIds.length };
}

export async function getAgendaAvailability''',
    'replace respondAgendaInvite',
)

write('app/api/agenda/connections/route.ts', r'''import { NextRequest, NextResponse } from "next/server";
import { inviteAgendaMember, respondAgendaInvite } from "@/lib/server/agenda";
import { sendAgendaInvitationEmail } from "@/lib/server/agenda-invitation-email";
import { sendAgendaInvitationWhatsApp } from "@/lib/server/agenda-invitation-whatsapp";
import { listAgendaConnections, listPendingAgendaInvites } from "@/lib/server/agenda/settings";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function apiError(error: unknown, fallback: string) {
  const typed = error as Error & { status?: number; code?: string };
  return NextResponse.json(
    { error: error instanceof Error ? error.message : fallback, ...(typed.code ? { code: typed.code } : {}) },
    { status: typed.status ?? (isAuthError(error) ? 401 : 500) },
  );
}

async function saveDelivery(
  admin: ReturnType<typeof createAdminSupabase>,
  agendaId: string,
  playerId: string,
  channel: "email" | "whatsapp" | "notification",
  result: { status: string; reason?: string; providerMessageId?: string | null },
) {
  const { data: current } = await admin
    .from("agenda_invitation_deliveries")
    .select("attempts")
    .eq("agenda_id", agendaId)
    .eq("player_id", playerId)
    .eq("channel", channel)
    .maybeSingle();
  await admin.from("agenda_invitation_deliveries").upsert(
    {
      agenda_id: agendaId,
      player_id: playerId,
      channel,
      status: result.status,
      provider_message_id: result.providerMessageId || null,
      failure_reason: result.reason || null,
      attempts: Number(current?.attempts || 0) + 1,
      last_attempt_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "agenda_id,player_id,channel" },
  );
}

function providerMessageId(result: object) {
  return "providerMessageId" in result && typeof result.providerMessageId === "string"
    ? result.providerMessageId
    : null;
}

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const admin = createAdminSupabase();
    const agendaId = request.nextUrl.searchParams.get("agendaId") || "";
    const [invitations, connections] = await Promise.all([
      listPendingAgendaInvites({ admin, userId: user.id }),
      agendaId ? listAgendaConnections({ admin, userId: user.id, agendaId }) : Promise.resolve([]),
    ]);
    return NextResponse.json({ invitations, connections }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error, "No se pudieron cargar las conexiones.");
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const body = await request.json().catch(() => ({})) as {
      agendaId?: string;
      playerId?: string;
      role?: "viewer" | "participant" | "editor";
    };
    if (!body.agendaId || !body.playerId || !body.role) {
      return NextResponse.json({ error: "agendaId, playerId y role son obligatorios." }, { status: 400 });
    }

    const admin = createAdminSupabase();
    const result = await inviteAgendaMember({ admin, userId: user.id, agendaId: body.agendaId, playerId: body.playerId, role: body.role });
    if (!result.shouldDeliver) return NextResponse.json({ ...result, deliverySkipped: true }, { status: 200 });

    const [{ data: recipient }, { data: inviter }] = await Promise.all([
      admin.from("players").select("owner_user_id,display_name,username,profile_image_url").eq("id", body.playerId).maybeSingle(),
      admin.from("players").select("id,display_name,username,profile_image_url").eq("id", result.invitedByPlayerId).maybeSingle(),
    ]);
    const invitationLink = result.invitationToken ? `/agenda/invite/${encodeURIComponent(result.invitationToken)}` : "/agenda/conexiones";
    let notificationId: string | null = null;
    if (recipient?.owner_user_id) {
      const inviterName = inviter?.display_name || inviter?.username || "Un Player";
      const inviterAlias = inviter?.username ? `@${inviter.username} · ` : "";
      const { data: notification, error: notificationError } = await admin.from("notifications").insert({
        user_id: recipient.owner_user_id,
        actor_player_id: inviter?.id || result.invitedByPlayerId,
        type: "agenda_invitation",
        title: `${inviterName} te invitó a conectar Agenda`,
        body: `${inviterAlias}Aceptá para sincronizar sus agendas.`,
        link: invitationLink,
        metadata: { kind: "agenda_invitation", agendaId: body.agendaId, playerId: body.playerId, invitationToken: result.invitationToken },
      }).select("id").single();
      if (notificationError) throw new Error(notificationError.message);
      notificationId = notification?.id ? String(notification.id) : null;
      if (notificationId) {
        await Promise.all([
          admin.from("agenda_members").update({ notification_id: notificationId }).eq("agenda_id", body.agendaId).eq("player_id", body.playerId),
          saveDelivery(admin, body.agendaId, body.playerId, "notification", { status: "sent", providerMessageId: notificationId }),
        ]);
      }
    }

    const [email, whatsapp] = await Promise.all([
      sendAgendaInvitationEmail({ admin, agendaId: body.agendaId, playerId: body.playerId }).catch(() => ({ status: "failed" as const, reason: "EMAIL_DELIVERY_ERROR" })),
      sendAgendaInvitationWhatsApp({ admin, agendaId: body.agendaId, playerId: body.playerId }).catch(() => ({ status: "failed" as const, reason: "WHATSAPP_DELIVERY_ERROR" })),
    ]);
    const emailProviderMessageId = providerMessageId(email);
    const whatsappProviderMessageId = providerMessageId(whatsapp);
    await Promise.all([
      saveDelivery(admin, body.agendaId, body.playerId, "email", { ...email, providerMessageId: emailProviderMessageId }),
      saveDelivery(admin, body.agendaId, body.playerId, "whatsapp", { ...whatsapp, providerMessageId: whatsappProviderMessageId }),
      admin.from("agenda_members").update({
        email_delivery_status: email.status,
        email_provider_message_id: emailProviderMessageId,
        whatsapp_delivery_status: whatsapp.status,
        whatsapp_provider_message_id: whatsappProviderMessageId,
      }).eq("agenda_id", body.agendaId).eq("player_id", body.playerId),
    ]);
    return NextResponse.json({ ...result, notificationId, emailDelivery: email, whatsappDelivery: whatsapp }, { status: 201 });
  } catch (error) {
    return apiError(error, "No se pudo conectar la Agenda.");
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const body = await request.json().catch(() => ({})) as { agendaId?: string; accept?: boolean };
    if (!body.agendaId || typeof body.accept !== "boolean") return NextResponse.json({ error: "agendaId y accept son obligatorios." }, { status: 400 });
    return NextResponse.json(await respondAgendaInvite({ admin: createAdminSupabase(), userId: user.id, agendaId: body.agendaId, accept: body.accept }));
  } catch (error) {
    return apiError(error, "No se pudo responder la conexión.");
  }
}
''')

replace_once(
    'app/agenda/conexiones/page.tsx',
    'type Player = { id: string; displayName: string; username: string | null; avatar: string | null };',
    'type Player = { id: string; displayName: string; username: string | null; avatar: string | null; status?: "active" | "pending" };\nconst AGENDA_DRAFT_STORAGE_KEY = "clouva:agenda-draft:v1";',
    'connections draft type',
)
regex_once(
    'app/agenda/conexiones/page.tsx',
    r'''  async function invite\(playerId: string\) \{[\s\S]*?\n  \}\n\n  async function respond''',
    '''  async function invite(playerId: string) {
    if (!agendaId) return;
    const invitedPlayer = players.find((player) => player.id === playerId) || null;
    setBusy(true);
    setError(null);
    try {
      const response = await authenticatedFetch("/api/agenda/connections", { method: "POST", body: JSON.stringify({ agendaId, playerId, role }) });
      await readApiJson(response);
      setPlayers((current) => current.filter((player) => player.id !== playerId));
      await loadConnections(agendaId);
      if (invitedPlayer) {
        const rawDraft = window.sessionStorage.getItem(AGENDA_DRAFT_STORAGE_KEY);
        if (rawDraft) {
          try {
            const draft = JSON.parse(rawDraft) as Record<string, unknown> & { connectedPlayers?: Player[] };
            const connectedPlayers = Array.isArray(draft.connectedPlayers) ? draft.connectedPlayers : [];
            draft.connectedPlayers = [...connectedPlayers.filter((player) => player.id !== invitedPlayer.id), { ...invitedPlayer, status: "pending" }];
            draft.quickShareOpen = true;
            window.sessionStorage.setItem(AGENDA_DRAFT_STORAGE_KEY, JSON.stringify(draft));
            router.push("/agenda");
          } catch {
            // La conexión persiste aunque un draft local viejo sea inválido.
          }
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo enviar la conexión.");
    } finally { setBusy(false); }
  }

  async function respond''',
    'connections invite draft return',
)

write('app/api/notifications/route.ts', r'''import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { user, supabase } = await requireUser(request);
    const { data, error } = await supabase.from("notifications").select("id,type,title,body,link,read_at,created_at,actor_player_id,metadata").eq("user_id", user.id).order("created_at", { ascending: false }).limit(30);
    if (error) throw new Error(error.message);
    const actorIds = Array.from(new Set((data ?? []).map((row) => row.actor_player_id ? String(row.actor_player_id) : "").filter(Boolean)));
    const admin = createAdminSupabase();
    const { data: actors, error: actorError } = actorIds.length ? await admin.from("players").select("id,display_name,username,profile_image_url").in("id", actorIds) : { data: [], error: null };
    if (actorError) throw new Error(actorError.message);
    const actorById = new Map((actors ?? []).map((actor) => [String(actor.id), actor]));
    const notifications = (data ?? []).map((row) => {
      const actor = row.actor_player_id ? actorById.get(String(row.actor_player_id)) : null;
      return { ...row, actor: actor ? { playerId: String(actor.id), displayName: actor.display_name || actor.username || "Player", username: actor.username || null, avatar: actor.profile_image_url || null } : null };
    });
    const unreadCount = notifications.filter((row) => !row.read_at).length;
    return NextResponse.json({ notifications, unreadCount }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = isAuthError(error) ? 401 : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudieron cargar las notificaciones." }, { status });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { user, supabase } = await requireUser(request);
    const body = (await request.json().catch(() => ({}))) as { id?: string; all?: boolean };
    let query = supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", user.id);
    query = body.all ? query.is("read_at", null) : query.eq("id", body.id ?? "");
    const { error } = await query;
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const status = isAuthError(error) ? 401 : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo actualizar la notificación." }, { status });
  }
}
''')

replace_once('components/notifications/NotificationBell.tsx', 'import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";', 'import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";\nimport { supabase } from "@/lib/supabase";', 'notification bell supabase import')
replace_once('components/notifications/NotificationBell.tsx', '''  read_at: string | null;
  created_at: string;
};''', '''  read_at: string | null;
  created_at: string;
  actor: { playerId: string; displayName: string; username: string | null; avatar: string | null } | null;
  metadata?: Record<string, unknown> | null;
};''', 'notification actor type')
replace_once('components/notifications/NotificationBell.tsx', '''    void load();
    const interval = window.setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);''', '''    void load();
    const interval = window.setInterval(() => void load(), POLL_INTERVAL_MS);
    const channel = supabase.channel(`notifications:${user.id}`).on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` }, () => void load()).subscribe();
    return () => {
      window.clearInterval(interval);
      void supabase.removeChannel(channel);
    };''', 'notification realtime')
replace_once('components/notifications/NotificationBell.tsx', '''                  <div className="flex items-start gap-2">
                    {!item.read_at ? <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-violet-400" /> : <span className="mt-1.5 h-2 w-2 shrink-0" />}
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white">{item.title}</p>
                      {item.body ? <p className="mt-0.5 text-xs text-white/55">{item.body}</p> : null}
                      <p className="mt-1 text-[10px] text-white/35">{timeAgo(item.created_at)}</p>
                    </div>
                  </div>''', '''                  <div className="flex items-start gap-2.5">
                    <div className="relative grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full border border-white/10 bg-white/[0.05] text-[11px] font-bold text-white/75">
                      {item.actor?.avatar ? <img src={item.actor.avatar} alt="" className="h-full w-full object-cover" /> : (item.actor?.displayName || "C").slice(0, 1).toUpperCase()}
                      {!item.read_at ? <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-[#0a0810] bg-violet-400" /> : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2"><p className="truncate text-sm font-semibold text-white">{item.title}</p>{item.type === "agenda_invitation" ? <span className="shrink-0 rounded-full border border-violet-300/15 bg-violet-300/[0.08] px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.12em] text-violet-200">Agenda</span> : null}</div>
                      {item.actor?.username ? <p className="mt-0.5 text-[10px] text-white/35">@{item.actor.username}</p> : null}
                      {item.body ? <p className="mt-1 text-xs text-white/55">{item.body}</p> : null}
                      <p className="mt-1 text-[10px] text-white/35">{timeAgo(item.created_at)}</p>
                    </div>
                  </div>''', 'notification visual actor')

replace_once('components/GlobalFlowBalance.tsx', '  const rootMobileVisibility = pathname === "/" ? "hidden md:flex" : "flex";', '  const rootMobileVisibility = pathname.startsWith("/agenda") ? "hidden" : pathname === "/" ? "hidden md:flex" : "flex";', 'hide global flow hud on agenda')

replace_once('app/agenda/page.tsx', 'import { useAuth } from "@/components/auth-provider";', 'import { useAuth } from "@/components/auth-provider";\nimport { GlobalFlowBalance } from "@/components/GlobalFlowBalance";', 'agenda flow header import')
replace_once('app/agenda/page.tsx', 'type PlayerResult = { id: string; displayName: string; username: string | null; avatar: string | null };\ntype AgendaConnection = PlayerResult & { playerId: string; status: string };', '''type PlayerResult = { id: string; displayName: string; username: string | null; avatar: string | null };
type SelectablePlayer = PlayerResult & { status: "active" | "pending" };
type AgendaConnection = PlayerResult & { playerId: string; status: string };
type AgendaTimelineItem = {
  id: string;
  type: "financial" | "flow" | "diamond";
  occurredAt: string;
  source: string;
  title: string;
  amount: number;
  currency: string;
  direction: "credit" | "debit";
  referenceId: string | null;
  metadata: Record<string, unknown>;
};
type ContentFilter = "all" | "agenda" | "economy" | "flows" | "knowledge";''', 'agenda timeline types')
replace_once('app/agenda/page.tsx', '  const [relation, setRelation] = useState<"all" | AgendaEvent["relation"]>("all");', '  const [relation, setRelation] = useState<"all" | AgendaEvent["relation"]>("all");\n  const [contentFilter, setContentFilter] = useState<ContentFilter>("all");\n  const [timelineItems, setTimelineItems] = useState<AgendaTimelineItem[]>([]);\n  const [timelineLoading, setTimelineLoading] = useState(false);', 'agenda timeline state')
replace_once('app/agenda/page.tsx', '  const [connectedPlayers, setConnectedPlayers] = useState<PlayerResult[]>([]);', '  const [connectedPlayers, setConnectedPlayers] = useState<SelectablePlayer[]>([]);', 'agenda selectable connection state')
replace_once('app/agenda/page.tsx', '          connectedPlayers?: PlayerResult[];', '          connectedPlayers?: SelectablePlayer[];', 'agenda draft selectable type')
replace_once('app/agenda/page.tsx', '''  useEffect(() => { if (activeAgendaId) void loadEvents(); }, [activeAgendaId, loadEvents]);

  useEffect(() => {
    if (!user || !activeAgendaId) return;''', '''  useEffect(() => { if (activeAgendaId) void loadEvents(); }, [activeAgendaId, loadEvents]);

  const loadTimeline = useCallback(async () => {
    if (!user) { setTimelineItems([]); return; }
    setTimelineLoading(true);
    try {
      const params = new URLSearchParams({ from: range.from.toISOString(), to: range.to.toISOString() });
      const response = await authenticatedFetch(`/api/agenda/timeline?${params.toString()}`);
      const payload = await readApiJson<{ items: AgendaTimelineItem[] }>(response);
      setTimelineItems(payload.items || []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo cargar la economía de Agenda.");
    } finally { setTimelineLoading(false); }
  }, [range.from, range.to, user]);

  useEffect(() => { if (user) void loadTimeline(); }, [loadTimeline, user]);

  useEffect(() => {
    if (!user || !activeAgendaId) return;''', 'agenda load timeline')
replace_once('app/agenda/page.tsx', '''  }, [activeAgendaId, loadEvents, user]);

  const filteredEvents = useMemo(() => {''', '''  }, [activeAgendaId, loadEvents, user]);

  useEffect(() => {
    if (!user) return;
    const refresh = () => void loadTimeline();
    const channel = supabase.channel(`agenda-finance:${user.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "flows_wallet_ledger", filter: `user_id=eq.${user.id}` }, refresh)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "diamond_wallet_ledger", filter: `user_id=eq.${user.id}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "mi_flow_money_ledger", filter: `beneficiary_user_id=eq.${user.id}` }, refresh)
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [loadTimeline, user]);

  const filteredEvents = useMemo(() => {''', 'agenda finance realtime')
replace_once('app/agenda/page.tsx', '''    return events.filter((event) => {
      if (relation !== "all" && event.relation !== relation) return false;''', '''    if (contentFilter !== "all" && contentFilter !== "agenda") return [];
    return events.filter((event) => {
      if (relation !== "all" && event.relation !== relation) return false;''', 'agenda event content filter')
replace_once('app/agenda/page.tsx', '  }, [events, query, relation]);', '''  }, [contentFilter, events, query, relation]);

  const filteredTimeline = useMemo(() => {
    if (contentFilter === "agenda" || contentFilter === "knowledge") return [];
    const normalized = query.trim().toLowerCase();
    return timelineItems.filter((item) => {
      if (contentFilter === "flows" && item.type !== "flow") return false;
      if (contentFilter === "economy" && item.type === "flow") return false;
      if (!normalized) return true;
      return `${item.title} ${item.source} ${item.currency}`.toLowerCase().includes(normalized);
    });
  }, [contentFilter, query, timelineItems]);''', 'agenda filtered timeline')

regex_once('app/agenda/page.tsx', r'''  async function loadConnectedPlayers\(\) \{[\s\S]*?\n  \}\n\n  function openQuickCreate''', '''  async function loadConnectedPlayers() {
    if (!active) return;
    setConnectionsLoading(true);
    try {
      const response = await authenticatedFetch(`/api/agenda/connections?agendaId=${encodeURIComponent(active.agendaId)}`);
      const payload = await readApiJson<{ connections: AgendaConnection[] }>(response);
      setConnectedPlayers((payload.connections || []).filter((connection) => connection.status === "active" || connection.status === "pending").map((connection) => ({ id: connection.playerId, displayName: connection.displayName, username: connection.username, avatar: connection.avatar, status: connection.status as "active" | "pending" })));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudieron cargar los Players conectados.");
      setConnectedPlayers([]);
    } finally { setConnectionsLoading(false); }
  }

  function openQuickCreate''', 'agenda load pending connections')

replace_once('app/agenda/page.tsx', '\nexport default function AgendaPage() {', r'''
function timelineAmount(item: AgendaTimelineItem) {
  const sign = item.amount > 0 ? "+" : item.amount < 0 ? "−" : "";
  const absolute = Math.abs(item.amount);
  if (item.currency === "FLOW") return `${sign}${absolute.toLocaleString("es-AR")} FLOWS`;
  if (item.currency === "DIAMOND") return `${sign}${absolute.toLocaleString("es-AR")} Diamonds`;
  try {
    const value = new Intl.NumberFormat("es-AR", { style: "currency", currency: item.currency, maximumFractionDigits: 2 }).format(absolute);
    return `${sign}${value}`;
  } catch { return `${sign}${absolute.toLocaleString("es-AR")} ${item.currency}`; }
}

function TimelineCard({ item }: { item: AgendaTimelineItem }) {
  const isFlow = item.type === "flow";
  const amountClass = item.direction === "debit" ? "text-rose-200" : isFlow ? "text-violet-200" : "text-emerald-200";
  return <article className="w-full rounded-2xl border border-white/10 bg-black/25 p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.15em] text-white/35"><span>{isFlow ? "FLOWS" : item.type === "diamond" ? "DIAMONDS" : "ECONOMÍA"}</span><span>·</span><span className="truncate normal-case tracking-normal text-white/45">{item.source}</span></div><p className="mt-2 truncate text-sm font-semibold text-white">{item.title}</p><p className="mt-1 flex items-center gap-1.5 text-xs text-white/40"><Clock3 size={13} /> {formatDateTime(item.occurredAt)}</p></div><strong className={`shrink-0 text-sm font-semibold tabular-nums ${amountClass}`}>{timelineAmount(item)}</strong></div></article>;
}

export default function AgendaPage() {''', 'agenda timeline card')

replace_once('app/agenda/page.tsx', '''            {canEdit ? <button type="button" onClick={() => { resetCreateForm(cursor); setCreateOpen(true); }} className="inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-semibold text-white shadow-lg transition hover:brightness-110" style={{ background: accent }}><Plus size={17} /> Crear evento</button> : null}''', '''            <div className="flex items-center gap-2"><GlobalFlowBalance variant="header" />{canEdit ? <button type="button" onClick={() => { resetCreateForm(cursor); setCreateOpen(true); }} className="inline-flex h-[38px] items-center gap-2 rounded-full px-3.5 text-xs font-semibold text-white shadow-lg transition hover:brightness-110 sm:h-auto sm:px-5 sm:py-3 sm:text-sm" style={{ background: accent }}><Plus size={16} /> <span className="hidden sm:inline">Crear evento</span></button> : null}</div>''', 'agenda header flow hud')
replace_once('app/agenda/page.tsx', '''        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <label className="flex flex-1 items-center rounded-xl border border-white/10 bg-white/[0.025] px-3"><Search size={15} className="text-white/30" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar evento, lugar o Player…" className="min-w-0 flex-1 bg-transparent px-2 py-2.5 text-sm outline-none placeholder:text-white/25" /></label>
          <select value={relation} onChange={(event) => setRelation(event.target.value as typeof relation)} className="rounded-xl border border-white/10 bg-[#101017] px-3 py-2.5 text-sm text-white/70 outline-none"><option value="all">Todos</option><option value="primary">Propios</option><option value="shared">Compartidos</option><option value="invited">Invitaciones</option></select>
        </div>''', '''        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <label className="flex flex-1 items-center rounded-xl border border-white/10 bg-white/[0.025] px-3"><Search size={15} className="text-white/30" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar en tu línea temporal…" className="min-w-0 flex-1 bg-transparent px-2 py-2.5 text-sm outline-none placeholder:text-white/25" /></label>
          <select value={contentFilter} onChange={(event) => setContentFilter(event.target.value as ContentFilter)} className="rounded-xl border border-white/10 bg-[#101017] px-3 py-2.5 text-sm text-white/70 outline-none"><option value="all">Todos</option><option value="agenda">Agenda</option><option value="economy">Economía</option><option value="flows">Flows</option><option value="knowledge">Conocimiento</option></select>
          {(contentFilter === "all" || contentFilter === "agenda") ? <select value={relation} onChange={(event) => setRelation(event.target.value as typeof relation)} className="rounded-xl border border-white/10 bg-[#101017] px-3 py-2.5 text-sm text-white/70 outline-none"><option value="all">Todos los eventos</option><option value="primary">Propios</option><option value="shared">Compartidos</option><option value="invited">Invitaciones</option></select> : null}
        </div>''', 'agenda content filters')
replace_once('app/agenda/page.tsx', '''        {loading ? <div className="mt-10 flex items-center justify-center gap-2 text-sm text-white/35"><Loader2 size={16} className="animate-spin" /> Actualizando Agenda…</div> : null}''', '''        {(loading || timelineLoading) ? <div className="mt-10 flex items-center justify-center gap-2 text-sm text-white/35"><Loader2 size={16} className="animate-spin" /> Actualizando línea temporal…</div> : null}''', 'agenda combined loading')

regex_once('app/agenda/page.tsx', r'''        \{!loading && view === "day" \? \([\s\S]*?        \) : null\}\n\n        \{!loading && view === "week"''', r'''        {!loading && !timelineLoading && view === "day" ? (
          <section className="mt-5 space-y-3">
            <h3 className="text-sm font-semibold capitalize text-white/70">{formatDayTitle(cursor)}</h3>
            {[...filteredEvents.filter((event) => sameDay(new Date(event.startAt), cursor)).map((event) => ({ key: `event:${event.id}`, at: event.startAt, node: <EventCard key={event.id} event={event} onOpen={setSelectedEvent} /> })), ...filteredTimeline.filter((item) => sameDay(new Date(item.occurredAt), cursor)).map((item) => ({ key: item.id, at: item.occurredAt, node: <TimelineCard key={item.id} item={item} /> }))].sort((a, b) => a.at.localeCompare(b.at)).map((entry) => <div key={entry.key}>{entry.node}</div>)}
            {!filteredEvents.some((event) => sameDay(new Date(event.startAt), cursor)) && !filteredTimeline.some((item) => sameDay(new Date(item.occurredAt), cursor)) ? <EmptyDay canEdit={canEdit && (contentFilter === "all" || contentFilter === "agenda")} onCreate={() => { resetCreateForm(cursor); setCreateOpen(true); }} /> : null}
          </section>
        ) : null}

        {!loading && view === "week"''', 'agenda day mixed timeline')

replace_once('app/agenda/page.tsx', '                const dayEvents = filteredEvents.filter((event) => sameDay(new Date(event.startAt), day));\n                const outside = day.getMonth() !== cursor.getMonth();', '                const dayEvents = filteredEvents.filter((event) => sameDay(new Date(event.startAt), day));\n                const dayTimelineItems = filteredTimeline.filter((item) => sameDay(new Date(item.occurredAt), day));\n                const outside = day.getMonth() !== cursor.getMonth();', 'agenda month timeline items')
replace_once('app/agenda/page.tsx', '''                    <div className="mt-1 space-y-1">{dayEvents.slice(0, 3).map((event) => <span key={event.id} className="block truncate rounded-md border border-white/8 bg-black/35 px-1 py-1 text-[8px] text-white/75 sm:px-1.5 sm:text-[10px]">{formatTime(event.startAt)} {event.title}</span>)}{dayEvents.length > 3 ? <span className="block text-[9px] text-white/30">+{dayEvents.length - 3}</span> : null}</div>''', '''                    <div className="mt-1 space-y-1">{dayTimelineItems.length ? <span className="flex items-center gap-1 text-[8px] font-medium text-emerald-200/65 sm:text-[9px]"><span className="h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_7px_rgba(110,231,183,.7)]" />{dayTimelineItems.length} mov.</span> : null}{dayEvents.slice(0, dayTimelineItems.length ? 2 : 3).map((event) => <span key={event.id} className="block truncate rounded-md border border-white/8 bg-black/35 px-1 py-1 text-[8px] text-white/75 sm:px-1.5 sm:text-[10px]">{formatTime(event.startAt)} {event.title}</span>)}{dayEvents.length > (dayTimelineItems.length ? 2 : 3) ? <span className="block text-[9px] text-white/30">+{dayEvents.length - (dayTimelineItems.length ? 2 : 3)}</span> : null}</div>''', 'agenda month economic indicator')

regex_once('app/agenda/page.tsx', r'''        \{!loading && view === "list" \? \([\s\S]*?        \) : null\}\n      </div>''', r'''        {!loading && !timelineLoading && view === "list" ? (
          <section className="mt-5 space-y-5">
            {Array.from(new Set([...filteredEvents.map((event) => startOfDay(new Date(event.startAt)).toISOString()), ...filteredTimeline.map((item) => startOfDay(new Date(item.occurredAt)).toISOString())])).sort().map((dayKey) => {
              const day = new Date(dayKey);
              const dayEvents = filteredEvents.filter((event) => sameDay(new Date(event.startAt), day));
              const dayTimelineItems = filteredTimeline.filter((item) => sameDay(new Date(item.occurredAt), day));
              const entries = [...dayEvents.map((event) => ({ key: `event:${event.id}`, at: event.startAt, node: <EventCard key={event.id} event={event} onOpen={setSelectedEvent} /> })), ...dayTimelineItems.map((item) => ({ key: item.id, at: item.occurredAt, node: <TimelineCard key={item.id} item={item} /> }))].sort((a, b) => a.at.localeCompare(b.at));
              return <div key={dayKey}><h3 className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-white/35">{formatDayTitle(day)}</h3><div className="grid gap-3 lg:grid-cols-2">{entries.map((entry) => <div key={entry.key}>{entry.node}</div>)}</div></div>;
            })}
            {!filteredEvents.length && !filteredTimeline.length ? <EmptyDay canEdit={canEdit && (contentFilter === "all" || contentFilter === "agenda")} onCreate={() => { resetCreateForm(cursor); setCreateOpen(true); }} /> : null}
          </section>
        ) : null}
      </div>''', 'agenda list mixed timeline')

replace_once('app/agenda/page.tsx', '<span className="mt-0.5 block text-xs text-white/35">El evento aparecerá también en su Agenda.</span>', '<span className="mt-0.5 block text-xs text-white/35">Conectado: aparece al instante. Pendiente: se activa cuando acepte.</span>', 'agenda quick share copy')
replace_once('app/agenda/page.tsx', '''<span className="block truncate text-xs font-medium">{player.displayName}</span>{player.username ? <span className="block truncate text-[10px] text-white/35">@{player.username}</span> : null}</span>{selected ? <span className="text-xs font-bold" style={{ color: accent }}>✓</span> : null}</button>;''', '''<span className="flex items-center gap-2"><span className="block truncate text-xs font-medium">{player.displayName}</span>{player.status === "pending" ? <span className="rounded-full border border-amber-200/15 bg-amber-200/[0.07] px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.1em] text-amber-100/75">Pendiente</span> : null}</span>{player.username ? <span className="block truncate text-[10px] text-white/35">@{player.username}</span> : null}</span>{selected ? <span className="text-xs font-bold" style={{ color: accent }}>✓</span> : null}</button>;''', 'agenda pending badge')
replace_once('app/agenda/page.tsx', 'No hay Players conectados activos en esta Agenda.', 'No hay Players conectados ni pendientes en esta Agenda.', 'agenda quick share empty copy')

print('Agenda life timeline patch applied successfully.')
