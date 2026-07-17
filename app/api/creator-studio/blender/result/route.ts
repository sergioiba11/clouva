import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function workerConfig() {
  const workerUrl =
    process.env.GARMENT_WORKER_URL ??
    process.env.BLENDER_WORKER_URL ??
    "https://rig.clouva.com.ar";
  const workerToken =
    process.env.GARMENT_WORKER_TOKEN ??
    process.env.BLENDER_WORKER_TOKEN;
  return { workerUrl: workerUrl.replace(/\/$/, ""), workerToken };
}

function authHeaders(workerToken?: string) {
  return workerToken ? { Authorization: `Bearer ${workerToken}` } : undefined;
}

function assertSafeWorkerUrl(candidate: string, workerUrl: string) {
  const target = new URL(candidate, workerUrl);
  const expected = new URL(workerUrl);
  if (target.origin !== expected.origin) {
    throw new Error("El worker devolvió una URL de resultado fuera de su origen permitido.");
  }
  return target.toString();
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get("jobId")?.trim();
    if (!jobId) {
      return NextResponse.json({ error: "Falta jobId." }, { status: 400 });
    }

    const { workerUrl, workerToken } = workerConfig();
    const headers = authHeaders(workerToken);
    const statusResponse = await fetch(
      `${workerUrl}/jobs/${encodeURIComponent(jobId)}`,
      { method: "GET", headers, cache: "no-store" },
    );
    const statusData = await statusResponse.json().catch(() => ({}));
    if (!statusResponse.ok) {
      return NextResponse.json(
        { error: "No se pudo consultar el resultado del Auto Rig.", details: statusData },
        { status: statusResponse.status },
      );
    }

    const directUrl = statusData.resultUrl ?? statusData.outputUrl ?? statusData.downloadUrl;
    const resultEndpoint = directUrl
      ? assertSafeWorkerUrl(String(directUrl), workerUrl)
      : `${workerUrl}/jobs/${encodeURIComponent(jobId)}/result.glb`;
    const resultResponse = await fetch(resultEndpoint, {
      method: "GET",
      headers,
      cache: "no-store",
    });

    if (!resultResponse.ok) {
      const details = await resultResponse.text().catch(() => "");
      return NextResponse.json(
        { error: "El GLB riggeado todavía no está disponible.", details },
        { status: resultResponse.status },
      );
    }

    const bytes = await resultResponse.arrayBuffer();
    const magic = new TextDecoder().decode(bytes.slice(0, 4));
    if (magic !== "glTF") {
      return NextResponse.json({ error: "El worker devolvió un archivo que no es GLB." }, { status: 502 });
    }

    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": "model/gltf-binary",
        "Content-Disposition": `attachment; filename="clouva-rigged-${jobId}.glb"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo descargar el GLB riggeado." },
      { status: 500 },
    );
  }
}
