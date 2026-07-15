import { NextResponse, type NextRequest } from "next/server";
import { verifyAdminFromRequest } from "@/lib/server-auth";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isAdminApi = pathname === "/api/admin" || pathname.startsWith("/api/admin/");

  // La sesión actual de Supabase se guarda en el navegador y puede no estar
  // disponible como cookie para el middleware. Permitimos cargar la interfaz
  // /admin y hacemos la validación de rol dentro de la página con useAuth.
  if (!isAdminApi) return NextResponse.next();

  const guard = await verifyAdminFromRequest(request.headers.get("cookie"));
  if (guard.kind === "admin") return NextResponse.next();

  return NextResponse.json(
    { error: "Unauthorized" },
    { status: guard.kind === "guest" ? 401 : 403 },
  );
}

export const config = { matcher: ["/api/admin/:path*"] };
