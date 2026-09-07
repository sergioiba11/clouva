import { NextRequest, NextResponse } from "next/server";
import {
  assertPlayerUsernameAvailable,
  getOwnedPlayerBasics,
  normalizePlayerDisplayName,
  playerBasicsComplete,
  validatePlayerUsername,
} from "@/lib/server/player-basics";
import { normalizeCountryCode, resolveFlowRegion } from "@/lib/flows/flow-region";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(error: unknown, fallback: string) {
  const typed = error as Error & { status?: number; code?: string };
  return NextResponse.json(
    {
      error: error instanceof Error ? error.message : fallback,
      ...(typed.code ? { code: typed.code } : {}),
    },
    { status: typed.status ?? (isAuthError(error) ? 401 : 500) },
  );
}

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const admin = createAdminSupabase();
    const [player, profileResult] = await Promise.all([
      getOwnedPlayerBasics(admin, user.id),
      admin.from("profiles").select("country_code").eq("id", user.id).maybeSingle(),
    ]);
    if (profileResult.error) throw new Error(profileResult.error.message);
    return NextResponse.json({
      player,
      countryCode: profileResult.data?.country_code ?? null,
      complete: playerBasicsComplete(player),
      needsName: !player?.display_name?.trim(),
      needsUsername: !player?.username?.trim(),
    });
  } catch (error) {
    return errorResponse(error, "No se pudo verificar tu identidad.");
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const body = (await request.json().catch(() => ({}))) as {
      displayName?: unknown;
      username?: unknown;
      countryCode?: unknown;
    };
    const displayName = normalizePlayerDisplayName(body.displayName);
    const username = validatePlayerUsername(body.username);
    const countryCode = normalizeCountryCode(typeof body.countryCode === "string" ? body.countryCode : null);
    if (!displayName) {
      return NextResponse.json({ error: "Tu nombre público es obligatorio.", code: "DISPLAY_NAME_REQUIRED" }, { status: 400 });
    }
    if (!countryCode || !resolveFlowRegion(countryCode)) {
      return NextResponse.json({ error: "Seleccioná un país válido.", code: "COUNTRY_REQUIRED" }, { status: 400 });
    }

    const admin = createAdminSupabase();
    const player = await getOwnedPlayerBasics(admin, user.id);
    if (!player) {
      return NextResponse.json({ error: "No pudimos resolver tu Player base.", code: "PLAYER_NOT_FOUND" }, { status: 409 });
    }

    // Friendly preflight plus the DB unique index/RPC check for the concurrent
    // write case. The RPC updates Player + Profile identity fields.
    await assertPlayerUsernameAvailable(admin, username, player.id);
    const { data: updated, error } = await admin.rpc("set_player_basics", {
      p_user_id: user.id,
      p_display_name: displayName,
      p_username: username,
    });
    if (error) {
      if (error.code === "23505") {
        const taken = new Error("Ese @ ya está en uso.") as Error & { status?: number; code?: string };
        taken.status = 409;
        taken.code = "USERNAME_TAKEN";
        throw taken;
      }
      throw new Error(error.message);
    }

    const { error: countryError } = await admin
      .from("profiles")
      .update({ country_code: countryCode })
      .eq("id", user.id);
    if (countryError) throw new Error(countryError.message);

    return NextResponse.json({ player: updated, countryCode, complete: true });
  } catch (error) {
    return errorResponse(error, "No se pudo guardar tu identidad.");
  }
}
