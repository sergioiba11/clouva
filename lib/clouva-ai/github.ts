type GitHubFileResponse = {
  sha?: string;
  content?: string;
  encoding?: string;
  path?: string;
  html_url?: string;
};

type RepositoryFile = {
  path: string;
  size: number;
  sha: string;
};

type RepositoryTreeChange =
  | { path: string; delete: true; content?: never; encoding?: never }
  | { path: string; delete?: false; content: string; encoding: "utf-8" | "base64" };

const TEXT_FILE_EXTENSIONS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "json", "css", "scss", "md", "mdx", "html", "txt", "yml", "yaml", "sql", "py", "sh", "toml", "xml",
]);
const TRANSIENT_GITHUB_STATUSES = new Set([403, 429, 502, 503, 504]);
const GITHUB_MAX_ATTEMPTS = 2;

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
  if (status === 403 || status === 429) return "GitHub limitó temporalmente esta operación. CLOUVA no modificó ningún archivo.";
  if (status === 404) return "GitHub no encontró el repositorio o archivo solicitado.";
  if (status === 409) return "GitHub detectó un conflicto al actualizar el archivo. Volvé a leerlo y reintentá.";
  if (status === 422) return "GitHub rechazó el cambio porque los datos o la versión del archivo ya no coinciden.";
  if (status >= 500 || contentTypeLooksHtml) {
    return "GitHub está temporalmente fuera de servicio. CLOUVA no modificó ningún archivo.";
  }

  if (typeof data === "object" && data && "message" in data) {
    return String((data as { message?: string }).message ?? `GitHub respondió HTTP ${status}`);
  }

  return `GitHub respondió HTTP ${status}`;
}

function retryDelayMs(response: Response, attempt: number) {
  const retryAfter = Number(response.headers.get("retry-after") ?? "");
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1000, 2_500);
  }
  return 500 * (attempt + 1);
}

async function githubFetch(path: string, init?: RequestInit) {
  const { token } = githubConfig();

  for (let attempt = 0; attempt < GITHUB_MAX_ATTEMPTS; attempt += 1) {
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
        if (TRANSIENT_GITHUB_STATUSES.has(response.status) && attempt + 1 < GITHUB_MAX_ATTEMPTS) {
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs(response, attempt)));
          continue;
        }
        throw new Error(friendlyGitHubError(response.status, raw, data));
      }

      if (raw && data === null) {
        throw new Error("GitHub devolvió una respuesta inválida. CLOUVA no modificó ningún archivo.");
      }

      return data;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        if (attempt + 1 < GITHUB_MAX_ATTEMPTS) continue;
        throw new Error("GitHub tardó demasiado en responder. CLOUVA no modificó ningún archivo.");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error("GitHub no pudo completar la operación. CLOUVA no modificó ningún archivo.");
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
    tree?: Array<{ path?: string; type?: string; size?: number; sha?: string }>;
  };

  const files: RepositoryFile[] = (data.tree ?? [])
    .filter((item) => item.type === "blob" && item.path)
    .map((item) => ({ path: item.path as string, size: item.size ?? 0, sha: item.sha ?? "" }));

  return { files, truncated: Boolean(data.truncated), branch };
}

