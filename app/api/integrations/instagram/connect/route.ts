import { NextRequest, NextResponse } from "next/server";
import { buildInstagramAuthorizeUrl } from "@/core/integrations/instagram/client";
import { isInstagramEnabled } from "@/core/integrations/instagram/config";
import { createInstagramState } from "@/core/integrations/instagram/state";
import { requireStudioManager } from "@/lib/server/studio-permissions";
import {
  createAdminSupabase,
  createUserSupabase,
  readBearerToken,
} from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_RETURN_PATHS = new Set([
  "/onboarding/instagram/select",
  "/profile/edit",
]);

export async function POST(request: NextRequest) {
  try {
    if (!isInstagramEnabled()) {
      return NextResponse.json({ error: "La importación de Instagram todavía no está activada." }, { status: 503 });
    }

    const body = (await request.json().catch(() => ({}))) as { returnPath?: string; studioId?: string };
    const studioId = typeof body.studioId === "string" && body.studioId ? body.studioId : undefined;

    const accessToken = readBearerToken(request);
    let userId: string | undefined;
    if (accessToken) {
      const supabase = createUserSupabase(accessToken);
      const { data, error } = await supabase.auth.getUser(accessToken);
      if (error || !data.user) {
        return NextResponse.json({ error: "Sesión inválida." }, { status: 401 });
      }
      userId = data.user.id;
    }

    const admin = createAdminSupabase();

    // Flujo por Estudio: siempre requiere sesión + permiso de manager, y el
    // return_path se calcula acá (nunca se confía en un path arbitrario del
    // cliente) -- evita tener que ampliar ALLOWED_RETURN_PATHS a un regex por
    // studioId, que sería una superficie de open-redirect más difícil de
    // auditar.
    let returnPath: string;
    if (studioId) {
      if (!userId) return NextResponse.json({ error: "Iniciá sesión para conectar el Instagram del Estudio." }, { status: 401 });
      await requireStudioManager({ admin, userId, studioId });
      returnPath = `/studio-dashboard/${studioId}?tab=ai-profile`;
    } else {
      returnPath = ALLOWED_RETURN_PATHS.has(body.returnPath || "")
        ? body.returnPath!
        : "/onboarding/instagram/select";
    }

    const created = await createInstagramState({
      admin,
      userId,
      studioId,
      returnPath,
      useContinuation: !userId,
    });

    const response = NextResponse.json({
      authorizeUrl: buildInstagramAuthorizeUrl(created.rawState),
      expiresAt: created.expiresAt,
    });

    if (created.rawContinuation) {
      response.cookies.set("clouva_ig_continuation", created.rawContinuation, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 10 * 60,
      });
    }

    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo iniciar Instagram.";
    const status = (error as Error & { status?: number })?.status ?? 500;
    return NextResponse.json({ error: message }, { status });
  }
}
