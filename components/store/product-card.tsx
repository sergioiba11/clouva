import Link from "next/link";
import type { Product } from "@/lib/store-data";
import { money } from "@/lib/store-utils";

export function ProductCard({ product }: { product: Product }) {
  const image = product.product_images?.[0]?.image_url;
  return <Link href={`/producto/${product.slug}`} className="group overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.03] transition hover:-translate-y-1 hover:bg-white/[0.06]">
    <div className="aspect-[4/5] bg-white/[0.04]">{image ? <img src={image} alt={product.name} className="h-full w-full object-cover transition duration-500 group-hover:scale-105" /> : <div className="flex h-full items-center justify-center text-white/30">CLOUVA</div>}</div>
    <div className="p-5"><p className="text-xs uppercase tracking-[0.2em] text-white/45">{product.categories?.name ?? "Drop"}</p><h3 className="mt-2 text-lg font-medium">{product.name}</h3><div className="mt-3 flex items-center gap-2"><span className="text-[#95d8ff]">{money(product.price)}</span>{product.old_price ? <span className="text-sm text-white/35 line-through">{money(product.old_price)}</span> : null}</div></div>
  </Link>;
}
