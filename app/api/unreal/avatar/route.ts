import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function supabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY');
  return { url: url.replace(/\/$/, ''), key };
}

function publicSnapshot(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const { source: _discardedSource, ...normalized } = value as Record<string, unknown>;
  return normalized;
}

export async function GET() {
  try {
    const { url, key } = supabaseConfig();
    const response = await fetch(`${url}/rest/v1/unreal_avatar_snapshots?preset_name=eq.RC_CLOUVA_Avatar&select=*&order=captured_at.desc&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`Supabase HTTP ${response.status}: ${await response.text()}`);
    const rows = await response.json() as Array<Record<string, unknown>>;
    const row = rows[0];
    if (!row) {
      return NextResponse.json({ status: 'offline', lastConnectionAt: null, snapshot: null, error: 'Todavía no se recibió ningún snapshot' }, { status: 404 });
    }
    const capturedAt = String(row.captured_at ?? '');
    const ageMs = Date.now() - new Date(capturedAt).getTime();
    const status = ageMs <= 45000 ? 'online' : 'offline';
    return NextResponse.json({
      status,
      lastConnectionAt: row.last_connected_at ?? capturedAt,
      capturedAt,
      error: status === 'offline' ? 'El bridge no envió datos recientemente o Unreal está cerrado' : null,
      snapshot: publicSnapshot(row.snapshot),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ status: 'offline', lastConnectionAt: null, snapshot: null, error: message }, { status: 500 });
  }
}
