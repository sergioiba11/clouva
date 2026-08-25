type GitHubFileResponse = {
  sha?: string;
  content?: string;
  encoding?: string;
  path?: string;
  html_url?: string;
};

function githubConfig() {
  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER ?? "sergioiba11";
  const repo = process.env.GITHUB_REPO ?? "clouva";
  const branch = process.env.GITHUB_BRANCH ?? "main";

  if (!token) throw new Error("Falta GITHUB_TOKEN en el servicio de Cloud Run.");

  return { token, owner, repo, branch };
}

function friendlyGitHubError(status: number, raw: string, data: unknown) {
  const contentTypeLooksHtml = /<!doctype html|<html|<head|<body/i.test(raw);

  if (status === 401) return "GitHub rechazó el token configurado. Revisá GITHUB_TOKEN en Cloud Run.";
  if (status === 403) return "GitHub bloqueó temporalmente la solicitud o se alcanzó un límite. Esperá unos segundos y reintentá.";
  if (status === 404) return "GitHub no encontró el repositorio o archivo solicitado.";
  if (status === 409) return "GitHub detectó un conflicto al actualizar el archivo. Volvé a leerlo y reintentá.";
  if (status === 422) return "GitHub rechazó el cambio porque los datos o la versión del archivo ya no coinciden.";
  if (status >= 500 || contentTypeLooksHtml) {
    return "GitHub está temporalmente fuera de servicio. No se modificó ningún archivo. Reintentá en unos minutos.";
  }

  if (typeof data === "object" && data && "message" in data) {
    return String((data as { message?: string }).message ?? `GitHub respondió HTTP ${status}`);
  }

  return `GitHub respondió HTTP ${status}`;
}

async function githubFetch(path: string, init?: RequestInit) {
  const { token } = githubConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    const response = await fetch(`https://api.github.com${path}`, {
      ...init,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
      signal: controller.signal,
    });

    const raw = await response.text();
    let data: unknown = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = null;
    }

    if (!response.ok) {
      throw new Error(friendlyGitHubError(response.status, raw, data));
    }

    if (raw && data === null) {
      throw new Error("GitHub devolvió una respuesta inválida. Reintentá en unos minutos.");
    }

    return data;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("GitHub tardó demasiado en responder. No se modificó ningún archivo.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getRepositoryStatus() {
  const { owner, repo, branch } = githubConfig();
  const data = (await githubFetch(`/repos/${owner}/${repo}`)) as {
    full_name?: string;
    default_branch?: string;
    private?: boolean;
    html_url?: string;
    pushed_at?: string;
  };

  return {
    connected: true,
    repository: data.full_name ?? `${owner}/${repo}`,
    branch: branch || data.default_branch || "main",
    private: Boolean(data.private),
    url: data.html_url,
    pushedAt: data.pushed_at,
  };
}

export async function listRepositoryFiles() {
  const { owner, repo, branch } = githubConfig();
  const data = (await githubFetch(
    `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
  )) as {
    truncated?: boolean;
    tree?: Array<{ path?: string; type?: string; size?: number }>;
  };

  const files = (data.tree ?? [])
    .filter((item) => item.type === "blob" && item.path)
    .map((item) => ({ path: item.path as string, size: item.size ?? 0 }));

  return { files, truncated: Boolean(data.truncated), branch };
}

export async function readRepositoryFile(path: string) {
  const { owner, repo, branch } = githubConfig();
  const normalizedPath = path.replace(/^\/+/, "");
  const data = (await githubFetch(
    `/repos/${owner}/${repo}/contents/${encodeURI(normalizedPath)}?ref=${encodeURIComponent(branch)}`,
  )) as GitHubFileResponse;

  if (!data.content || data.encoding !== "base64") {
    throw new Error("GitHub no devolvió contenido de texto para ese archivo.");
  }

  return {
    path: data.path ?? normalizedPath,
    sha: data.sha ?? "",
    content: Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf8"),
    url: data.html_url,
  };
}

export async function searchRepositoryCode(args: { query: string; path?: string; limit?: number }) {
  const { owner, repo } = githubConfig();
  const query = args.query.trim().slice(0, 200);
  if (query.length < 2) throw new Error("La búsqueda de código debe tener al menos 2 caracteres.");
  const normalizedPath = args.path?.trim().replace(/^\/+|\/+$/g, "").slice(0, 500);
  if (normalizedPath?.split("/").includes("..")) throw new Error("La ruta de búsqueda no es válida.");
  const limit = Math.min(Math.max(args.limit ?? 10, 1), 20);
  const qualifiers = [`repo:${owner}/${repo}`, ...(normalizedPath ? [`path:${normalizedPath}`] : [])];
  const data = (await githubFetch(
    `/search/code?q=${encodeURIComponent(`${query} ${qualifiers.join(" ")}`)}&per_page=${limit}`,
  )) as {
    total_count?: number;
    incomplete_results?: boolean;
    items?: Array<{ name?: string; path?: string; sha?: string; html_url?: string; score?: number }>;
  };
  return {
    total: data.total_count ?? 0,
    incomplete: Boolean(data.incomplete_results),
    results: (data.items ?? []).slice(0, limit).map((item) => ({
      name: item.name ?? "",
      path: item.path ?? "",
      sha: item.sha ?? "",
      url: item.html_url,
      score: item.score ?? null,
    })),
  };
}

export async function writeRepositoryFile(args: {
  path: string;
  content: string;
  message: string;
  expectedSha?: string | null;
}) {
  const { owner, repo, branch } = githubConfig();
  const normalizedPath = args.path.replace(/^\/+/, "");

  let existingSha: string | undefined;
  try {
    const existing = await readRepositoryFile(normalizedPath);
    existingSha = existing.sha || undefined;
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (!message.includes("no encontró")) throw error;
  }

  if (args.expectedSha !== undefined) {
    const expected = args.expectedSha || undefined;
    if (existingSha !== expected) {
      throw new Error(
        "El archivo cambió desde que se preparó el diff. Volvé a pedir el cambio para revisar la versión actual antes de confirmar.",
      );
    }
  }

  const body: Record<string, unknown> = {
    message: args.message,
    content: Buffer.from(args.content, "utf8").toString("base64"),
    branch,
  };
  if (existingSha) body.sha = existingSha;

  const result = (await githubFetch(
    `/repos/${owner}/${repo}/contents/${encodeURI(normalizedPath)}`,
    {
      method: "PUT",
      body: JSON.stringify(body),
    },
  )) as {
    commit?: { sha?: string; html_url?: string };
    content?: { path?: string; html_url?: string };
  };

  return {
    path: result.content?.path ?? normalizedPath,
    commitSha: result.commit?.sha ?? "",
    commitUrl: result.commit?.html_url,
    fileUrl: result.content?.html_url,
    branch,
  };
}
