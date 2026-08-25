import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Loopback discovery marker for CLOUVA Workspace. It carries no session,
// path, or secret and deliberately does not identify production as a local
// development target.
export function GET() {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ project: "clouva-web", protocol: 1 });
}
