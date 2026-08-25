export type ProjectToolScope = "hybrid" | "workspace";

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isLocalPreviewUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

/** Local Preview context only narrows tools. Workspace still authenticates
 * the linked device and Desktop still validates permissions server-side. */
export function projectToolScopeFromScreenContext(value: unknown): ProjectToolScope {
  const context = record(value);
  const project = record(context?.project);
  const preview = record(context?.preview);
  const localProject = typeof project?.path === "string" && project.path.trim().length > 0;
  const desktopSurface = context?.surface === "desktop";
  return desktopSurface && localProject && isLocalPreviewUrl(preview?.url)
    ? "workspace"
    : "hybrid";
}
