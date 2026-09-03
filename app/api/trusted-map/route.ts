import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LOCATION_TTL_MS = 5 * 60 * 1000;
const PAUSED_LAST_LOCATION_TTL_MS = 10 * 60 * 1000;

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function validUuid(value: unknown) {
  const text = cleanText(value, 80);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text) ? text : null;
}

function safeCoordinate(value: unknown, min: number, max: number) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

async function publicPlayersByUsers(admin: ReturnType<typeof createAdminSupabase>, userIds: string[]) {
  if (!userIds.length) return new Map<string, Record<string, unknown>>();
  const { data, error } = await admin
    .from("players")
    .select("owner_user_id,slug,display_name,username,profile_image_url,accent_color")
    .in("owner_user_id", [...new Set(userIds)])
    .eq("is_published", true);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((player) => [player.owner_user_id as string, player as Record<string, unknown>]));
}

async function buildSnapshot(admin: ReturnType<typeof createAdminSupabase>, userId: string, searchQuery = "") {
  const [{ data: connections, error: connectionError }, { data: ownedGroups, error: ownedGroupError }, { data: memberships, error: membershipError }, { data: ownPlayer }] = await Promise.all([
    admin.from("trusted_map_connections").select("id,requester_user_id,recipient_user_id,status,created_at,accepted_at,revoked_at").or(`requester_user_id.eq.${userId},recipient_user_id.eq.${userId}`).order("created_at", { ascending: false }),
    admin.from("trusted_map_groups").select("id,owner_user_id,name,created_at").eq("owner_user_id", userId).order("created_at", { ascending: false }),
    admin.from("trusted_map_group_members").select("group_id,user_id,invited_by,status,created_at,joined_at").eq("user_id", userId),
    admin.from("players").select("owner_user_id,slug,display_name,username,profile_image_url,accent_color").eq("owner_user_id", userId).eq("is_published", true).maybeSingle(),
  ]);
  if (connectionError || ownedGroupError || membershipError) throw new Error(connectionError?.message || ownedGroupError?.message || membershipError?.message);

  const memberGroupIds = (memberships ?? []).filter((member) => member.status === "accepted").map((member) => member.group_id as string);
  const invitedGroupIds = (memberships ?? []).filter((member) => member.status === "pending").map((member) => member.group_id as string);
  const allGroupIds = [...new Set([...(ownedGroups ?? []).map((group) => group.id as string), ...memberGroupIds, ...invitedGroupIds])];

  const [{ data: groups }, { data: groupMembers, error: groupMembersError }] = await Promise.all([
    allGroupIds.length ? admin.from("trusted_map_groups").select("id,owner_user_id,name,created_at").in("id", allGroupIds) : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    allGroupIds.length ? admin.from("trusted_map_group_members").select("group_id,user_id,invited_by,status,created_at,joined_at").in("group_id", allGroupIds) : Promise.resolve({ data: [] as Record<string, unknown>[], error: null }),
  ]);
  if (groupMembersError) throw new Error(groupMembersError.message);

  const authorizedUserIds = new Set<string>([userId]);
  for (const connection of connections ?? []) {
    if (connection.status !== "accepted") continue;
    authorizedUserIds.add(connection.requester_user_id === userId ? connection.recipient_user_id : connection.requester_user_id);
  }
  for (const group of groups ?? []) {
    const userAccepted = group.owner_user_id === userId || (groupMembers ?? []).some((member) => member.group_id === group.id && member.user_id === userId && member.status === "accepted");
    if (!userAccepted) continue;
    authorizedUserIds.add(group.owner_user_id as string);
    for (const member of groupMembers ?? []) if (member.group_id === group.id && member.status === "accepted") authorizedUserIds.add(member.user_id as string);
  }

  const [playersByUser, locationResult] = await Promise.all([
    publicPlayersByUsers(admin, [...authorizedUserIds, ...(connections ?? []).flatMap((connection) => [connection.requester_user_id, connection.recipient_user_id])]),
    admin.from("trusted_map_locations").select("user_id,latitude,longitude,accuracy_meters,sharing_status,updated_at,expires_at").in("user_id", [...authorizedUserIds]),
  ]);
  if (locationResult.error) throw new Error(locationResult.error.message);

  const now = Date.now();
  const locations = (locationResult.data ?? []).map((location) => {
    const expiresAt = location.expires_at ? new Date(location.expires_at).getTime() : 0;
    const visible = expiresAt > now;
    return {
      userId: location.user_id,
      latitude: visible ? location.latitude : null,
      longitude: visible ? location.longitude : null,
      accuracyMeters: visible ? location.accuracy_meters : null,
      status: visible ? location.sharing_status : "stale",
      updatedAt: location.updated_at,
      expiresAt: location.expires_at,
      player: playersByUser.get(location.user_id as string) ?? null,
    };
  });

  const connectionPayload = (connections ?? []).map((connection) => {
    const otherId = connection.requester_user_id === userId ? connection.recipient_user_id : connection.requester_user_id;
    return { ...connection, direction: connection.requester_user_id === userId ? "outgoing" : "incoming", other: playersByUser.get(otherId) ?? null };
  });

  const groupPayload = (groups ?? []).map((group) => ({
    ...group,
    isOwner: group.owner_user_id === userId,
    myMembership: group.owner_user_id === userId ? { status: "accepted" } : (memberships ?? []).find((member) => member.group_id === group.id) ?? null,
    members: (groupMembers ?? []).filter((member) => member.group_id === group.id).map((member) => ({ ...member, player: playersByUser.get(member.user_id as string) ?? null })),
    owner: playersByUser.get(group.owner_user_id as string) ?? null,
  }));

  let suggestions: Record<string, unknown>[] = [];
  const q = searchQuery.trim();
  if (q.length >= 2) {
    const pattern = `%${q.replace(/[%_,]/g, " ").trim()}%`;
    const { data, error } = await admin
      .from("players")
      .select("owner_user_id,slug,display_name,username,profile_image_url,accent_color")
      .eq("is_published", true)
      .not("owner_user_id", "is", null)
      .or(`display_name.ilike.${pattern},username.ilike.${pattern}`)
      .limit(12);
    if (error) throw new Error(error.message);
    suggestions = (data ?? []).filter((player) => player.owner_user_id !== userId);
  }

  return {
    me: ownPlayer ?? null,
    connections: connectionPayload,
    groups: groupPayload,
    locations,
    suggestions,
    sharing: locations.find((location) => location.userId === userId) ?? null,
  };
}

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const q = new URL(request.url).searchParams.get("q") ?? "";
    return NextResponse.json(await buildSnapshot(createAdminSupabase(), user.id, q));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo abrir el mapa de confianza." }, { status: isAuthError(error) ? 401 : 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const admin = createAdminSupabase();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = cleanText(body.action, 40);
    const now = new Date();
    const nowIso = now.toISOString();

    if (action === "invite") {
      const recipientUserId = validUuid(body.recipientUserId);
      if (!recipientUserId || recipientUserId === user.id) return NextResponse.json({ error: "Elegí otro Player." }, { status: 400 });
      const { data: target } = await admin.from("players").select("owner_user_id").eq("owner_user_id", recipientUserId).eq("is_published", true).maybeSingle();
      if (!target) return NextResponse.json({ error: "Ese Player no está disponible para conectar." }, { status: 404 });
      const { data: existing } = await admin.from("trusted_map_connections").select("id,status").or(`and(requester_user_id.eq.${user.id},recipient_user_id.eq.${recipientUserId}),and(requester_user_id.eq.${recipientUserId},recipient_user_id.eq.${user.id})`).maybeSingle();
      if (existing?.status === "accepted") return NextResponse.json({ error: "Ya están conectados en el mapa de confianza." }, { status: 409 });
      if (existing?.status === "pending") return NextResponse.json({ error: "Ya hay una invitación pendiente." }, { status: 409 });
      if (existing) {
        const { error } = await admin.from("trusted_map_connections").update({ requester_user_id: user.id, recipient_user_id: recipientUserId, status: "pending", accepted_at: null, revoked_at: null, updated_at: nowIso }).eq("id", existing.id);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await admin.from("trusted_map_connections").insert({ requester_user_id: user.id, recipient_user_id: recipientUserId, status: "pending" });
        if (error) throw new Error(error.message);
      }
    } else if (["accept", "reject"].includes(action)) {
      const connectionId = validUuid(body.connectionId);
      if (!connectionId) return NextResponse.json({ error: "Conexión inválida." }, { status: 400 });
      const status = action === "accept" ? "accepted" : "rejected";
      const { data, error } = await admin.from("trusted_map_connections").update({ status, accepted_at: status === "accepted" ? nowIso : null, revoked_at: null, updated_at: nowIso }).eq("id", connectionId).eq("recipient_user_id", user.id).eq("status", "pending").select("id").maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return NextResponse.json({ error: "Esta invitación ya no está pendiente." }, { status: 409 });
    } else if (action === "revoke") {
      const connectionId = validUuid(body.connectionId);
      if (!connectionId) return NextResponse.json({ error: "Conexión inválida." }, { status: 400 });
      const { data: connection } = await admin.from("trusted_map_connections").select("id,requester_user_id,recipient_user_id").eq("id", connectionId).maybeSingle();
      if (!connection || (connection.requester_user_id !== user.id && connection.recipient_user_id !== user.id)) return NextResponse.json({ error: "No podés modificar esa conexión." }, { status: 403 });
      const { error } = await admin.from("trusted_map_connections").update({ status: "revoked", revoked_at: nowIso, updated_at: nowIso }).eq("id", connectionId);
      if (error) throw new Error(error.message);
    } else if (action === "create_group") {
      const name = cleanText(body.name, 80);
      if (!name) return NextResponse.json({ error: "Poné un nombre al grupo." }, { status: 400 });
      const { error } = await admin.from("trusted_map_groups").insert({ owner_user_id: user.id, name });
      if (error) throw new Error(error.message);
    } else if (action === "invite_group") {
      const groupId = validUuid(body.groupId);
      const recipientUserId = validUuid(body.recipientUserId);
      if (!groupId || !recipientUserId || recipientUserId === user.id) return NextResponse.json({ error: "Invitación inválida." }, { status: 400 });
      const { data: group } = await admin.from("trusted_map_groups").select("id").eq("id", groupId).eq("owner_user_id", user.id).maybeSingle();
      if (!group) return NextResponse.json({ error: "Solo quien creó el grupo puede invitar." }, { status: 403 });
      const { error } = await admin.from("trusted_map_group_members").upsert({ group_id: groupId, user_id: recipientUserId, invited_by: user.id, status: "pending", joined_at: null }, { onConflict: "group_id,user_id" });
      if (error) throw new Error(error.message);
    } else if (["accept_group", "reject_group"].includes(action)) {
      const groupId = validUuid(body.groupId);
      if (!groupId) return NextResponse.json({ error: "Grupo inválido." }, { status: 400 });
      const status = action === "accept_group" ? "accepted" : "rejected";
      const { data, error } = await admin.from("trusted_map_group_members").update({ status, joined_at: status === "accepted" ? nowIso : null }).eq("group_id", groupId).eq("user_id", user.id).eq("status", "pending").select("group_id").maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return NextResponse.json({ error: "La invitación al grupo ya no está pendiente." }, { status: 409 });
    } else if (action === "leave_group") {
      const groupId = validUuid(body.groupId);
      if (!groupId) return NextResponse.json({ error: "Grupo inválido." }, { status: 400 });
      const { error } = await admin.from("trusted_map_group_members").update({ status: "left" }).eq("group_id", groupId).eq("user_id", user.id);
      if (error) throw new Error(error.message);
    } else if (action === "delete_group") {
      const groupId = validUuid(body.groupId);
      if (!groupId) return NextResponse.json({ error: "Grupo inválido." }, { status: 400 });
      const { error } = await admin.from("trusted_map_groups").delete().eq("id", groupId).eq("owner_user_id", user.id);
      if (error) throw new Error(error.message);
    } else if (action === "share_location") {
      const latitude = safeCoordinate(body.latitude, -90, 90);
      const longitude = safeCoordinate(body.longitude, -180, 180);
      const accuracy = Math.min(50_000, Math.max(0, Number(body.accuracyMeters) || 0));
      if (latitude == null || longitude == null) return NextResponse.json({ error: "El dispositivo no devolvió una ubicación válida." }, { status: 400 });
      const { data: hasAudience, error: audienceError } = await admin.rpc("trusted_map_has_audience", { p_user_id: user.id });
      if (audienceError) throw new Error(audienceError.message);
      if (!hasAudience) return NextResponse.json({ error: "Necesitás una conexión aceptada antes de compartir ubicación." }, { status: 403 });
      const expiresAt = new Date(now.getTime() + LOCATION_TTL_MS).toISOString();
      const { error } = await admin.from("trusted_map_locations").upsert({ user_id: user.id, latitude, longitude, accuracy_meters: accuracy, sharing_status: "sharing", updated_at: nowIso, expires_at: expiresAt }, { onConflict: "user_id" });
      if (error) throw new Error(error.message);
    } else if (action === "pause_location") {
      const expiresAt = new Date(now.getTime() + PAUSED_LAST_LOCATION_TTL_MS).toISOString();
      const { error } = await admin.from("trusted_map_locations").update({ sharing_status: "paused", updated_at: nowIso, expires_at: expiresAt }).eq("user_id", user.id);
      if (error) throw new Error(error.message);
    } else if (action === "stop_location") {
      const { error } = await admin.from("trusted_map_locations").delete().eq("user_id", user.id);
      if (error) throw new Error(error.message);
    } else {
      return NextResponse.json({ error: "Acción de mapa no reconocida." }, { status: 400 });
    }

    return NextResponse.json(await buildSnapshot(admin, user.id));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo actualizar el mapa de confianza." }, { status: isAuthError(error) ? 401 : 500 });
  }
}
