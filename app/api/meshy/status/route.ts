import { NextResponse } from "next/server";
import { getTask } from "@/lib/meshy";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const taskId = searchParams.get("taskId");
  if (!taskId) return NextResponse.json({ error: "Falta taskId" }, { status: 400 });
  try {
    const task = await getTask(taskId);
    return NextResponse.json(task);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error desconocido" }, { status: 500 });
  }
}
