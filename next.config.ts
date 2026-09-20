import type { NextConfig } from "next";

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'self'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline' https://accounts.google.com https://apis.google.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob: https:",
  "connect-src 'self' https: wss:",
  "frame-src 'self' https://accounts.google.com https://www.youtube.com https://www.youtube-nocookie.com https://open.spotify.com https://w.soundcloud.com https://www.google.com",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(self), geolocation=(self), payment=(self), accelerometer=(self), gyroscope=(self), usb=(), serial=()",
  },
];

const nextConfig: NextConfig = {
  images: {
    // Prefer modern encodings for critical visual assets. The original PNGs
    // remain the canonical sources while Next negotiates AVIF/WebP per browser.
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      // Google OAuth profile photos. Keep this scoped to the exact HTTPS host
      // and avatar path instead of allowing every googleusercontent tenant.
      { protocol: "https", hostname: "lh3.googleusercontent.com", pathname: "/a/**" },
      // Canonical CLOUVA visual assets used by the public portfolio and product.
      { protocol: "https", hostname: "storage.googleapis.com", pathname: "/clouva-generated-media/**" },
    ],
  },
  // Cloud Build compiles and typechecks the production app here. ESLint remains a
  // separate explicit validation (`npm run lint`) so `next build` does not load
  // a different lint runtime or dependency graph inside the container build.
  eslint: { ignoreDuringBuilds: true },
  // Cloud Run runs the app from a minimal standalone server bundle instead of
  // a full `node_modules` + `next start`.
  output: "standalone",
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
  // "Comunidad" is retired in favor of the Players/Estudios ecosystem
  // (/matrix, /players, /studios) -- permanent redirects so no duplicate
  // content lives at the old paths, per the Players/Estudios spec.
  async rewrites() {
    const minecraftMapUpstream = (process.env.MINECRAFT_MAP_UPSTREAM || "http://35.198.44.243:8100").replace(/\/$/, "");
    return [
      {
        source: "/minecraft/map/:path*",
        destination: `${minecraftMapUpstream}/:path*`,
      },
    ];
  },
  async redirects() {
    return [
      { source: "/ninos-rata-server", destination: "/minecraft", permanent: true },
      { source: "/ninos-rata-server/:path*", destination: "/minecraft", permanent: true },
      { source: "/iglu/radio", destination: "/studios/el-iglu/radio", permanent: true },
      { source: "/iglu/radio/:path*", destination: "/studios/el-iglu/radio/:path*", permanent: true },
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
