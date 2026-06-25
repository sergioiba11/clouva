import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site-url";
export default function sitemap(): MetadataRoute.Sitemap { return ["/", "/tienda", "/catalogo", "/carrito", "/checkout"].map((route) => ({ url: `${siteUrl}${route}`, lastModified: new Date() })); }
