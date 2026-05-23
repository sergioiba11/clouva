import { NextResponse, type NextRequest } from "next/server";
import { verifyAdminFromRequest } from "@/lib/server-auth";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isAdminPath = pathname === "/admin" || pathname.startsWith("/admin/");
  const isAdminApiPath = pathname === "/api/admin" || pathname.startsWith("/api/admin/");

  if (!isAdminPath && !isAdminApiPath) {
    return NextResponse.next();
  }

  const guard = await verifyAdminFromRequest(request.headers.get("cookie"));

  if (guard.kind === "admin") {
    return NextResponse.next();
  }

  if (isAdminApiPath) {
    const status = guard.kind === "guest" ? 401 : 403;
    return NextResponse.json({ error: "Unauthorized" }, { status });
  }

  const loginUrl = new URL("/login", request.url);
  const flowUrl = new URL("/mi-flow", request.url);

  return NextResponse.redirect(guard.kind === "guest" ? loginUrl : flowUrl);
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
