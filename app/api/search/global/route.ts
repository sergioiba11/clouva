import { NextRequest, NextResponse } from "next/server";
import { listPublishedPlayers, listPublishedStudios } from "@/lib/server/public-identity-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SearchResult = {
  id: string;
  kind: "player" | "studio";
  label: string;
  secondary: string | null;
  imageUrl: string | null;
  href: string;
};

function normalize(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function includesQuery(query: string, values: unknown[]) {
  return values.some((value) => {
    if (Array.isArray(value)) return value.some((item) => normalize(item).includes(query));
    return normalize(value).includes(query);
  });
}

export async function GET(request: NextRequest) {
  const query = normalize(request.nextUrl.searchParams.get("q"));
  if (query.length < 2) return NextResponse.json({ results: [] satisfies SearchResult[] });

  try {
    const [players, studios] = await Promise.all([
      listPublishedPlayers(),
      listPublishedStudios(),
    ]);

    const playerResults: SearchResult[] = players
      .filter((player) => includesQuery(query, [
        player.display_name,
        player.username,
        player.slug,
        player.short_bio,
        player.origin,
        player.location,
        player.professional_categories,
        player.disciplines,
      ]))
      .slice(0, 6)
      .map((player) => ({
        id: player.id,
        kind: "player",
        label: player.display_name || player.username || player.slug,
        secondary: player.username ? `@${player.username.replace(/^@/, "")}` : player.primary_role || player.location || null,
        imageUrl: player.profile_image_url || null,
        href: `/${player.slug}`,
      }));

    const studioResults: SearchResult[] = studios
      .filter((studio) => includesQuery(query, [
        studio.name,
        studio.slug,
        studio.tagline,
        studio.description,
        studio.city,
        studio.country,
        studio.categories,
      ]))
      .slice(0, 6)
      .map((studio) => ({
        id: studio.id,
        kind: "studio",
        label: studio.name,
        secondary: [studio.city, studio.country].filter(Boolean).join(", ") || studio.tagline || null,
        imageUrl: studio.logo_url || studio.cover_url || null,
        href: `/studios/${studio.slug}`,
      }));

    const results = [...playerResults, ...studioResults]
      .sort((a, b) => {
        const aStarts = normalize(a.label).startsWith(query) ? 0 : 1;
        const bStarts = normalize(b.label).startsWith(query) ? 0 : 1;
        return aStarts - bStarts || a.label.localeCompare(b.label, "es");
      })
      .slice(0, 10);

    return NextResponse.json(
      { results },
      { headers: { "Cache-Control": "public, max-age=15, s-maxage=60, stale-while-revalidate=120" } },
    );
  } catch (error) {
    console.error("[global-search] public identity search failed", error);
    return NextResponse.json({ results: [] satisfies SearchResult[] }, { status: 200 });
  }
}
