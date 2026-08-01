import type { SupabaseClient } from "@supabase/supabase-js";

// Same alias-then-slug resolution as resolveStudioAlias() in
// public-identity-data.ts, but against the admin client (server-side
// membership actions don't go through the public RLS path) and returning
// only the fields the join/subscribe routes need.
export async function resolveStudioForMembership(admin: SupabaseClient, slugOrAlias: string) {
  const normalized = slugOrAlias.trim().toLowerCase();
  const { data: aliasRow, error: aliasError } = await admin
    .from("public_slug_aliases")
    .select("entity_id")
    .eq("normalized_alias", normalized)
    .eq("entity_type", "studio")
    .maybeSingle();
  if (aliasError) throw new Error(aliasError.message);

  let query = admin.from("studios").select("id,slug,name,logo_url,cover_url,accent_color");
  query = aliasRow ? query.eq("id", aliasRow.entity_id) : query.eq("slug", normalized);
  const { data: studio, error } = await query
    .eq("is_published", true)
    .eq("publication_status", "published")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!studio) {
    const notFound = new Error("El Estudio no existe.");
    (notFound as Error & { status?: number }).status = 404;
    throw notFound;
  }
  return studio as { id: string; slug: string; name: string; logo_url: string | null; cover_url: string | null; accent_color: string | null };
}
