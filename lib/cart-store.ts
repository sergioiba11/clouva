"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type CartItem = {
  lineId: string;
  productId: string;
  variantId: string | null;
  slug: string;
  name: string;
  price: number;
  currency: string;
  image?: string | null;
  quantity: number;
  sku?: string | null;
  variantTitle?: string | null;
  size?: string | null;
  color?: string | null;
  stock?: number | null;
};

type AddCartItem = Omit<CartItem, "lineId" | "quantity">;

type CartState = {
  items: CartItem[];
  add: (item: AddCartItem, quantity?: number) => void;
  remove: (lineId: string) => void;
  update: (lineId: string, quantity: number) => void;
  clear: () => void;
  subtotal: () => number;
};

function lineId(productId: string, variantId: string | null) {
  return `${productId}:${variantId ?? "base"}`;
}

function clampQuantity(quantity: number, stock: number | null | undefined) {
  const upperBound = stock == null ? 50 : Math.max(1, stock);
  return Math.max(1, Math.min(upperBound, Math.floor(Number(quantity) || 1)));
}

export const useCart = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      add: (item, quantity = 1) =>
        set((state) => {
          const id = lineId(item.productId, item.variantId);
          const existing = state.items.find((cartItem) => cartItem.lineId === id);
          if (existing) {
            return {
              items: state.items.map((cartItem) =>
                cartItem.lineId === id
                  ? {
                      ...cartItem,
                      quantity: clampQuantity(cartItem.quantity + quantity, cartItem.stock),
                    }
                  : cartItem,
              ),
            };
          }

          return {
            items: [
              ...state.items,
              {
                ...item,
                lineId: id,
                quantity: clampQuantity(quantity, item.stock),
              },
            ],
          };
        }),
      remove: (id) => set((state) => ({ items: state.items.filter((item) => item.lineId !== id) })),
      update: (id, quantity) =>
        set((state) => ({
          items: state.items.map((item) =>
            item.lineId === id ? { ...item, quantity: clampQuantity(quantity, item.stock) } : item,
          ),
        })),
      clear: () => set({ items: [] }),
      subtotal: () => get().items.reduce((total, item) => total + item.price * item.quantity, 0),
    }),
    {
      name: "clouva-cart",
      version: 2,
      merge: (persisted, current): CartState => {
        const previous = persisted as {
          items?: Array<Partial<CartItem> & { id?: string; variantId?: string | null }>;
        };
        const items: CartItem[] = [];

        for (const item of previous.items ?? []) {
          const productId = item.productId ?? item.id;
          if (!productId || !item.slug || !item.name || typeof item.price !== "number") continue;
          const variantId = item.variantId ?? null;
          items.push({
            lineId: lineId(productId, variantId),
            productId,
            variantId,
            slug: item.slug,
            name: item.name,
            price: item.price,
            currency: item.currency ?? "ARS",
            image: item.image,
            quantity: clampQuantity(item.quantity ?? 1, item.stock),
            sku: item.sku,
            variantTitle: item.variantTitle,
            size: item.size,
            color: item.color,
            stock: item.stock,
          });
        }

        return { ...current, items };
      },
    },
  ),
);
