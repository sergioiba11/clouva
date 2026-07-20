import { createHash, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function tokenMatches(received: string | null, expected: string | undefined): boolean {
  if (!received || !expected) return false;
  const receivedHash = createHash('sha256').update(received).digest();
  const expectedHash = createHash('sha256').update(expected).digest();
  return timingSafeEqual(receivedHash, expectedHash);
}

function supabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY');
  return { url: url.replace(/\/$/, ''), key };
}

export async function POST(request: NextRequest) {
  try {
    const auth = request.headers.get('authorization');
    const receivedToken = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!tokenMatches(receivedToken, process.env.CLOUVA_BRIDGE_TOKEN)) {
      return NextResponse.json({ ok: false, error: 'Token del bridge inválido' }, { status: 401 });
    }

    const snapshot = await request.json();
    if (!snapshot || snapshot.schemaVersion !== 1 || snapshot.preset !== 'RC_CLOUVA_Avatar') {
      return NextResponse.json({ ok: false, error: 'Snapshot inválido o preset incorrecto' }, { status: 400 });
    }

    const capturedAt = typeof snapshot.capturedAt === 'string' ? snapshot.capturedAt : new Date().toISOString();
    const { source: _discardedSource, ...normalizedSnapshot } = snapshot;
    const { url, key } = supabaseConfig();
    const response = await fetch(`${url}/rest/v1/unreal_avatar_snapshots?on_conflict=preset_name,actor_name`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal,resolution=merge-duplicates',
      },
      body: JSON.stringify({
        preset_name: 'RC_CLOUVA_Avatar',
        actor_name: snapshot.actor?.name ?? 'BP_ClouvaCharacter',
        status: 'online',
        captured_at: capturedAt,
        last_connected_at: new Date().toISOString(),
        snapshot: normalizedSnapshot,
        error: null,
      }),
    });

    if (!response.ok) throw new Error(`Supabase HTTP ${response.status}: ${await response.text()}`);
    return NextResponse.json({ ok: true, capturedAt });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
