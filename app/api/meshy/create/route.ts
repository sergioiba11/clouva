import { NextResponse } from "next/server";
import { createPreviewTask, createRefineTask } from "@/lib/meshy";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (body.mode === "refine") {
      if (!body.previewTaskId) return NextResponse.json({ error: "Falta previewTaskId" }, { status: 400 });
      const taskId = await createRefineTask(body.previewTaskId);
      return NextResponse.json({ taskId });
    }
    if (!body.prompt) return NextResponse.json({ error: "Falta prompt" }, { status: 400 });
    const taskId = await createPreviewTask(body.prompt, body.artStyle ?? "cartoon");
    return NextResponse.json({ taskId });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error desconocido" }, { status: 500 });
  }
}
