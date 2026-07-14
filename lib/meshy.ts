const MESHY_BASE = "https://api.meshy.ai/openapi/v2/text-to-3d";
const MESHY_MULTI_IMAGE_BASE = "https://api.meshy.ai/openapi/v1/multi-image-to-3d";

type MeshyTask = {
  id?: string;
  status: "PENDING" | "IN_PROGRESS" | "SUCCEEDED" | "FAILED" | "EXPIRED";
  progress?: number;
  model_urls?: { glb?: string; fbx?: string; obj?: string };
  thumbnail_url?: string;
  task_error?: { message?: string };
};

function getMeshyApiKey() {
  const apiKey = process.env.MESHY_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Falta configurar MESHY_API_KEY en el servidor");
  }
  return apiKey;
}

async function parseMeshyResponse(res: Response) {
  const text = await res.text();
  let data: any = {};

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }

  if (!res.ok) {
    const message =
      data?.message ||
      data?.detail ||
      data?.error?.message ||
      `Meshy respondió ${res.status}`;
    throw new Error(message);
  }

  return data;
}

async function meshyFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${MESHY_BASE}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${getMeshyApiKey()}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  return parseMeshyResponse(res);
}

export async function createPreviewTask(prompt: string, artStyle: "realistic" | "cartoon" = "cartoon") {
  const data = await meshyFetch("", {
    method: "POST",
    body: JSON.stringify({ mode: "preview", prompt, art_style: artStyle, should_remesh: true }),
  });
  return data.result as string;
}

export async function createRefineTask(previewTaskId: string) {
  const data = await meshyFetch("", {
    method: "POST",
    body: JSON.stringify({ mode: "refine", preview_task_id: previewTaskId, enable_pbr: true, target_formats: ["glb"] }),
  });
  return data.result as string;
}

export async function getTask(taskId: string): Promise<MeshyTask> {
  return meshyFetch(`/${encodeURIComponent(taskId)}`);
}

async function meshyFetchAbsolute(url: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${getMeshyApiKey()}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  return parseMeshyResponse(res);
}

export async function createMultiImageTask(imageUrls: string[], texturePrompt?: string) {
  if (imageUrls.length < 2 || imageUrls.length > 4) {
    throw new Error("Meshy necesita entre 2 y 4 imágenes de referencia");
  }

  const body: Record<string, unknown> = {
    image_urls: imageUrls,
    should_texture: true,
    enable_pbr: true,
    target_formats: ["glb"],
  };

  if (texturePrompt?.trim()) {
    body.texture_prompt = texturePrompt.trim().slice(0, 600);
  }

  const data = await meshyFetchAbsolute(MESHY_MULTI_IMAGE_BASE, {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (!data?.result || typeof data.result !== "string") {
    throw new Error("Meshy no devolvió un ID de generación válido");
  }

  return data.result as string;
}

export async function getMultiImageTask(taskId: string): Promise<MeshyTask> {
  return meshyFetchAbsolute(`${MESHY_MULTI_IMAGE_BASE}/${encodeURIComponent(taskId)}`);
}
