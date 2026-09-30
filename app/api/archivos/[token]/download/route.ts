import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";

function validToken(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!validToken(token)) {
    return NextResponse.json({ error: "Enlace inválido." }, { status: 404 });
  }

  const admin = createAdminSupabase();
  const { data: file, error } = await admin
    .from("clouva_files")
    .select("id,storage_path,original_name,is_share_enabled,download_count")
    .eq("share_token", token)
    .maybeSingle();

  if (error || !file?.is_share_enabled) {
    return NextResponse.json({ error: "El archivo no está disponible." }, { status: 404 });
  }

  const { data: signed, error: signedError } = await admin.storage
    .from("clouva-files")
    .createSignedUrl(file.storage_path, 120, { download: file.original_name });

  if (signedError || !signed?.signedUrl) {
    return NextResponse.json({ error: "No se pudo preparar la descarga." }, { status: 502 });
  }

  void admin
    .from("clouva_files")
    .update({ download_count: Number(file.download_count || 0) + 1 })
    .eq("id", file.id);

  const response = NextResponse.redirect(signed.signedUrl, 302);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}
