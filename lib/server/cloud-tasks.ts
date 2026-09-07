import "server-only";

const METADATA_TOKEN_URL =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";

async function getAccessToken(): Promise<string> {
  const response = await fetch(METADATA_TOKEN_URL, {
    headers: { "Metadata-Flavor": "Google" },
    cache: "no-store",
    signal: AbortSignal.timeout(5 * 1000),
  });
  if (!response.ok) {
    throw new Error(`No se pudieron obtener credenciales de Google Cloud (${response.status})`);
  }
  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("Google Cloud no devolvió un access token");
  return data.access_token;
}

function queueConfig() {
  const project = process.env.CLOUVA_GCP_PROJECT || "gen-lang-client-0737053175";
  const location = process.env.CLOUVA_GCP_REGION || "us-central1";
  const queue = process.env.CLOUVA_VIP_PROFILE_QUEUE_NAME || "vip-profile-generation";
  return { project, location, queue };
}

// Every queued step now enters the V3 orchestrator. It delegates all legacy
// stages to the canonical processor and only intercepts Reference Fidelity
// stages, so adaptive layouts keep exactly the existing state machine.
export async function enqueueVipProfileJobStep(jobId: string) {
  const { project, location, queue } = queueConfig();
  const secret = process.env.VIP_PROFILE_TASK_SECRET?.trim();
  if (!secret) throw new Error("VIP_PROFILE_TASK_SECRET no está configurada.");

  const baseUrl = process.env.APP_BASE_URL?.trim() || "https://clouva.com.ar";
  const targetUrl = `${baseUrl}/api/internal/vip-profile/process-job-v3`;
  const token = await getAccessToken();

  const response = await fetch(
    `https://cloudtasks.googleapis.com/v2/projects/${project}/locations/${location}/queues/${queue}/tasks`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        task: {
          httpRequest: {
            httpMethod: "POST",
            url: targetUrl,
            headers: { "Content-Type": "application/json", "x-clouva-vip-task-secret": secret },
            body: Buffer.from(JSON.stringify({ jobId })).toString("base64"),
          },
        },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(15 * 1000),
    },
  );
  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    throw new Error(`No se pudo encolar el paso siguiente (${response.status})${raw ? `: ${raw.slice(0, 500)}` : ""}`);
  }
}
