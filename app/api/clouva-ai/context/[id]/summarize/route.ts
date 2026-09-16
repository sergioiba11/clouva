import { NextRequest, NextResponse } from "next/server";
import { refreshContextSummary } from "@/lib/clouva-ai/media/context-service";
import { publicMediaError, requireMediaAdmin } from "@/lib/server/media-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { admin, user } = await requireMediaAdmin(request);
    const { id } = await context.params;
    const summary = await refreshContextSummary(admin, user.id, id);
    return NextResponse.json({ context: summary });
  } catch (error) {
    const mapped = publicMediaError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
