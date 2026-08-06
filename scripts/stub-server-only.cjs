// Preload-only test helper: node --require ./scripts/stub-server-only.cjs.
// lib/server/**/*.ts import "server-only" to keep webpack from ever bundling
// server code into a client component -- correct in the real Next.js build,
// but the real "server-only" package throws unconditionally under plain
// Node/tsx (no bundler doing the aliasing), which would make it impossible
// to unit-test any pure function that happens to live in a server-only file
// without importing the whole Next.js build pipeline. This intercepts just
// that one bare specifier and resolves it to a no-op module, only for
// `node --test` runs that explicitly preload this file -- never touches the
// real app/build.
const Module = require("node:module");
const path = require("node:path");

const stubPath = path.join(__dirname, "server-only-stub.cjs");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function resolveFilename(request, ...rest) {
  if (request === "server-only") return stubPath;
  return originalResolve.call(this, request, ...rest);
};
