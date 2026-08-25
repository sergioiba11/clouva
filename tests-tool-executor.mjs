import assert from "node:assert/strict";
import { test } from "node:test";

process.env.GITHUB_TOKEN = process.env.GITHUB_TOKEN || "test-token";
process.env.GITHUB_OWNER = process.env.GITHUB_OWNER || "sergioiba11";
process.env.GITHUB_REPO = process.env.GITHUB_REPO || "clouva";
process.env.GITHUB_BRANCH = process.env.GITHUB_BRANCH || "main";

const { GitHubExecutor } = await import("./lib/clouva-ai/github-executor.ts");

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  const raw = JSON.stringify(body);
  return { ok, status, text: async () => raw };
}

test("GitHubExecutor exposes the authenticated GitHub read/search/write tools", () => {
  const executor = new GitHubExecutor();
  assert.equal(executor.target, "github");

  const tools = executor.tools();
  const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));

  assert.deepEqual(
    Object.keys(byName).sort(),
    ["github_get_status", "github_list_files", "github_read_file", "github_search_code", "github_write_file"].sort(),
  );
  assert.equal(byName.github_get_status.risk, "read");
  assert.equal(byName.github_list_files.risk, "read");
  assert.equal(byName.github_read_file.risk, "read");
  assert.equal(byName.github_search_code.risk, "read");
  assert.equal(byName.github_write_file.risk, "write");
  assert.deepEqual(byName.github_write_file.parameters.required, ["path", "content", "message"]);
  assert.equal("confirm" in byName.github_write_file.parameters.properties, false);
});

test("github_search_code uses the authenticated repository and bounds results", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    assert.match(decodeURIComponent(String(url)), /\/search\/code\?q=ToolRouter repo:sergioiba11\/clouva/);
    return jsonResponse({ total_count: 1, items: [{ name: "tool-router.ts", path: "lib/clouva-ai/tool-router.ts", sha: "abc" }] });
  };

  try {
    const result = await new GitHubExecutor().getTool("github_search_code").execute({ query: "ToolRouter", limit: 5 });
    assert.equal(result.total, 1);
    assert.equal(result.results[0].path, "lib/clouva-ai/tool-router.ts");
  } finally {
    global.fetch = originalFetch;
  }
});

test("getTool() looks up by exact name and returns undefined for unknown tools", () => {
  const executor = new GitHubExecutor();
  assert.equal(executor.getTool("github_read_file")?.name, "github_read_file");
  assert.equal(executor.getTool("workspace_read_file"), undefined);
});

test("github_read_file executes straight through to readRepositoryFile()", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    assert.match(String(url), /\/repos\/sergioiba11\/clouva\/contents\/README\.md/);
    return jsonResponse({
      path: "README.md",
      sha: "abc123",
      content: Buffer.from("# CLOUVA").toString("base64"),
      encoding: "base64",
    });
  };

  try {
    const executor = new GitHubExecutor();
    const result = await executor.getTool("github_read_file").execute({ path: "README.md" });
    assert.equal(result.content, "# CLOUVA");
    assert.equal(result.sha, "abc123");
  } finally {
    global.fetch = originalFetch;
  }
});

test("github_write_file rejects without confirm=true and never calls fetch", async () => {
  const originalFetch = global.fetch;
  let fetchCalled = false;
  global.fetch = async () => {
    fetchCalled = true;
    throw new Error("should not be called");
  };

  try {
    const executor = new GitHubExecutor();
    await assert.rejects(
      () => executor.getTool("github_write_file").execute({ path: "a.md", content: "x", message: "m", confirm: false }),
      /confirmación explícita/,
    );
    assert.equal(fetchCalled, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test("github_write_file with confirm=true commits through writeRepositoryFile()", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init?.method ?? "GET" });
    if (!init?.method) {
      // writeRepositoryFile() reads the existing file first to get its sha —
      // simulate "not found" (a brand-new file), which the real function
      // already treats as non-fatal.
      return jsonResponse({ message: "Not Found" }, { ok: false, status: 404 });
    }
    return jsonResponse({
      commit: { sha: "deadbeef", html_url: "https://github.com/x/y/commit/deadbeef" },
      content: { path: "a.md", html_url: "https://github.com/x/y/blob/main/a.md" },
    });
  };

  try {
    const executor = new GitHubExecutor();
    const result = await executor
      .getTool("github_write_file")
      .execute({ path: "a.md", content: "hola", message: "feat: a", confirm: true });

    assert.equal(result.commitSha, "deadbeef");
    assert.equal(result.path, "a.md");
    assert.equal(calls.length, 2);
    assert.equal(calls[1].method, "PUT");
  } finally {
    global.fetch = originalFetch;
  }
});

test("github_write_file rejects a stale diff instead of overwriting a newer file", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (_url, init) => {
    calls.push(init?.method ?? "GET");
    return jsonResponse({
      path: "a.md",
      sha: "newer-sha",
      content: Buffer.from("contenido nuevo").toString("base64"),
      encoding: "base64",
    });
  };

  try {
    const executor = new GitHubExecutor();
    await assert.rejects(
      () => executor
        .getTool("github_write_file")
        .execute({ path: "a.md", content: "propuesta vieja", message: "feat: a", confirm: true, expectedSha: "old-sha" }),
      /cambió desde que se preparó el diff/i,
    );
    assert.deepEqual(calls, ["GET"]);
  } finally {
    global.fetch = originalFetch;
  }
});
