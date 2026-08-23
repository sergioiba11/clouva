import { NextRequest, NextResponse } from "next/server";
import { spotifyErrorPayload } from "@/core/integrations/spotify/http";
import { isSpotifyUriSaved, removeSpotifyUri, saveSpotifyUri } from "@/core/integrations/spotify/service";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

function validUri(value: unknown) {
  if (typeof value !== "string") return null;
  const uri = value.trim();
  return /^spotify:(track|artist):[A-Za-z0-9]+$/.test(uri) ? uri : null;
}

function responseKey(uri: string, value: boolean) {
  return uri.startsWith("spotify:artist:") ? { followed: value } : { saved: value };
}

async function auth(request: NextRequest) {
  const { user } = await requireUser(request);
  return { user, admin: createAdminSupabase() };
}

export async function GET(request: NextRequest) {
  try {
    const { user, admin } = await auth(request);
    const uri = validUri(request.nextUrl.searchParams.get("uri"));
    if (!uri) return NextResponse.json({ ok: false, code: "invalid_request" }, { status: 400 });
    const saved = await isSpotifyUriSaved(admin, user.id, uri);
    return NextResponse.json({ ok: true, ...responseKey(uri, saved) });
  } catch (error) {
    if (isAuthError(error)) return NextResponse.json({ ok: false, code: "unauthorized" }, { status: 401 });
    const mapped = spotifyErrorPayload(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { user, admin } = await auth(request);
    const body = (await request.json().catch(() => ({}))) as { uri?: unknown };
    const uri = validUri(body.uri);
    if (!uri) return NextResponse.json({ ok: false, code: "invalid_request" }, { status: 400 });
    await saveSpotifyUri(admin, user.id, uri);
    return NextResponse.json({ ok: true, ...responseKey(uri, true) });
  } catch (error) {
    if (isAuthError(error)) return NextResponse.json({ ok: false, code: "unauthorized" }, { status: 401 });
    const mapped = spotifyErrorPayload(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { user, admin } = await auth(request);
    const body = (await request.json().catch(() => ({}))) as { uri?: unknown };
    const uri = validUri(body.uri);
    if (!uri) return NextResponse.json({ ok: false, code: "invalid_request" }, { status: 400 });
    await removeSpotifyUri(admin, user.id, uri);
    return NextResponse.json({ ok: true, ...responseKey(uri, false) });
  } catch (error) {
    if (isAuthError(error)) return NextResponse.json({ ok: false, code: "unauthorized" }, { status: 401 });
    const mapped = spotifyErrorPayload(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
