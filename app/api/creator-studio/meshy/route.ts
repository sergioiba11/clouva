import { NextResponse } from "next/server";

export const runtime = "nodejs";

type MeshyRequest = {
  prompt?: string;
  category?: string;
  quality?: string;
  polycount?: number;
  textureResolution?: number;
  imageUrl?: string;
};

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as MeshyRequest;
    if (!payload.prompt?.trim() && !payload.imageUrl) {
      return NextResponse.json({ error: "Se necesita un prompt o una imagen de referencia." }, { status: 400 });
    }

    const apiKey = process.env.MESHY_API_KEY;
    const endpoint = process.env.MESHY_API_URL ?? "https://api.meshy.ai/openapi/v2/text-to-3d";

    if (!apiKey) {
      return NextResponse.json({
        ok: true,
        mock: true,
        taskId: `meshy_preview_${Date.now()}`,
        status: "PENDING_CONFIGURATION",
        message: "El módulo está instalado. Agregá MESHY_API_KEY en Vercel para activar la generación real.",
      });
    }

    const meshyPayload = payload.imageUrl
      ? {
          image_url: payload.imageUrl,
          ai_model: "meshy-5",
          topology: "quad",
          target_polycount: payload.polycount ?? 30000,
          should_texture: true,
        }
      : {
          mode: "preview",
          prompt: `${payload.category ? `${payload.category}. ` : ""}${payload.prompt}`,
          ai_model: "meshy-5",
          topology: "quad",
          target_polycount: payload.polycount ?? 30000,
          should_remesh: true,
          symmetry_mode: "auto",
        };

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(meshyPayload),
      cache: "no-store",
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return NextResponse.json({ error: "Meshy rechazó la solicitud.", details: data }, { status: response.status });
    }

    return NextResponse.json({
      ok: true,
      mock: false,
      taskId: data.result ?? data.id ?? data.task_id,
      status: data.status ?? "PENDING",
      raw: data,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error inesperado al conectar con Meshy." }, { status: 500 });
  }
}
