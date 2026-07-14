import { NextRequest, NextResponse } from "next/server";
import { createRefineTask } from "@/lib/meshy";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const previewTaskId = typeof body?.previewTaskId === "string" ? body.previewTaskId : "";
    const texturePrompt = typeof body?.texturePrompt === "string" ? body.texturePrompt.slice(0, 600) : "";
    if (!previewTaskId) return NextResponse.json({ error: "Falta previewTaskId" }, { status: 400 });
    const taskId = await createRefineTask(previewTaskId, texturePrompt);
    return NextResponse.json({ taskId });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo aplicar la textura" }, { status: 500 });
  }
}
