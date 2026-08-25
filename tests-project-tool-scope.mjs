import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

const { projectToolScopeFromScreenContext } = await import("./lib/clouva-ai/project-tool-scope.ts");

test("Desktop local Web Preview narrows project tools to Workspace", () => {
  assert.equal(projectToolScopeFromScreenContext({
    surface: "desktop",
    project: { id: "clouva", path: "D:\\Clouva\\Clouva app\\clouva" },
    preview: { url: "http://localhost:3000/perfil", state: "running" },
  }), "workspace");
  assert.equal(projectToolScopeFromScreenContext({
    surface: "desktop",
    project: { id: "clouva", path: "D:\\Clouva\\Clouva app\\clouva" },
    preview: { url: "http://127.0.0.1:3000/" },
  }), "workspace");
});

test("non-local and malformed contexts retain the normal hybrid project scope", () => {
  assert.equal(projectToolScopeFromScreenContext({
    surface: "web",
    project: { path: "/repo" },
    preview: { url: "https://clouva.com.ar" },
  }), "hybrid");
  assert.equal(projectToolScopeFromScreenContext({ surface: "desktop", preview: { url: "file:///repo" } }), "hybrid");
  assert.equal(projectToolScopeFromScreenContext(null), "hybrid");
});

test("the canonical Orchestrator removes GitHub tools for a local Preview turn", () => {
  const source = fs.readFileSync(new URL("./app/api/clouva-ai/chat/route.ts", import.meta.url), "utf8");
  const toolService = fs.readFileSync(new URL("./lib/clouva-ai/agent/tool-service.ts", import.meta.url), "utf8");
  const decisionService = fs.readFileSync(new URL("./lib/clouva-ai/agent/tool-decision.ts", import.meta.url), "utf8");
  assert.match(source, /projectScope:\s*projectToolScopeFromScreenContext\(screenContext\)/);
  assert.match(toolService, /if \(options\.projectScope !== "workspace"\) executors\.push\(new GitHubExecutor\(\)\)/);
  assert.match(source, /decidePendingToolAction/);
  assert.match(decisionService, /content: `No se ejecutó \$\{pendingAction\.title\}: \$\{message\}`/);
});
