import { NextResponse, type NextRequest } from "next/server";
import { verifyAdminFromRequest } from "@/lib/server-auth";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isAdminApiPath = pathname === "/api/admin" || pathname.startsWith("/api/admin/");

  if (!isAdminApiPath) {
    return NextResponse.next();
  }

  const guard = await verifyAdminFromRequest(request.headers.get("cookie"));
  if (guard.kind === "admin") return NextResponse.next();

  const status = guard.kind === "guest" ? 401 : 403;
  return NextResponse.json({ error: "Unauthorized" }, { status });
}

export const config = {
  matcher: ["/api/admin/:path*"],
};
