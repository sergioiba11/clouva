import type { Database } from "@/lib/database.types";

export type Category = Database["public"]["Tables"]["categories"]["Row"];
export type Product = Database["public"]["Tables"]["products"]["Row"] & { categories?: Pick<Category, "name" | "slug"> | null; product_images?: Database["public"]["Tables"]["product_images"]["Row"][] };
export type Banner = Database["public"]["Tables"]["banners"]["Row"];
export type Order = Database["public"]["Tables"]["orders"]["Row"];

export const productSelect = "*, categories(name, slug), product_images(*)";
