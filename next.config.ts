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
  // "Comunidad" is retired in favor of the Players/Estudios ecosystem
  // (/matrix, /players, /studios) -- permanent redirects so no duplicate
  // content lives at the old paths, per the Players/Estudios spec.
  async redirects() {
    return [
      { source: "/comunidad", destination: "/matrix", permanent: true },
      { source: "/comunidad/players", destination: "/players", permanent: true },
      { source: "/comunidad/estudios/nuevo", destination: "/studios/nuevo", permanent: true },
      { source: "/comunidad/estudios", destination: "/studios", permanent: true },
      { source: "/comunidad/estudios/:slug", destination: "/studios/:slug", permanent: true },
      { source: "/p/:slug", destination: "/players/:slug", permanent: true },
    ];
  },
};

export default nextConfig;
