import "server-only";

import { commerceProductSelect, type CommerceProduct } from "@/lib/commerce-store-data";
import { getAgendaOccurrences } from "@/lib/server/agenda/recurrence";
import { createAdminSupabase } from "@/lib/server/supabase";
import { resolveStudioAlias } from "@/lib/server/public-identity-data";

export type IgluPublicPlayer = {
  id: string;
  slug: string;
  displayName: string;
  role: string | null;
  primaryRole: string | null;
  location: string | null;
  latitude: number | null;
  longitude: number | null;
  avatar: string | null;
  disciplines: string[];
  isPro: boolean;
};

export type IgluCalendarEvent = {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  kind: "occupied" | "session" | "show" | "event";
  public: boolean;
  location: string | null;
  playerId: string | null;
  playerName: string | null;
};

export type IgluAvailabilityRule = {
  id: string;
  agendaId: string;
  playerId: string | null;
  weekday: number;
  startLocal: string;
  endLocal: string;
  timezone: string;
  isAvailable: boolean;
};

export async function loadIgluOperationalData(options?: { from?: string; to?: string }) {
  const identity = await resolveStudioAlias("el-iglu");
  if (!identity) return null;

  const admin = createAdminSupabase();
  const now = new Date();
  const from = options?.from || new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const to = options?.to || new Date(now.getFullYear(), now.getMonth() + 2, 1).toISOString();

  const { data: space, error: spaceError } = await admin
    .from("spaces")
    .select("id,owner_player_id")
    .eq("legacy_studio_id", identity.studio.id)
    .eq("status", "active")
    .maybeSingle();
  if (spaceError) throw new Error(spaceError.message);
  if (!space) throw new Error("El Iglú todavía no tiene Space canónico.");

  const { data: playerLinks, error: playerLinksError } = await admin
    .from("player_studios")
    .select("role,is_visible,status,display_order,player:players(id,owner_user_id,slug,display_name,primary_role,location,latitude,longitude,profile_image_url,disciplines,is_published,publication_status)")
    .eq("studio_id", identity.studio.id)
    .eq("status", "active")
    .eq("is_visible", true)
    .order("display_order", { ascending: true });
  if (playerLinksError) throw new Error(playerLinksError.message);

  const linkedPlayers = (playerLinks ?? [])
    .map((link) => ({
      link,
      player: Array.isArray(link.player) ? link.player[0] : link.player,
    }))
    .filter((entry): entry is { link: typeof entry.link; player: NonNullable<typeof entry.player> } =>
      Boolean(entry.player?.id && entry.player?.is_published && entry.player?.publication_status === "published"),
    );
  const rawPlayers = linkedPlayers.map((entry) => entry.player);

  const ownerUserIds = Array.from(new Set(rawPlayers.flatMap((player) => player.owner_user_id ? [String(player.owner_user_id)] : [])));
  const { data: entitlementRows, error: entitlementError } = ownerUserIds.length
    ? await admin
        .from("user_entitlements")
        .select("user_id,product_code,tier,status,valid_from,valid_until")
        .in("user_id", ownerUserIds)
        .eq("product_code", "clouva_vip")
        .eq("tier", "vip")
        .eq("status", "active")
    : { data: [], error: null };
  if (entitlementError) throw new Error(entitlementError.message);
  const nowMs = Date.now();
  const proUserIds = new Set(
    (entitlementRows ?? [])
      .filter((row) => {
        const from = row.valid_from ? new Date(String(row.valid_from)).getTime() : null;
        const until = row.valid_until ? new Date(String(row.valid_until)).getTime() : null;
        return (from == null || from <= nowMs) && (until == null || until > nowMs);
      })
      .map((row) => String(row.user_id)),
  );

  const players: IgluPublicPlayer[] = linkedPlayers.map(({ player, link }) => ({
    id: String(player.id),
    slug: String(player.slug),
    displayName: String(player.display_name || player.slug || "Player"),
    role: String(link.role || "") || null,
    primaryRole: player.primary_role ? String(player.primary_role) : null,
    location: player.location ? String(player.location) : null,
    latitude: typeof player.latitude === "number" ? player.latitude : null,
    longitude: typeof player.longitude === "number" ? player.longitude : null,
    avatar: player.profile_image_url ? String(player.profile_image_url) : null,
    disciplines: Array.isArray(player.disciplines) ? player.disciplines.filter((item): item is string => typeof item === "string").slice(0, 8) : [],
    isPro: Boolean(player.owner_user_id && proUserIds.has(String(player.owner_user_id))),
  }));

  const playerOwnerUser = new Map(rawPlayers.map((player) => [String(player.id), player.owner_user_id ? String(player.owner_user_id) : null]));
  const playerName = new Map(players.map((player) => [player.id, player.displayName]));

  const { data: studioAgenda, error: studioAgendaError } = await admin
    .from("agendas")
    .select("id,name,owner_space_id,owner_player_id,timezone,public_enabled,booking_enabled,is_default")
    .eq("owner_space_id", space.id)
    .eq("is_default", true)
    .maybeSingle();
  if (studioAgendaError) throw new Error(studioAgendaError.message);

  const playerIds = players.map((player) => player.id);
  const { data: playerAgendas, error: playerAgendaError } = playerIds.length
    ? await admin
        .from("agendas")
        .select("id,name,owner_space_id,owner_player_id,timezone,public_enabled,booking_enabled,is_default")
        .in("owner_player_id", playerIds)
        .eq("is_default", true)
    : { data: [], error: null };
  if (playerAgendaError) throw new Error(playerAgendaError.message);

  const ownerIds = Array.from(new Set([space.owner_player_id, ...playerIds].filter(Boolean).map(String)));
  const { data: ownerRows, error: ownerError } = ownerIds.length
    ? await admin.from("players").select("id,owner_user_id").in("id", ownerIds)
    : { data: [], error: null };
  if (ownerError) throw new Error(ownerError.message);
  const ownerUser = new Map((ownerRows ?? []).map((row) => [String(row.id), row.owner_user_id ? String(row.owner_user_id) : null]));

  const agendas = [...(studioAgenda ? [studioAgenda] : []), ...(playerAgendas ?? [])];
  const calendarEvents: IgluCalendarEvent[] = [];
  for (const agenda of agendas) {
    const ownerPlayerId = agenda.owner_player_id ? String(agenda.owner_player_id) : String(space.owner_player_id || "");
    const userId = ownerUser.get(ownerPlayerId) || playerOwnerUser.get(ownerPlayerId) || null;
    if (!userId) continue;

    const occurrences = await getAgendaOccurrences({
      admin,
      userId,
      agendaId: String(agenda.id),
      from,
      to,
    }).catch(() => []);

    for (const event of occurrences) {
      const publicEvent = event.visibility === "public";
      const normalizedType = String(event.eventType || "").toLowerCase();
      const kind: IgluCalendarEvent["kind"] = !publicEvent
        ? "occupied"
        : normalizedType.includes("show")
          ? "show"
          : normalizedType.includes("session") || normalizedType.includes("booking")
            ? "session"
            : "event";
      calendarEvents.push({
        id: String(event.id),
        title: publicEvent ? event.title : "Ocupado",
        startAt: event.startAt,
        endAt: event.endAt,
        kind,
        public: publicEvent,
        location: publicEvent ? event.locationText : null,
        playerId: agenda.owner_player_id ? String(agenda.owner_player_id) : null,
        playerName: agenda.owner_player_id ? playerName.get(String(agenda.owner_player_id)) || null : "El Iglú",
      });
    }
  }

  const dedupedEvents = Array.from(new Map(calendarEvents.map((event) => [`${event.id}:${event.startAt}`, event])).values())
    .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());

  const agendaIds = agendas.map((agenda) => String(agenda.id));
  const agendaPlayerById = new Map(
    agendas.map((agenda) => [String(agenda.id), agenda.owner_player_id ? String(agenda.owner_player_id) : null]),
  );
  const { data: availabilityRules, error: availabilityError } = agendaIds.length
    ? await admin
        .from("agenda_availability_rules")
        .select("id,agenda_id,weekday,start_local,end_local,timezone,is_available")
        .in("agenda_id", agendaIds)
        .order("weekday")
        .order("start_local")
    : { data: [], error: null };
  if (availabilityError) throw new Error(availabilityError.message);

  const { data: services, error: servicesError } = await admin
    .from("studio_services")
    .select("id,name,description,category,price_type,price,currency,duration_minutes,cta_type,is_active,image_url")
    .eq("studio_id", identity.studio.id)
    .eq("is_active", true)
    .eq("cta_type", "reservar")
    .order("display_order");
  if (servicesError) throw new Error(servicesError.message);

  const { data: products, error: productError } = await admin
    .from("commerce_products")
    .select(commerceProductSelect)
    .eq("studio_id", identity.studio.id)
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .limit(20);
  if (productError) throw new Error(productError.message);

  const { data: radio, error: radioError } = await admin
    .from("profile_radio_settings")
    .select("id,station_name,tagline,stream_url,artwork_url,is_enabled,is_public")
    .eq("studio_id", identity.studio.id)
    .maybeSingle();
  if (radioError) throw new Error(radioError.message);

  const { data: tracks, error: tracksError } = await admin
    .from("radio_tracks")
    .select("id,title,artist,album,duration_seconds,artwork_url,status,youtube_url,storage_bucket,storage_path,created_at")
    .eq("studio_id", identity.studio.id)
    .in("status", ["ready", "synced"])
    .order("created_at", { ascending: false })
    .limit(30);
  if (tracksError) throw new Error(tracksError.message);

  return {
    identity,
    space,
    studioAgenda,
    players,
    events: dedupedEvents,
    availabilityRules: (availabilityRules ?? []).map((rule): IgluAvailabilityRule => ({
      id: String(rule.id),
      agendaId: String(rule.agenda_id),
      playerId: agendaPlayerById.get(String(rule.agenda_id)) || null,
      weekday: Number(rule.weekday),
      startLocal: String(rule.start_local),
      endLocal: String(rule.end_local),
      timezone: String(rule.timezone),
      isAvailable: Boolean(rule.is_available),
    })),
    services: services ?? [],
    products: (products ?? []) as unknown as CommerceProduct[],
    radio: radio && radio.is_enabled && radio.is_public ? radio : null,
    tracks: tracks ?? [],
  };
}
