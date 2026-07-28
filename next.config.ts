import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: { remotePatterns: [{ protocol: "https", hostname: "images.unsplash.com" }] },
  // Cloud Build compiles and typechecks the production app here. ESLint remains a
  // separate explicit validation (`npm run lint`) so `next build` does not load
  // a different lint runtime or dependency graph inside the container build.
  eslint: { ignoreDuringBuilds: true },
  // Cloud Run runs the app from a minimal standalone server bundle instead of
  // a full `node_modules` + `next start`.
  output: "standalone",
};

export default nextConfig;
