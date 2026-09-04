import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";
import { asNonNegativeInt, asNullableText, asText, requireOwnedPlayer } from "@/lib/auto/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const admin = createAdminSupabase();
    const player = await requireOwnedPlayer(admin, user);
    const { data: vehicles, error } = await admin
      .from("vehicles")
      .select("id,nickname,make,model,version,year,license_plate,odometer_km,color_current,overall_status,created_at,updated_at")
      .eq("player_id", player.id)
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return NextResponse.json({ player, vehicles: vehicles ?? [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudieron cargar tus vehículos.";
    return NextResponse.json({ error: message }, { status: isAuthError(error) ? 401 : 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const admin = createAdminSupabase();
    const player = await requireOwnedPlayer(admin, user);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const make = asText(body.make, 100);
    const model = asText(body.model, 100);
    if (!make || !model) return NextResponse.json({ error: "Marca y modelo son obligatorios." }, { status: 400 });

    const rawYear = Number(body.year);
    const year = Number.isFinite(rawYear) && rawYear >= 1886 && rawYear <= 2200 ? Math.trunc(rawYear) : null;
    const payload = {
      player_id: player.id,
      nickname: asNullableText(body.nickname, 100),
      make,
      model,
      version: asNullableText(body.version, 120),
      year,
      license_plate: asNullableText(body.licensePlate, 24),
      vin: asNullableText(body.vin, 80),
      odometer_km: asNonNegativeInt(body.odometerKm),
      fuel_type: asNullableText(body.fuelType, 60),
      transmission: asNullableText(body.transmission, 60),
      color_current: asNullableText(body.colorCurrent, 80),
      color_original: asNullableText(body.colorOriginal, 80),
      acquired_on: asNullableText(body.acquiredOn, 20),
      notes: asNullableText(body.notes, 4000),
      overall_status: "review",
    };

    const { data: vehicle, error } = await admin.from("vehicles").insert(payload).select("*").single();
    if (error) throw new Error(error.message);
    await admin.from("vehicle_events").insert({
      vehicle_id: vehicle.id,
      event_type: "vehicle_created",
      title: "Vehículo agregado a CLOUVA Auto",
      description: `${make} ${model}${year ? ` ${year}` : ""}`,
      odometer_km: payload.odometer_km,
      metadata: { source: "clouva_auto" },
    });
    return NextResponse.json({ vehicle }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo crear el vehículo.";
    return NextResponse.json({ error: message }, { status: isAuthError(error) ? 401 : 500 });
  }
}
