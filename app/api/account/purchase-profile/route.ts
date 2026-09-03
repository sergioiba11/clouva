import { NextRequest, NextResponse } from "next/server";
import { getPurchaseEligibility } from "@/lib/server/purchase-eligibility";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function validDate(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date > new Date()) return null;
  return value;
}

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const eligibility = await getPurchaseEligibility(createAdminSupabase(), user.id);
    return NextResponse.json({ eligibility });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo cargar tu información de compra." },
      { status: isAuthError(error) ? 401 : 500 },
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const admin = createAdminSupabase();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const dateOfBirth = validDate(body.dateOfBirth);
    if (!dateOfBirth) {
      return NextResponse.json({ error: "Ingresá una fecha de nacimiento válida.", field: "dateOfBirth" }, { status: 400 });
    }

    const source = body.address && typeof body.address === "object" ? body.address as Record<string, unknown> : {};
    const address = {
      label: cleanText(source.label, 40) || "Principal",
      recipient_name: cleanText(source.recipientName, 160),
      recipient_phone: cleanText(source.recipientPhone, 60) || null,
      recipient_email: cleanText(source.recipientEmail, 320).toLowerCase() || user.email?.toLowerCase() || null,
      address_line_1: cleanText(source.addressLine1, 240),
      address_line_2: cleanText(source.addressLine2, 240) || null,
      city: cleanText(source.city, 120),
      province: cleanText(source.province, 120),
      postal_code: cleanText(source.postalCode, 30),
      country: (cleanText(source.country, 2) || "AR").toUpperCase(),
    };
    if (!address.recipient_name || !address.address_line_1 || !address.city || !address.province || !address.postal_code || address.country.length !== 2) {
      return NextResponse.json({ error: "Completá destinatario, calle, localidad, provincia y código postal.", field: "address" }, { status: 400 });
    }

    const requestedAddressId = cleanText(source.id, 80);
    if (requestedAddressId) {
      const { data: ownedAddress, error: ownershipError } = await admin
        .from("user_addresses")
        .select("id")
        .eq("id", requestedAddressId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (ownershipError) throw new Error(ownershipError.message);
      if (!ownedAddress) return NextResponse.json({ error: "La dirección no pertenece a tu cuenta." }, { status: 404 });
    }

    const now = new Date().toISOString();
    const { error: privateError } = await admin.from("account_private_data").upsert({
      user_id: user.id,
      date_of_birth: dateOfBirth,
      updated_at: now,
    }, { onConflict: "user_id" });
    if (privateError) throw new Error(privateError.message);

    const { error: clearDefaultError } = await admin
      .from("user_addresses")
      .update({ is_default: false, updated_at: now })
      .eq("user_id", user.id)
      .eq("is_default", true);
    if (clearDefaultError) throw new Error(clearDefaultError.message);

    if (requestedAddressId) {
      const { error } = await admin
        .from("user_addresses")
        .update({ ...address, is_default: true, updated_at: now })
        .eq("id", requestedAddressId)
        .eq("user_id", user.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await admin.from("user_addresses").insert({ ...address, user_id: user.id, is_default: true });
      if (error) throw new Error(error.message);
    }

    return NextResponse.json({ eligibility: await getPurchaseEligibility(admin, user.id) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo guardar tu información de compra." },
      { status: isAuthError(error) ? 401 : 500 },
    );
  }
}