export async function listPublicRepositoryAssets() {
  const { files, truncated, branch } = await listRepositoryFiles();
  return {
    files: files.filter((file) => file.path.startsWith("public/")),
    truncated,
    branch,
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

async function readRepositoryBlob(path: string) {
  const normalizedPath = path.replace(/^\/+/, "");
  const { owner, repo } = githubConfig();
  const { files } = await listRepositoryFiles();
  const file = files.find((item) => item.path === normalizedPath);
  if (!file?.sha) throw new Error("GitHub no encontró el asset solicitado.");

  const data = (await githubFetch(`/repos/${owner}/${repo}/git/blobs/${file.sha}`)) as {
    content?: string;
    encoding?: string;
    size?: number;
  };
  if (!data.content || data.encoding !== "base64") throw new Error("GitHub no pudo leer el contenido binario del asset.");

  return {
    path: normalizedPath,
    sha: file.sha,
    size: data.size ?? file.size,
    contentBase64: data.content.replace(/\n/g, ""),
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

function publicRuntimePath(repositoryPath: string) {
  const normalized = repositoryPath.replace(/^\/+/, "");
  if (!normalized.startsWith("public/")) throw new Error("Solo se pueden administrar assets dentro de public/.");
  return `/${normalized.slice("public/".length)}`;
}

function isTextFile(path: string) {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  return TEXT_FILE_EXTENSIONS.has(extension);
}

async function findReferenceFiles(needles: string[]) {
  const { owner, repo } = githubConfig();
  const uniqueNeedles = [...new Set(needles.filter((value) => value.length >= 2))]
    .sort((a, b) => a.length - b.length);
  const needle = uniqueNeedles[0];
  if (!needle) return [];

  const data = (await githubFetch(
    `/search/code?q=${encodeURIComponent(`\"${needle}\" repo:${owner}/${repo}`)}&per_page=100`,
  )) as { items?: Array<{ path?: string }> };

  const paths = new Set<string>();
  for (const item of data.items ?? []) {
    if (item.path && isTextFile(item.path)) paths.add(item.path);
  }
  return [...paths];
}

async function commitRepositoryChanges(changes: RepositoryTreeChange[], message: string) {
  if (!changes.length) throw new Error("No hay cambios para guardar en GitHub.");
  const { owner, repo, branch } = githubConfig();

  const ref = (await githubFetch(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`)) as {
    object?: { sha?: string };
  };
  const headSha = ref.object?.sha;
  if (!headSha) throw new Error("GitHub no pudo resolver la rama configurada.");

  const headCommit = (await githubFetch(`/repos/${owner}/${repo}/git/commits/${headSha}`)) as {
    tree?: { sha?: string };
  };
  const baseTreeSha = headCommit.tree?.sha;
  if (!baseTreeSha) throw new Error("GitHub no pudo resolver el árbol actual del repositorio.");

  const tree: Array<{ path: string; mode: "100644"; type: "blob"; sha: string | null }> = [];
  for (const change of changes) {
    if (change.delete) {
      tree.push({ path: change.path, mode: "100644", type: "blob", sha: null });
      continue;
    }

    const content = change.encoding === "base64"
      ? change.content
      : Buffer.from(change.content, "utf8").toString("base64");
    const blob = (await githubFetch(`/repos/${owner}/${repo}/git/blobs`, {
      method: "POST",
      body: JSON.stringify({ content, encoding: "base64" }),
    })) as { sha?: string };
    if (!blob.sha) throw new Error(`GitHub no pudo preparar ${change.path}.`);
    tree.push({ path: change.path, mode: "100644", type: "blob", sha: blob.sha });
  }

  const newTree = (await githubFetch(`/repos/${owner}/${repo}/git/trees`, {
    method: "POST",
    body: JSON.stringify({ base_tree: baseTreeSha, tree }),
  })) as { sha?: string };
  if (!newTree.sha) throw new Error("GitHub no pudo preparar el árbol del cambio.");

  const commit = (await githubFetch(`/repos/${owner}/${repo}/git/commits`, {
    method: "POST",
    body: JSON.stringify({ message, tree: newTree.sha, parents: [headSha] }),
  })) as { sha?: string; html_url?: string };
  if (!commit.sha) throw new Error("GitHub no pudo crear el commit del cambio.");

  await githubFetch(`/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
    method: "PATCH",
    body: JSON.stringify({ sha: commit.sha, force: false }),
  });

  return { commitSha: commit.sha, commitUrl: commit.html_url, branch };
}

export async function renamePublicRepositoryAsset(path: string, requestedName: string) {
  const normalizedPath = path.replace(/^\/+/, "");
  if (!normalizedPath.startsWith("public/")) throw new Error("Solo se pueden renombrar assets dentro de public/.");
  const safeName = requestedName.replace(/[\\/]/g, "-").trim();
  if (!safeName || safeName === "." || safeName === "..") throw new Error("El nuevo nombre no es válido.");

  const slash = normalizedPath.lastIndexOf("/");
  const folder = slash >= 0 ? normalizedPath.slice(0, slash) : "public";
  const nextPath = `${folder}/${safeName}`;
  if (nextPath === normalizedPath) return { path: normalizedPath, name: safeName, updatedReferences: 0, commitSha: "" };

  const { files } = await listRepositoryFiles();
  if (files.some((file) => file.path === nextPath)) throw new Error("Ya existe un asset con ese nombre en esa carpeta.");

  const sourceBlob = await readRepositoryBlob(normalizedPath);
  const oldRuntime = publicRuntimePath(normalizedPath);
  const nextRuntime = publicRuntimePath(nextPath);
  const referenceNeedles = [normalizedPath, oldRuntime, oldRuntime.slice(1)];
  const referencePaths = (await findReferenceFiles(referenceNeedles)).filter((candidate) => candidate !== normalizedPath);

  const changes: RepositoryTreeChange[] = [
    { path: nextPath, content: sourceBlob.contentBase64, encoding: "base64" },
    { path: normalizedPath, delete: true },
  ];
  let updatedReferences = 0;

  for (const referencePath of referencePaths) {
    const current = await readRepositoryFile(referencePath);
    let nextContent = current.content;
    nextContent = nextContent.split(normalizedPath).join(nextPath);
    nextContent = nextContent.split(oldRuntime).join(nextRuntime);
    nextContent = nextContent.split(oldRuntime.slice(1)).join(nextRuntime.slice(1));
    if (nextContent !== current.content) {
      changes.push({ path: referencePath, content: nextContent, encoding: "utf-8" });
      updatedReferences += 1;
    }
  }

  const commit = await commitRepositoryChanges(changes, `admin assets: rename ${normalizedPath} to ${nextPath}`);
  return { path: nextPath, name: safeName, updatedReferences, ...commit };
}

export async function deletePublicRepositoryAsset(path: string) {
  const normalizedPath = path.replace(/^\/+/, "");
  if (!normalizedPath.startsWith("public/")) throw new Error("Solo se pueden eliminar assets dentro de public/.");

  const { files } = await listRepositoryFiles();
  if (!files.some((file) => file.path === normalizedPath)) throw new Error("El asset ya no existe en el repositorio.");

  const runtimePath = publicRuntimePath(normalizedPath);
  const referencePaths = (await findReferenceFiles([normalizedPath, runtimePath, runtimePath.slice(1)]))
    .filter((candidate) => candidate !== normalizedPath);
  if (referencePaths.length) {
    return { deleted: false as const, references: referencePaths.slice(0, 20), totalReferences: referencePaths.length };
  }

  const commit = await commitRepositoryChanges(
    [{ path: normalizedPath, delete: true }],
    `admin assets: delete ${normalizedPath}`,
  );
  return { deleted: true as const, path: normalizedPath, ...commit };
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