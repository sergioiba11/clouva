const MESHY_API_KEY = "msy_5C5stJjDlIJrYF1esBtQUhc7AsHrQCwLYMbf";
const MESHY_BASE = "https://api.meshy.ai/openapi/v2/text-to-3d";

type MeshyTask = {
  id?: string;
  status: "PENDING" | "IN_PROGRESS" | "SUCCEEDED" | "FAILED" | "EXPIRED";
  progress?: number;
  model_urls?: { glb?: string; fbx?: string; obj?: string };
  thumbnail_url?: string;
  task_error?: { message?: string };
};

async function meshyFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${MESHY_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${MESHY_API_KEY}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.message || `Meshy respondió ${res.status}`);
  }
  return data;
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
  return meshyFetch(`/${taskId}`);
}
