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
  const data = await response.json() as { access_token?: string };
  if (!data.access_token) throw new Error("Google Cloud no devolvió un access token");
  return data.access_token;
}

function analyzerJobConfig() {
  const project = process.env.CLOUVA_GCP_PROJECT || "gen-lang-client-0737053175";
  const location = process.env.CLOUVA_GCP_REGION || "us-central1";
  const job = process.env.CLOUVA_ANALYZER_JOB_NAME || "clouva-avatar-analyzer";
  return { project, location, job };
}

type CloudRunOperation = {
  name?: string;
  metadata?: { name?: string };
};

/** Starts one execution of the clouva-avatar-analyzer Cloud Run Job for the given
 * avatar_analyzer_jobs.id, returning the execution's full resource name (needed
 * to cancel it later). */
export async function runAnalyzerJob(jobId: string): Promise<string> {
  const { project, location, job } = analyzerJobConfig();
  const token = await getAccessToken();
  const response = await fetch(
    `https://run.googleapis.com/v2/projects/${project}/locations/${location}/jobs/${job}:run`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        overrides: {
          containerOverrides: [{ env: [{ name: "CLOUVA_ANALYZER_JOB_ID", value: jobId }] }],
        },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(20 * 1000),
    },
  );
  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    throw new Error(`No se pudo iniciar el análisis en Cloud Run (${response.status})${raw ? `: ${raw.slice(0, 500)}` : ""}`);
  }
  const operation = await response.json() as CloudRunOperation;
  const executionName = operation.metadata?.name;
  if (!executionName) throw new Error("Cloud Run no devolvió la ejecución del Job");
  return executionName;
}

/** Cancels a running execution. A 404 (already finished/gone) is treated as success. */
export async function cancelAnalyzerExecution(executionName: string): Promise<void> {
  const token = await getAccessToken();
  const response = await fetch(`https://run.googleapis.com/v2/${executionName}:cancel`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({}),
    cache: "no-store",
    signal: AbortSignal.timeout(20 * 1000),
  });
  if (!response.ok && response.status !== 404) {
    const raw = await response.text().catch(() => "");
    throw new Error(`No se pudo cancelar la ejecución del análisis (${response.status})${raw ? `: ${raw.slice(0, 500)}` : ""}`);
  }
}
