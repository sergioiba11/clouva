"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type CartItem = { id: string; slug: string; name: string; price: number; image?: string | null; quantity: number; size?: string; color?: string; stock?: number };
type CartState = { items: CartItem[]; add: (item: Omit<CartItem, "quantity">, quantity?: number) => void; remove: (id: string) => void; update: (id: string, quantity: number) => void; clear: () => void; subtotal: () => number };
export const useCart = create<CartState>()(persist((set, get) => ({
  items: [],
  add: (item, quantity = 1) => set((state) => {
    const existing = state.items.find((cartItem) => cartItem.id === item.id);
    if (existing) return { items: state.items.map((cartItem) => cartItem.id === item.id ? { ...cartItem, quantity: Math.min((cartItem.stock ?? 99), cartItem.quantity + quantity) } : cartItem) };
    return { items: [...state.items, { ...item, quantity }] };
  }),
  remove: (id) => set((state) => ({ items: state.items.filter((item) => item.id !== id) })),
  update: (id, quantity) => set((state) => ({ items: state.items.map((item) => item.id === id ? { ...item, quantity: Math.max(1, quantity) } : item) })),
  clear: () => set({ items: [] }),
  subtotal: () => get().items.reduce((total, item) => total + item.price * item.quantity, 0),
}), { name: "clouva-cart" }));
