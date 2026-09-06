import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";

const PLAYER_SELECT = "id,owner_user_id,slug,username,display_name,profile_image_url,is_published,publication_status,privacy_status";

type PlayerRow = {
  id: string;
  owner_user_id: string;
  slug: string;
  username: string | null;
  display_name: string | null;
  profile_image_url: string | null;
  is_published: boolean | null;
  publication_status: string | null;
  privacy_status: string | null;
};

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const query = (request.nextUrl.searchParams.get("q") || "").trim().replace(/[%_]/g, "").slice(0, 80);
    if (query.length < 2) return NextResponse.json({ recipients: [] });

    const admin = createAdminSupabase();
    const buildQuery = () => admin
      .from("players")
      .select(PLAYER_SELECT)
      .neq("owner_user_id", user.id)
      .eq("is_published", true)
      .eq("publication_status", "published")
      .neq("privacy_status", "private")
      .limit(12);

    const [byName, byUsername] = await Promise.all([
      buildQuery().ilike("display_name", `%${query}%`),
      buildQuery().ilike("username", `%${query.replace(/^@/, "")}%`),
    ]);
    if (byName.error) throw new Error(byName.error.message);
    if (byUsername.error) throw new Error(byUsername.error.message);

    const players = new Map<string, PlayerRow>();
    for (const row of [...(byName.data ?? []), ...(byUsername.data ?? [])] as PlayerRow[]) players.set(row.id, row);
    const rows = Array.from(players.values()).slice(0, 12);
    if (!rows.length) return NextResponse.json({ recipients: [] });

    const ownerIds = Array.from(new Set(rows.map((row) => row.owner_user_id)));
    const { data: qrRows, error: qrError } = await admin
      .from("clouva_qr_registry")
      .select("entity_id,public_token")
      .eq("entity_type", "USER")
      .eq("status", "ACTIVE")
      .eq("is_canonical", true)
      .in("entity_id", ownerIds);
    if (qrError) throw new Error(qrError.message);

    const qrByOwner = new Map((qrRows ?? []).map((row) => [String(row.entity_id), String(row.public_token)]));
    const recipients = rows.flatMap((row) => {
      const publicToken = qrByOwner.get(row.owner_user_id);
      if (!publicToken) return [];
      return [{
        playerId: row.id,
        slug: row.slug,
        username: row.username,
        displayName: row.display_name || row.username || row.slug,
        profileImageUrl: row.profile_image_url,
        publicToken,
        paymentHref: `/q/${encodeURIComponent(publicToken)}`,
      }];
    });

    return NextResponse.json({ recipients });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudieron buscar Players." },
      { status },
    );
  }
}
