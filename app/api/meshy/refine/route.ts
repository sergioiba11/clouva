import { NextRequest, NextResponse } from "next/server";
import { createRefineTask } from "@/lib/meshy";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const previewTaskId = typeof body?.previewTaskId === "string" ? body.previewTaskId : "";
    if (!previewTaskId) return NextResponse.json({ error: "Falta previewTaskId" }, { status: 400 });
    const taskId = await createRefineTask(previewTaskId);
    return NextResponse.json({ taskId });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo refinar el modelo" }, { status: 500 });
  }
}
