import assert from "node:assert/strict";
import test from "node:test";
import importedNextConfig from "./next.config.ts";

const nextConfig = importedNextConfig.default ?? importedNextConfig;

test("Google OAuth profile images use a narrow Next.js remote pattern", () => {
  const patterns = nextConfig.images?.remotePatterns ?? [];
  assert.equal(
    patterns.some(
      (pattern) =>
        !(pattern instanceof URL) &&
        pattern.protocol === "https" &&
        pattern.hostname === "lh3.googleusercontent.com" &&
        pattern.pathname === "/a/**" &&
        !("search" in pattern),
    ),
    true,
  );
  assert.equal(
    patterns.some((pattern) => !(pattern instanceof URL) && pattern.hostname === "**.googleusercontent.com"),
    false,
  );
});
