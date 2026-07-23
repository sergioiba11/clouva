import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: { remotePatterns: [{ protocol: "https", hostname: "images.unsplash.com" }] },
  // Railway compiles and typechecks the production app here. ESLint remains a
  // separate explicit validation (`npm run lint`) so `next build` does not load
  // a different lint runtime or dependency graph inside Nixpacks.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
