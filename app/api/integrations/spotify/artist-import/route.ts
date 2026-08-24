import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

const MAX_CSV_BYTES = 2_000_000;
const MAX_ROWS = 5_000;
const MAX_COLUMNS = 100;

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const firstLine = text.split(/\r?\n/, 1)[0] || "";
  const delimiter = (firstLine.match(/;/g)?.length || 0) > (firstLine.match(/,/g)?.length || 0) ? ";" : ",";

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (quoted && next === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (!quoted && char === delimiter) {
      row.push(field.trim());
      field = "";
      continue;
    }

    if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(field.trim());
      field = "";
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      if (rows.length > MAX_ROWS + 1) break;
      continue;
    }

    field += char;
  }

  row.push(field.trim());
  if (row.some((cell) => cell.length > 0)) rows.push(row);
  if (!rows.length) throw new Error("El CSV está vacío.");

  const rawHeaders = rows[0].slice(0, MAX_COLUMNS);
  const headers = rawHeaders.map((header, index) => header || `columna_${index + 1}`);
  if (!headers.length) throw new Error("El CSV no tiene columnas.");

  const bodyRows = rows.slice(1, MAX_ROWS + 1).map((cells) => {
    const item: Record<string, string> = {};
    headers.forEach((header, index) => {
      item[header] = cells[index] ?? "";
    });
    return item;
  });

  return { headers, rows: bodyRows };
}

function classify(headers: string[]) {
  const normalized = headers.join(" ").toLowerCase();
  if (normalized.includes("playlist")) return "playlists";
  if (normalized.includes("song") || normalized.includes("track") || normalized.includes("canción") || normalized.includes("cancion")) return "songs";
  if (normalized.includes("listener") || normalized.includes("stream") || normalized.includes("follower") || normalized.includes("oyente") || normalized.includes("reproducci")) return "audience";
  return "generic";
}

async function ownedPlayer(userId: string) {
  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from("players")
    .select("id,slug,display_name")
    .eq("owner_user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const player = await ownedPlayer(user.id);
    if (!player) return NextResponse.json({ error: "Primero creá tu Player." }, { status: 404 });

    const { data, error } = await createAdminSupabase()
      .from("spotify_for_artists_imports")
      .select("id,source_type,file_name,row_count,imported_at,headers")
      .eq("player_id", player.id)
      .eq("owner_user_id", user.id)
      .order("imported_at", { ascending: false })
      .limit(10);
    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true, imports: data || [] });
  } catch (error) {
    const status = isAuthError(error) ? 401 : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudieron leer las importaciones." }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const player = await ownedPlayer(user.id);
    if (!player) return NextResponse.json({ error: "Primero creá tu Player." }, { status: 404 });

    const body = (await request.json().catch(() => ({}))) as { fileName?: unknown; csvText?: unknown };
    const csvText = typeof body.csvText === "string" ? body.csvText : "";
    const fileName = typeof body.fileName === "string" && body.fileName.trim()
      ? body.fileName.trim().slice(0, 180)
      : "spotify-for-artists.csv";

    if (!csvText) return NextResponse.json({ error: "Seleccioná un CSV exportado desde Spotify for Artists." }, { status: 400 });
    if (Buffer.byteLength(csvText, "utf8") > MAX_CSV_BYTES) {
      return NextResponse.json({ error: "El CSV es demasiado grande. Máximo 2 MB por importación." }, { status: 413 });
    }

    const parsed = parseCsv(csvText.replace(/^\uFEFF/, ""));
    if (parsed.rows.length > MAX_ROWS) {
      return NextResponse.json({ error: `El CSV supera el máximo de ${MAX_ROWS.toLocaleString("es-AR")} filas.` }, { status: 413 });
    }
    const sourceType = classify(parsed.headers);
    const now = new Date().toISOString();
    const admin = createAdminSupabase();

    const { data: imported, error } = await admin
      .from("spotify_for_artists_imports")
      .insert({
        player_id: player.id,
        owner_user_id: user.id,
        source_type: sourceType,
        file_name: fileName,
        headers: parsed.headers,
        rows: parsed.rows,
        row_count: parsed.rows.length,
        imported_at: now,
      })
      .select("id,source_type,file_name,row_count,imported_at,headers")
      .single();
    if (error) throw new Error(error.message);

    const { error: playerError } = await admin
      .from("players")
      .update({ spotify_for_artists_last_import_at: now, updated_at: now })
      .eq("id", player.id);
    if (playerError) throw new Error(playerError.message);

    return NextResponse.json({
      ok: true,
      import: imported,
      preview: parsed.rows.slice(0, 5),
    });
  } catch (error) {
    const status = isAuthError(error) ? 401 : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo importar el CSV de Spotify for Artists." }, { status });
  }
}
