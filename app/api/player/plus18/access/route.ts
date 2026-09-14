import { NextRequest, NextResponse } from "next/server";
import { isAuthError, requireUser } from "@/lib/server/supabase";
import { ageFromDateOfBirth, getAdultAccess, validateDateOfBirth } from "@/lib/player-plus18/server";

export const runtime = "nodejs";

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "No se pudo validar el acceso +18.";
  return NextResponse.json({ error: message }, { status: isAuthError(error) ? 401 : 500 });
}

export async function GET(request: NextRequest) {
  try {
    const access = await getAdultAccess(request);
    return NextResponse.json({
      authenticated: true,
      needsBirthDate: access.needsBirthDate,
      isAdult: access.isAdult,
      age: access.age,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, supabase } = await requireUser(request);
    const body = (await request.json().catch(() => ({}))) as { dateOfBirth?: string };
    const dateOfBirth = body.dateOfBirth?.trim() ?? "";
    const validation = validateDateOfBirth(dateOfBirth);

    if (!validation.valid) {
      return NextResponse.json({ error: validation.reason }, { status: 400 });
    }

    const { error } = await supabase.from("account_private_data").upsert(
      {
        user_id: user.id,
        date_of_birth: dateOfBirth,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    if (error) throw error;

    return NextResponse.json({
      authenticated: true,
      needsBirthDate: false,
      isAdult: validation.isAdult,
      age: ageFromDateOfBirth(dateOfBirth),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
