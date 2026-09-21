import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function num(value: string | null) {
  if (value == null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number) {
  const toRad = (value: number) => value * Math.PI / 180;
  const radius = 6371;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(h));
}

function producerLike(player: {
  primary_role: string | null;
  professional_categories: unknown;
  disciplines: unknown;
}) {
  const values = [
    player.primary_role || "",
    ...(Array.isArray(player.professional_categories) ? player.professional_categories : []),
    ...(Array.isArray(player.disciplines) ? player.disciplines : []),
  ].map((value) => String(value).toLowerCase());

  return values.some((value) =>
    value.includes("productor") ||
    value.includes("producer") ||
    value.includes("beatmaker") ||
    value.includes("engineer") ||
    value.includes("ingeniero"),
  );
}

function normalizedZone(value: string | null) {
  return (value || "").trim().toLocaleLowerCase("es-AR");
}

export async function GET(request: NextRequest) {
  try {
    const admin = createAdminSupabase();
    const lat = num(request.nextUrl.searchParams.get("lat"));
    const lon = num(request.nextUrl.searchParams.get("lon"));
    const zone = normalizedZone(request.nextUrl.searchParams.get("zone"));

    const { data: players, error: playerError } = await admin
      .from("players")
      .select("id,owner_user_id,slug,display_name,username,primary_role,professional_categories,disciplines,location,latitude,longitude,profile_image_url,is_verified,is_published,publication_status")
      .eq("is_published", true)
      .eq("publication_status", "published")
      .limit(80);
    if (playerError) throw new Error(playerError.message);

    const producers = (players ?? []).filter(producerLike);
    const ownerIds = Array.from(new Set(producers.flatMap((player) => player.owner_user_id ? [String(player.owner_user_id)] : [])));
    const playerIds = producers.map((player) => String(player.id));

    const [{ data: entitlements, error: entitlementError }, { data: agendas, error: agendaError }] = await Promise.all([
      ownerIds.length
        ? admin
            .from("user_entitlements")
            .select("user_id,product_code,tier,status,valid_from,valid_until")
            .in("user_id", ownerIds)
            .eq("product_code", "clouva_vip")
            .eq("tier", "vip")
            .eq("status", "active")
        : Promise.resolve({ data: [], error: null }),
      playerIds.length
        ? admin
            .from("agendas")
            .select("id,owner_player_id,booking_enabled,public_enabled")
            .in("owner_player_id", playerIds)
            .eq("is_default", true)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (entitlementError) throw new Error(entitlementError.message);
    if (agendaError) throw new Error(agendaError.message);

    const agendaIds = (agendas ?? []).map((agenda) => String(agenda.id));
    const { data: rules, error: rulesError } = agendaIds.length
      ? await admin
          .from("agenda_availability_rules")
          .select("agenda_id,is_available")
          .in("agenda_id", agendaIds)
          .eq("is_available", true)
      : { data: [], error: null };
    if (rulesError) throw new Error(rulesError.message);

    const now = Date.now();
    const proUsers = new Set(
      (entitlements ?? [])
        .filter((row) => {
          const from = row.valid_from ? new Date(String(row.valid_from)).getTime() : null;
          const until = row.valid_until ? new Date(String(row.valid_until)).getTime() : null;
          return (from == null || from <= now) && (until == null || until > now);
        })
        .map((row) => String(row.user_id)),
    );
    const agendaByPlayer = new Map((agendas ?? []).map((agenda) => [String(agenda.owner_player_id), agenda]));
    const agendasWithAvailability = new Set((rules ?? []).map((rule) => String(rule.agenda_id)));

    const result = producers.map((player) => {
      const latitude = typeof player.latitude === "number" ? player.latitude : null;
      const longitude = typeof player.longitude === "number" ? player.longitude : null;
      const distanceKm =
        lat != null && lon != null && latitude != null && longitude != null
          ? haversineKm(lat, lon, latitude, longitude)
          : null;
      const agenda = agendaByPlayer.get(String(player.id));
      const location = player.location ? String(player.location) : null;
      const zoneMatch = zone && location ? normalizedZone(location).includes(zone) || zone.includes(normalizedZone(location)) : false;

      return {
        id: String(player.id),
        slug: String(player.slug),
        displayName: String(player.display_name || player.username || player.slug || "Player"),
        primaryRole: player.primary_role ? String(player.primary_role) : null,
        disciplines: Array.isArray(player.disciplines) ? player.disciplines.map(String).slice(0, 8) : [],
        location,
        latitude,
        longitude,
        avatar: player.profile_image_url ? String(player.profile_image_url) : null,
        isVerified: Boolean(player.is_verified),
        isPro: Boolean(player.owner_user_id && proUsers.has(String(player.owner_user_id))),
        bookingEnabled: Boolean(agenda?.booking_enabled && agenda?.public_enabled),
        hasAvailability: Boolean(agenda && agendasWithAvailability.has(String(agenda.id))),
        distanceKm,
        zoneMatch,
      };
    });

    result.sort((a, b) => {
      if (a.distanceKm != null && b.distanceKm != null && a.distanceKm !== b.distanceKm) return a.distanceKm - b.distanceKm;
      if (a.distanceKm != null) return -1;
      if (b.distanceKm != null) return 1;
      if (a.zoneMatch !== b.zoneMatch) return a.zoneMatch ? -1 : 1;
      if (a.bookingEnabled !== b.bookingEnabled) return a.bookingEnabled ? -1 : 1;
      if (a.hasAvailability !== b.hasAvailability) return a.hasAvailability ? -1 : 1;
      if (a.isPro !== b.isPro) return a.isPro ? -1 : 1;
      return a.displayName.localeCompare(b.displayName, "es");
    });

    return NextResponse.json(
      { producers: result.slice(0, 40) },
      { headers: { "Cache-Control": "private, max-age=30" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudieron cargar productores cercanos." },
      { status: 500 },
    );
  }
}
