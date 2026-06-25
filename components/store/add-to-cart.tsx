"use client";
import { useState } from "react";
import type { Product } from "@/lib/store-data";
import { useCart } from "@/lib/cart-store";

export function AddToCart({ product }: { product: Product }) {
  const [size, setSize] = useState(product.sizes?.[0] ?? "");
  const [color, setColor] = useState(product.colors?.[0] ?? "");
  const add = useCart((state) => state.add);
  const image = product.product_images?.[0]?.image_url;
  return <div className="space-y-4">
    {product.sizes?.length ? <div><p className="text-sm text-white/60">Talle</p><div className="mt-2 flex gap-2">{product.sizes.map((value) => <button key={value} onClick={() => setSize(value)} className={`rounded-full border px-4 py-2 ${size === value ? "border-white bg-white text-black" : "border-white/15"}`}>{value}</button>)}</div></div> : null}
    {product.colors?.length ? <div><p className="text-sm text-white/60">Color</p><div className="mt-2 flex gap-2">{product.colors.map((value) => <button key={value} onClick={() => setColor(value)} className={`rounded-full border px-4 py-2 ${color === value ? "border-white bg-white text-black" : "border-white/15"}`}>{value}</button>)}</div></div> : null}
    <button disabled={!product.active || product.stock <= 0} onClick={() => add({ id: product.id, slug: product.slug, name: product.name, price: product.price, image, size, color, stock: product.stock })} className="w-full rounded-full bg-white px-6 py-4 font-semibold text-black disabled:cursor-not-allowed disabled:opacity-40">{product.stock > 0 ? "Agregar al carrito" : "Sin stock"}</button>
  </div>;
}
