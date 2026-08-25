"use client";

import { useMemo, useState } from "react";
import {
  availableCommerceVariants,
  commerceProductImages,
  commerceVariantPrice,
  type CommerceProduct,
  type CommerceVariant,
} from "@/lib/commerce-store-data";
import { useCart } from "@/lib/cart-store";
import { money } from "@/lib/store-utils";

export function AddToCart({ product }: { product: CommerceProduct }) {
  const variants = useMemo(() => availableCommerceVariants(product), [product]);
  const initialVariant = variants.find((variant) => variant.stock > 0) ?? variants[0] ?? null;
  const [variantId, setVariantId] = useState(initialVariant?.id ?? "");
  const [size, setSize] = useState(initialVariant?.size ?? "");
  const [color, setColor] = useState(initialVariant?.color ?? "");
  const add = useCart((state) => state.add);

  const selectedVariant = variants.find((variant) => variant.id === variantId) ?? null;
  const sizes = [...new Set(variants.map((variant) => variant.size).filter((value): value is string => Boolean(value)))];
  const colors = [...new Set(variants.map((variant) => variant.color).filter((value): value is string => Boolean(value)))];
  const image = commerceProductImages(product)[0];
  const price = commerceVariantPrice(product, selectedVariant);
  const stock = selectedVariant ? selectedVariant.stock : product.stock;
  const comingSoon = product.metadata?.availability === "coming_soon";
  const available = !comingSoon && (variants.length ? Boolean(selectedVariant?.active && selectedVariant.stock > 0) : stock == null || stock > 0);

  function chooseVariant(candidate: CommerceVariant | undefined) {
    if (!candidate) return;
    setVariantId(candidate.id);
    setSize(candidate.size ?? "");
    setColor(candidate.color ?? "");
  }

  function chooseSize(value: string) {
    chooseVariant(
      variants.find((variant) => variant.size === value && (!color || variant.color === color)) ??
        variants.find((variant) => variant.size === value),
    );
  }

  function chooseColor(value: string) {
    chooseVariant(
      variants.find((variant) => variant.color === value && (!size || variant.size === size)) ??
        variants.find((variant) => variant.color === value),
    );
  }

  return (
    <div className="space-y-4">
      {sizes.length ? (
        <div>
          <p className="text-sm text-white/60">Talle</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {sizes.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => chooseSize(value)}
                className={`rounded-full border px-4 py-2 ${
                  size === value ? "border-white bg-white text-black" : "border-white/15"
                }`}
              >
                {value}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {colors.length ? (
        <div>
          <p className="text-sm text-white/60">Color</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {colors.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => chooseColor(value)}
                className={`rounded-full border px-4 py-2 ${
                  color === value ? "border-white bg-white text-black" : "border-white/15"
                }`}
              >
                {value}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {variants.length ? (
        <p className="text-sm text-white/50">
          {selectedVariant?.sku ? `SKU ${selectedVariant.sku} · ` : ""}
          {selectedVariant ? `${selectedVariant.stock} disponibles` : "Elegí una combinación disponible"}
        </p>
      ) : null}

      <div className="text-xl font-semibold text-[#95d8ff]">{money(price, product.currency)}</div>

      <button
        type="button"
        disabled={!available}
        onClick={() =>
          add({
            productId: product.id,
            variantId: selectedVariant?.id ?? null,
            slug: product.slug,
            name: product.name,
            price,
            currency: product.currency,
            image,
            sku: selectedVariant?.sku,
            variantTitle: selectedVariant?.title,
            size: selectedVariant?.size,
            color: selectedVariant?.color,
            stock,
          })
        }
        className="w-full rounded-full bg-white px-6 py-4 font-semibold text-black disabled:cursor-not-allowed disabled:opacity-40"
      >
        {comingSoon ? "Próximamente" : available ? "Agregar al carrito" : "Sin stock"}
      </button>
    </div>
  );
}
