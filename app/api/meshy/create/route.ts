import { NextResponse } from "next/server";
import { createMultiImageTask, createPreviewTask, createRefineTask } from "@/lib/meshy";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (body.mode === "multi-image") {
      if (!body.imageUrls?.length) return NextResponse.json({ error: "Falta imageUrls" }, { status: 400 });
      const taskId = await createMultiImageTask(body.imageUrls);
      return NextResponse.json({ taskId });
    }
    if (body.mode === "refine") {
      if (!body.previewTaskId) return NextResponse.json({ error: "Falta previewTaskId" }, { status: 400 });
      const taskId = await createRefineTask(body.previewTaskId);
      return NextResponse.json({ taskId });
    }
    if (!body.prompt) return NextResponse.json({ error: "Falta prompt" }, { status: 400 });

    // La versión actual de Meshy conectada al proyecto solo acepta "realistic".
    // La diferencia visual entre estilos se mantiene dentro del prompt.
    const taskId = await createPreviewTask(body.prompt, "realistic");
    return NextResponse.json({ taskId });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error desconocido" }, { status: 500 });
  }
}
