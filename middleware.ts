import { NextResponse, type NextRequest } from "next/server";
import { verifyAdminFromRequest } from "@/lib/server-auth";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isAdminPath = pathname === "/admin" || pathname.startsWith("/admin/") || pathname === "/api/admin" || pathname.startsWith("/api/admin/");
  if (!isAdminPath) return NextResponse.next();

  const guard = await verifyAdminFromRequest(request.headers.get("cookie"));
  if (guard.kind === "admin") return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: guard.kind === "guest" ? 401 : 403 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/admin/:path*", "/api/admin/:path*"] };
