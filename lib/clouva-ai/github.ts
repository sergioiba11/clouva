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

  if (!token) throw new Error("Falta GITHUB_TOKEN en Railway.");

  return { token, owner, repo, branch };
}

async function githubFetch(path: string, init?: RequestInit) {
  const { token } = githubConfig();
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
  });

  const raw = await response.text();
  let data: unknown = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = raw;
  }

  if (!response.ok) {
    const message =
      typeof data === "object" && data && "message" in data
        ? String((data as { message?: string }).message)
        : raw || `GitHub respondió HTTP ${response.status}`;
    throw new Error(message);
  }

  return data;
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

export async function writeRepositoryFile(args: {
  path: string;
  content: string;
  message: string;
}) {
  const { owner, repo, branch } = githubConfig();
  const normalizedPath = args.path.replace(/^\/+/, "");

  let existingSha: string | undefined;
  try {
    const existing = await readRepositoryFile(normalizedPath);
    existingSha = existing.sha || undefined;
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (!message.includes("not found")) throw error;
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
