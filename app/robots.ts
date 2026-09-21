import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site-url";

const privateRoutes = [
  "/api/",
  "/admin/",
  "/auth/",
  "/account/",
  "/cuenta/",
  "/checkout/",
  "/carrito",
  "/empleado/",
  "/mi-flow/",
  "/profile/edit/",
  "/debug-auth",
  "/onboarding/",
  "/registro",
  "/login",
  "/studio-dashboard/",
  "/businesses/manage",
  "/businesses/new",
  "/gracias",
  "/pedido/",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: privateRoutes }],
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}
